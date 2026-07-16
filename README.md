# AI Calendar（智能日程与周期事务中心）

AI Calendar 是一个面向个人用户的日程、待办和周期事务管理服务。它把原有日历、AI 对话、账户与邮件能力统一到同一套前端中，并增加今日行动中心、周期事务模板、可靠提醒、完成证明、备份恢复和 AI 智能导入。

本文档适用于本仓库当前版本，包含本地启动、邮件配置、环境变量、目录说明、部署入口、数据安全和常见故障排查。

## 1. 当前能力

- 登录后默认进入 `/today` 今日行动中心。
- 日历支持日程、待办、分类、优先级和完成状态。
- 周期事务支持信用卡、SIM、订阅、保险、证件、会员、房租、水电、车辆年检和自定义规则。
- 周期事务会按当前周期到期日同步为日历全天待办，完成后继续生成下一周期事项。
- 通知支持邮件、站内消息、浏览器通知、免打扰、失败重试和发送记录。
- 完成时可保存备注、金额、账单日期、图片或 PDF 证明。
- 支持用户加密导出/恢复和管理员全站快照。
- AI 可从自然语言或截图生成待确认草稿；确认前不会写入正式数据。
- 可选通过 163 邮箱 IMAP 接收转发邮件并生成待确认草稿。
- 支持 Web 页面和 Electron 桌面壳。

固定业务规则：

- 不提供“跳过”功能。
- 月份不存在指定账单日或执行日时，自动使用当月最后一天。
- 周期事务逾期后标记为 `expired`，仍保留手动完成入口。
- 普通日程结束后不会自动变成逾期；待办和周期事务才参与逾期判断。
- 官方发件邮箱固定为 `aicalendarofficial@163.com`。
- 每位用户自行配置提醒收件邮箱；未配置时使用该用户的注册邮箱。

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

开发模式下，Vite 前端运行在 `http://localhost:5173`，后端运行在 `http://localhost:3000`，`/api` 请求由 Vite 代理到后端。

## 3. Windows 本地启动

### 3.1 环境要求

- Node.js 20 或更高版本。
- npm（随 Node.js 安装）。
- 需要使用 AI 功能时准备 CodeBuddy API Key。
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
ADMIN_INVITE_CODE=管理员邀请码
USER_INVITE_CODE=普通用户邀请码

SMTP_HOST=smtp.163.com
SMTP_PORT=465
SMTP_USER=aicalendarofficial@163.com
SMTP_PASS=163邮箱客户端授权码

CODEBUDDY_API_KEY=你的CodeBuddy_API_Key
PORT=3000
APP_TIMEZONE=Asia/Shanghai
APP_URL=http://localhost:5173/today
APP_ENV=development
```

不要把真实密钥、授权码或邀请码写进 `.env.example`，也不要提交 `.env`。

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
5. 点击测试邮件。
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
| `ADMIN_INVITE_CODE` | 是 | 注册管理员账号时使用的邀请码 |
| `USER_INVITE_CODE` | 是 | 注册普通账号时使用的邀请码 |

### 6.2 官方邮件

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `SMTP_HOST` | 是 | 固定使用 `smtp.163.com` |
| `SMTP_PORT` | 是 | SSL 连接使用 `465` |
| `SMTP_USER` | 是 | 固定使用 `aicalendarofficial@163.com` |
| `SMTP_PASS` | 是 | 163 客户端授权码，不是登录密码 |

### 6.3 AI 与服务地址

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `CODEBUDDY_API_KEY` | AI 功能必需 | 服务器默认使用的 CodeBuddy API Key |
| `CODEBUDDY_BASE_URL` | 否 | 自定义 CodeBuddy API 地址 |
| `PORT` | 否 | 后端监听端口，默认 `3000` |
| `APP_TIMEZONE` | 建议 | 业务时区，当前建议 `Asia/Shanghai` |
| `APP_URL` | 是 | 邮件按钮跳转地址；生产环境填写 HTTPS 域名，例如 `https://example.com/today` |
| `APP_ENV` | 是 | 本地为 `development`，服务器为 `production`；避免 Vite 读取 `NODE_ENV` 产生构建警告 |

### 6.4 备份与 OSS

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `BACKUP_ENCRYPTION_KEY` | 全站备份必需 | 独立随机长密钥，不应与 `JWT_SECRET` 共用 |
| `OSS_BUCKET` | OSS 可选 | 阿里云 OSS 私有 Bucket 名称 |
| `OSS_ENDPOINT` | OSS 可选 | 同地域 ECS 优先使用内网 Endpoint |
| `OSS_ACCESS_KEY_ID` | OSS 可选 | 专用 RAM 用户 AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | OSS 可选 | 专用 RAM 用户 AccessKey Secret |
| `MAINTENANCE_MODE` | 是 | 正常运行保持 `false`；全站恢复时才临时设为 `true` |

### 6.5 邮箱自动导入（可选）

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

| 文件或目录 | 作用 |
| --- | --- |
| `.git/` | Git 本地版本历史和分支信息，不要手工修改 |
| `.env` | 当前机器真实运行配置，包含秘密，不提交 Git |
| `.env.example` | 可提交的环境变量模板，新机器通过它创建 `.env` |
| `.gitignore` | 排除密钥、数据库、附件、依赖和构建产物 |
| `README.md` | 项目主说明，也就是本文档 |
| `DEPLOY.md` | 阿里云服务器、Nginx、HTTPS、PM2 和升级部署的详细步骤 |
| `DEVELOPMENT.md` | 原项目较长的开发参考和历史实现说明；实际行为以当前代码和本 README 为准 |
| `package.json` | npm 脚本、依赖版本范围、Electron 打包配置和项目元数据 |
| `package-lock.json` | npm 锁定依赖树，保证不同机器安装一致，应该提交 |
| `index.html` | Vite 前端 HTML 入口，挂载 React 根节点 |
| `vite.config.ts` | Vite 配置；定义 5173 端口、Less 和 `/api` 后端代理 |
| `tsconfig.json` | 前端和通用 TypeScript 编译/类型检查配置 |
| `tsconfig.node.json` | Vite 等 Node 侧配置文件的 TypeScript 设置 |
| `tsconfig.electron.json` | Electron 主进程和 preload 的独立编译配置 |
| `tailwind.config.js` | Tailwind CSS 内容扫描和主题配置 |
| `postcss.config.js` | PostCSS、Tailwind 和 Autoprefixer 配置 |
| `go.bat` | Windows 双击启动脚本；缺依赖时安装并打开 5173 页面 |
| `deploy.sh` | Ubuntu/Debian 首次部署第一步；安装 Node.js 20、PM2 并创建目录 |
| `deploy-continue.sh` | 上传代码后的部署第二步；安装、构建、复制静态文件并用 PM2 启动 |
| `node_modules/` | npm 安装的第三方依赖，可由 `npm ci` 重建，不提交 |
| `dist/` | Vite 构建后的 Web 静态文件，可由 `npm run build:client` 重建 |
| `dist-electron/` | Electron TypeScript 编译结果，可由 `npm run build:electron` 重建 |
| `release/` | Electron 安装包输出目录，仅在执行桌面打包后产生 |

### 7.2 `src/` 前端

| 文件 | 作用 |
| --- | --- |
| `src/main.tsx` | React 浏览器入口，创建根节点并加载全局样式 |
| `src/App.tsx` | 顶层路由和登录后页面组织 |
| `src/index.css` | 全局样式、主题变量和页面基础视觉 |
| `src/config.ts` | 应用名称、描述和版本等前端常量 |
| `src/types.ts` | AI 对话、会话和公共前端类型 |
| `src/reminder-types.ts` | 周期事务、通知偏好、行动中心和完成记录等类型 |
| `src/pages/LoginPage.tsx` | 登录、注册和验证码流程页面 |
| `src/pages/ChatPage.tsx` | AI 对话页面容器 |
| `src/components/AppShell.tsx` | 登录后统一页面框架、顶部导航和内容区域 |
| `src/components/ActionCenterPage.tsx` | 今日行动中心：下一步、今天、临期、逾期和已完成 |
| `src/components/ScheduleView.tsx` | 日历主页面和日程管理容器 |
| `src/components/CalendarView.tsx` | 日历日期网格/时间视图展示 |
| `src/components/ScheduleSidebar.tsx` | 日历侧栏、日历源和分类操作 |
| `src/components/ReminderPage.tsx` | 周期事务模板、任务、完成和提醒历史页面 |
| `src/components/SettingsPage.tsx` | 全局设置、提醒收件邮箱、通知偏好、备份和邮箱导入设置 |
| `src/components/AiImportPage.tsx` | 自然语言/截图智能导入、草稿校对与确认 |
| `src/components/AiSchedulePanel.tsx` | 原 AI 日程助手面板 |
| `src/components/Header.tsx` | 原对话界面顶部栏 |
| `src/components/Sidebar.tsx` | AI 会话列表侧栏 |
| `src/components/ChatMessages.tsx` | AI 对话消息列表和流式结果展示 |
| `src/components/ChatInput.tsx` | AI 对话输入和发送控制 |
| `src/components/NewChatView.tsx` | 新建对话的空状态页面 |
| `src/components/NewChatDialog.tsx` | 新建对话弹窗 |
| `src/components/AdminModal.tsx` | 管理员用户管理弹窗 |
| `src/components/PermissionDialog.tsx` | AI 工具权限确认弹窗 |
| `src/components/InlinePermissionCard.tsx` | 对话流中的内嵌权限确认卡片 |
| `src/components/ToolCallsCollapse.tsx` | AI 工具调用记录的折叠展示 |
| `src/hooks/useAuth.ts` | 登录状态、令牌和当前用户逻辑 |
| `src/hooks/useChat.ts` | AI 对话发送、流式响应和状态管理 |
| `src/hooks/useModels.ts` | 可用 AI 模型获取和选择 |
| `src/hooks/useSessions.ts` | 对话会话列表、新建、重命名和删除 |
| `src/hooks/useTheme.ts` | 明暗主题读取、切换和持久化 |
| `src/utils/iconMap.ts` | 工具名称到界面图标的映射 |

### 7.3 `server/` 后端

| 文件 | 作用 |
| --- | --- |
| `server/index.ts` | Express 服务主入口；认证、用户、日历、周期、通知、附件、备份、AI 和静态页面 API 都在此注册 |
| `server/db.ts` | 账号、验证码、会话、用户设置和 `chat.db` 的访问层 |
| `server/schedule-store.ts` | `schedule.db` 的日历、分类、日程和用户隔离访问层 |
| `server/schedule-format.ts` | 把日程整理成邮件或 AI 可读文本 |
| `server/reminder-store.ts` | `reminder.db` 的周期规则、任务、周期实例和迁移逻辑 |
| `server/reminder-service.ts` | 计算到期日、月末兜底、逾期状态和周期推进 |
| `server/reminder-calendar-sync.ts` | 将周期任务同步为日历全天待办，并维护完成、下一周期和删除联动 |
| `server/action-center.ts` | 聚合日程、待办和周期事务，计算“下一步”和行动中心分组 |
| `server/activity-store.ts` | `activity.db` 的完成记录、附件元数据、通知队列、偏好和 AI 草稿访问层 |
| `server/notification-service.ts` | 持久化通知调度、免打扰、幂等去重、失败重试和发送状态 |
| `server/email-service.ts` | 固定 163 官方发件邮箱、邮件模板、SMTP 校验和错误转换 |
| `server/email-import-service.ts` | 可选 IMAP 邮箱轮询、令牌匹配和 Message-ID 去重 |
| `server/attachment-service.ts` | 附件类型/大小校验、哈希存储、配额和鉴权读取辅助 |
| `server/backup-service.ts` | 用户加密备份、恢复预览、全站快照和可选 OSS 上传 |
| `server/ai-import-service.ts` | 自然语言/截图解析、置信度草稿、确认和过期清理 |
| `server/core.test.ts` | 核心业务测试：月末、逾期完成、附件、用户隔离、备份和 AI 草稿等 |
| `server/sql-js.d.ts` | 为 `sql.js` 补充项目所需的 TypeScript 类型声明 |
| `server/public/` | 旧版静态产物目录，仅为兼容历史部署保留；当前生产服务直接读取 `dist/` |

### 7.4 `electron/` 桌面端

| 文件 | 作用 |
| --- | --- |
| `electron/main.ts` | Electron 主进程；创建窗口、托盘、通知和外部链接处理 |
| `electron/preload.ts` | 在隔离上下文中向前端安全暴露窗口与通知 API |

### 7.5 `data/` 运行数据

| 文件或目录 | 作用 |
| --- | --- |
| `data/chat.db` | 用户、验证码、登录、AI 会话和账号级设置 |
| `data/chat.db-wal` / `data/chat.db-shm` | SQLite 正在运行时的 WAL 临时文件，不要单独复制或删除 |
| `data/schedule.db` | 日历、分类和日程数据 |
| `data/reminder.db` | 周期事务、周期实例和完成历史兼容数据 |
| `data/activity.db` | 统一完成记录、附件元数据、通知、偏好和 AI 导入草稿 |
| `data/attachments/` | 按用户隔离并以哈希名称保存的附件实体 |
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
| `npm run build:electron` | 编译 Electron 代码到 `dist-electron/` |
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
4. 保存后发送测试邮件。

这些设置按登录用户保存，不会修改官方发件账号，也不会影响其他用户。

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

## 10. API 模块概览

后端 API 统一以 `/api` 开头，主要模块为：

- `/api/auth/*`：验证码、注册、登录和当前用户。
- `/api/action-center`：今日行动中心聚合。
- `/api/schedules`、`/api/calendars`、`/api/categories`：日历数据。
- `/api/cycle-reminders`：周期事务、模板、完成和测试邮件。
- `/api/notification-preferences`、`/api/notifications`：提醒偏好与发送记录。
- `/api/completions`、`/api/history`、`/api/attachments`：完成证明和附件。
- `/api/backups`、`/api/admin/backups`：用户备份和全站灾备。
- `/api/ai/imports`：AI 导入草稿、确认和删除。
- `/api/email-import/settings`：可选邮箱自动导入设置。
- `/api/admin/users`：管理员用户管理。

除登录、验证码和少量兼容接口外，个人数据接口都需要登录令牌，并在服务端按 `user_id` 校验。

## 11. 备份与恢复

用户备份文件扩展名为 `.aicalendar-backup`，使用口令派生密钥并加密。导出内容包含个人日历、周期事务、完成记录、附件、通知偏好和确认后的 AI 导入记录，不包含密码、角色、JWT、SMTP 凭据和 AI API Key。

恢复前先使用“检查备份”查看版本、数量和冲突，再选择：

- 合并：仅导入不存在的数据，冲突保留当前数据。
- 替换：先备份当前用户数据，再替换该用户的个人数据。

全站恢复属于高风险管理操作，必须进入维护模式并先生成恢复前快照。阿里云 OSS 应使用私有 Bucket、阻止公共访问、同地域内网 Endpoint 和最小权限 RAM 用户。

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

### 为什么没有收到提醒邮件

依次检查：

1. 当前用户是否保存了提醒邮箱。
2. 邮件通知开关是否开启。
3. 是否处于免打扰时间。
4. `.env` 是否为统一的 163 SMTP 配置。
5. `SMTP_PASS` 是否为有效客户端授权码。
6. 通知记录中是否显示重试或最终失败原因。
7. 收件箱垃圾邮件规则是否拦截。

### 能否删除 `.env.example`

不建议。程序虽然不直接读取它，但首次部署、团队协作、灾后重建和新增配置都依赖这份模板。它也能在不泄露秘密的前提下说明环境要求。

### 能否直接编辑 `server/public/assets` 或 `dist`

不要。它们是构建产物，下一次构建会覆盖。应修改 `src/`，然后重新执行 `npm run build:client`；生产服务会直接读取最新的 `dist/`。

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

## 16. License

MIT
