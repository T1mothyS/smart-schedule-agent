# ChatGPT Work Cloud 日报候选链路

本文档描述把日报 V2 迁移到 ChatGPT Work Cloud 的并行实现。当前代码已提供 OAuth/MCP 和 Cloud Context 边界，但不会自动创建 Work 定时任务，也不会停用现有本地日报任务。

这里的“云端”指 ChatGPT Work 的后台任务运行环境；它不能直接读取本机 `日报-v2` worktree 或本地令牌。当前分支中的 Skill、结构化校验器和渲染器是待打包的源材料，尚未安装为 Work 可用的插件/Skill 资源，因此现在还不能仅凭本地文件路径创建可运行的 Work 定时任务。

## 目标架构

```text
ChatGPT Work scheduled task
    │ OAuth 2.1 + PKCE + offline_access
    ▼
AI Calendar /mcp
    ├─ read_inputs -> Calendar / QQ 未读摘要 / Cloud Context / 日报历史
    ├─ Work Cloud 网络 -> 公开新闻、市场和可靠媒体
    ├─ Work Skill -> daily-digest.v1 JSON
    └─ publish(dry_run) -> 服务端媒体托管 -> publish
                                      └─ 日报记录 -> 账号级邮件队列 -> 163 SMTP

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
| `daily_report.publish` | `daily_report:publish` | dry-run 或服务端媒体托管后发布 |

Work 连接应申请：

```text
daily_report:read_calendar
daily_report:read_mail
daily_report:read_context
daily_report:read_history
daily_report:publish
offline_access
```

OAuth 令牌只保存在数据库的 SHA-256 哈希；人工登录/权限审阅请求有效 30 分钟，授权码一次性使用且 5 分钟过期，访问令牌 15 分钟过期，刷新令牌轮换并支持撤销。客户端为公开 PKCE 客户端，不使用 `client_secret`。账号禁用会立即阻止新的 MCP bearer 请求。

## Cloud Context 导入

V2 本地 Context 仍是当前本地链路的编辑源。一次性迁移时：

1. 在 V2 分支运行 `python scripts/export_cloud_context.py --output <temporary-json>`。
2. 人工核对 JSON 只含 `profile`、`preferences`、`recent_interests`、`watchlist`、`theses` 等最小信息，没有凭据、本地路径、邮箱原文或无关身份资料。
3. 使用 AI Calendar 登录态调用 `PUT /api/daily-report/cloud-context`，正文形如 `{"context": <导出 JSON>}`。实现会再次拒绝凭据字段/值，并按账号递增版本。
4. 删除或按本机安全流程处理临时导出文件；它不应进入 Git、Work prompt、日报或日志。

活动证据通过登录态 `POST /api/daily-report/cloud-activity` 主动维护，MCP 不允许模型写入。Calendar 和邮件则由服务端实时读取，不复制到长期 Context。

## 发布语义

Work 必须先生成 `daily-digest.v1` JSON，再调用已经随 Work Skill 提供的等价确定性渲染器（当前 V2 分支的 `scripts/cloud_digest.py` 是待打包源材料）生成 Markdown。不能让 Work 任务引用本地路径，也不能把“模型直接写 Markdown”当作渲染器替代。`daily_report.publish` 的 `dry_run=true` 会在服务端执行：

- 日期、结构化标记和基础安全检查；
- 公开图片和来源 logo 的 DNS/SSRF、大小、MIME、签名校验；
- 内容哈希媒体缓存和本站路径替换。

dry-run 返回 `VALIDATED_NOT_PUBLISHED` 才能进行同正文正式发布。任何媒体失败都会阻断云端发布，不会降级成不完整日报。正式返回的 `PUBLISHED` 只代表日报已写入服务端；`QUEUED` 只代表邮件已入队，不代表 SMTP accepted 或收件箱到达。

## 目前未做的事情

- 没有在 Work 账号中创建或启用定时任务；这需要登录 Work 官方界面、确认 workspace/admin 连接策略和实际授权。
- 没有部署新分支到生产域名；因此 `.well-known`、OAuth 和 `/mcp` 尚未有公网实测证据。
- 没有暂停、改写或删除现有 `v2-chatgpt` 本地任务。
- 没有把本地公开资料采集器强行改成云端 prompt；Work 运行时需要按 Skill 使用云端网络重新核实新闻、市场和图片。

切换前按 V2 分支的 `skills/daily-report-cloud/references/cutover.md` 执行至少三个日期的 shadow、故障矩阵、通知分层和回滚演练。
