# AI Calendar Test Matrix

项目成长：运行 `server/project-evolution.test.ts`、`npm run evolution:history` 和 `scripts/project-evolution-browser-smoke.cjs`。覆盖模型与历史真实性、认证、架构差异、顶部入口、四尺寸明暗主题及深链接；浏览器使用合成 API，真实认证由独立 HTTP 测试覆盖，均不等同生产验收。详情见 [维护说明](../project-evolution/README.md)。

- Status: LIVING
- Scope: 本文列明的源码结构、合同或验证方法；历史证据按时点使用。
- Last verified commit/version: AI 记事板合并按钮 / `0.29.0-260920.0727`（2026-09-20，本地专项回归；其他领域以各节证据为准）。
- CalDAV 补充验证：2026-09-18，隔离 POC 与主应用回归；仅覆盖下述独立入口，真机尚未验证。
- Authority: 当前源码与自动化验证优先；文档职责见文档索引。
- Update trigger: 本领域 API、数据归属、媒体策略或验收入口变化。
- Supersedes: 原文中已纠正的漂移描述；保留历史快照时间边界。
- Do not use for: 推断当前生产部署、Work 配置或邮件收件箱状态。

本矩阵区分自动化、浏览器手工和生产验收。单元测试通过不等于浏览器 UI 正常；浏览器页面正常也不等于生产部署、SMTP 接受或收件箱最终到达。

2026-09-19 增量验证：`schedule-time.test.ts` 和 `unscheduled-api.test.ts` 覆盖共同日期约束/旧数据兼容；`dependency-security.test.ts` 覆盖升级后的邮件解析及依赖输入；`daily-report.test.ts`、Cloud API 测试覆盖媒体计数、版本、账号及恢复。具体数字、浏览器尺寸与未验证范围见[本次修复快照](FORMAT-SECURITY-REPAIR-20260919.md)。

## 1. 通用命令

| 层级 | 入口 | 证明什么 |
| --- | --- | --- |
| 类型 | npm run typecheck | TypeScript 和 Node/Electron 配置可检查 |
| 服务端自动化 | npm test | server/*.test.ts 的业务、权限、数据和模板回归 |
| 构建 | npm run build | Web、Electron 代码和桌面暂存可生成 |
| 差异 | git diff --check | 没有明显空白错误 |
| CI | .github/workflows/ci.yml | push/pull_request 上重复执行安装、类型、测试和构建 |
| 浏览器 | 本地实际页面和指定 viewport | 路由、控件、布局、主题、交互和 console 状态 |
| 生产 | 按 DEPLOY.md | 备份、原子切换、PM2、health、静态资源和业务链路分层验收 |

## 2. 功能矩阵

| 功能 | 对应自动化测试/代码入口 | 手工验收 | 生产验收 |
| --- | --- | --- | --- |
| 登录、注册、账号隔离 | core.test.ts、admin-api-sharing.test.ts、auth 相关 API | 登录/退出、错误提示、不同账号看不到对方数据 | 真实账号登录和退出；不读取或复制生产凭据 |
| 日程、分类、冲突 | schedule-actions.test.ts、schedule-conflict.test.ts、schedule-store-legacy.test.ts | /schedule 创建、编辑、删除、月视图/时间视图和小屏 | 生产日历读写、时区和刷新 |
| 周期事务 | core.test.ts、reminder-store 相关测试、notification-scheduler.test.ts | /reminders 月末、逾期、完成、下一周期和操作反馈 | 生产周期任务与唯一 worker 行为 |
| 通知与邮件 | notification-service.test.ts、notification-preferences-client.test.ts、email-service.test.ts、user-mail-api.test.ts | 设置渠道、免打扰、失败/重试和错误状态 | SMTP accepted 与收件箱到达分开验证 |
| 日报 | daily-report*.test.ts、daily-digest-template.test.ts、daily-email-template.test.ts | /reports 列表、/reports/:date 阅读、媒体、版本更新和显式重发 | 发布接口、媒体托管、队列、SMTP 和收件箱逐层核对 |
| AI 计划和导入 | ai-intent.test.ts、ai-json.test.ts、ai-plan.test.ts、codebuddy-config.test.ts | /assistant 和 /import 生成草稿、确认前不写入、错误降级 | 真实 AI 另行授权；验证账号 Key 和服务限流 |
| AI 记事 | note-item.test.ts、note-export.test.ts、note-color-migration.test.ts | NoteBoard 创建/编辑/完成/恢复、两步合并、跨分区目标、超长错误、TXT/CSV、窄屏抽屉 | 生产数据备份、恢复和账号隔离；不把记事当待办 |
| 设置 | Settings V2 浏览器证据、notification-preferences-client.test.ts、user-mail-api.test.ts | 390×844、430×932、768×1024、1440×900；浅色/暗色、长文本、保存/取消/删除/撤销 | 真实设置读取/保存需授权；不把 synthetic API 证据写成生产验收 |
| Tools 挂载应用 | protected-tools.test.ts、scripts/tools-browser-smoke.cjs、ToolsPage、`GET /api/tools` | Settings → 挂载工具 → Tools；四视口、浅色/暗色、卡片链接、键盘焦点、无横向溢出；三个 HTML 应用真实打开效果 | 真实登录 Cookie、工具页面、Plotly/支付宝 iframe 降级和浏览器本地数据需单独授权验收 |
| 附件、导出和备份 | export-service.test.ts、core.test.ts、attachment 相关实现 | 下载、大小/MIME、检查备份、合并/替换取消路径 | 备份前快照、恢复演练、附件权限和回滚 |
| 管理员 | admin-api-sharing.test.ts、管理员 API | 普通用户隐藏管理入口；管理员危险操作有确认 | 维护模式、全站备份、恢复和删除必须单独授权 |
| 知识库 | library.test.ts；db、library-service、publish-token-service | `/library` 与 `/library/:id` 检查只读入口、搜索、关系状态、版本、评论、单条/全库导出；隔离 V2 批次验证 CREATED/UPDATED/UNCHANGED | 三篇样本只允许本地隔离账号；不读取生产数据库、不使用生产令牌、不部署 |

### 独立 CalDAV POC 验证入口

按照 [POC 操作说明](../infra/caldav-poc/README.md) 安装独立 Python 环境，然后运行 `python -X utf8 -m unittest discover -s infra/caldav-poc -p test_poc.py -v`。该套件用真实 loopback Radicale 和临时合成数据验证发现、只读/账号隔离、条件写入删除、重启及日志隐私；不包含在 `npm test` 中，不读取正式数据库，也不证明荣耀设备、TLS 或后台提醒成功。真机矩阵与阶段门槛见 [研究记录](CALDAV-HONOR-POC.md)。

## 3. UI Smoke Test 决策

仓库当前没有项目级 Playwright/Cypress 依赖和独立浏览器 fixture。Phase 2 使用了本机提供的 Playwright 与 Headless Edge，适合本地验收但不能直接证明 CI 可复现。

本阶段不新增浏览器依赖或庞大 E2E 套件，原因是：

- 需要先确定无真实账号/生产数据的登录和 API fixture；
- Playwright 浏览器下载会增加锁文件、CI 时间和维护边界；
- 当前 CI 先保证 npm ci、类型、服务端测试和构建稳定。

现阶段的最小 UI smoke 范围是 /login、/today、/schedule、/assistant、/reminders、/reports、/library、/tools，以及通过产品壳按钮打开 SettingsDialog（没有独立 /settings 路由）。另检查 /import 重定向到 /assistant?tool=email-import，并验证导入草稿及确认流程。Tools 的服务器门禁、Cookie、清单、未知 slug、路径遍历和 CSP 由 `protected-tools.test.ts` 覆盖；浏览器验收再覆盖 Settings 跳转、卡片和三个真实 HTML。下次引入项目级浏览器测试时，必须先补 fixture、console error 处理、viewport 断言和 CI 浏览器安装，再决定是否加入 workflow。

## 4. Bundle 观察基线

[Bundle 测量说明](BUNDLE-BASELINE.md) 使用生产构建 manifest 的静态 imports 闭包区分 initial 和非首屏 JS，记录全部 JS/CSS raw/gzip 与最大 10 个资源。测量脚本只读构建目录、不加载 .env、不构建、不发网络请求；不设置预算，不改 CI 或 Vite 警告阈值。脚本的合成 manifest 验证用 `node --test scripts/measure-bundle.test.mjs`，与现有服务测试分别执行。

## Phase 2 可重复浏览器 smoke

可选入口 scripts/browser-smoke.cjs，使用现有 Edge 与外部提供的 Playwright；未新增 npm 依赖，不是 CI 必跑项。先在无真实 .env/data 的源码副本完成生产构建，再执行：

```powershell
$env:PLAYWRIGHT_MODULE = '<现有 Playwright 包的绝对路径>'
node scripts/browser-smoke.cjs '<包含 dist 的隔离源码目录>'
```

默认证据写入系统临时目录，可用 BROWSER_SMOKE_OUTPUT 指定。仅启动随机端口的回环静态服务；拦截合成 API，阻止非本地网络，不启动真实后端。覆盖四 viewport、设置浅/暗色、导航返回、日期深链、日程草稿、焦点、富内容及分包失败。请检查输出截图；断言通过不等于所有视觉细节无误。结果与未覆盖项目见 [Phase 2 验收](PHASE2-FRONTEND-LOADING.md)。

## CalDAV 全量单向桥接

`caldav-bridge.test.ts`、`caldav-api.test.ts`、`caldav-control.test.ts` 随 npm test 覆盖全量/全部周期纯读、完成/恢复同UID且无提醒、历史保留、副本归并/孤立阻断、500/501容量、迁移备份、异常保留、授权/退避/批量删除、恢复及备份排他；core 的系统恢复覆盖账本与暂停状态。`infra/caldav-poc/bridge_smoke.py` 验证累计10个对象的真实 API/Radicale CRUD、完成/恢复与历史停用保留、只读权限、源库不变并保留原有9个seed。browser-smoke 覆盖四视口浅暗主题、长文本、操作/错误和启用门槛；这些不能替代荣耀手机提醒/后台/修改删除验收。具体边界见 [CalDAV 合同](CALDAV-BRIDGE.md)。

## Phase 3 故障与恢复

persistence.test.ts 覆盖原子替换、内存回退、第二库失败、补偿失败停止访问、持久执行结果和用户恢复；persistence-crash.test.ts 在独立子进程中模拟中断并逐字核对恢复；phase3-api.test.ts 覆盖两账号、import/plan 确认失败重试、部分计划失败和周期完成去重。全部加入现有 npm test。具体限制见 [Phase 3 验收](PHASE3-PERSISTENCE-RECOVERY.md)。

## 无固定期限待办管理

`unscheduled-api.test.ts` 覆盖只读、账号隔离、完成历史、状态切换、全天写入校验和旧备份恢复。`scripts/unscheduled-browser-smoke.cjs` 使用构建产物与合成接口验证四个规定视口、浅暗主题、完成记录、完成/恢复、编辑入口、空态/错误、Escape 和返回焦点；使用与既有 browser-smoke 相同的 PLAYWRIGHT_MODULE。不得把本地验证写成生产真机通过。
