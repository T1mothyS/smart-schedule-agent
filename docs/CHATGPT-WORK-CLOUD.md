# ChatGPT Work Cloud 日报正式发布与并行回滚链路

本文档描述把日报 V2 迁移到 ChatGPT Work Cloud 的并行与正式发布实现。当前代码已提供 OAuth/MCP、来源维度的生产写入、Cloud Context 边界和隔离的媒体准备批次；媒体准备服务的生产部署与真实 Work 选图验证需要按本轮验收记录单独确认。正式发布和本地链路切换仍未执行。

这里的“云端”指 ChatGPT Work 的后台任务运行环境；它不能直接读取本机 `日报-v2` worktree 或本地令牌。当前分支中的 Skill、结构化校验器和渲染器是待打包的源材料，尚未安装为 Work 可用的插件/Skill 资源，因此现在还不能仅凭本地文件路径创建可运行的 Work 定时任务。

## 目标架构

```text
ChatGPT Work scheduled task
    │ OAuth 2.1 + PKCE + offline_access
    ▼
AI Calendar /mcp
    ├─ read_inputs -> Calendar / QQ 未读摘要 / Cloud Context / 日报历史
    ├─ Work Cloud 网络 -> 公开新闻、市场和可靠媒体候选 URL
    ├─ Work Skill -> daily-digest.v1 JSON
    ├─ media_prepare_start/media_prepare -> 服务端受控抓取、校验、哈希和托管
    └─ publish(dry_run=true|false, mediaBatchId=...)
             ├─ true  -> VALIDATED_NOT_PUBLISHED（不写日报、不入邮件队列）
             └─ false -> 仅使用 READY 批次媒体 -> PUBLISHED
                                      └─ source=cloud 日报记录
                                           ├─ RECEIVED -> 正式网页 + Cloud 邮件队列
                                           └─ CANDIDATE -> 候选对照（不进正式网页/邮件）

现有本地链路：继续由 v2-chatgpt -> run_daily.ps1 独立运行，作为当前生产和回滚链路。
```

## 服务端接口

OAuth 元数据和动态注册：

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-protected-resource/mcp`
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-authorization-server/mcp`
- `POST /oauth/register`
- `GET/POST /oauth/authorize*`
- `POST /oauth/token`
- `POST /oauth/revoke`

MCP 地址为 `APP_URL` 的 origin 加 `/mcp`。生产环境必须使用 HTTPS；把地址交给 Work 前，先人工确认服务实际域名和两个 `.well-known` 响应，不要从历史记录猜测域名。

兼容性要求：`tools/list` 为每个工具声明 `securitySchemes: [{ type: "oauth2", scopes: [...] }]`；如果工具调用因缺少 scope 被拒绝，MCP 结果必须带 `isError: true` 和 `_meta["mcp/www_authenticate"]`（数组中的 challenge 至少包含 `error` 与 `error_description`）。这两层都存在时，Work 才能在工具级别显示重新授权入口；本候选分支的 API 测试覆盖了这条契约。

MCP 工具如下：

| 工具 | 权限 | 说明 |
|---|---|---|
| `daily_report.read_inputs` | 四个 read scope | 一次读取日报所需的账号数据 |
| `daily_report.read_calendar` | `daily_report:read_calendar` | 读取指定日期日程 |
| `daily_report.read_mail` | `daily_report:read_mail` | 读取 QQ 未读摘要，不返回授权码 |
| `daily_report.read_context` | `daily_report:read_context` | 读取脱敏 Context 和活动证据 |
| `daily_report.read_history` | `daily_report:read_history` | 读取最近日报摘要/哈希 |
| `daily_report.publish` | `daily_report:publish` | 使用兼容路径或已 READY 媒体批次 dry-run/发布 |
| `daily_report.media_prepare_start` | `daily_report:media_prepare` | 创建绑定账号、日期和 runId 的媒体批次 |
| `daily_report.media_prepare` | `daily_report:media_prepare` | 按候选顺序由服务器抓取、校验和托管图片 |
| `daily_report.media_prepare_status` | `daily_report:media_prepare` | 读取批次状态、assetKey、hash 和失败原因 |

Work 连接应申请：

```text
daily_report:read_calendar
daily_report:read_mail
daily_report:read_context
daily_report:read_history
daily_report:publish
daily_report:media_prepare
offline_access
```

OAuth 令牌只保存在数据库的 SHA-256 哈希；人工登录/权限审阅请求有效 30 分钟，授权码一次性使用且 5 分钟过期，访问令牌 15 分钟过期，刷新令牌轮换并支持撤销。客户端为公开 PKCE 客户端，不使用 `client_secret`。账号禁用会立即阻止新的 MCP bearer 请求。

日报来源接收策略使用登录态接口：

- `GET /api/daily-report/delivery-policy`
- `PUT /api/daily-report/delivery-policy`，正文只允许 `{"sources":["local","cloud"]}`；空数组表示两边都暂不接收

网页设置只保留“接收并转发本地日报”和“接收并转发 Cloud 日报”两个开关。它不暂停本地或 Work 任务，不删除候选或历史，也不追溯发送；下一次正式发布时，两个来源都仍先写生产记录，再根据开关标记为 `RECEIVED` 或 `CANDIDATE`。同日 Local/Cloud 按来源和内容哈希分别保存，邮件去重键也包含来源。

## Cloud Context 导入

V2 本地 Context 仍是当前本地链路的编辑源。一次性迁移时：

1. 在 V2 分支运行 `python scripts/export_cloud_context.py --output <temporary-json>`。
2. 人工核对 JSON 只含 `profile`、`preferences`、`recent_interests`、`watchlist`、`theses` 等最小信息，没有凭据、本地路径、邮箱原文或无关身份资料。
3. 使用 AI Calendar 登录态调用 `PUT /api/daily-report/cloud-context`，正文形如 `{"context": <导出 JSON>}`。实现会再次拒绝凭据字段/值，并按账号递增版本。
4. 删除或按本机安全流程处理临时导出文件；它不应进入 Git、Work prompt、日报或日志。

活动证据通过登录态 `POST /api/daily-report/cloud-activity` 主动维护，MCP 不允许模型写入。Calendar 和邮件则由服务端实时读取，不复制到长期 Context。

## 发布语义

Work 必须先生成 `daily-digest.v1` JSON，再调用已经随 Work Skill 提供的等价确定性渲染器（当前 V2 分支的 `scripts/cloud_digest.py` 是待打包源材料）生成 Markdown。不能让 Work 任务引用本地路径，也不能把“模型直接写 Markdown”当作渲染器替代。

新媒体路径先调用 `daily_report.media_prepare_start`，再将每个新闻条目的 `assetKey` 和 1–5 个候选 URL 交给 `daily_report.media_prepare`。服务器执行：

- redirect、DNS/IP/SSRF、超时和大小限制；
- HTTP `Content-Type` 与图片 magic bytes 双重校验；
- SHA-256 去重、原子写入和批次归属记录；
- 每个候选的成功/失败结果和 fallback 过程。

带 `mediaBatchId` 的 `daily_report.publish` 会要求 `runId`、`requiredAssetKeys`、READY 批次、真实文件校验和 Markdown 中所有媒体均属于该批次；该分支不会在 publish 阶段抓取外链或静默替换为空。环境变量 `CLOUD_DAILY_REPORT_MEDIA_BATCH_REQUIRED` 默认保持 `false`，用于在正式 Work 提示词切换前保留旧版兼容路径；通过隔离验收后才可单独启用。

`daily_report.publish` 的 `dry_run=true` 会在服务端执行日期、结构化标记、内容完整性和批次媒体检查：

dry-run 返回 `VALIDATED_NOT_PUBLISHED` 才能进行同正文正式发布。新媒体批次中任何必需图片失败都会停留在非 READY 状态，Work 应更换候选后重试，不得降低图片质量要求。正式调用必须使用 `dry_run=false`，并以返回 `status=PUBLISHED` 作为“已写入生产服务器”的硬性回执；`source` 必须由服务端标记为 `cloud`。随后 `deliveryStatus=RECEIVED` 或 `CANDIDATE` 只表示是否进入正式网页和邮件，`QUEUED` 只代表邮件已入队，不代表 SMTP accepted 或收件箱到达。

## 第二阶段第一轮状态（2026-09-13）

- 已在本地实现并测试 `media_prepare_start`、`media_prepare`、`media_prepare_status`、批次归属/生命周期、候选 fallback、服务器受控抓取和严格批次发布检查。
- 现有 Local V2 与 Cloud 兼容发布路径保留；`CLOUD_DAILY_REPORT_MEDIA_BATCH_REQUIRED` 未开启，正式 Work 定时任务未改写，relay 未部署。
- 进入生产切换前仍需用真实生产服务器完成 10–20 个公开 URL 的来源分布/成功率验收，再用独立 Work 对话提交 3–5 个候选并确认不发布、不发信。

## 当前运行证据（2026-09-09）

- 生产候选服务：`gotimothy.online` 当前发布标识为 `workspace-20260909-cloud-mcp-11`，基于 Calendar 候选分支的 `fb77c8a`；公网 health、OAuth metadata、保护资源和未授权 `/mcp` 已完成状态检查。
- Work 连接：已完成 OAuth 授权并确认 Daily Report Cloud 工具可调用；脱敏 Cloud Context 已通过设置页导入，云端显示版本 `v1`。本地临时导出文件已删除，原始本地 Context 仍是编辑源。
- Shadow：2026-09-09 的 Calendar、Mail、Context、History 和公开新闻输入均返回可用；首轮缺少固定标题被服务端拒绝，修正为逐字包含 `# Daily Digest`、`<!-- daily-digest.v1 -->`、`## Today at a Glance` 后，`daily_report.publish(dry_run=true)` 返回 `VALIDATED_NOT_PUBLISHED`，媒体数量为 `0`，未写入日报或邮件队列。
- Work 调度：已创建并启用 `日报 V2 Cloud Shadow`，任务编辑器显示每天 `16:40`，提示词固定使用 `Asia/Shanghai`，并明确禁止 `dry_run=false`、正式发布、发邮件和修改本地链路。
- 并行边界：本地 `v2-chatgpt` 任务和本地采集/发布链路未修改，生产服务保留部署前备份和 rollback 目录。

## 目前未做的事情

- 尚未完成至少 3 个日期的连续 shadow，也未覆盖 Calendar 无数据/不可用、邮箱部分失败或不可用和公开新闻源异常的对照测试。
- 没有执行云端正式 `PUBLISHED`，也没有验证通知队列、SMTP/provider 或收件箱最终到达；当前任务仅用于 shadow dry-run。
- 尚未证明 Work 侧已安装可执行的 `cloud_digest.py` 等打包资源；当前任务提示词已固化结构和安全边界，因此仍按候选 shadow 处理，不把一次 `VALIDATED_NOT_PUBLISHED` 当作迁移完成。
- 没有暂停、改写或删除现有 `v2-chatgpt` 本地任务。
- 没有把本地公开资料采集器强行改成云端 prompt；Work 运行时需要按 Skill 使用云端网络重新核实新闻、市场和图片。

切换前按 V2 分支的 `skills/daily-report-cloud/references/cutover.md` 执行至少三个日期的 shadow、故障矩阵、通知分层和回滚演练。
