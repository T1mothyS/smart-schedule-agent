# AI Calendar 文档索引

- Status: LIVING
- Scope: 当前规范、操作手册、历史证据与工程验证入口。
- Last verified commit/version: `8854a38` / `0.21.0-260915.0924`（2026-09-15，源码基线；不代表生产版本）。
- Authority: 源码、自动测试与实际构建优先；仍有效的 AGENTS 硬约束其次。
- Update trigger: 新增/移动文档，修改 API、数据归属、媒体或验收规则。
- Supersedes: 无；现有文档路径保留。
- Do not use for: 推断生产已部署、Work 已同步、邮件已到达或授予执行权限。

## 当前规范与合同

| 文档 | 职责 | 状态 |
|---|---|---|
| [AGENTS](../AGENTS.md) | Agent 安全、授权、协作和验证规则 | AUTHORITATIVE |
| [项目地图](../PROJECT-MAP.md) | 领域/跨项目边界与任务路由 | LIVING |
| [架构](ARCHITECTURE.md) | 当前运行时、数据所有权和实现边界 | LIVING |
| [测试矩阵](TEST-MATRIX.md) | 自动化、浏览器、生产各自能证明什么 | LIVING |
| [UI 规范](UI-GUIDELINES.md) | 布局、主题、交互与响应式要求 | AUTHORITATIVE / LIVING |
| [Cloud 日报](CHATGPT-WORK-CLOUD.md) | OAuth/MCP、内容、媒体和发布合同；末尾历史区单独标记 | CONTRACT |
| [知识库](LIBRARY.md) | 只读呈现、发布/生命周期 API 与本地加工规则；批次记录仅为历史 | FEATURE / CONTRACT |
| [路线图](ROADMAP.md) | 未来顺序；已完成条目不代替当前验证 | ROADMAP |

## 操作与验证

| 文档 | 使用场景 | 边界 |
|---|---|---|
| [根 README](../README.md) | 本地启动、功能和配置入口 | 版本以 package.json 为准 |
| [部署路径](DEPLOYMENT-PATHS.md) | 预构建升级与依赖/环境升级 | 不含生产凭据；实际部署另行授权 |
| [Cloud 排障](CLOUD-DIGEST-RECOVERY.md) | 生成模板、完整性及媒体分支不一致 | 运行中 Prompt 必须另行核对 |
| [知识库首次部署](KNOWLEDGE-LIBRARY-FIRST-DEPLOYMENT.md) | 首次配置、目标核对、令牌权限与验收 | 首次/切目标先 dry-run；已知目标普通 publish 规则保留 |
| [Bundle 测量](BUNDLE-BASELINE.md) | 首屏闭包、全部 JS/CSS、最大资源及 gzip | 观察指标，不是性能预算或浏览器耗时 |

本机 `AGENTS.local.md`、`DEPLOY.md`、`CONTINUOUS-REQUIREMENTS.md` 保持忽略，不复制到可提交文档。外部 Daily Report V2 与 Knowledge Library 工作树路径由本机配置提供。

## 历史快照与决策

| 文档 | 分类 | 不能用于 |
|---|---|---|
| [2026-09-05 Phase 1 审计](PHASE-1-AUDIT.md) | AUDIT-SNAPSHOT | 直接引用为当前文件规模/风险状态 |
| [Settings V2 验证](SETTINGS-V2-VERIFICATION.md) | VERIFICATION-SNAPSHOT | 当前 HEAD 的浏览器验收 |
| [Calendar Design QA](../design-qa.md) | VERIFICATION-SNAPSHOT | 推断当前左栏布局或当前已验证 |
| [Cloud 历史运行](CHATGPT-WORK-CLOUD.md#cloud-run-history) | AUDIT / VERIFICATION-SNAPSHOT | 推断当前 Work 模式、生产版本或收件箱状态 |
| [Decision 0001](decisions/0001-phase-three-foundations.md) | 已接受的历史决策 | 把当时“无 CI”当成今天的结构 |

## 维护规则

Living/Contract 文档应标注 Status、Scope、Last verified commit/version、Authority、Update trigger、Supersedes、Do not use for。更新只证明列明范围，不能把源码核对写成生产核验。历史快照保留日期和原始结论，新增更晚证据时明确时间界限，不用追加记录悄悄改变前文“当前”的含义。

本阶段不全量移动目录或拆分合同；后续按确有重复和漂移的领域逐步整理，并核对入链。

- [Phase 2 前端加载边界验收](PHASE2-FRONTEND-LOADING.md)：0.21.1 本地实现、体积、浏览器证据与未验证边界。

- [Phase 3 数据写入与恢复可靠性](PHASE3-PERSISTENCE-RECOVERY.md)：四库写回、确认结果、恢复协议与故障验收。

- [Phase 4 应用工厂、运行时与低耦合路由](PHASE4-APP-RUNTIME-ROUTERS.md)：独立 HTTP fixture、五组 worker 生命周期、账号隔离与兼容性验收。

- [Phase 5 领域边界与迁移验收](PHASE5-DOMAIN-BOUNDARIES.md)：高耦合路由、数据库分层、等价 CSS 拆分及完整本地回归。
