# AI Calendar 项目 Agent 工作规范与需求记录

> 本文件是 smart-schedule-agent 的项目级协作说明，适用于在本仓库中工作的 Agent 和开发者。
>
> 状态：持续维护。本文件同时记录已从项目文件、Git 记录和对话中确认的事实、项目工作规范和用户需求。项目运行行为以当前源码和测试为准；部署细节以 DEPLOY.md 为准。
>
> 本文件不得包含密钥、授权码、邀请码、用户数据、服务器密码或其他真实凭据。

## 1. 项目目标

AI Calendar 是面向个人和小规模使用的智能日程与周期事务中心。目标是让用户可以用日历视图、行动中心或自然语言管理需要记住和执行的事情，并获得可靠的提醒、完成证明和数据恢复能力。

当前产品能力包括：

- 账号登录、注册、用户隔离和管理员用户管理；
- 日程、待办、分类、优先级、完成状态和日期/时间管理；
- 今日行动中心，聚合下一步、今天、临期、逾期和已完成事项；
- 周期事务模板，例如订阅、保险、证件、会员、房租、水电和车辆年检；
- 周期事务与日历全天待办的联动、完成后生成下一周期事项；
- 邮件、站内消息和浏览器通知，包含免打扰、失败重试和发送记录；
- 完成证明，包括备注、金额、账单日期、图片和 PDF 附件；
- 用户加密备份/恢复、管理员全站快照和可选阿里云 OSS 离机备份；
- AI 普通常识问答、基于 Open-Meteo 的真实天气查询，以及从自然语言或账单截图生成待确认草稿；
- 可选通过 163 邮箱 IMAP 接收转发邮件并生成待确认草稿；
- 可读 JSON/CSV 导出、只读日报令牌和外部日报日程接口；
- Web 页面和 Electron 桌面端。

产品行为的基本原则：

1. AI 可以帮助理解和生成计划，但在确认前不得把草稿写入正式日历或周期事务。
2. 所有用户数据必须按账号隔离；任何新增接口都必须检查登录身份和资源所有权。
3. 涉及日期、周期、逾期、完成和提醒的逻辑必须保持可解释、可测试，并遵守现有业务规则。
4. 涉及数据删除、替换、恢复或生产升级的操作必须先留下可验证的备份或回滚路径。
5. 当前以轻量单机服务为边界，不因“未来可能扩展”提前引入 PostgreSQL、Redis、消息队列或复杂部署平台。

当前已经确认的业务规则：

- 不提供“跳过”周期事务的功能；
- 当月份不存在指定账单日或执行日时，使用该月最后一天；
- 周期事务逾期后可以继续手动完成；
- 普通日程结束不会自动变成逾期，待办和周期事务才参与逾期判断；
- 官方发件邮箱固定为 aicalendarofficial@163.com；
- 用户可以配置自己的提醒收件邮箱；未配置时使用注册邮箱。

## 2. 主目录、仓库和工作副本

### 2.1 主要工作目录

主要工作目录是：

    C:\Users\Elysia\Documents\提醒云服务\smart-schedule-agent

所有正常开发、测试、提交和发布准备都应在这个目录进行。不要把另一个文件夹中的代码直接覆盖到这里，也不要把生产服务器上的 data/ 或 .env 拉回本地仓库。

### 2.2 Git 远程仓库

当前唯一配置的 Git 远程仓库是：

    https://github.com/T1mothyS/smart-schedule-agent.git

远程名称是 origin。当前采用“一份主要 GitHub 仓库 + 一台阿里云生产服务器”的低维护发布方式，项目中没有 .github/workflows，也没有自动部署流水线。

起草本文件时观察到的基线（2026-08-16，仅供定位，不是永久版本号）：

- 主工作副本当前分支为 refactor/calendar-workspace-v2；
- main 和 refactor/calendar-workspace-v2 当时都指向提交 7c99bd6；
- 另一份公开副本仍停留在 8c4a0b4；
- 起草本文件时（2026-08-16）主工作副本曾存在 production-assets.tar.gz 和 smart-schedule-agent.tar.gz 两个未跟踪压缩包；它们已于 2026-08-17 按用户确认移入 Windows 回收站，不再作为当前工作副本内容。

任何任务开始时都必须重新执行状态检查，不要依赖上面的基线：

    git status --short --branch
    git branch -vv
    git remote -v

### 2.3 公开副本的定位

    C:\Users\Elysia\Documents\提醒云服务\smart-schedule-agent-public-20260724

这个目录曾是历史上的公开/隐私安全快照，不是当前主要开发目录；该快照已于 2026-08-17 按用户确认移入 Windows 回收站。除非任务明确要求，否则：

- 不在该目录开发新功能；
- 不把它当作当前生产版本的依据；
- 不通过复制粘贴让两个目录“看起来一致”；
- 如需更新它，应先确认快照用途、隐私范围和目标提交，再单独完成并核验。

## 3. 目录和文件职责

| 路径 | 职责 | 工作规则 |
| --- | --- | --- |
| src/ | React/Vite 前端源码、页面、组件、hooks、样式和类型 | 产品界面和前端逻辑的主要修改位置 |
| server/ | Express/TypeScript 后端、认证、数据访问、AI、通知、备份和 API | 后端业务规则和数据安全的主要修改位置 |
| server/*.test.ts | 后端核心业务测试 | 修改核心逻辑时优先补充或调整测试 |
| electron/ | Electron 主进程和 preload | 只处理桌面壳、窗口、托盘、通知和安全桥接 |
| data/ | 运行时 SQLite 数据、附件、迁移备份和全站备份 | 生产资产，不提交、不删除、不从运行中的数据库直接复制 |
| .env | 当前机器真实运行配置和密钥 | 不提交、不复制到聊天、不覆盖生产配置 |
| .env.example | 无秘密的环境变量模板 | 新增配置变量时同步更新并提交 |
| dist/ | Vite 生成的 Web 静态产物 | 不手工编辑，由 npm run build:client 生成 |
| dist-electron/ | Electron 编译产物 | 不手工编辑，由 npm run build:electron 生成 |
| dist-desktop/ | Electron 最小打包暂存目录 | 不手工编辑，不携带服务器端生产依赖 |
| release/ | Electron 安装包输出目录 | 只作为打包产物，不作为 Web 服务部署源 |
| node_modules/ | npm 依赖安装目录 | 不提交，需要时用 npm ci 重建 |
| .git/ | 本地版本、分支和 reflog | 只通过 Git 命令使用，不手工修改内部文件 |
| README.md | 项目能力、配置、目录和常见问题 | 行为或配置变化时同步更新 |
| DEPLOY.md | 阿里云、Nginx、PM2、升级、备份和回滚说明 | 生产操作的主要参考 |
| deploy.sh | 首次服务器部署的准备步骤 | 不用于普通版本升级 |
| deploy-continue.sh | 上传代码后的安装、检查、构建和 PM2 启动/重启 | 手动上传或首次部署时使用 |
| scripts/ | 可重复执行的维护、迁移和构建辅助脚本 | 默认安全模式，不写入秘密；破坏性动作必须要求显式参数 |
| electron-builder.yml | Electron 最小桌面壳打包配置 | 打包项目目录必须保持为 dist-desktop/，不得携带服务器依赖 |

源码、生成物和运行数据的边界必须保持清晰：修改 src/、server/、electron/ 或 scripts/，不要直接修改 dist/ 或 data/ 来“修复”问题。

## 4. 技术结构和运行方式

当前技术栈：

- 前端：React 18、TypeScript、Vite、TDesign React、Tailwind CSS；
- 后端：Node.js、Express、TypeScript、Nodemailer；
- 数据：本地 SQLite/sql.js 文件，按账号隔离；
- AI：CodeBuddy Agent SDK；
- 桌面端：Electron；
- 依赖管理：npm，仓库已有 package-lock.json；
- 生产：阿里云轻量服务器、PM2、Nginx、HTTPS；
- 备份：本机加密快照，可选阿里云 OSS 私有 Bucket。

本地开发结构：

    浏览器/Vite  http://localhost:5173
           ↓ /api 代理
    Node.js      http://localhost:3000
           ↓
    data/*.db、data/attachments/

生产结构：

    公网 HTTPS 443
           ↓
    Nginx
           ↓ 127.0.0.1:3000
    Node.js + PM2（进程名 smart-schedule）
           ↓
    /root/smart-schedule-agent/dist
    /root/smart-schedule-agent/data

生产服务器目录是：

    /root/smart-schedule-agent

Node.js 版本要求为 20 或更高。应用默认监听 3000，公网不应直接开放 3000、3001 或 5173；HTTPS 由 Nginx 终止。

应用内定时任务包括每日快照、OSS 失败重试、邮箱导入检查和通知处理。改动定时任务、时区、备份或通知逻辑时，必须同时考虑重启、重复执行、失败重试和数据一致性。

## 5. 工作范式

### 5.1 任务开始前

每项任务先明确：

1. 用户要解决的实际问题；
2. 验收标准和不在范围内的内容；
3. 涉及的层级：配置、前端、后端、数据、部署还是外部服务；
4. 当前实现、相关文件和已有测试；
5. 数据、认证、兼容性和回滚风险。

先读文件和命令确认事实，再提出方案。把结论分为：

- 已确认：文件、命令、测试或 Git 记录直接证明的内容；
- 推断：根据代码或历史合理推测，但仍需验证；
- 未知：当前本地记录无法证明，需要用户、生产服务器或外部服务提供信息。

### 5.2 实施阶段

- 保持现有 Node/npm/TypeScript/Vite/Express/Electron 结构；
- 优先采用最小、可回滚、低维护成本的改动；
- 不为局部需求引入新的框架、依赖、数据库或部署平台；
- 不把与当前任务无关的格式化、重命名和重构混入同一个改动；
- 修改 API、数据结构、认证或备份时，先检查所有调用方和兼容路径；
- 修改日程/周期逻辑时，明确测试时区、月末、逾期、完成、重复和删除联动；
- 修改 AI 行为时，保留用户确认、歧义提示、权限控制和失败降级；
- 修改上传、附件或备份时，保留文件类型/大小、所有权、配额、加密和恢复前快照检查。

### 5.3 任务优先级（建议）

- P0：生产不可用、数据丢失、认证/权限漏洞、备份恢复失败；
- P1：日历、周期事务、行动中心、通知、AI 确认等核心流程的正确性和回归；
- P2：用户体验、页面视觉、性能和开发效率；
- P3：规模化能力和非当前资源约束下的架构升级。

P0/P1 任务先于视觉优化和架构扩展。只有当用户量、附件量或并发明显超过当前单机边界时，才评估 PostgreSQL、对象存储直传和独立任务进程。

### 5.4 完成定义

一项任务只有同时满足以下条件才算完成：

- 目标行为已经在源码中实现，或问题原因已用证据说明；
- 相关类型检查、测试、构建或运行检查已经执行；
- 没有把密钥、用户数据、构建垃圾或无关改动带入提交；
- 相关 README/部署说明已经同步，或明确说明暂不需要更新；
- 如果涉及生产，已经记录提交、备份、部署结果和健康检查结果；
- 仍未验证的外部依赖、真实服务器状态和风险已经明确写出。

## 6. 本地开发与验证

本地默认使用 Windows PowerShell。除非明确要求，不修改全局 PATH、全局 Git 配置或默认 Python/Node 环境。

首次准备或依赖变化后：

    node --version
    npm --version
    npm ci
    Copy-Item .env.example .env

只有主动修改依赖时才使用 npm install；一般安装必须使用 npm ci，以遵守 package-lock.json。

日常开发：

    npm run dev

需要分别启动时可以使用：

    npm run dev:server
    npm run dev:client
    npm run electron:dev

提交或部署前的最小检查：

    npm run typecheck
    npm test
    npm run build

需要验证桌面安装包时再执行：

    npm run electron:build

建议按改动范围补充验证：

- 认证、用户隔离和管理员操作；
- 日程创建、编辑、删除、完成、日期和时区；
- 周期事务月末、逾期完成、下一周期和日历联动；
- 行动中心分组、完成证明和附件权限；
- 邮件通知、免打扰、失败重试和发送记录；
- AI 草稿生成、歧义提示、用户确认和拒绝；
- 用户备份、恢复预览、合并/替换和管理员全站恢复；
- 生产构建后 /api/health、静态页面和 PM2 进程状态。

## 7. Git 工作流

### 7.1 修改前

    git status --short --branch
    git branch -vv
    git remote -v

先确认当前分支、跟踪分支和未提交改动。已有改动属于用户时，保留并避免覆盖；如果无法安全区分，停止并说明。

### 7.2 修改和提交

建议使用独立任务分支，例如：

    feature/<short-name>
    fix/<short-name>
    docs/<short-name>

一个提交尽量只表达一个完整意图。沿用仓库已有的提交前缀：feat:、fix:、docs:、chore:。

提交前必须：

1. 查看 git diff 和 git status；
2. 检查没有 .env、数据库、附件、备份、密钥或不应提交的压缩包；
3. 执行与改动相关的 typecheck、test、build；
4. 确认没有修改无关文件；
5. 再创建提交并推送当前任务分支。

默认不直接向 main 推送。合并或发布到 main 需要明确确认；禁止未经授权的 git push --force、历史重写、git reset --hard 或覆盖用户改动。

### 7.3 同步与记录

- GitHub origin 是代码版本的唯一权威来源；
- 生产服务器通过 git pull --ff-only 获取已经推送的版本；
- 公开副本是快照，不是第二个开发源；
- Git reflog 能记录本地观察到的 fetch/push 更新，但不能证明生产服务器已经部署；
- 每次发布至少记录：提交 ID、目标分支、操作时间、执行人/任务、备份位置、PM2 状态和健康检查结果；
- 如果 GitHub 远端、生产服务器或公开副本出现不同提交，先比较提交和用途，不要直接复制目录或强制覆盖。

## 8. 发布和部署方式

### 8.1 选择的发布策略

当前采用：

    本地主工作目录
           ↓ git commit / git push
    GitHub origin
           ↓ 生产机 git pull --ff-only
    阿里云 /root/smart-schedule-agent
           ↓ npm ci / test / build
    PM2 + Nginx + HTTPS

这是当前 2 核 2 GB 单机资源下最简单、最容易回滚的方案。仓库没有自动部署，所以“推送到 GitHub”不等于“已经上线”。

### 8.2 Git 仓库且依赖有变化时的完整升级路径

仅在 `package.json` 或 `package-lock.json` 发生变化、服务器没有可复用的依赖，或必须在服务器重新安装运行环境时使用。本机只有 2 GB 内存时，默认优先使用 8.3 的预构建路径，不要在生产机同时执行 `npm ci` 和完整构建。

本地准备：

    git status --short --branch
    npm run typecheck
    npm test
    npm run build
    git push origin <当前任务分支>

确认目标提交已经在 GitHub 后，再到生产服务器执行。生产操作前先确认当前提交和工作树状态：

    cd /root/smart-schedule-agent
    git status --short --branch
    git rev-parse HEAD
    pm2 status

升级前先保留应用数据和生产配置。涉及数据迁移、运行代码替换或高风险改动时，先停止应用：

    pm2 stop smart-schedule || true
    tar -czf /root/ai-calendar-data-before-upgrade-$(date +%F-%H%M).tar.gz data .env

然后只使用快进更新和项目既有检查：

    git pull --ff-only
    npm ci
    npm run typecheck
    npm test
    npm run build
    pm2 restart smart-schedule --update-env
    pm2 save
    curl http://127.0.0.1:3000/api/health
    pm2 status
    pm2 logs smart-schedule --lines 100

如果 git pull --ff-only、测试、构建或健康检查失败，停止发布，不要强行合并或覆盖服务器本地改动。先保留日志和备份，再判断是代码、依赖、配置、数据还是服务器环境问题。

### 8.3 2 GB 服务器的预构建一次性部署路径（已验证）

这是当前低内存生产机的默认版本升级路径。本路径已经在生产服务器验证成功：本地完成检查和生产构建，服务器不执行 `npm ci`、`npm test` 或 `npm run build`，只接收预构建发布包并切换版本。

适用条件：

- 当前版本与目标版本的 `package.json`、`package-lock.json` 内容一致（忽略 Windows/Linux 换行差异）；
- 目标版本已在本地完成 `typecheck`、测试和生产构建；
- 服务器已有可用的 `node_modules/`、`.env` 和 `data/`。

如果依赖文件发生变化，不得直接复用旧 `node_modules/`；应先在更大内存的构建机完成依赖安装和构建，或升级服务器内存后走 8.2。不要在生产应用目录中直接运行 `npm ci`，因为它会先清理现有依赖，失败时会同时破坏回滚能力。

#### 8.3.1 本地生成预构建发布包

在主工作目录执行：

    git status --short --branch
    npm run typecheck
    npm test
    npm run build

创建发布包时必须包含最新的 `dist/`、前端源码、后端源码和 `public/` 资源；必须排除 `.env`、`data/`、`node_modules/`、`.git/`、本地数据库、附件、备份和其他压缩包。示例（PowerShell）：

    $releaseId = "workspace-" + (Get-Date -Format "yyyyMMdd-HHmmss")
    $archivePath = Join-Path $env:TEMP "smart-schedule-$releaseId.tar.gz"
    tar -czf $archivePath --exclude=node_modules --exclude=data --exclude=.env --exclude=.git --exclude=*.tar.gz dist public server src electron scripts package.json package-lock.json index.html vite.config.ts tsconfig.json tsconfig.node.json tsconfig.electron.json tailwind.config.js postcss.config.js .env.example .gitignore deploy.sh deploy-continue.sh DEPLOY.md README.md design-qa.md go.bat
    Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath

通过已有 SSH/SCP 入口上传到服务器临时位置，并在服务器再次执行 `sha256sum`，确认本地和服务器的 SHA256 完全一致。不要把服务器地址、密钥、`.env` 或用户数据写入仓库或对话。

#### 8.3.2 服务器预检和备份

上传后先做只读预检：

    free -h
    swapon --show
    sysctl vm.swappiness
    df -h /
    pm2 status
    curl -fsS --max-time 5 http://127.0.0.1:3000/api/health

确认服务当前健康、磁盘有足够空间、`data/`、`.env` 和 `node_modules/` 存在。比较当前目录和发布包中的 `package.json`、`package-lock.json` 规范化哈希；不一致时停止，不要跳过依赖安装。

升级前在服务器保留数据和生产配置备份：

    mkdir -p /root/deploy-backups
    tar -czf /root/deploy-backups/smart-schedule-data-env-before-<release-id>.tar.gz -C /root/smart-schedule-agent data .env

备份必须保留到新版本通过健康检查之后，且不能下载到本地或提交 Git。

#### 8.3.3 临时目录校验、原子切换和启动

使用唯一发布 ID 和三个目录：

    APP=/root/smart-schedule-agent
    STAGE=/root/smart-schedule-agent.new-<release-id>
    ROLLBACK=/root/smart-schedule-agent.rollback-<release-id>
    FAILED=/root/smart-schedule-agent.failed-<release-id>

按以下固定顺序执行：

1. 将发布包解压到 `STAGE`，检查 `package.json`、`package-lock.json`、`server/index.ts`、`dist/index.html` 和关键静态资源存在；确认 `STAGE` 中没有 `.env`、`data/` 或 `node_modules/`。
2. 再次确认 `STAGE` 与 `APP` 的依赖文件哈希一致；本路径不执行 `npm ci`、`npm test` 或 `npm run build`。
3. `pm2 stop smart-schedule`，等待旧进程退出。
4. 将 `APP/data`、`APP/.env`、`APP/node_modules` 移入 `STAGE`，使新版本继续使用原数据、生产配置和已验证依赖。
5. 将旧 `APP` 重命名为 `ROLLBACK`，再将 `STAGE` 重命名为 `APP`。不要删除 `ROLLBACK`。
6. 在新 `APP/.deploy` 写入 `base_commit`、`release_id`、`deployed_at`、`source` 和发布包 SHA256，记录这次部署不是 GitHub 自动上线。
7. 执行 `pm2 restart smart-schedule --update-env` 和 `pm2 save`。
8. 循环检查 `curl -fsS --max-time 3 http://127.0.0.1:3000/api/health`，最多等待约 30 秒；同时检查 PM2 为 `online`，并检查新静态资源返回 HTTP `200`。

这套顺序的关键是：所有可能失败的安装/构建都在本地完成，服务器只做文件切换；旧版本、数据、配置和依赖始终有明确位置，不把线上目录变成半安装状态。`deploy-continue.sh` 的旧流程包含服务器端 `npm ci` 和构建，不作为 2 GB 服务器普通升级路径。

#### 8.3.4 失败自动回滚

如果新版本启动失败、健康检查超时或 PM2 不是 `online`：

1. 停止新版本 PM2 进程；
2. 将新 `APP` 中的 `data/`、`.env`、`node_modules/` 移回 `ROLLBACK`；
3. 将失败的新目录改名为 `FAILED`，将 `ROLLBACK` 改回 `APP`；
4. `pm2 restart smart-schedule --update-env`、`pm2 save`，再次执行健康检查；
5. 保留 `FAILED`、`ROLLBACK`、部署日志和数据配置备份，等待人工分析，不要自动删除。

### 8.4 首次部署或无法使用 Git 时

首次部署使用 deploy.sh 准备 Node.js 22、PM2 和目录，再把代码放到 ~/smart-schedule-agent，最后使用 deploy-continue.sh 完成安装、检查、构建和启动。当前工具链要求至少 Node.js 22.12；升级生产前必须先核对实际版本并保留回滚路径。

项目没有记录固定的 SCP、SFTP、SSH 上传地址或服务器密码，因此不要凭空生成主机地址、密钥参数或传输命令。普通版本升级优先走 GitHub + git pull --ff-only；手动压缩包上传只在服务器无法访问 GitHub 或任务明确要求时使用。

手动上传时：

- 只上传经过检查的源码和必要配置模板；
- 不覆盖服务器的 .env、data/、附件和备份；
- 不把 node_modules/、dist/ 或本地数据库当作长期发布源；
- 上传后仍必须执行 deploy-continue.sh 或等价的 typecheck、test、build、PM2 和健康检查。

### 8.5 回滚

回滚前必须保留升级前的提交 ID、日志、阿里云快照或应用生成的备份。优先恢复上一份经过验证的代码和数据快照，再重新执行构建和健康检查。

不要把正在运行的 sql.js/SQLite 单个数据库文件直接复制为备份；应使用应用生成的一致性快照。不要在没有确认和备份的情况下删除数据库、重置服务器或执行全站恢复。

## 9. 配置、数据和安全边界

必须保护的配置包括：

- JWT_SECRET、BACKUP_ENCRYPTION_KEY；
- ADMIN_INVITE_CODE、USER_INVITE_CODE；
- SMTP_PASS、IMAP_PASS；
- CODEBUDDY_API_KEY；
- OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET；
- 生产 APP_URL 及其他服务器内部配置。

规则：

- .env 只存在于对应机器，不提交 Git；
- .env.example 只放不含秘密的占位项和说明；
- 不在对话、截图、日志、提交说明或 README 中粘贴真实密钥；
- 生产环境必须使用 HTTPS；
- 公网只开放 Nginx 所需的 80/443，SSH 22 应限制来源；
- OSS 使用私有 Bucket、同地域内网 Endpoint 和最小权限 RAM 用户；
- 维护模式、全站恢复和管理员删除等高风险操作必须有明确确认和恢复前快照；
- 用户附件必须通过鉴权和所有权检查访问，不能通过静态目录直接暴露。

## 10. 当前任务安排和演进边界

Git 历史显示项目已经经历了基础架构、日历工作区、AI 客户端、Electron 桌面壳、行动中心、周期事务、通知、备份和 AI 导入等阶段。后续任务建议按以下顺序安排：

### P0：先保证可发布和可恢复

- 固化生产服务器的实际主机、访问方式和运维联系人；这些信息目前不在仓库中；
- 每次升级前验证备份，升级后验证 /api/health、登录、日历和 PM2；
- 确认生产 .env、数据目录和 OSS 备份策略没有被代码发布覆盖；
- 将每次上线的提交、备份和结果留下可追溯记录。

### P1：保证核心业务不回归

- 加强认证、用户隔离和管理员危险操作测试；
- 覆盖月末、时区、逾期、完成、下一周期和日历联动边界；
- 覆盖通知失败重试、邮箱导入、附件配额和备份恢复；
- 保证 AI 所有写入动作都经过草稿确认，不因 UI 或接口变更绕过确认。

### P2：改善产品体验

- 根据真实使用反馈改进行动中心、日历工作区、周期事务和智能导入；
- 优先解决会阻碍用户完成任务的交互和错误提示；
- 视觉修改仍需保留核心业务状态、无障碍和小屏兼容。

### P3：用户量增长后的扩展

只有在当前单机资源成为实际瓶颈后，才评估 PostgreSQL、对象存储直传、独立队列/任务进程、横向扩展和自动化部署。扩展前先用数据证明瓶颈，并给出迁移、回滚和成本方案。

## 11. Agent 交付报告格式

每次完成任务后，使用简短、可核对的格式报告：

    修改了什么：
    - 文件和行为变化

    如何验证：
    - 执行过的命令或检查
    - 结果

    没有验证：
    - 未能访问的外部服务、生产环境或未覆盖的路径

    实际风险：
    - 数据、兼容性、部署、安全或回滚风险

    Git/部署状态（如适用）：
    - 分支和提交
    - 是否已推送
    - 是否已部署
    - 备份和健康检查结果

不要把“代码看起来正确”当作测试通过，也不要把“已经推送到 GitHub”表述成“已经部署上线”。

## 12. 持续需求记录

从 2026-08-17 起，`AGENTS.md` 同时作为本项目的需求记录文档。每次用户提出新的需求或修改现有行为时，Agent 都必须在实施该任务时追加记录，至少包含：日期、用户意图、实际修改范围、验证结果和 Git/部署状态。未完成、待确认或无法验证的内容必须明确标记，不能写成已完成。记录不得包含密钥、授权码、邀请码、用户数据、服务器密码或其他真实凭据。

### 2026-08-17：界面与交互修订

- 顶部导航的“AI 助手”改为只显示机器人图标，并保留草绿色视觉；移除顶部通知铃铛按钮。
- 今日行动中心保留“挂起待办（无固定期限）”区域，但删除该区域的新增输入框；无固定期限待办仍可从日历待办表单创建。
- 今日行动中心的日程行改为点击整行直接进入编辑，隐藏外显的编辑按钮；完成待办后刷新数据不能把页面滚动位置跳回顶部。
- 今日行动中心删除“今天”“明天”“即将到期”区域中不需要的说明文字；周期事务在优先级点外增加循环标志。
- 日程分类标题改为黑色正式标题，删除下方解释文字。
- 周期提醒页面标题改为“周期事件管理”，删除顶部说明和筛选标签，新增入口文字改为“+周期事件”。
- 智能导入的说明移入“智能导入”标题后的问号帮助框，仅在悬浮、聚焦或点击时显示，点击其他位置或移开鼠标后关闭。

### 2026-08-17：无固定期限待办的旧数据库兼容

- 日志确认旧数据库的 `schedules.end_time` 仍为 `NOT NULL`；无固定期限待办创建时使用 `start_time` 作为内部 `end_time` 占位，实际语义继续由 `is_unscheduled` 表示。
- 创建、编辑和恢复数据路径统一采用该兼容规则，不进行破坏性的现有数据库重建。
- 已通过 `npm run typecheck`、`npm test`（26 项）和 `npm run build:client`。

### 2026-08-17：顶部导航图标

- 使用用户提供的图标资源替换顶部五个选项卡图标：`1.png` 对应“今日”、`2.png` 对应“日程”、`3.png` 对应“周期提醒”、`4.png` 对应“智能导入”、`5.png` 对应“AI 助手”。
- 五个选项卡改为图标按钮，正式中文名称通过 `title` 和 `aria-label` 提供；增加悬浮、选中时的背景、阴影和图标反馈。
- 相关代码和资源已提交为 `1a58f8b feat: refine action center and navigation icons`，尚未推送或部署。

### 2026-08-17：需求文档约定

- 用户要求：今后每次提出新的需求或修改工作，都必须同步追加到本文件；本文件作为双方协作时的项目需求文档和 Agent 工作依据。

### 2026-08-17：清理历史打包文件和旧快照

- 用户确认删除 `production-assets.tar.gz` 和 `smart-schedule-agent.tar.gz`；前者是可由构建重新生成的旧生产产物包，后者是已由 Git 版本追踪替代的旧源码快照。
- 用户确认删除 `smart-schedule-agent-public-20260724`；核对结果显示它是干净的独立 `main` 分支快照，远程仍为当前 GitHub 仓库，当前主工作目录和脚本没有依赖它。
- 三个目标均已从原工作位置移入 Windows 回收站，未加入 Git、未推送、未部署；如需恢复，可从回收站还原。

### 2026-08-20：今日行动中心、冲突提醒和周期日期修订

- 用户意图：让逾期事项出现在“今日”的逾期栏；让当天已完成任务可查看详情并恢复为未完成；修正无固定期限待办在手机上的按钮排版；允许关闭日程冲突提醒并在冲突时段结束后自动隐藏；修正信用卡设置日期与当前周期日期不一致的问题。
- 实际修改：行动中心按用户时区识别带时区的日程日期，并补充历史未完成待办的聚合测试；已完成日程打开详情，周期事务打开完成详情，统一支持“设为未完成”；无固定期限待办移动端保持操作按钮与内容同行；冲突提醒增加小叉，冲突重叠结束后不再显示；编辑信用卡账单日、还款日或还款月份后重算当前未完成周期及其提醒日期。
- 验证结果：`npm run typecheck`、`npm test`（28 项）、`npm run build` 和 `git diff --check` 通过；本地页面实际检查到逾期栏有数据，`390×844` 视口下无固定期限待办按钮保持同行。
- 未验证内容：当前本地账号没有当天已完成事项和正在发生的冲突样例，因此未在真实浏览器数据上点击验证“设为未完成”和冲突提醒小叉；生产服务器、真实多设备展示和部署结果尚未验证。
- Git/部署状态：本次修改已建立本地 checkpoint `46b7ec7 fix: refine action center and reminder dates`，未推送、未部署；保留生产预构建发布路径，不执行服务器端安装或构建。

### 2026-08-20：行动中心修订版部署上线

- 用户意图：将上一项行动中心、冲突提醒和信用卡周期日期修订部署到生产环境。
- 实际部署：基于提交 `948d3e93bb16c6eff8f4f9a691882217ed5e80f8` 在本地完成 `typecheck`、28 项测试和完整构建；生成预构建发布包 `workspace-20260820122049`，服务器未执行 `npm ci`、测试或构建。发布包共 115 个条目，排除项检查为 0，SHA256 为 `9a421f846facfcae61b59a48060cf3f15fa94a99388b40a5c19e30d664f23431`。
- 备份与回滚：部署前备份为 `/root/deploy-backups/smart-schedule-data-env-before-workspace-20260820122049.tar.gz`；旧版本保留在 `/root/smart-schedule-agent.rollback-workspace-20260820122049`，新版本 `.deploy` 已记录提交、发布包哈希、备份和回滚目录。
- 验证结果：服务器 PM2 为 `online`；本机和公网 `/api/health` 均返回 `{"status":"ok"}`；公网今日页面和导航静态资源均返回 HTTP 200。
- 异常记录：原子切换主流程已显示 `DEPLOY_SUCCESS`；PowerShell 通过 SSH 管道传入的 CRLF 使远程脚本退出时附带 127，但发生在成功健康检查和 PM2 状态输出之后，独立复核确认服务已正常上线。
- Git/部署状态：当前分支 `refactor/calendar-workspace-v2` 仍领先 origin 5 个提交，未推送；生产已通过本地预构建制品上线，未执行服务器端依赖安装或构建。

### 2026-08-20：冲突提醒与逾期栏目复测（待修复）

- 用户意图：确认“冲突提醒”在有效冲突时出现、冲突结束后隐藏；确认历史已有和新建的逾期待办都能进入“已经逾期”栏目。
- 测试范围：本地开发环境使用真实页面操作，创建明日同一时段的两个普通日程，选择历史日期新建一个未完成 `todo`，分别检查首次加载、刷新、日期切换和关闭横幅；测试数据已通过页面删除并复核数据库无残留。
- 已确认：明日两个未来日程会显示冲突横幅；点击小叉后当前冲突键被关闭，返回该日期仍保持关闭；今天 09:00–10:00 的已结束冲突不显示；历史日期新建的未完成 `todo` 会进入“已经逾期”，刷新后仍保留。
- 已确认的空白原因：历史 `todo`“哈哈”的日程本身是未完成，但仍存在未重开的活动完成记录，行动中心按完成记录过滤；历史“测试过期用例”是普通 `event`，当前业务规则不把普通日程自动视为逾期。两者都会导致用户看到“逾期栏没有该事项”。
- 未完成：尚未改变“普通日程是否应计入逾期”的业务规则，也尚未修复日程状态与活动完成记录不一致的历史数据；本条只完成复测和根因定位。
- 验证结果：本地真实页面复测通过上述对照；`npm test`（28 项）和 `npm run typecheck` 通过；本轮未改业务源码、未推送、未部署。

### 2026-08-20：普通日程过期应进入逾期栏（待修复）

- 用户意图：截图中的 `t2` 日期为 2026-08-19、当前日期为 2026-08-20，虽然它是普通日程而不是待办，也应在“已经逾期”栏目显示。
- 已确认：本地数据库中的 `t2` 为未完成 `event`，开始时间为 `2026-08-19T09:00:00`，结束时间为 `2026-08-19T10:00:00`；当前行动中心只在 `schedule.type === 'todo'` 且日期早于今天时设置 `overdue`，普通 `event` 会被跳过。
- 待修复范围：重新定义普通日程、带日期待办和无固定期限待办的逾期规则，并补充普通 `event` 历史未完成、已完成和无固定期限边界测试；本条尚未修改业务源码或部署。
- 验证结果：已通过截图核对、数据库读取和 `server/action-center.ts` 逻辑核对确认；Git 工作区在记录前干净，未推送。

### 2026-08-20：统一 event/todo 逾期、冲突与四小时提醒

- 用户意图：`event` 和 `todo` 按同一规则进入逾期栏；两类有时间事项都参与今天及未来的冲突提醒；冲突横幅 dismiss 后每 4 小时可以再次出现，直到冲突时段结束或日程被重新安排。
- 实施范围：后端行动中心统一历史未完成 `event/todo` 的逾期判定；前端冲突检测统一两类事项，日程列表不再只按当前选中日期遗漏今天/未来其他日期的冲突；dismiss 记录带 4 小时冷却和日程时间变化识别。
- 验收重点：历史 `event`、历史 `todo`、今天有效冲突、未来有效冲突、待办与日程混合冲突、冲突结束自动隐藏、dismiss 后冷却期内隐藏、冷却期后再次出现、重新安排后立即重新提醒、无固定期限待办不进入逾期。
- 实际修改：逾期栏按日程当前 `is_completed` 状态统一处理带日期的 `event/todo`，无固定期限待办仍只进入挂起区域；历史遗留的未重开完成记录不再吞掉未完成日程。冲突工具统一处理两类有时间事项，覆盖当前仍有重叠的今天及未来日程；冲突时段结束后自动隐藏；横幅小叉以冲突内容键保存 dismiss，4 小时内隐藏，日程时间重新安排后再次提醒。
- 验证结果：`npm test`（31 项）、`npm run typecheck`、`npm run build`、`git diff --check` 通过；真实页面验证“今日”视图直接出现未来 8 月 21 日冲突，历史 `t1/t2` 出现在“已经逾期”，临时新增待办后混合冲突组数由 3 变 4，删除后恢复为 3；关闭按钮文案确认“4小时后可再次出现”。
- 未验证内容：未等待真实四小时再做墙钟复现，四小时边界与重新安排键已由单元测试覆盖；生产服务器、真实多设备展示和部署结果尚未验证。
- Git/部署状态：代码修复已完成，准备建立本地 checkpoint；未推送、未部署。

### 2026-08-20：统一 event/todo 修复部署上线

- 用户意图：将统一逾期、今天及未来冲突、四小时 dismiss 冷却的修复发布到生产环境。
- 实际部署：以提交 `0547280fc0b7fd63e41880cb4d49aa701852a100` 生成预构建发布包 `workspace-20260820-223717`；发布包 119 个条目，排除项检查为 0，SHA256 为 `720bce450c31f30f228802a2faa0f725c75be9ef49b65cc3f4219966eb65813e`；服务器未执行 `npm ci`、测试或构建。
- 备份与回滚：部署前备份为 `/root/deploy-backups/smart-schedule-data-env-before-workspace-20260820-223717.tar.gz`；旧版本保留在 `/root/smart-schedule-agent.rollback-workspace-20260820-223717`；新版本 `.deploy` 已记录提交、发布包哈希、备份和回滚目录。
- 验证结果：服务器 PM2 为 `online`；本机 `/api/health` 返回 `200`；公网根路径 `/api/health` 返回 `200` 和 `{"status":"ok"}`；今日页面返回 `200` 并引用本次构建的静态脚本；新导航 PNG 返回 `200 image/png`。
- 路径说明：`APP_URL` 是带 `/today` 的页面入口，公网 API 和静态资源由根路径提供；`/today/api/health` 会回退到前端页面，因此健康检查以根路径 `/api/health` 为准。
- Git/部署状态：提交 `0547280` 已上线；本条部署记录随后建立本地文档 checkpoint，未推送。

### 2026-08-24：功能改进计划与全项目审计修复

- 用户意图：落实下载目录中由对话 `01a02e44-c3a9-7a52-aef2-ba1467ad5376` 形成的功能计划，并把本轮全项目审计确认的缺陷、冗余和规范偏差一并修复；保持方案简单、可逆，不直接部署生产。
- 新功能：AI 助手支持普通问答和基于 Open-Meteo 的真实天气查询，设置中可搜索并保存常驻城市/区县；AI 正文采用最大 `960px` 阅读栏。日历增加前后日期导航、滚动与选中日期同步提示、固定冲突时段显示；完成记录支持金额、账单日期和附件。每日邮件按问候、天气、分类日程和完成状态生成兼容邮件客户端的内联样式正文；设置页增加可读 JSON/CSV 导出，以及只显示一次明文、数据库只存哈希的只读日报令牌。
- 日报联动：在 `C:\Users\Elysia\Documents\Codex\2026-08-05\日报` 增加标准库实现的只读日程读取器、示例配置、测试和日报章节；明确区分“当天 0 条日程”“鉴权失败”和“接口不可用”，令牌撤销后立即失效。日报项目修改前备份在 `var/checkpoints/calendar-integration-20260824-093440`。
- 审计修复：认证改为每次请求核对实时用户状态和 `auth_version`；限制用户及日历更新字段并补齐跨账号所有权检查；修复 AI 日程更新返回值、部分失败重复执行、周期事项创建后的日历同步边界、完成记录幂等、严格日期校验和附件失败反馈；修复提醒迁移、按账号时区运行每日提醒、备份跨账号 ID 重映射，以及四个数据库与附件的全站恢复回滚。管理员清空或删除用户前必须核对邮箱并先生成加密系统快照；验证码改为带密钥摘要保存。旧数据库 chat WAL 提供默认 dry-run 的核对脚本和启动保护，审计前备份位于忽略目录 `data/pre-fix-backups/`。
- 安全与维护：新增安全响应头、请求体上限、接口分级限流和有界内存缓存；普通问答不再加载用户日程上下文，日志不再写入用户 AI 正文，设置接口不再回传已保存 API Key 明文，自定义 CodeBuddy 地址仅接受公网 HTTPS 域名；用户级 AI 凭据和模型统一应用到聊天、模型检查和邮箱导入。修复依赖审计并固定 Node.js `>=22.12.0`。Electron 改为最小远程桌面壳，只允许生产 HTTPS 入口并启用沙箱、上下文隔离和导航校验；打包不再携带服务器依赖。删除未被当前产品使用的旧 Chat 前端、旧物理 API 实现、过时 `server/public` 构建物和重复 `DEVELOPMENT.md`。
- 验证结果：主项目 `npm run typecheck`、54 项 `npm test`、通过 npm 官方 registry 执行的 `npm audit --audit-level=high`（0 vulnerabilities）和生产构建通过；Windows Electron 解包目录构建通过，`app.asar` 仅包含桌面壳必要文件。隔离临时数据目录的首轮 API 烟雾测试通过 31 项断言，管理与输入边界复测通过 23 项断言；最后又通过真实 HTTP 确认重复完成只保留一条记录及非法日期返回 `400`，所有隔离测试均未启动后台任务或 SMTP。日报项目 88 项 Python 测试通过，并以临时令牌完成一次跨项目读取后撤销。
- 未验证内容：当前应用内浏览器运行环境没有可用浏览器实例，因此最终 UI 没有完成真实截图、窄屏、hover/selected/loading/empty/error 状态复核；生产服务器、真实 SMTP/IMAP、真实用户数据恢复和部署均未执行。Vite 仍提示主 JavaScript chunk 超过 500 kB，属于性能风险而非本轮功能错误。
- Git/部署状态：在 `feature/calendar-improvements-audit-fixes` 分支建立本地 checkpoint，未 push、未部署；本地运行数据备份和日报项目 checkpoint 均不进入 Git。本轮不发送真实邮件，不修改生产服务器。

## 13. 参考文件

- README.md：当前能力、配置、目录、常见问题和资源边界；
- DEPLOY.md：阿里云、Nginx、PM2、备份、升级和回滚；
- deploy.sh：首次部署准备；
- deploy-continue.sh：上传代码后的安装、检查、构建和启动；
- package.json：npm scripts、依赖和 Electron 打包配置；
- .env.example：安全的环境变量模板；
- .gitignore：禁止进入 Git 的运行和构建文件。

当本文档与 README.md 或 DEPLOY.md 的事实描述不一致时，先以当前源码和实际命令为准，再在同一任务中同步修正文档，避免让下一次 Agent 继续沿用错误流程。
