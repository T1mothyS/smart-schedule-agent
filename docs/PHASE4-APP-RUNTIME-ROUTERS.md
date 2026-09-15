# Phase 4：应用工厂、运行时与低耦合路由

- Status: VERIFICATION-SNAPSHOT
- Date: 2026-09-15
- Version: `0.21.3-260915.1936`
- Baseline: `57b915b`（Phase 3）
- Implementation: `629f19e`、`723a284`、`c14fd45`、`68b8786`、`fa67fa7`
- Scope: 本地源码、合成数据、隔离构建；不证明生产运行或真实邮件到达。

## 完成内容

| 所有者 | 职责 |
|---|---|
| `server/index.ts` | 保留原 npm/部署入口；仅直接执行时加载 dotenv 并启动；兼容现有测试导出 |
| `server/app.ts` | `createApp(deps)` 组合安全头、限流、1 MB/75 MB JSON、OAuth/MCP、ready gate、媒体与静态文件；SPA fallback 最后注册 |
| `server/auth.ts` | 显式注入密钥与账号查询；保持 authVersion、禁用账号、401/403 合同 |
| `server/runtime/config.ts`、`stores.ts` | 配置校验、环境默认值、四库与邀请码初始化；并发初始化合并为一次 |
| `server/runtime/bootstrap.ts` | 单一应用的监听端口、启动失败清理、SIGINT/SIGTERM 和程序主动关闭 |
| `server/runtime/jobs.ts`、`job-runner.ts` | 拥有提醒/通知、每日备份、OSS 重试、邮箱导入、AI 历史清理五组任务；显式 start/stop |
| `server/routes/guides.ts`、`notes.ts`、`search.ts` | 指南、记事与按账号隔离的统一搜索 |
| `server/routes/library.ts` | 保持固定路径先于 `:id`、发布别名、发布令牌、网页只读和生命周期合同 |
| `server/routes/reports-read.ts`、`reports-policy.ts`、`reports-token.ts` | 日报读取、候选/正式视图、来源策略、Cloud Context/活动记录、专用令牌 |
| `server/application.ts` | 组合上述模块，并暂存 Phase 5 的高耦合 HTTP 处理器与 AI 内存状态 |

`createApp` 的导入和构造不加载 dotenv、不读取 store、不创建数据目录、不注册定时器、不监听端口。可以只注入合成 router 作为独立 HTTP fixture。`index` 的兼容导出会导入业务组合模块，部分既有 store 仍可能创建空目录；无副作用工厂入口明确是 `app.ts`。

运行入口仍为 `npm run server` / `npm run dev:server`。邮件服务不再自行加载 dotenv，由显式 CLI 启动在导入业务模块之前加载。外部直接导入服务的调用方应自行提供环境配置。

`stop()` 先拒绝新 tick，销毁全部 cron handles，并等待已接受的异步任务结束；通知队列、周期提醒、IMAP 和 OSS Promise 都属于这一等待范围。HTTP listener 同时停止接收连接并等待在途请求。重复启动不重复创建定时器或监听端口；停止/启动失败会移除所属信号监听。

## 兼容性证据

- 将基线与当前组合展开后的 144 条 `app.get/post/put/patch/delete/all` 注册按 TypeScript AST 对照，顺序及处理器结构完全一致（独立核对 SPA fallback）。保留发布/只读权限、错误状态、响应字段和账号所有权。
- Library 固定路由、评论、版本、发布别名、retire/restore/purge 继续通过原有 API 测试。
- 日报生成、媒体上传、重发、AI 确认、完成事务及备份的业务实现未在本阶段重写；Phase 3 的持久化与恢复协议继续生效。
- 不新增依赖，不改变包管理器、数据库格式、来源策略或部署步骤。

## 本地验证

所有运行验证都在不含真实 `.env` / `data` 的临时源码副本进行。生产模式 smoke 使用临时数据库、合成邀请码与配置，并禁用后台业务任务。

| 验证 | 实际结果 |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | 201/201 PASS；Phase 4 新增 10 项测试 |
| `npm run build` | Web + Electron staging PASS；沿用合成 HTTPS 应用地址 |
| `server/phase4-runtime.test.ts` | 工厂无副作用、非测试环境入口导入不启动、真实 5 组定时器销毁、入口配置顺序、503/401、parser 例外路径、媒体 404/SPA 顺序、关闭等待、失败清理、端口占用 |
| `server/phase4-api.test.ts` | 两账号 401/403/404、搜索隔离、策略隔离、日期与字段校验、专用令牌权限隔离 |
| 原 Library / 日报 / Phase 3 API 测试 | PASS；保留既有测试入口与断言 |
| `scripts/browser-smoke.cjs` | 6 页面 × 4 viewport 共 24 次导航无溢出，错误列表为空；额外覆盖设置/Admin、富文本、日期深链、草稿、返回焦点与失败回退 |
| `git diff --check` | PASS |

浏览器 smoke 使用合成 API 响应，证明当前构建和导航回归；真实 HTTP API 由独立集成测试证明。两类证据都不等于生产端到端验收。构建仍有既有的大 chunk 提示；本阶段不改变前端分包策略。

## 未验证与简短 premortem

1. **外部 I/O 迟迟不返回使关闭等待变长。** 新 owner 等待真实 Promise，不把已开始的发信/上传假装取消；仍依赖现有外部服务超时及部署进程管理器的宽限期。没有用真实 SMTP、IMAP、OSS 演练慢关闭。
2. **后续迁移把固定路由放到参数路由之后，或漏接认证。** 现有两账号、固定路径和专用令牌 API 测试降低风险；新增端点仍必须补对应所有权验证。
3. **后续代码绕过 runtime 再注册 worker。** 当前五组任务集中管理，测试断言注册数量与销毁结果；未来新增定时器必须加入同一 owner。强制杀进程仍不能保证外部操作完成，磁盘状态沿用 Phase 3 恢复协议。

未执行 push、部署、真实发信、真实 IMAP/OSS、生产数据操作、Linux/PM2 信号演练或跨项目日报工作树验收。回滚按本阶段提交逆序 revert，应用与 runtime 文件应成组恢复；无数据库迁移需要撤回。

## 计划状态与下一步

| 阶段 | 状态 / 剩余工作 |
|---|---|
| Phase 1–3 | 本地完成 |
| Phase 4 | 本地完成 |
| Phase 5 | 待执行：schedule/reminder/completion、AI、settings/admin 等剩余路由；schema/migrations/query 边界；剩余 feature CSS；迁移/旧备份/来源策略及完整 UI 回归 |

Phase 5 继续按领域逐项提交。`application.ts` 仍集中保留高耦合业务，不能把此次入口变小写成全仓解耦已完成；四 store 仍是进程级单例，多数据目录隔离继续使用独立进程。
