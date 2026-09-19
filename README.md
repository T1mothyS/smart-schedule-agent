# AI Calendar（智能日程与周期事务中心）

AI Calendar 是一个面向个人用户的日程、待办和周期事务管理服务。它把原有日历、AI 对话、账户与邮件能力统一到同一套前端中，并增加今日行动中心、周期事务模板、可靠提醒、完成证明、备份恢复和 AI 智能导入。

本文档适用于本仓库当前版本，包含本地启动、邮件配置、环境变量、目录说明、部署入口、数据安全和常见故障排查。

跨项目结构、日报 V2 接口边界、任务路由和分层验收见 [`PROJECT-MAP.md`](PROJECT-MAP.md)。

当前规范、操作手册与历史快照统一从 [文档索引](docs/README.md) 进入；[Bundle 测量](docs/BUNDLE-BASELINE.md) 记录构建体积，不能代替浏览器性能验收。

Knowledge Library V2 首次部署、令牌权限、分层验收和回滚见 [`docs/KNOWLEDGE-LIBRARY-FIRST-DEPLOYMENT.md`](docs/KNOWLEDGE-LIBRARY-FIRST-DEPLOYMENT.md)；本地 Knowledge Library 项目另有对应的 `docs/knowledge-library-first-deployment.md` 文档追踪入口。

## 1. 当前能力

- 设置顶部可打开“项目成长”和“Tools 工具中心”。成长页展示可追溯里程碑、指标和架构演化，登录后可读；数据维护见 [项目成长说明](project-evolution/README.md)。

- 登录后默认进入 `/today` 今日行动中心。
- 日历支持日程、待办、分类、优先级和完成状态；带时间的待办是时间点事项，不保存持续时长，日视图使用固定视觉卡片高度展示。
- 周期事务支持信用卡、SIM、订阅、保险、证件、会员、房租、水电、车辆年检和自定义规则。
- 周期事务会按当前周期到期日同步为日历全天待办，完成后继续生成下一周期事项。
- 通知支持邮件、站内消息、浏览器通知、免打扰、失败重试和发送记录。
- 通知调度会记录扫描、筛选、入队、去重、领取、SMTP 接受/拒收、重试和最终状态；调试日志会持久化并在服务重启后保留。管理员日志新增 `mail` 分类，可单独查看邮件传输链路。
- 完成时可保存备注、金额、账单日期、图片或 PDF 证明。
- 支持可读 JSON/CSV 导出、用户加密导出/恢复和管理员全站快照。
- AI 可从自然语言或截图生成待确认草稿；确认前不会写入正式数据。
- AI 助手支持普通问答；配置常驻城市/区县后，可查询 Open-Meteo 实时与未来天气。
- 知识库 V2 链路以 `C:\Users\Elysia\Documents\Codex_Knowledge_Library` 为唯一内容入口：本地 Codex 负责 Markdown 加工、关系清单和生命周期操作，AI Calendar 负责只读呈现、评论、版本、原文导出和本地发布令牌；网页不再编辑正文。普通处理完成后默认自动 `publish`，`retire`、`restore` 和 `purge` 仍需显式选择。
- 全局搜索以只读方式聚合日程、NoteBoard、Daily Report 和 Knowledge Library；结果按账号隔离并支持日程日期/详情直达，不会通过搜索写入知识库或建立关系。
- AI 对话移动端使用独立的 NoteBoard 入口和未完成数量角标；管理员入口沿用 Settings V2 的响应式结构，桌面端为侧边分区，手机端为全屏卡片/列表和日志筛选。
- 每日邮件摘要包含天气、进度、分类日程和完整明细，不与单项提醒混用。
- 日报页面按日期和来源保存当前账号的个人情报日报；新版 `daily-digest.v1` 内容由固定 Newsletter 模板渲染，发布前由 V2 在本地下载、校验并上传新闻图片与来源 logo，服务端按“账号、日期、来源、内容哈希”保存并在入库前确认 Markdown 只引用本站媒体；未读邮箱默认生成独立的邮件简报，明确动作另列为邮件待办；旧日报继续使用受限 Markdown 兼容路径，并严格按账号隔离。
- 日报设置提供“接收并转发本地日报”和“接收并转发 Cloud 日报”两个来源开关。两边的有效正式发布都会先写入生产服务器；未勾选来源保存为 `CANDIDATE`，不进入正式网页和邮件，可在日报页候选对照；勾选来源保存为 `RECEIVED`，网页和邮件按来源分别处理。
- 日报由外部 V2 程序在 Validator 通过后通过专用接口发布；“日报邮件”是独立于每日摘要的设置，首次发布和后续内容更新都会为新的内容版本入队，同一来源和内容版本保持幂等；每一天的日报详情都支持手动重新发送。
- 日报云端链路提供 OAuth PKCE、Cloud Context、MCP 和 `dry_run`/`PUBLISHED` 合同，与 Local 专用令牌链路并行。Cloud 内容完整性是硬闸门；兼容路径逐图 Best Effort，带媒体批次则保持严格校验。Shadow 必须显式传 `dry_run=true`；实际 Work 模式与生产状态需现场核对，不能从历史文档推断。详细边界见 [Cloud 文档](docs/CHATGPT-WORK-CLOUD.md)。
- 每日摘要按账号保存的时、分和时区入队；同一配置时间的重复扫描保持幂等，修改当天提醒时间后允许再次触发，不与单项提醒混用。
- 高优先级、未完成且有明确开始时间的事件/待办，在开始前 15 分钟内发送固定邮件提醒；它不受邮件开关、免打扰和日报开关影响。
- 可生成仅展示一次的只读日报令牌，供独立日报程序按日期读取当前账号日程；服务端只保存令牌哈希。
- 用户可以在网页设置中保存 QQ 邮箱账号和客户端授权码；授权码使用独立密钥加密保存，日报令牌只读取未读邮件摘要，不返回授权码，也不修改邮件已读状态。
- 可选通过 163 邮箱 IMAP 接收转发邮件并生成待确认草稿。
- 支持 Web 页面和 Electron 桌面壳。

固定业务规则：

- 不提供“跳过”功能。
- 月份不存在指定账单日或执行日时，自动使用当月最后一天。
- 周期事务逾期后标记为 `expired`，仍保留手动完成入口。
- 普通日程结束后不会自动变成逾期；待办和周期事务才参与逾期判断。
- 官方发件邮箱固定为 `aicalendarofficial@163.com`。
- 每位用户自行配置提醒收件邮箱；未配置时使用该用户的注册邮箱。

### 1.1 版本与邮件链路

- 当前源码版本以 [`package.json`](package.json) 的 `version` 为准，构建与界面从包版本读取，`package-lock.json` 保持同步。源码版本不等于当前生产部署版本。
- 每日摘要邮件链路：账号提醒设置 → 每日摘要调度器 → 持久化通知队列 → 固定发件邮箱；按账号、时区、日期和配置时间组成触发键幂等。
- 高优先级邮件链路：高优先级事件/待办 → 开始前 1–15 分钟调度器 → 持久化通知队列 → 固定发件邮箱；不依赖每日提醒或邮件开关。
- V2 本地日报链路：Validator 通过 → 本地下载/校验并上传 `daily-digest.v1` 图片与来源 logo → `PUT /api/integrations/daily-report/reports/:date`（固定 `source=local`）→ 服务端确认本站媒体存在 → 账号、日期、来源和内容版本日报记录 → 根据来源接收设置决定网页与日报邮件队列 → 固定发件邮箱；同一来源和内容版本只自动入队一次，媒体失败不会进入最后的日报 PUT，详情页可对正式接收正文手动重新发送。
- 每日摘要不再按账号和自然日全局去重；同一配置时间的重复扫描仍按触发键幂等，修改当天提醒时间后可以再次生成邮件。
- 邮件只有在 Nodemailer 返回至少一个 `accepted` 且没有 `rejected/pending` 时才标记为 `sent`；这表示 SMTP 已接受，不等同于收件箱最终到达。
- 浏览器提前提醒仍可单独使用，不替代高优先级固定邮件。
- AI 助手提供独立记事模式：每个非空输入行保存为一个账号隔离的记事条目；条目可完成、恢复、编辑、删除、设置预设颜色、送入普通对话或导出 TXT/CSV。送入对话后生成的计划仍需确认，记事不会被自动完成或建立关联。

## 2. 技术结构

| 层级 | 当前实现 |
| --- | --- |
| 前端 | React 18、TypeScript、Vite、TDesign React、Tailwind CSS |
| 后端 | Node.js、Express、TypeScript、Nodemailer |
| 数据 | 本地 SQLite/sql.js 数据文件，按账号隔离业务数据 |
| AI | CodeBuddy Agent SDK |
| 桌面端 | Electron |
| 部署 | 阿里云服务器、PM2、Nginx、HTTPS |
| 离机备份 | 本机加密快照，可选阿里云 OSS 私有 Bucket |

开发模式下，Vite 前端运行在 `http://localhost:5173`，后端运行在 `http://localhost:3000`，`/api` 和 `/daily-report-media` 请求由 Vite 代理到后端。

## 3. Windows 本地启动

### 3.1 环境要求

- Node.js 22.12 或更高版本。
- npm（随 Node.js 安装）。
- 需要使用 AI 功能时准备个人 CodeBuddy API Key，登录后在“设置”中保存。
- 需要发送邮件时准备官方 163 邮箱的客户端授权码。

先检查版本：

```powershell
node --version
npm --version
```

### 3.2 安装依赖

在项目目录打开 PowerShell：

```powershell
Set-Location 'C:\Users\Elysia\Documents\提醒云服务\smart-schedule-agent'
npm ci
```

仓库已有 `package-lock.json`，因此使用 `npm ci` 可以按照锁定版本安装依赖。只有在主动修改依赖时才使用 `npm install`。

### 3.3 创建本机配置

如果还没有 `.env`：

```powershell
Copy-Item .env.example .env
notepad .env
```

至少需要设置：

```dotenv
JWT_SECRET=一段足够长且随机的字符串
# 仅首次启动或迁移缺少数据库记录时使用；初始化后以数据库为准
ADMIN_INVITE_CODE=管理员邀请码
USER_INVITE_CODE=普通用户邀请码

SMTP_HOST=smtp.163.com
SMTP_PORT=465
SMTP_USER=aicalendarofficial@163.com
SMTP_PASS=163邮箱客户端授权码

PORT=3000
APP_TIMEZONE=Asia/Shanghai
APP_URL=http://localhost:5173/today
APP_ENV=development
```

AI 凭据按账号保存，不再从服务器 `.env` 读取默认的 `CODEBUDDY_API_KEY` 或 `CODEBUDDY_BASE_URL`。登录后进入“设置”，输入个人 API Key；如需自定义地址，也只保存到当前账号。旧的服务器级变量会阻止服务启动，避免账号之间发生凭据串用。

不要把真实密钥、授权码或邀请码写进 `.env.example`，也不要提交 `.env`。

### 3.3.1 邀请码管理与轮换

服务首次启动时，会把 `.env` 中缺失的 `ADMIN_INVITE_CODE` 和 `USER_INVITE_CODE` 导入数据库，并只保存带随机盐的哈希。数据库完成初始化后成为唯一生效来源，后续修改 `.env` 不会覆盖已存在的记录；迁移完成后可以移除这两个环境变量，但生产环境不能在缺少对应数据库记录时启动。

管理员可以在“管理员面板 → 用户管理”中分别轮换管理员邀请码和普通用户邀请码。轮换后旧值立即失效，已有账号和登录会话不受影响；新明文只在轮换成功的响应和当前页面中展示一次，关闭提示后不会再次从服务器读取。`GET /api/admin/invite-codes` 只返回启用状态、版本和时间信息，`POST /api/admin/invite-codes/:role/rotate` 才返回本次新值。日志不记录邀请码。

### 3.4 启动开发服务

```powershell
npm run dev
```

随后访问：

- 前端：`http://localhost:5173`
- 后端健康检查：`http://localhost:3000/api/health`

项目根目录的 `go.bat` 也能自动安装缺失依赖、启动开发服务并打开浏览器，但日常排错更推荐直接执行 `npm run dev`，这样可以看到完整日志。

### 3.5 停止服务

在启动服务的终端中按 `Ctrl+C`。修改 `.env` 后必须停止并重新启动，运行中的 Node.js 进程不会自动重新读取环境变量。

## 4. 邮件系统配置

### 4.1 发件邮箱与收件邮箱不是一回事

| 类型 | 配置位置 | 说明 |
| --- | --- | --- |
| 官方发件邮箱 | 服务器 `.env` | 固定为 `aicalendarofficial@163.com`，所有验证码和提醒都从该账号发出 |
| SMTP 授权码 | 服务器 `.env` | 只由管理员配置，用户看不到 |
| 用户提醒收件邮箱 | 页面右上角“设置” | 每个账号独立保存，可以与注册邮箱不同 |
| 默认收件邮箱 | 用户注册资料 | 用户未填写提醒邮箱时使用注册邮箱 |

因此项目不再使用 `REMINDER_RECIPIENT_EMAIL`。这个全局变量会让所有用户共用同一个收件地址，不符合多用户产品逻辑，也容易把提醒发错人。

### 4.2 163 SMTP 必填配置

```dotenv
SMTP_HOST=smtp.163.com
SMTP_PORT=465
SMTP_USER=aicalendarofficial@163.com
SMTP_PASS=这里填写客户端授权码
```

`SMTP_PASS` 不是 163 网页登录密码，而是邮箱开启 SMTP 服务后生成的客户端授权码。

获取步骤：

1. 登录 `aicalendarofficial@163.com` 的网页版邮箱。
2. 打开邮箱设置，找到 POP3/SMTP/IMAP 或“客户端授权密码”相关设置。
3. 开启 SMTP 服务；第三阶段需要邮箱导入时再同时开启 IMAP。
4. 按页面要求完成安全验证并生成客户端授权码。
5. 只把授权码填写到服务器 `.env` 的 `SMTP_PASS`。
6. 重启本地 Node.js 服务或服务器上的 PM2 服务。

不要把授权码发到聊天、截图、Git 提交或 README 中。

### 4.3 当前 TLS 报错的含义

报错：

```text
Client network socket disconnected before secure TLS connection was established
```

表示程序在完成 TLS 安全连接前，连接就被断开了。当前项目之前的实际问题是：`.env` 使用了 Gmail 的 `SMTP_HOST/SMTP_USER`，而代码发件人固定为 163 官方邮箱，两套配置不一致。

排查顺序：

1. 确认 `SMTP_HOST=smtp.163.com`。
2. 确认 `SMTP_PORT=465`。
3. 确认 `SMTP_USER=aicalendarofficial@163.com`。
4. 确认 `SMTP_PASS` 是该 163 账号新生成的客户端授权码。
5. 修改后重启服务。
6. 登录页面，在右上角“设置”中填写当前用户的提醒邮箱，再发送测试邮件。

常见错误对照：

| 错误 | 一般含义 | 处理方式 |
| --- | --- | --- |
| `EAUTH` / authentication failed | 账号或授权码错误 | 重新生成 163 客户端授权码，确认不是网页登录密码 |
| TLS/socket disconnected | 主机、端口、TLS 或网络路径错误 | 核对 163 主机和 465 端口，检查服务器出站网络 |
| timeout | 服务器无法及时连接 SMTP | 检查云服务器防火墙、运营商限制和 DNS |
| 页面提示没有收件邮箱 | 当前用户没有注册邮箱或提醒邮箱 | 在右上角“设置”中保存提醒邮箱 |

### 4.4 测试邮件

1. 启动前后端。
2. 登录一个用户账号。
3. 打开右上角“设置”。
4. 填写并保存“提醒收件邮箱”。
5. 如需验证日程发信，在“今日”页面点击“一键发送日程”并确认；设置中的“测试读取”仅检查 QQ 未读摘要。
6. 检查页面反馈、后端终端日志、收件箱和垃圾邮件箱。

测试邮件只验证发件链路，不会把用户收件邮箱写入 `.env`。

## 5. `.env` 与 `.env.example`

`.env.example` 不是运行时配置，但它非常有用，应该保留并提交到 Git。

| 文件 | 是否被程序读取 | 是否提交 Git | 用途 |
| --- | --- | --- | --- |
| `.env` | 是 | 否 | 当前机器的真实密钥、授权码、邀请码和部署地址 |
| `.env.example` | 否 | 是 | 安全的配置模板，说明项目需要哪些变量 |
| `.gitignore` | Git 使用 | 是 | 防止 `.env`、数据库、附件和构建产物被提交 |

新机器部署时先复制模板：

```powershell
Copy-Item .env.example .env
```

Linux 服务器上使用：

```bash
cp .env.example .env
```

然后只编辑新生成的 `.env`。如果未来增加新的环境变量，应同时在 `.env.example` 中添加不含秘密的占位项和说明。

## 6. 环境变量说明

### 6.1 认证与账号

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | 是 | JWT 签名密钥，生产环境必须使用随机长字符串 |
| `EMAIL_CODE_PEPPER` | 建议 | 验证码 HMAC 独立密钥；留空时回退到 `JWT_SECRET` |
| `ADMIN_INVITE_CODE` | 首次初始化时 | 数据库尚无管理员邀请码记录时的迁移期引导值；初始化后以数据库为准 |
| `USER_INVITE_CODE` | 首次初始化时 | 数据库尚无普通用户邀请码记录时的迁移期引导值；初始化后以数据库为准 |

### 6.2 官方邮件

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `SMTP_HOST` | 是 | 固定使用 `smtp.163.com` |
| `SMTP_PORT` | 是 | SSL 连接使用 `465` |
| `SMTP_USER` | 是 | 固定使用 `aicalendarofficial@163.com` |
| `SMTP_PASS` | 是 | 163 客户端授权码，不是登录密码 |

### 6.3 用户 QQ 邮箱摘要（可选）

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `MAIL_CREDENTIALS_ENCRYPTION_KEY` | 使用网页 QQ 邮箱配置时必需 | 独立随机长密钥；不能与 `JWT_SECRET` 或 `BACKUP_ENCRYPTION_KEY` 共用 |

网页设置中的 QQ 邮箱固定使用 `imap.qq.com:993` TLS 连接。服务端只读取未读邮件摘要，不保存邮件正文，不标记已读；V2 通过日报只读令牌调用 `/api/integrations/daily-report/mail`。未配置该变量时，其他登录、日历、提醒和日报功能仍可运行，但不能保存用户 QQ 邮箱配置。

### 6.4 AI 与服务地址

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `PORT` | 否 | 后端监听端口，默认 `3000` |
| `APP_TIMEZONE` | 建议 | 业务时区，当前建议 `Asia/Shanghai` |
| `APP_URL` | 是 | 邮件按钮跳转地址和邮件图片的公开站点地址；生产环境填写 HTTPS 域名，例如 `https://example.com/today` |
| `APP_ENV` | 是 | 本地为 `development`，服务器为 `production`；避免 Vite 读取 `NODE_ENV` 产生构建警告 |
| `TRUST_PROXY_HOPS` | 反向代理时必需 | Nginx 直接代理到 Node 时通常为 `1`；本地直连保持 `0` |
| `BACKGROUND_JOBS_ENABLED` | 是 | 默认 `false`；本地实际验收提醒时临时设为 `true`，生产环境只允许唯一 worker 开启，额外实例保持 `false` 防止重复发信 |
| `ELECTRON_APP_URL` | Electron 打包必需 | 写入安装包的公开 HTTPS 页面地址，不包含任何密钥 |
| `VITE_DEV_HOST` / `VITE_ALLOWED_HOST` | 局域网调试可选 | 默认只允许本机访问；确需局域网调试时同时显式配置监听地址和允许主机 |

### 6.5 备份与 OSS

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `BACKUP_ENCRYPTION_KEY` | 全站备份必需 | 独立随机长密钥，不应与 `JWT_SECRET` 共用 |
| `OSS_BUCKET` | OSS 可选 | 阿里云 OSS 私有 Bucket 名称 |
| `OSS_ENDPOINT` | OSS 可选 | 同地域 ECS 优先使用内网 Endpoint |
| `OSS_ACCESS_KEY_ID` | OSS 可选 | 专用 RAM 用户 AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | OSS 可选 | 专用 RAM 用户 AccessKey Secret |
| `MAINTENANCE_MODE` | 是 | 正常运行保持 `false`；全站恢复时才临时设为 `true` |

### 6.6 邮箱自动导入（可选）

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `IMAP_HOST` | 邮箱导入必需 | 163 使用 `imap.163.com` |
| `IMAP_PORT` | 邮箱导入必需 | TLS 端口 `993` |
| `IMAP_USER` | 邮箱导入必需 | 官方 163 邮箱地址 |
| `IMAP_PASS` | 邮箱导入必需 | 163 客户端授权码 |

邮箱自动导入是可选功能；不配置 IMAP 不影响登录验证码、普通提醒或网页使用。

## 7. 项目目录与文件说明

下面按当前仓库结构说明各目录和文件。`dist`、`dist-electron`、`node_modules` 和 `data` 是运行或构建生成内容，不应手工修改其中的产物。

### 7.1 根目录

协作和长期维护入口：

| 文件或目录 | 作用 |
| --- | --- |
| AGENTS.md | 可提交的项目通用协作、安全、验证和 Git 规则 |
| AGENTS.local.md | 当前工作机的本地补充，不提交 Git |
| docs/ARCHITECTURE.md | 当前运行时、数据和跨项目边界 |
| docs/UI-GUIDELINES.md | 响应式、控件、主题和 UI 验收原则 |
| docs/TEST-MATRIX.md | 自动测试、浏览器手工验收和生产验收分层 |
| docs/ROADMAP.md | Now、Next、Later、Ideas 和 Won't Do 路线图 |
| docs/LIBRARY.md | 知识库 V2 的本地加工、只读发布、生命周期 API 和安全边界 |
| .github/workflows/ci.yml | push 和 pull_request 的安装、类型、测试、构建检查；不执行部署 |

| 文件或目录 | 作用 |
| --- | --- |
| `.git/` | Git 本地版本历史和分支信息，不要手工修改 |
| `.env` | 当前机器真实运行配置，包含秘密，不提交 Git |
| `.env.example` | 可提交的环境变量模板，新机器通过它创建 `.env` |
| `.gitignore` | 排除密钥、数据库、附件、依赖和构建产物 |
| `README.md` | 项目主说明，也就是本文档 |
| `PROJECT-MAP.md` | AI Calendar、日报 V2 和旧日报的逻辑结构、接口边界、任务路由与验证地图 |
| `DEPLOY.md` | 阿里云服务器、Nginx、HTTPS、PM2 和升级部署的详细步骤 |
| `package.json` | npm 脚本、依赖版本范围、Electron 打包配置和项目元数据 |
| `electron-builder.yml` | 只针对 `dist-desktop/` 最小桌面壳的跨平台打包配置 |
| `package-lock.json` | npm 锁定依赖树，保证不同机器安装一致，应该提交 |
| `index.html` | Vite 前端 HTML 入口，挂载 React 根节点 |
| `vite.config.ts` | Vite 配置；定义 5173 端口、Less 和 `/api` 后端代理 |
| `tsconfig.json` | 前端和通用 TypeScript 编译/类型检查配置 |
| `tsconfig.node.json` | Vite 等 Node 侧配置文件的 TypeScript 设置 |
| `tsconfig.electron.json` | Electron 主进程和 preload 的独立编译配置 |
| `tailwind.config.js` | Tailwind CSS 内容扫描和主题配置 |
| `postcss.config.js` | PostCSS、Tailwind 和 Autoprefixer 配置 |
| `go.bat` | Windows 双击启动脚本；缺依赖时安装并打开 5173 页面 |
| `deploy.sh` | Ubuntu/Debian 首次部署第一步；安装 Node.js 22、PM2 并创建目录 |
| `deploy-continue.sh` | 上传代码后的部署第二步；检查 Node/生产配置、安装、测试、构建并用 PM2 启动 |
| `node_modules/` | npm 安装的第三方依赖，可由 `npm ci` 重建，不提交 |
| `dist/` | Vite 构建后的 Web 静态文件，可由 `npm run build:client` 重建 |
| `dist-electron/` | Electron TypeScript 编译结果，可由 `npm run build:electron` 重建 |
| `dist-desktop/` | Electron 打包前生成的最小桌面壳目录，不包含服务器依赖 |
| `release/` | Electron 安装包输出目录，仅在执行桌面打包后产生 |

### 7.2 `src/` 前端

| 文件 | 作用 |
| --- | --- |
| `src/main.tsx` | React 浏览器入口，创建根节点并加载全局样式 |
| `src/App.tsx` | 顶层路由和登录后页面组织 |
| `src/index.css` | 全局样式、主题变量和页面基础视觉 |
| `src/config.ts` | 应用名称、描述和版本等前端常量 |
| `src/reminder-types.ts` | 周期事务、通知偏好、行动中心和完成记录等类型 |
| `src/pages/LoginPage.tsx` | 登录、注册和验证码流程页面 |
| `src/components/AppShell.tsx` | 登录后统一页面框架、顶部导航和内容区域 |
| `src/components/ActionCenterPage.tsx` | 今日行动中心：下一步、今天、临期、逾期和已完成 |
| `src/components/ScheduleView.tsx` | 日历主页面和日程管理容器 |
| `src/components/CalendarView.tsx` | 日历日期网格/时间视图展示 |
| `src/components/ScheduleSidebar.tsx` | 日历侧栏、日历源和分类操作 |
| `src/components/ReminderPage.tsx` | 周期事务模板、任务、完成和提醒历史页面 |
| `src/components/DailyReportsPage.tsx` | 当前账号的日报列表、全屏阅读页、状态和显式邮件重试入口 |
| `src/components/LibraryPage.tsx` | 知识库只读列表、搜索筛选、Markdown 详情、关联、版本、评论和导出 |
| `src/components/settings/` | Settings V2：Dialog/Layout/Section/Row 统一响应式布局；账户、AI、通知、日报、QQ 邮箱、数据和管理领域组件 |
| `src/components/AiImportPage.tsx` | 自然语言/截图智能导入、草稿校对与确认 |
| `src/components/AiSchedulePanel.tsx` | 普通问答、天气查询、待确认日程建议和记事模式的 AI 助手 |
| `src/components/NoteBoard.tsx` | AI 记事板：桌面侧栏、窄屏抽屉和条目操作 |
| `src/utils/note-colors.ts` | 记事预设颜色枚举、标签和主题样式 |
| `src/utils/note-export.ts` | 当前分区记事的 TXT/CSV 确定性导出 |
| `src/components/AdminModal.tsx` | 管理员用户管理弹窗 |
| `src/hooks/useAuth.ts` | 登录状态、令牌和当前用户逻辑 |
| `src/hooks/useTheme.ts` | 明暗主题读取、切换和持久化 |
| `src/utils/iconMap.ts` | 工具名称到界面图标的映射 |

### 7.3 `server/` 后端

| 文件 | 作用 |
| --- | --- |
| `server/index.ts`、`server/app.ts` | CLI 兼容入口与无副作用 HTTP 应用工厂 |
| `server/runtime/` | 配置、四库初始化、监听端口与六组后台任务（含受控 CalDAV）的显式启动/关闭 |
| `server/routes/`、`server/application.ts` | 领域路由与应用组合入口；见 [Phase 5 验证](docs/PHASE5-DOMAIN-BOUNDARIES.md) |
| `server/db.ts`、`server/database/` | 兼容导出、连接、schema/migrations 与 chat.db 领域查询 |
| `server/schedule-store.ts` | `schedule.db` 的日历、分类、日程和用户隔离访问层 |
| `server/schedule-format.ts` | 把日程整理成邮件或 AI 可读文本 |
| `server/reminder-store.ts` | `reminder.db` 的周期规则、任务、周期实例和迁移逻辑 |
| `server/reminder-service.ts` | 计算到期日、月末兜底、逾期状态和周期推进 |
| `server/reminder-calendar-sync.ts` | 将周期任务同步为日历全天待办，并维护完成、下一周期和删除联动 |
| `server/action-center.ts` | 聚合日程、待办和周期事务，计算“下一步”和行动中心分组 |
| `server/activity-store.ts` | `activity.db` 的完成记录、附件元数据、通知队列、偏好和 AI 草稿访问层 |
| `server/daily-report-service.ts` | 日报发布幂等、媒体入库前校验、内容哈希、账号隔离、邮件状态和安全渲染视图 |
| `server/daily-report-media-service.ts` | 日报媒体的本地上传接收、大小/类型/文件签名/哈希校验、本站路径检查和公开读取；保留旧调用方的安全下载兼容层 |
| `server/daily-digest-template.ts` | 解析 `daily-digest.v1` 内容并以 Header、本站新闻图片、本站来源 logo、AtAGlance、LeadStory、DigestItem、MailBriefing、MailTask、Section、Footer 等稳定组件渲染网页、邮件和纯文本 |
| `server/markdown-renderer.ts` | 新版日报路由到固定 Newsletter 模板，旧日报回退到受限 Markdown 渲染器；两条路径都转义 HTML 并过滤危险链接 |
| `server/user-mail-service.ts` | 用户 QQ 邮箱授权码加密保存、只读 IMAP 摘要读取和脱敏状态 |
| `server/notification-service.ts` | 持久化通知调度、免打扰、幂等去重、失败重试和发送状态 |
| `server/notification-scheduler.ts` | 每日摘要和高优先级固定邮件的时区扫描、筛选与幂等入队 |
| `server/email-service.ts` | 固定 163 官方发件邮箱、邮件模板、SMTP 校验和错误转换 |
| `server/log-service.ts` | 脱敏结构化日志、持久化 JSONL、轮转和管理员日志读取 |
| `server/daily-email-template.ts` | 每日摘要邮件的天气、进度、分类与完整日程模板 |
| `server/weather-service.ts` | Open-Meteo 地点搜索、天气读取、缓存、超时和天气代码转换 |
| `server/export-service.ts` | 当前账号的可读 JSON/CSV 数据导出与表格公式注入防护 |
| `server/note-item-service.ts` | 账号隔离的 AI 记事 CRUD、批量校验和预设颜色校验 |
| `server/library-service.ts` | 知识库条目校验、搜索、版本、评论、关系、发布幂等、生命周期和导出 |
| `server/library-markdown.ts` | 知识库 Markdown 的保守安全渲染和危险链接处理 |
| `server/library-publish-token-service.ts` | 独立知识库发布令牌的哈希保存、轮换、撤销和鉴权 |
| `C:\Users\Elysia\Documents\Codex_Knowledge_Library\scripts\publish-library.ps1` | V2 批次唯一发布脚本：强制操作选择、校验、干跑、生命周期操作、上传和脱敏报告 |
| `server/daily-report-token-service.ts` | 只读日报令牌生成、哈希保存、轮换、吊销和鉴权 |
| `server/daily-report-cloud-auth.ts` | OAuth PKCE 客户端注册、授权码、刷新轮换、撤销和 MCP bearer 鉴权 |
| `server/daily-report-cloud-mcp.ts` | ChatGPT Work Cloud 的无状态 MCP 工具：读取日报输入、Context/历史和服务端媒体发布 |
| `server/daily-report-cloud-store.ts` | 脱敏 Cloud Context、活动证据和日报历史摘要的账号隔离存储 |
| `server/daily-report*.test.ts` | 日报服务、HTTP API 和 V2 假 SMTP 隔离端到端测试 |
| `server/http-security.ts` | 安全响应头、请求体限制和分接口频率限制 |
| `server/email-import-service.ts` | 可选 IMAP 邮箱轮询、令牌匹配和 Message-ID 去重 |
| `server/attachment-service.ts` | 附件类型/大小校验、哈希存储、配额和鉴权读取辅助 |
| `server/backup-service.ts` | 用户加密备份、恢复预览、全站快照和可选 OSS 上传 |
| `server/ai-import-service.ts` | 自然语言/截图解析、置信度草稿、确认和过期清理 |
| `server/core.test.ts` | 核心业务测试：月末、逾期完成、附件、用户隔离、备份和 AI 草稿等 |
| `server/sql-js.d.ts` | 为 `sql.js` 补充项目所需的 TypeScript 类型声明 |

### 7.4 `electron/` 桌面端

| 文件 | 作用 |
| --- | --- |
| `electron/main.ts` | Electron 主进程；创建窗口、托盘、通知和外部链接处理 |
| `electron/preload.ts` | 在隔离上下文中向前端安全暴露窗口与通知 API |

### 7.5 `data/` 运行数据

| 文件或目录 | 作用 |
| --- | --- |
| `data/chat.db` | 用户、验证码、登录、AI 历史、日报令牌哈希和账号级设置 |
| `data/chat.db-wal` / `data/chat.db-shm` | SQLite 正在运行时的 WAL 临时文件，不要单独复制或删除 |
| `data/schedule.db` | 日历、分类和日程数据 |
| `data/reminder.db` | 周期事务、周期实例和完成历史兼容数据 |
| `data/activity.db` | 统一完成记录、附件元数据、日报记录、通知、偏好和 AI 导入草稿 |
| `data/application.log` | 最近的脱敏结构化运行日志；达到大小上限后轮转为 `application.1.log` 等文件 |
| `data/attachments/` | 按用户隔离并以哈希名称保存的附件实体 |
| `data/daily-report-media/` | 服务端校验后的日报新闻图片，以内容哈希名称保存并由 `/daily-report-media/` 公开读取 |
| `data/migration-backups/` | 数据迁移前自动生成的数据库快照 |
| `data/backups/` | 管理员全站加密快照，首次生成后出现 |

`data/` 是最重要的运行资产。迁移、恢复或重置前应先停止服务并做一致性快照，不要只复制正在写入的单个 `.db` 或 WAL 文件。

## 8. 常用 npm 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 同时启动后端监听和 Vite 前端 |
| `npm run dev:server` | 只启动后端，修改代码时自动重启 |
| `npm run dev:client` | 只启动 Vite 前端 |
| `npm run server` | 单次启动后端，适合 PM2 调用 |
| `npm run typecheck` | TypeScript 类型检查，不生成文件 |
| `npm test` | 运行 `server/*.test.ts` 核心测试 |
| `npm run build:client` | 构建 Web 前端到 `dist/` |
| `npm run build:electron` | 编译 Electron 并生成不含服务器依赖的 `dist-desktop/` 最小打包目录 |
| `npm run build` | 依次构建 Web 和 Electron 代码 |
| `npm run preview` | 本地预览 Vite 构建结果 |
| `npm run electron:dev` | 启动后端、Vite 和 Electron 开发窗口 |
| `npm run electron:build` | 构建桌面安装包到 `release/` |

提交或部署前建议运行：

```powershell
npm run typecheck
npm test
npm run build
```

## 9. 主要页面与使用流程

### 9.1 今日行动中心

登录后默认进入 `/today`，按以下优先级突出一个“下一步”：

1. 正在进行或两小时内开始的日程。
2. 高优先级逾期事项。
3. 其他逾期事项。
4. 今日到期事项。
5. 临期事项。

### 9.2 周期事务

进入“周期事务”，选择模板、填写周期和提醒时间。周期到期后可以标记完成并保存证明。系统没有跳过按钮；逾期任务仍可完成，完成后按对应 `advancePolicy` 生成下一周期。

### 9.3 用户提醒邮箱

进入右上角“设置”：

1. 填写自己的提醒收件邮箱。
2. 设置邮件、站内、浏览器通知开关。
3. 可设置提醒时间和免打扰时段。
4. 保存后如需验证发信，在“今日”页面使用“一键发送日程”并确认。

这些设置按登录用户保存，不会修改官方发件账号，也不会影响其他用户。

设置在桌面端使用居中 Dialog、左侧分类导航和独立内容滚动；手机端为全屏纵向分区，顶部关闭按钮固定。输入框、按钮组和状态文字会随屏幕宽度调整，长邮箱、用户 ID 和令牌可以换行。切换分类不会卸载其他分区，因此未保存的输入和刚生成的令牌会保留到关闭设置为止。每日提醒和日报邮件开关立即保存；通知渠道及免打扰使用“保存通知设置”。

### 9.4 完成证明

完成待办或周期事务时可添加：

- 完成时间。
- 备注。
- 金额（内部以整数分保存，默认 CNY）。
- 账单日期。
- JPEG、PNG、WebP 或 PDF 附件。

单文件最大 10MB，每次完成最多 5 个附件，每位用户默认总配额 500MB。附件只能通过鉴权接口访问。

### 9.5 智能导入

智能导入接受自然语言或最多 3 张图片，每张最大 8MB。AI 首先生成草稿并标注低置信度字段；只有用户检查并确认后，系统才创建日程或周期事务。

### 9.6 常驻地、天气与普通问答

在“设置”中搜索并确认常驻城市/区县后，AI 助手可回答今天、明天及未来天气；地点和天气来自 Open-Meteo，网络失败时会明确提示不可用，不会编造数据。非日程问题走普通问答，日程写入仍必须经过用户确认。

### 9.7 日报、导出与邮件联动

登录后从顶部“日报”进入 `/reports`，可以查看当前账号按日期保存的日报，并打开 `/reports/:date` 全屏阅读页。列表按日期倒序排列；带有 `daily-digest.v1` 标记的正文按固定 Newsletter 信息架构渲染，LLM 不生成 HTML 或决定布局。日报中的“邮件简报”默认覆盖大多数有信息价值的未读邮件，“邮件待办”只列明确需要采取措施的子集；明显低价值噪音才会省略。历史日报继续走受限 Markdown 兼容路径；两条路径都会转义原始 HTML，危险链接不会成为可点击链接。阅读页保持独立的登录后二级页面，只提供返回列表按钮和安全渲染后的正文，不重复显示产品导航、日报元信息或外层卡片。
新发布或更新的 `daily-digest.v1` 必须由日报 V2 在本地完成新闻图片与来源 logo 的下载、校验和上传，服务端入库前只确认 Markdown 引用的本站媒体文件确实存在；已有历史记录不会在普通读取时触发外部下载，如需补齐旧日报图片或 logo，应在本地准备媒体后重新发布对应日期的日报。

“设置”提供独立的“日报邮件”开关。它不等同于每日摘要、普通提醒渠道或免打扰设置；开启后，首次发布或更新产生的新内容版本会入队，同一内容版本保持幂等。日报详情页可显式确认后手动重新发送当前正文。日报邮件使用当前账号的提醒收件邮箱，未配置时回退到注册邮箱。

“设置”同时提供可读 JSON 和 CSV 导出，均只包含当前账号的非敏感业务数据。日报联动令牌只在生成/轮换时展示一次，可随时吊销；它允许读取当前账号的日程与 QQ 未读摘要，也允许上传日报媒体、发布日报，不能修改日程。`/api/integrations/daily-report/agenda` 是只读、限定当前账号并要求显式日期的日程接口。

“设置”中的“日报邮箱（QQ）”用于按个人账号保存 QQ 邮箱账号和客户端授权码。授权码在服务端以独立密钥加密保存，测试读取和日报接口只返回未读邮件摘要，不返回授权码，也不影响 AI Calendar 固定的 163 发件邮箱。

云端候选链路通过 OAuth Authorization Code + PKCE 和 `/mcp` 接口供 ChatGPT Work 使用。Work 连接只接触当前账号的结构化输入和服务端生成的日报，不读取本地 `日报-v2` worktree；服务端负责媒体托管、日报幂等和邮件入队。Cloud Context 通过登录态 `/api/daily-report/cloud-context` 维护，MCP 对 Context 和活动证据只读。当前生产候选发布为 `workspace-20260909-cloud-mcp-11`，已完成 Work 连接、脱敏 Context `v1` 导入和一次返回 `VALIDATED_NOT_PUBLISHED` 的 shadow dry-run；Work 中已创建并启用每日 `16:40`（`Asia/Shanghai`）的 `日报 V2 Cloud Shadow`。现有本地 `v2-chatgpt` 任务未停用，正式切换须按 [`docs/CHATGPT-WORK-CLOUD.md`](docs/CHATGPT-WORK-CLOUD.md) 的连续 shadow、故障对照、通知分层和收件箱证据门槛执行。

## 10. API 模块概览

后端 API 统一以 `/api` 开头，主要模块为：

- `/api/auth/*`：验证码、注册、登录和当前用户。
- `/api/action-center`：今日行动中心聚合。
- `/api/note-items`：当前账号的 AI 记事条目 CRUD；批量 POST 会按非空行创建条目。
- `/api/schedules`、`/api/calendars`、`/api/categories`：日历数据。
- `/api/cycle-reminders`：周期事务、模板、完成和测试邮件。
- `/api/notification-preferences`、`/api/notifications`：提醒偏好与发送记录。
- `/api/weather/locations`、`/api/weather`：常驻地搜索和天气读取。
- `/api/completions`、`/api/history`、`/api/attachments`：完成证明和附件。
- `/api/exports/user-data.json`、`/api/exports/schedules.csv`：当前账号可读导出。
- `/api/daily-reports`、`/api/daily-reports/:date`：当前账号日报列表和详情；`POST /api/daily-reports/:date/send` 用于确认后手动重新发送当前正文。
- `/api/integrations/daily-report-token`、`/api/integrations/daily-report/agenda`：令牌管理和只读日报日程。
- `/api/user-mail-account`、`/api/user-mail-account/test`：当前账号 QQ 邮箱配置、删除和只读连接测试。
- `/api/integrations/daily-report/mail`：日报令牌读取当前账号的 QQ 未读摘要，不返回授权码。
- `/api/integrations/daily-report/reports/:date/media/:filename`：V2 使用日报令牌上传本地已校验的新闻图片或来源 logo；文件名必须是内容 SHA256，服务端不会从该请求访问外站。
- `/api/integrations/daily-report/reports/:date`：V2 使用日报令牌发布或幂等更新日报；`daily-digest.v1` 必须只引用已经上传的本站 `/daily-report-media/` 地址，发布正文不写入日志，邮件状态由账号设置和通知队列决定。
- `/api/daily-report/cloud-context`、`/api/daily-report/cloud-activity`：登录态维护云端日报 Context 和主动提供的活动证据；写入前拒绝凭据字段/值，MCP 只读。
- `/.well-known/oauth-protected-resource`、`/.well-known/oauth-authorization-server`、`/oauth/*`：ChatGPT Work Cloud 的 OAuth 2.1 风格 PKCE 元数据、动态客户端注册、授权、令牌刷新和撤销。
- `/mcp`：无状态 Streamable HTTP MCP；工具按 scope 读取 Calendar、QQ 未读摘要、Context、历史，或在服务端完成媒体托管后发布日报。
- `/daily-report-media/:filename`：公开读取服务端已校验的日报媒体；文件名为内容哈希，供登录后网页和邮件共同使用。
- `/api/backups`、`/api/admin/backups`：用户备份和全站灾备。
- `/api/ai-chat`：普通问答、天气问答和待确认日程建议；只有明确提到“知识库”或 `Knowledge Library` 才检索知识库；历史专用 `sourceNoteId`/`requestedAction=create_todo` 参数会明确拒绝。
- `/api/ai/imports`：AI 导入草稿、确认和删除。
- `/api/email-import/settings`：可选邮箱自动导入设置。
- `/api/admin/users`：管理员用户管理。

除登录、验证码和少量兼容接口外，个人数据接口都需要登录令牌，并在服务端按 `user_id` 校验。

## 11. 备份与恢复

用户备份文件扩展名为 `.aicalendar-backup`，使用口令派生密钥并加密。导出内容包含个人日历、周期事务、AI 记事、完成记录、附件、日报、通知偏好和确认后的 AI 导入记录，不包含密码、角色、JWT、SMTP 凭据和 AI API Key。旧版缺少记事字段的备份仍可恢复；CSV 导出不包含 AI 记事。

恢复前先使用“检查备份”查看版本、数量和冲突，再选择：

- 合并：仅导入不存在的数据，冲突保留当前数据。
- 替换：先备份当前用户数据，再替换该用户的个人数据。

全站恢复属于高风险管理操作，必须进入维护模式并先生成恢复前快照；管理员全站快照会同时保存用户附件和 `data/daily-report-media/` 日报图片。阿里云 OSS 应使用私有 Bucket、阻止公共访问、同地域内网 Endpoint 和最小权限 RAM 用户。

## 12. 阿里云部署

完整部署流程见 [DEPLOY.md](./DEPLOY.md)。推荐结构：

```text
Internet
   ↓ HTTPS 443
Nginx
   ↓ 127.0.0.1:3000
Node.js + PM2
   ↓
data/*.db + data/attachments
```

生产环境注意：

- 公网只开放 `80/443`；SSH `22` 最好限制来源 IP。
- 不要向公网直接开放 `3000`、`3001` 或 `5173`。
- Nginx 负责 HTTPS，Node.js 只监听内部端口。
- 修改 `.env` 后执行 `pm2 restart smart-schedule --update-env`。
- 更新代码前先生成数据库和附件快照。

## 13. 常见问题

### 页面可以打开，但 API 报错

确认后端是否运行，并访问 `http://localhost:3000/api/health`。开发模式还应检查 Vite 的 `/api` 代理是否仍指向 `http://localhost:3000`。

### 修改 `.env` 后没有生效

必须重启 Node.js 进程。本地按 `Ctrl+C` 后重新执行 `npm run dev`；服务器执行：

```bash
pm2 restart smart-schedule --update-env
```

### 启动时报“缺少邀请码初始化配置”或“生产邀请码至少需要 12 个字符”

这表示当前进程被识别为生产环境，且数据库还没有对应角色的邀请码记录。首次部署或迁移时，应在 `.env` 中为管理员和普通用户分别配置不同且至少 12 个字符的引导值；初始化完成后，实际生效值来自数据库，重启不会重新导入旧环境变量。运行本地开发服务时，可使用 `APP_ENV=development` 和 `APP_URL=http://localhost:5173/today`。不要通过关闭生产校验来绕过报错。

### 为什么没有收到提醒邮件

依次检查：

1. 当前用户是否保存了提醒邮箱。
2. 邮件通知开关是否开启。
3. 是否处于免打扰时间。
4. `.env` 是否为统一的 163 SMTP 配置。
5. `SMTP_PASS` 是否为有效客户端授权码。
6. 通知记录中是否显示重试或最终失败原因。
7. 收件箱垃圾邮件规则是否拦截。

日报邮件还需检查：

1. 日报详情是否显示 `邮件已入队`、`邮件已发送` 或 `邮件失败`。
2. “设置”中的“日报邮件”是否已开启；它影响自动入队，日报详情中的手动发送可用于补发或重发已有日报。
3. 邮件失败后是否在日报列表显式确认重试，或在日报详情手动重新发送；系统不会对日报邮件自动重试。

本地开发还必须显式设置 `BACKGROUND_JOBS_ENABLED=true` 并重启后端；设置页的“自动提醒”只保存账号级开关，不会替代服务进程的后台任务开关。生产环境只允许唯一一个 worker 开启该配置，避免重复发送。

管理员可以在“调试日志”中按 `reminder` 分类查看扫描、筛选和队列汇总，按 `mail` 分类查看邮件通知创建、领取、发送开始、SMTP 反馈、成功落库、失败与重试。重点看同一 `notificationId` 是否依次出现 `notification_created`、`notification_claimed`、`mail_send_started`、`mail_smtp_feedback` 和 `notification_sent`；若 SMTP 没有接受收件人，会出现 `mail_send_failed`、`email_smtp_rejected` 和 `notification_failed`，并记录 `errorCode`、`lastError` 与 `nextRetryAt`。SMTP 反馈表示发件服务器处理结果，不等同于收件箱最终到达。

### 能否删除 `.env.example`

不建议。程序虽然不直接读取它，但首次部署、团队协作、灾后重建和新增配置都依赖这份模板。它也能在不泄露秘密的前提下说明环境要求。

### 能否直接编辑 `dist`

不要。它是构建产物，下一次构建会覆盖。应修改 `src/`，然后重新执行 `npm run build:client`；生产服务会直接读取最新的 `dist/`。

## 14. 安全边界

- `.env`、数据库、附件和备份均已被 `.gitignore` 排除。
- SMTP/IMAP 授权码、JWT 密钥、邀请码、OSS AccessKey 和 AI Key 都不能提交 Git。
- 用户附件不通过静态目录暴露，下载必须验证登录账号和所有权。
- 正式备份密钥应与 JWT 密钥分开，并保存在服务器外的安全位置。
- 生产环境必须使用 HTTPS。
- 删除数据库、重置服务器或执行全站恢复前，必须先生成可验证快照。

## 15. 当前资源适配

该项目按轻量单机服务设计，适合当前 2 核 2GB 阿里云服务器的小规模个人使用。为控制资源：

- AI 图片导入限制为单任务并发、最多 3 张图。
- 本地数据库和附件直接落盘，不额外引入 Redis、消息队列或独立数据库服务。
- 通知队列由应用持久化，重启后继续处理。
- OSS 上传失败不阻断主应用，保留本地备份并等待重试。

当用户量、附件量或并发明显增长后，再评估迁移到独立 PostgreSQL、对象存储直传和独立任务进程；当前阶段不需要提前增加这些维护成本。

设置页提供“荣耀日历同步”：预览/确认、状态和自动化启停。全部日历的已排期日程/待办和已保存周期可单向投影；完成历史须显式启用，停用/取消周期保留状态，副本归并去重；生产扩大范围、自动化和提醒需分阶段验收。配置与恢复边界见 [CalDAV 桥接合同](docs/CALDAV-BRIDGE.md)，真机证据见 [荣耀 POC](docs/CALDAV-HONOR-POC.md)。

## 无固定期限待办与全天输入

行动中心的“无固定期限待办 · 查看全部”抽屉展示当前账号全部未排期 todo，包含完成历史。可按状态筛选、搜索标题/描述/备注、查看完成记录、编辑、完成/恢复和删除。历史保存时间不是执行期限；关闭无固定期限后须重新选择日期。

`GET /api/schedules/unscheduled` 是登录账号隔离的纯只读接口，不套日期窗口、不生成周期。修改复用既有日程和完成记录接口。

新建和涉及时间字段的更新统一校验：单日全天必须使用日期或零点，todo 不保存结束时间；全天与非零时刻冲突明确拒绝。AI 导入只有日期时生成零点全天待办。历史备份仍可恢复，异常记录由桥接报告并由用户明确修正。

## 16. License

MIT
