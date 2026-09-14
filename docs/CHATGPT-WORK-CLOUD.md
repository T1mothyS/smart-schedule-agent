# ChatGPT Work Cloud 日报正式发布与并行回滚链路

本文档描述把日报 V2 迁移到 ChatGPT Work Cloud 的并行与正式发布实现。当前代码已提供 OAuth/MCP、来源维度的生产写入、Cloud Context 边界和隔离的媒体准备批次；媒体准备服务已部署并完成真实 Work 选图验证。2026-09-14 的内容完整性优先与兼容媒体降级代码已按本地预构建路径上线，但正式 Work 发布和本地链路切换仍未执行。

这里的“云端”指 ChatGPT Work 的后台任务运行环境；它不能直接读取本机 `日报-v2` worktree 或本地令牌。V2 的 Skill、结构化校验器和渲染器源材料及插件副本已经同步并通过本地验证，但本地文件路径不是 Work 资源安装证明；现有 Work 任务仍按已保存的 Shadow 边界运行。

## 目标架构

```text
ChatGPT Work scheduled task
    │ OAuth 2.1 + PKCE + offline_access
    ▼
AI Calendar /mcp
    ├─ read_inputs -> Calendar / QQ 未读摘要 / Cloud Context / 日报历史
    ├─ Work Cloud 网络 -> 公开新闻、市场和可靠媒体候选 URL
    ├─ Work Skill -> daily-digest.v1 JSON
    ├─ 可选 media_prepare_start/media_prepare -> 严格批次受控抓取、校验、哈希和托管
    └─ publish(dry_run=true|false)
             ├─ true  -> VALIDATED_NOT_PUBLISHED（不写日报、不入邮件队列）
             └─ false -> 内容完整性 + 逐图媒体 Best Effort -> PUBLISHED
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

OAuth 令牌只保存在数据库的 SHA-256 哈希；人工登录/权限审阅请求有效 30 分钟，授权码一次性使用且 5 分钟过期，访问令牌 15 分钟过期，刷新令牌在 30 天有效期内保持稳定并支持撤销。保持稳定是为了兼容定时任务客户端未可靠保存刷新响应的情况；客户端为公开 PKCE 客户端，不使用 `client_secret`。账号禁用会立即阻止新的 MCP bearer 请求。

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

严格媒体批次路径先调用 `daily_report.media_prepare_start`，再将每个新闻条目的 `assetKey` 和 1–5 个候选 URL 交给 `daily_report.media_prepare`。默认 Cloud 兼容路径不要求预先创建批次，而是在 `daily_report.publish` 内逐图尝试媒体托管。服务器执行：

- redirect、DNS/IP/SSRF、超时和大小限制；
- HTTP `Content-Type` 与图片 magic bytes 双重校验；
- SHA-256 去重、原子写入和批次归属记录；
- 每个候选的成功/失败结果和 fallback 过程。

带 `mediaBatchId` 的 `daily_report.publish` 会要求 `runId`、`requiredAssetKeys`、READY 批次、真实文件校验和 Markdown 中所有媒体均属于该批次；该分支不会在 publish 阶段抓取外链或静默替换为空。未提供批次时，服务端对每个显式图片逐图执行受控抓取，失败项替换为 `图片：—`/`来源图标：—` 并返回失败代码，不阻断通过内容完整性校验的日报。环境变量 `CLOUD_DAILY_REPORT_MEDIA_BATCH_REQUIRED` 默认保持 `false`，用于保留兼容路径；通过隔离验收后才可单独启用严格批次。

`daily_report.publish` 的 `dry_run=true` 会在服务端执行日期、结构化标记、内容完整性和媒体检查：

dry-run 返回 `VALIDATED_NOT_PUBLISHED` 才能进行同正文正式发布。兼容路径允许 `imageCount=0`，但必须如实保留 `candidateImageCount`、`mediaFailureCount` 和 `mediaFailures`；严格媒体批次中任何必需图片失败仍会停留在非 READY 状态，不能降低该批次质量要求。正式调用必须使用 `dry_run=false`，并以返回 `status=PUBLISHED` 作为“已写入生产服务器”的硬性回执；`source` 必须由服务端标记为 `cloud`。随后 `deliveryStatus=RECEIVED` 或 `CANDIDATE` 只表示是否进入正式网页和邮件，`QUEUED` 只代表邮件已入队，不代表 SMTP accepted 或收件箱到达。

## 第二阶段第一轮状态（2026-09-13）

- 本地已实现并测试 `media_prepare_start`、`media_prepare`、`media_prepare_status`、批次归属/生命周期、候选 fallback、服务器受控抓取和严格批次发布检查；生产基线为 commit `6767ae8`、版本 `0.20.4-260913.2139`。
- 第一轮真实 Work 负向矩阵已完成：批次 `19f8cb8e-6a5c-433c-a498-1e8bc6af2f26` 处理 12 个 asset，`PREPARING`、`hostedCount=1`、`failedCount=11`、`totalBytes=30320`。`gstatic.com` 的 WebP 成功托管；HTTP 403/404、HTML/错误 MIME、SSRF/private IP 均由服务器归因。`upload.wikimedia.org` 在阿里云服务器侧连接超时，属于服务器到源站的网络不可达，不是 Work 没有提交 URL。
- 正向真实 Work 复核已通过：新批次 `e61b22b4-2bf8-40f5-a433-73ebf7d9120d`、runId `cloud-media-1cd4ba3b-7a9a-4dab-8011-8c8063497202`，状态 `READY`，4/4 托管、0 失败、总计 `134598` bytes。`hero-fallback` 先收到 HTTP 404，再使用第二候选成功；PNG、JPEG、WebP 均返回服务器生成的 MIME、字节数、SHA-256 和 `hostedUrl`。Work 的 `media_prepare` 与 `media_prepare_status` 明细完全一致。
- 服务器独立复核确认 4 个文件真实存在于 `data/daily-report-media`，磁盘 hash/大小与数据库一致，4 个 `hostedUrl` 均返回 HTTP 200 且 MIME/长度匹配；本轮发生过一次 OAuth 重新授权，未观察到人工审批。
- 现有 Local V2 与 Cloud 兼容发布路径保留；`CLOUD_DAILY_REPORT_MEDIA_BATCH_REQUIRED` 未开启，正式 Work 定时任务未改写，relay 未部署。本轮未调用 publish、未入队、未发邮件。

## 第三阶段：内容完整性优先与媒体降级（2026-09-14）

- 主项目 `main` 已建立本地 checkpoint `9c039d5b1acc6ab92a6ab1fd75335b7e0bf956ae`，版本为 `0.20.5-260914.0808`；Cloud 兼容路径保留 Calendar 日程、Mail Briefing、金融与市场、观察名单和新闻结构硬闸门。每个 Calendar schedule 的标题必须出现在 `atAGlance`，避免日程在云端生成时被静默遗漏。
- 未提供 `mediaBatchId` 的 Cloud 兼容路径改为逐图 Best Effort：失败图片/来源图标降级为空图片位，并返回 `candidateImageCount`、`mediaFailureCount` 和脱敏 `mediaFailures`；严格媒体批次路径仍保持 READY、文件归属、完整媒体和失败即阻断。生产 `CLOUD_DAILY_REPORT_MEDIA_BATCH_REQUIRED` 未开启，兼容路径保持 `false`，未改变批次语义。
- V2 `main` checkpoint 为 `9dcee55`，插件清单版本为 `0.1.5`；源 Skill、插件副本、Prompt 和确定性渲染器已同步。V2 本地默认严格媒体规则不变，只有 Cloud 兼容路径放宽图片硬闸门。
- 本地验证通过：主项目 Cloud 定向测试 `16/16`、全量 `npm test` `173/173`、`npm run typecheck`、临时 HTTPS `ELECTRON_APP_URL` 的 `npm run build`；V2 `python -m pytest -q` `73 passed`。构建保留既有主 JavaScript chunk 超过 500 kB 的警告。
- 生产按 `DEPLOY.md §8.1` 使用本地预构建归档 `workspace-20260914-0808-cloud-best-effort.tar.gz`，217 个条目，SHA-256 `868371de4291ec615f08c73fb05d85463824c958d867489033405ba4d4fc1c73`；最终成功发布 ID 为 `workspace-20260914-0830-cloud-best-effort`。两次早期收尾校验假失败分别自动回滚，失败现场/备份保留，未丢失 `data`、`.env` 或 `node_modules`；服务器未执行安装、测试或构建。
- 最终公网核验通过：`/api/health`、首页、`/today`、OAuth 保护资源元数据均为 HTTP `200`；实际静态 JS 为 `1,256,211` bytes、`application/javascript`，SHA-256 `4871FABE3B8884CDB914B84D6385E2DBBA0073F835F194D4EC4953E2B96063B2` 与本地构建一致；无凭据 `POST /mcp` 返回预期 `401`。
- 正式 Work 任务 `日报 V2 Cloud Shadow` 仍保持每日 `16:40`、`Asia/Shanghai` 和 `dry_run=true` 边界；本轮没有调用云端正式 `publish`、没有入邮件队列或发送邮件，也没有把本地插件文件路径冒充为 Work 侧已安装证明。

## 既有 Work 运行证据（2026-09-09）

- 生产候选服务：`gotimothy.online` 当前发布标识为 `workspace-20260909-cloud-mcp-11`，基于 Calendar 候选分支的 `fb77c8a`；公网 health、OAuth metadata、保护资源和未授权 `/mcp` 已完成状态检查。
- Work 连接：已完成 OAuth 授权并确认 Daily Report Cloud 工具可调用；脱敏 Cloud Context 已通过设置页导入，云端显示版本 `v1`。本地临时导出文件已删除，原始本地 Context 仍是编辑源。
- Shadow：2026-09-09 的 Calendar、Mail、Context、History 和公开新闻输入均返回可用；首轮缺少固定标题被服务端拒绝，修正为逐字包含 `# Daily Digest`、`<!-- daily-digest.v1 -->`、`## Today at a Glance` 后，`daily_report.publish(dry_run=true)` 返回 `VALIDATED_NOT_PUBLISHED`，媒体数量为 `0`，未写入日报或邮件队列。
- Work 调度：已创建并启用 `日报 V2 Cloud Shadow`，任务编辑器显示每天 `16:40`，提示词固定使用 `Asia/Shanghai`，并明确禁止 `dry_run=false`、正式发布、发邮件和修改本地链路。
- 并行边界：本地 `v2-chatgpt` 任务和本地采集/发布链路未修改，生产服务保留部署前备份和 rollback 目录。

## 当前仍未完成的事情（2026-09-14）

- 尚未完成至少 3 个日期的连续 shadow，也未覆盖 Calendar 无数据/不可用、邮箱部分失败或不可用和公开新闻源异常的对照测试。
- 没有执行云端正式 `PUBLISHED`，也没有验证通知队列、SMTP/provider 或收件箱最终到达；本轮公网 200、`QUEUED` 或服务健康均不替代这些分层验收。
- 尚未证明当前 Work 侧已安装并执行本地 `cloud_digest.py` 等打包资源；当前任务仍按 Shadow 处理，不把本地插件同步或一次 `VALIDATED_NOT_PUBLISHED` 当作迁移完成。
- 已证明 Work 能把公开图片 URL 交给服务器受控抓取和托管；尚未证明所有新闻源在阿里云出口均可达，Wikimedia 本轮即为连接超时。正式日报仍需在实际新闻候选集合上做来源分布和成功率验收。
- 尚未验证正式定时运行中的上传/发布是否会被工作区策略暂停等待人工审批；本轮仅验证了 Work 对话中的 OAuth 重新授权路径。
- 暂存媒体的自动 GC 尚未实现；过期的未引用批次仍有短期文件积累风险。
- 没有暂停、改写或删除现有 `v2-chatgpt` 本地任务。
- 没有把本地公开资料采集器强行改成云端 prompt；Work 运行时需要按 Skill 使用云端网络重新核实新闻、市场和图片。

切换前按 V2 分支的 `skills/daily-report-cloud/references/cutover.md` 执行至少三个日期的 shadow、故障矩阵、通知分层和回滚演练。

## 第三阶段单次 Work 排障记录（2026-09-14）

- 第一轮部署后单次 Shadow 已实际到达生产 MCP：`read_inputs`、Work 公开新闻核实和 Calendar/Mail/Context/History/Market/Watchlist 输入均返回可用；输入显示有 `3` 条未读邮件。`daily_report.publish(dry_run=true)` 在媒体处理前返回 `INVALID_ARGUMENT`，错误为正文无法解析为 `daily-digest.v1`，因此没有 `contentHash`、媒体完成统计或邮件状态。这不是媒体降级路径失败。
- 根因范围已收窄：当前正式 Work 任务仍保存旧版且相互冲突的 Markdown 模板，要求空置 `Worth Your Time`，但没有把 `Mail Briefing`、`Mail Tasks`、`金融与市场`、`观察名单` 和 Calendar 标题覆盖写成同一份可执行结构；该模板与已部署的 Cloud 内容完整性 contract 不一致。服务端当前返回的是解析阶段的通用错误，未暴露具体缺失行，因此不能把某一个字段缺失写成已确认的唯一原因。
- 第二轮使用单次消息明确补齐当前 parser 顺序和 Mail/Market/Watchlist/Calendar 要求，并只要求 `dry_run=true`；但 Work 在调用生产 MCP 前提示 `Daily Report Cloud` OAuth 连接已过期，未执行任何新的 `read_inputs` 或 `publish`。重连入口已打开到账号登录页；本次未代填账号、密码或授权。
- 结论：生产部署与本地兼容媒体实现仍有效；当前业务复测阻塞在 Work OAuth 会话，正式 Work 定时任务没有修改，也没有调用 `dry_run=false`、入队或发信。完成登录后应先复跑同一单次结构验证，再根据 `VALIDATED_NOT_PUBLISHED` 决定是否进入单次正式发布验收。

## 第三阶段受控正式发布记录（2026-09-14）

- 重连后同一单次结构验证返回 `VALIDATED_NOT_PUBLISHED`：Calendar、Mail、Context、History、Public News 均 OK；5 个图片候选中 4 个成功、1 个 HTTP 404，`mediaFailureCount=1`，失败未阻断正文校验。
- 随后对同一日期、同一正文执行唯一一次 `dry_run=false`，生产回执为 `status=PUBLISHED`、`source=cloud`、`reportStatus=CREATED`、`deliveryStatus=RECEIVED`，`contentHash=f0d226a11d6dcb435451bca8f1f761acc2a5643c9d73792947dfab8d8cc7d199`，媒体候选 5、成功 4、失败 1（`FETCH_ERROR`）。
- Work 回执的邮件状态为 `QUEUED`；随后生产日志确认 SMTP `acceptedCount=1`、`rejectedCount=0`、`pendingCount=0` 并记录 `notification_sent`。这证明 SMTP/provider 接受，不证明目标收件箱最终到达；本轮未独立使用 IMAP 读取收件箱。
- 本次发布是当前会话中的单次受控操作；正式 `16:40` Work 任务、本地日报任务和 V2 自动化均未修改，未调用 Media Prepare，未新增第二次发布。
