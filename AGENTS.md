# AI Calendar 项目 Agent 工作规范

本文档是提交到仓库的通用协作规则。只写项目事实、可复用的安全边界和验证方式，不写本机绝对路径、服务器地址、凭据或个人数据。本机补充放在被忽略的 AGENTS.local.md；持续记录和部署 runbook 分别放在本地的 CONTINUOUS-REQUIREMENTS.md 与 DEPLOY.md。

## 1. 项目定位和技术结构

AI Calendar 是面向个人和小规模使用的日程、周期事务、提醒、AI 助手和日报中心，提供 Web 和 Electron 两种入口。

- 前端是 React、TypeScript、Vite、TDesign React、Tailwind CSS。
- 后端是 Node.js、Express、TypeScript、Nodemailer。
- 数据层使用 sql.js 将多个 SQLite 文件加载到内存并整体写回。
- AI、天气、邮箱、日报媒体和可选 OSS 备份属于外部边界，失败时必须显式反馈。
- 依赖管理使用 npm；存在 package-lock.json 时使用 npm ci。

主要目录：

| 路径 | 职责 | 边界 |
| --- | --- | --- |
| src/ | React 页面、组件、hooks、样式和前端类型 | 不直接读取 data/ 或生产配置 |
| server/ | Express、认证、领域服务、数据访问、通知、AI 和备份 | 新接口必须检查认证和资源所有权 |
| electron/ | Electron 主进程和 preload | 不把服务器端生产依赖带入桌面暂存目录 |
| scripts/ | 可重复执行的维护和构建辅助脚本 | 默认安全模式；破坏性动作要求显式参数 |
| public/ | 静态图标和资源 | 资源优化不得破坏现有导航和可访问性 |
| docs/ | 可提交的架构、界面、测试和路线文档 | 不写真实生产数据或凭据 |
| data/ | 运行时数据库、附件、媒体和备份 | 不提交、不删除、不从生产机器回填 |
| dist/、dist-electron/、dist-desktop/、release/ | 构建和打包产物 | 不手工修改、不提交 |

源码、测试和实际运行行为优先于旧 README、旧对话或历史计划。文档与代码冲突时，先用代码、测试和 Git 历史确认事实，再同步修正文档。

## 2. 开始任务前

先读取与任务相关的 AGENTS.md、AGENTS.local.md（若存在）、PROJECT-MAP.md、README.md、package.json、.gitignore，以及涉及部署、数据或发布的本地文档。

然后在仓库根目录确认：

- git status --short --branch
- git branch -vv
- git remote -v
- 当前 package.json 的 version、Node/npm 版本和现有测试脚本

区分已确认事实、合理推断和未知项。已有未提交修改属于用户，除非能明确区分，否则不得覆盖、恢复、删除或重置。

## 3. 数据、认证和 AI 安全边界

- 所有用户数据按当前账号隔离；新增 GET、POST、PUT、PATCH、DELETE 都要检查认证身份与资源所有权。
- AI 可以理解输入和生成草稿，但日程、待办或周期事务在用户确认前不得写入正式数据。
- AI 记事可以直接保存，但送入普通 AI 对话不会自动完成来源记事，也不会绕过现有确认流程。
- 密码、JWT、邀请码、SMTP/IMAP 授权码、AI Key、OSS 密钥和备份密钥只存在于忽略的配置或账号级安全存储中。
- 不读取、复制、提交或展示生产 data/、.env、附件、备份、用户邮件和真实令牌。
- 修改删除、替换、恢复、迁移、备份或发布逻辑时，必须保留可验证的备份和回滚路径。

## 4. 日报和外部项目边界

- 日报 V2 是独立的外部项目；Local 链路先在本地校验内容、下载/校验/上传媒体，服务端 Local 发布只接受本站托管媒体，不在发布时抓取外链。
- Cloud 链路由服务端受控获取媒体：内容完整性始终是硬闸门；无媒体批次时逐图 Best Effort 并返回失败记录，有批次时保持 READY、归属与完整媒体检查。不得把两条媒体规则混用；具体合同见 docs/CHATGPT-WORK-CLOUD.md。
- 只读日报令牌只能访问绑定账号允许的日报接口，不得扩展为任意 API 权限。
- PUBLISHED、QUEUED、health、PM2 或 SMTP accepted 只能证明对应层级，不能写成收件箱最终到达。
- 外部日报、真实发信、生产部署和收件箱验收必须分别授权、分别记录。

## 5. 修改原则

- 先调查现有实现、调用方、测试和数据边界，再做最小的相容修改。
- 沿用 React/Vite/Express/sql.js/npm 和现有组件、服务、测试方式；不为局部问题引入新框架或依赖。
- 不为了形式一次性拆分 server/index.ts；新功能优先在实际修改对应领域时逐步提取 router。
- 不把无关格式化、重命名、依赖升级或大范围重构混入当前任务。
- UI 修改必须保持窄屏、长文本、暗色主题、键盘操作和可访问性；统一原则见 docs/UI-GUIDELINES.md。
- Settings V2 的布局、接口合同和危险操作确认不可被后续修改绕过。

## 6. 本地和 CI 验证

常规提交前至少运行：

- npm run typecheck
- npm test
- npm run build
- git diff --check

默认构建 Electron 时需要进程级提供合法 HTTPS 的 ELECTRON_APP_URL 或 APP_URL，不要修改仓库 .env 来绕过检查。CI 只做安装、类型检查、测试和构建，不执行生产部署。

涉及 UI 时，实际浏览器验收至少覆盖 390×844、430×932、768×1024、1440×900；检查页面打开、核心控件、无横向溢出、长文本、加载/错误/禁用状态和暗色主题。单元测试通过不等于浏览器 UI 正常，也不等于生产部署成功。

## 7. Git、版本和发布

- 默认在当前任务分支建立一个清晰的本地 checkpoint；不要自动 push、合并 main、force push、rebase、reset --hard、clean 或删除分支/tag。
- 提交前检查 git diff、git status、git diff --check，以及是否混入 .env、数据库、附件、备份、构建物、临时脚本或秘密。
- 只有用户明确授权时，才执行 GitHub push、tag、Release、服务器上传、生产切换或真实发信。
- 应用版本以 package.json 为源；代码、依赖、功能或发布行为变更时，package-lock.json 顶层/根包和界面读取版本必须同步。仅协作规则、部署说明或历史记录不改变应用行为时，可以不更新版本，但要明确报告原因。
- 不在 AGENTS.md、README、日志、Prompt、测试产物或提交说明中写真实凭据。

## 8. 持续记录和交付

每个任务都要在本地 CONTINUOUS-REQUIREMENTS.md 记录用户意图、授权范围、开始基线、实际修改、验证结果、未验证内容、残余风险、线程 ID、分支/提交、push/部署/发信状态。只规划、失败、中止或被叫停的任务同样记录。

交付报告至少说明：

- 修改或实际执行了什么；
- 如何验证以及真实结果；
- 没有验证什么以及原因；
- 当前版本和版本号是否更新；
- Git 分支、提交、是否 push；
- 是否部署、是否发信、SMTP accepted 与收件箱是否验证；
- 剩余的具体风险和最有价值的下一步。

## 9. 文档维护与交接

每个任务结束前必须进行一次文档影响检查：

- 先通过 `docs/README.md` 和 `PROJECT-MAP.md` 找到受影响领域的 canonical 文档，不因局部需求随意新增平行说明。
- 修改行为、API、认证、数据归属、持久化、运行时、依赖、构建、测试、部署或验收规则时，在同一任务中更新对应的 Living、Contract、Feature 或 Runbook 文档。
- 同一事实只保留一个主要来源；其他文档使用链接，不复制容易过期的版本号、生产状态或历史结论。
- Living/Contract 文档的状态、范围、验证基线、权威来源、更新触发条件或适用边界发生变化时同步更新；新增、移动或归档文档时同步更新文档索引和引用。
- `AGENTS.md` 只维护稳定的协作、安全、授权、验证和文档维护规则；当前架构、版本、测试结果、生产状态和一次性审计证据应放在对应的 canonical 文档或本机连续记录中。
- 历史审计、验证和部署快照不得被悄悄改写；新增证据使用新的日期快照，并明确时间边界。
- 每个任务都要在本地 `CONTINUOUS-REQUIREMENTS.md` 记录意图、授权、基线、修改、验证、未验证内容、风险、Git/版本和 push/部署/发信状态。若其他文档无需更新，明确记录“文档影响检查：无需更新”及原因。
- 交付前检查文档链接、旧路径、旧版本号、过期命令、敏感信息和运行时产物。不能把本地测试、health、SMTP accepted 或历史记录写成生产端到端成功。
- 本机路径、服务器信息、凭据和生产运行细节只放在被忽略的本机文档或安全配置中，不写入可提交文档。

## 10. 参考入口

- docs/README.md：当前规范、操作手册、历史快照与验证基线索引。
- PROJECT-MAP.md：主应用、日报 V2 和旧项目的模块边界与任务路由。
- docs/ARCHITECTURE.md：当前运行时和数据架构。
- docs/UI-GUIDELINES.md：界面和响应式约束。
- docs/TEST-MATRIX.md：自动、手工和生产验收层级。
- docs/ROADMAP.md：阶段顺序和明确不做的事项。
- DEPLOY.md：本地保留的生产部署、备份和回滚 runbook。
