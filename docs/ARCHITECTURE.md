# AI Calendar 架构

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

当前登录后页面路由是 /today、/schedule、/assistant、/reminders、/import、/reports、/reports/:date、/library 和 /library/:id；未登录时使用 /login。

## 3. 后端

server/index.ts 目前是 Express 组合入口，集中注册认证、用户、日程、周期事务、通知、AI、记事、知识库、日报、附件、备份和管理员接口。业务实现已经部分下沉到 store/service 文件，但 HTTP 注册仍较集中。

认证中间件先解析登录身份；业务接口使用当前用户 ID 查询或写入数据。管理员接口额外检查管理员角色。外部日报接口使用独立的按账号绑定令牌，权限与登录会话分开。

后续 router 拆分采取增量方式：只有在修改某个领域时，才把该领域的路由和依赖一起提取；不为了目录形式一次重写 server/index.ts。

## 4. 持久化

数据层使用 sql.js。服务启动时把 SQLite 文件加载到内存，业务修改后导出并写回 data/。当前主要文件为：

- chat.db：用户、会话、消息、AI 配置、记事、日报和账号私有知识库的 `library_entries`、Article 版本、评论及发布令牌哈希；知识正文以 Markdown 为 source，HTML 按读取时安全渲染。
- schedule.db：日历、分类和日程。
- reminder.db：周期事务和提醒配置。
- activity.db：通知、完成记录和活动审计。

数据库文件、附件、日报媒体、备份和日志都是运行时资产，不能提交 Git。备份服务在导出和恢复时处理四个数据库及允许的附件/媒体内容；恢复前必须检查版本、冲突和快照路径。

## 5. 领域边界

| 领域 | 前端入口 | 后端入口/服务 | 关键规则 |
| --- | --- | --- | --- |
| 认证与账号 | LoginPage、useAuth | auth 路由、db | JWT 与账号状态；所有数据按用户隔离 |
| 日程与分类 | ScheduleView、CalendarView | schedule-store、日历 API | 日期、时区、冲突和分类逻辑可测试 |
| 周期事务与通知 | ReminderPage、ActionCenterPage | reminder-store、notification-service、scheduler | 月末兜底、逾期完成、免打扰和失败重试 |
| AI | AiSchedulePanel、AiImportPage | AI 服务、ai-plan、ai-import-service | 生成计划不等于写入；必须用户确认 |
| AI 记事 | NoteBoard | note-item-service | 记事独立于行动中心；导出确定性生成 |
| 知识库 | LibraryPage | library-service、library-markdown、library publish API | Fragment/Article 统一模型、账号隔离、普通搜索、版本与安全 Markdown；日程关系只预留 |
| 日报 | DailyReportsPage | daily-report API、模板、media service | 媒体先校验/托管；内容版本决定入队 |
| 完成和附件 | ActionCenterPage | completion、attachment service | 所有权、大小、MIME 和恢复边界 |
| 备份与管理 | Settings、AdminModal | backup-service、admin API | 高风险操作确认、快照和回滚 |

## 6. 日报 V2 跨项目流程

外部日报 V2 负责采集、上下文、结构化生成、Validator、确定性渲染、本地媒体下载/校验和上传。AI Calendar 负责令牌鉴权、媒体按内容哈希保存、日报按日期与内容版本幂等保存，以及按账号设置决定邮件队列。

本地 NoSend、发布接口返回、QUEUED、SMTP accepted 和收件箱到达属于不同证据层级，不能相互替代。主仓库不从生产服务器访问外站新闻图，也不把外部项目的凭据或运行数据带入仓库。

## 7. 构建产物

Vite Web 构建写入 dist/；Electron TypeScript 编译写入 dist-electron/；build:electron 准备只含 main.js、preload.js、app-url.json、package.json 和桌面图标的 dist-desktop/；安装包写入 release/。构建需要合法 HTTPS 的 ELECTRON_APP_URL 或 APP_URL，但该值不应写入提交或覆盖 .env。
