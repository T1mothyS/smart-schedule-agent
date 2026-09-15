# AI Calendar 架构

- Status: LIVING
- Scope: 本文列明的源码结构、合同或验证方法；历史证据按时点使用。
- Last verified commit/version: `8854a38` / `0.21.0-260915.0924`（2026-09-15，源码核对）。
- Authority: 当前源码与自动化验证优先；文档职责见文档索引。
- Update trigger: 本领域 API、数据归属、媒体策略或验收入口变化。
- Supersedes: 原文中已纠正的漂移描述；保留历史快照时间边界。
- Do not use for: 推断当前生产部署、Work 配置或邮件收件箱状态。

本文档记录当前源码和测试能够证明的结构，不记录密钥、真实生产数据、用户邮件或服务器凭据。发生行为变化时，先以源码和测试为准，再更新本文档。

## 1. 运行时边界

浏览器或 Electron renderer 进入 React/Vite 前端。前端通过同源的 /api 请求访问 Express 服务；开发环境由 Vite 代理到 Node 服务，生产环境由 HTTPS/Nginx 转发到 Node 服务。

React/Vite 与 Electron 壳都使用同一套前端页面。Electron 主进程和 preload 只负责桌面窗口、安全桥接和通知等壳能力，不复制服务器端业务。

## 2. 前端

入口和主要页面：

| 入口 | 职责 |
| --- | --- |
| src/main.tsx | 创建 React 根节点并加载全局样式 |
| src/App.tsx | 登录态、顶层路由和登录后页面组合 |
| src/pages/LoginPage.tsx | 登录、注册和验证码 |
| src/components/AppShell.tsx | 登录后产品壳、导航、主题、设置和退出 |
| src/components/ActionCenterPage.tsx | 今日行动中心 |
| src/components/ScheduleView.tsx、CalendarView.tsx、ScheduleSidebar.tsx | 日历、日程和分类 |
| src/components/ReminderPage.tsx | 周期事务、完成和提醒历史 |
| src/components/AiSchedulePanel.tsx、AiImportPage.tsx | 普通 AI、天气和待确认导入 |
| src/components/NoteBoard.tsx | AI 记事的 CRUD、颜色、完成和导出 |
| src/components/DailyReportsPage.tsx | 日报列表、独立阅读页和显式重发 |
| src/components/LibraryPage.tsx | 知识库列表、搜索、Fragment/Article 生命周期、Markdown 阅读和评论 |
| src/components/settings/ | Settings V2 的 Dialog、Layout、Section、Row 和领域设置 |

当前登录后页面路由是 /today、/schedule、/assistant、/reminders、/reports、/reports/:date、/library 和 /library/:id；/import 重定向到 /assistant?tool=email-import；未登录时使用 /login。设置通过产品壳按钮打开 SettingsDialog，没有独立 /settings 路由。

## 3. 后端

server/index.ts 目前是 Express 组合入口，集中注册认证、用户、日程、周期事务、通知、AI、记事、知识库、日报、附件、备份和管理员接口。业务实现已经部分下沉到 store/service 文件，但 HTTP 注册仍较集中。

认证中间件先解析登录身份；业务接口使用当前用户 ID 查询或写入数据。管理员接口额外检查管理员角色。外部日报接口使用独立的按账号绑定令牌，权限与登录会话分开。

后续 router 拆分采取增量方式：只有在修改某个领域时，才把该领域的路由和依赖一起提取；不为了目录形式一次重写 server/index.ts。

## 4. 持久化

数据层使用 sql.js。服务启动时把 SQLite 文件加载到内存，业务修改后导出并写回 data/。当前主要文件为：

- chat.db：用户、会话、消息、AI 配置、记事、账号私有知识库、偏好与令牌哈希，以及 OAuth、Cloud Context/活动输入和媒体批次元数据；知识正文以 Markdown 为 source，HTML 按读取时安全渲染。日报正文不在此库。
- schedule.db：日历、分类和日程。
- reminder.db：周期事务和提醒配置。
- activity.db：`daily_reports` 日报正文和来源/投递状态、通知队列、完成记录、AI 导入草稿与附件元数据，由 `activity-store.ts` 管理。

数据库文件、附件、日报媒体、备份和日志都是运行时资产，不能提交 Git。备份服务在导出和恢复时处理四个数据库及允许的附件/媒体内容；恢复前必须检查版本、冲突和快照路径。

系统快照包含四库、附件和日报媒体；用户备份包含账号范围记录和附件，但不打包日报媒体文件。部署配置由独立部署备份负责。当前整库写回与跨库操作不构成统一事务；用户恢复有事前备份但无全流程自动回滚，系统恢复有暂存及可捕获异常的回滚路径，不能当作进程中断恢复保证。

## 5. 领域边界

| 领域 | 前端入口 | 后端入口/服务 | 关键规则 |
| --- | --- | --- | --- |
| 认证与账号 | LoginPage、useAuth | auth 路由、db | JWT 与账号状态；所有数据按用户隔离 |
| 日程与分类 | ScheduleView、CalendarView | schedule-store、日历 API | 日期、时区、冲突和分类逻辑可测试 |
| 周期事务与通知 | ReminderPage、ActionCenterPage | reminder-store、notification-service、scheduler | 月末兜底、逾期完成、免打扰和失败重试 |
| AI | AiSchedulePanel、AiImportPage | AI 服务、ai-plan、ai-import-service | 生成计划不等于写入；必须用户确认 |
| AI 记事 | NoteBoard | note-item-service | 记事独立于行动中心；导出确定性生成 |
| 知识库 | LibraryPage | library-service、library-markdown、library publish API | V2 本地加工、服务器只读呈现、评论、版本、关系原样保存和安全 Markdown；不在服务器做 AI 加工 |
| 日报 | DailyReportsPage | daily-report API、模板、media service、delivery policy | Local/Cloud 按来源和内容哈希保存；媒体先校验/托管；来源设置决定 `RECEIVED` 或 `CANDIDATE` 及邮件入队 |
| 完成和附件 | ActionCenterPage | completion、attachment service | 所有权、大小、MIME 和恢复边界 |
| 备份与管理 | Settings、AdminModal | backup-service、admin API | 高风险操作确认、快照和回滚 |

## 6. 日报 V2 跨项目流程

外部日报 V2 负责本地链路的采集、上下文、结构化生成、Validator、确定性渲染、本地媒体下载/校验和上传；Work Cloud 通过生产 MCP 读取输入并在服务端托管媒体。AI Calendar 负责令牌/OAuth 鉴权、根据调用身份固定 `local` 或 `cloud` 来源、媒体按内容哈希保存、日报按账号/日期/来源/内容版本幂等保存，以及按账号来源设置决定 `RECEIVED` 或 `CANDIDATE` 和邮件队列。Cloud `dry_run=true` 不写日报或邮件队列，`dry_run=false` 必须返回 `PUBLISHED` 才表示生产数据库已保存。

本地 NoSend、发布接口返回、QUEUED、SMTP accepted 和收件箱到达属于不同证据层级，不能相互替代。Local 发布阶段不抓取外站新闻图；Cloud 服务端可受控获取显式媒体，无批次时逐图 Best Effort，有批次时检查 READY、归属与完整性，正文完整性保持硬闸门。`dry_run=true` 不保存日报或队列，但可能托管媒体文件。不得把外部项目凭据或运行数据带入仓库。完整合同见 [Cloud 文档](CHATGPT-WORK-CLOUD.md)。

## 7. 构建产物

Vite Web 构建写入 dist/；Electron TypeScript 编译写入 dist-electron/；build:electron 准备只含 main.js、preload.js、app-url.json、package.json 和桌面图标的 dist-desktop/；安装包写入 release/。构建需要合法 HTTPS 的 ELECTRON_APP_URL 或 APP_URL，但该值不应写入提交或覆盖 .env。
