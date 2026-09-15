# Phase 5：领域边界与迁移验收

- Status: VERIFICATION-SNAPSHOT
- Scope: 本地高耦合路由、chat.db 分层、剩余 CSS、兼容与恢复验证。
- Baseline: `main` / `4c9a521`，开始时工作区干净。
- Last verified version: `0.21.4-260916.0715`（2026-09-16）；原版本 `0.21.3-260915.1936`，PATCH。
- Authority: 当前源码、测试和隔离验证产物；本文不证明生产状态。
- Update trigger: HTTP 合同、模块归属、迁移顺序、持久化或样式加载策略变化。
- Supersedes: Phase 4 中“高耦合处理器仍在 application.ts”的当前结构说明；历史证据保留。
- Do not use for: 真实账号、真实 AI、邮件到达、生产迁移或部署结论。

## 1. 完成范围

| 所有者 | 职责 |
|---|---|
| `server/application.ts` | 组合中间件、领域 Router、健康检查、SPA fallback 和运行时依赖 |
| `server/routes/` | 账号、设置、管理、日程、周期、完成、AI 对话/确认/导入、备份、导出、通知及日报发布等 HTTP 处理器 |
| `ai-credentials.ts`、`ai-history.ts`、`ai-chat-state.ts` | 共享模型凭据、历史与对话状态；Router 不反向依赖 application |
| `schedule-input.ts`、`reminder-input.ts`、`local-date.ts` | 原有输入标准化与日期辅助逻辑 |
| `server/db.ts` | 保留原有公开导出与默认导出的兼容入口 |
| `server/database/connection.ts` | SQL.js 实例、路径、可靠写回与连接生命周期 |
| `server/database/schema.ts`、`migrations.ts` | 原有建表、索引及七组历史升级，保持调用顺序 |
| `server/database/queries/` | 账号、会话、偏好、记事、知识库、凭据、日报令牌/Cloud、OAuth、维护与操作结果查询 |
| `src/styles/` | foundation、reminders、shell、calendar、assistant、reports、search、assistant-mobile，按原顺序导入 |

没有新增 ORM、依赖、数据库格式或业务规则。其余三个 store 已有独立领域所有者，保持实现。连接模块下移一层后，默认 data 路径仍解析到项目根。

CSS 是源码职责拆分：混合选择器、Portal 和响应式覆盖继续按原级联顺序全局加载，Library/Admin 原有延迟加载保持不变。没有把本阶段描述为新增 CSS 按需加载或减小首屏体积。

## 2. 兼容性与故障验证

所有运行检查在独立临时源码副本进行，不复制真实 `.env`、数据库或凭据。Node `24.14.1`、npm `11.11.0`；Electron 配置使用合成 URL。

| 检查 | 实际结果 |
|---|---|
| 全量 `npm test` | 205/205，通过，无跳过 |
| `npm run typecheck` | 前端、后端、Electron 均通过 |
| `npm run build` | Web 与 Electron staging 构建通过 |
| 迁移/旧备份/可靠写回/中断恢复专项 | 17 项通过 |
| HTTP 回归 | 临时账号的创建、完成、重复完成、重新打开、周期事务和跨账号拒绝；已有 AI 重复确认、来源策略及备份恢复测试通过 |
| 历史迁移 | 合成旧表缺列/缺索引补齐；保留数据和账号归属；重复初始化的结构/数据稳定 |
| WAL 与失败重试 | 非空 WAL 阻止启动；注入 rename 失败保留旧文件，重试完成迁移 |
| AST 对照 Phase 4 | 144 个 HTTP handler、133 个数据库函数主体一致；69 条 schema/迁移语句顺序与主体一致 |
| 依赖方向 | 静态 import/export 检查未发现 Router 回引 app/application 或 database 回引 db 兼容入口 |
| CSS 对照 | 初次提取拼接逐字一致；最终清理原有行尾空白后，语法树和规则顺序一致（忽略行尾空白） |

路由按领域组合后，独立领域的整体挂载位置有所变化；不是声称全局注册顺序逐项相同。领域内固定路径优先和末尾 SPA fallback 保留。AI 多行 prompt 的字面量空白也恢复为原始内容，避免缩进变化影响请求。

既有 `markdown-renderer.ts` 与 `daily-report-markdown.ts` 的相互引用未在本阶段调整；不宣称全仓无环。

## 3. 浏览器与体积

Edge 合成 API 检查覆盖 390×844、430×932、768×1024、1440×900：六个页面共 24 次导航无水平溢出、无 pageerror；新增每页明暗主题截图。设置/管理弹窗、Escape 焦点恢复、日期链接、表单草稿、前进后退、普通/富文本知识库、慢加载及失败分支通过。人工查看手机提醒/AI、桌面日程/日报截图，未发现本次提取引入的布局问题。

页面 API 使用合成数据，日程/日报等列表以空态为主；不代表真实账号、有大量真实内容时的完整业务验收。实际写入与归属验证由独立临时数据 HTTP 测试承担。

拆分前后以同一版本构建并读取 Vite manifest，以下字节数全部相同：

| 指标 | 原始字节 | gzip 字节 |
|---|---:|---:|
| 首屏 JS 静态依赖闭包 | 354241 | 113169 |
| 首屏 CSS | 199563 | 29830 |
| 全部 JS | 6669184 | 1954807 |
| 全部 CSS | 372823 | 59461 |

这是资源体积测量，不是加载耗时或服务端压缩测试。既有大型 Mermaid/ELK 分包仍存在。

本机临时证据目录：`%TEMP%/aicalendar-phase5-cccd5be729d54b9595f2a0150e6aa8a8`，包括 stage4-final.log、migration-check.log、final-typecheck.log、final-build.log、bundle-before/after.json 与 browser-before/after；临时文件可能被系统清理。

## 4. 变更记录与边界

- `f1cd223`：账号、设置、管理及共享 AI 凭据。
- `c141a95`：日程、周期、完成、通知、备份等领域 Router。
- `ff19c93`：AI 对话、导入、确认及状态所有权。
- `375469e`：数据库连接、schema、迁移和领域查询；兼容 facade。
- CSS、字面量兼容修正与最终文档收尾提交见本文件所在 Git 历史。

版本以 package.json 为来源，package-lock.json 顶层与根包同步。README、PROJECT-MAP、ARCHITECTURE 和文档索引已同步；API、配置及部署方式不变，无需改写部署操作说明。

Phase 1–5 本地实施完成。未 push、创建发布、部署、真实发信、读取真实收件箱或操作生产数据；未运行真实 AI/OSS、Linux/PM2、远端 CI Node 22、Electron 桌面实机或跨项目集成验收。

残余边界：四库仍是进程级单例；未包装的旧多步业务不自动获得事务保证；真实老库可能存在合成 fixture 未覆盖的异常数据。恢复沿用 Phase 3 协议，未来部署前应在独立副本演练实际备份；本阶段未产生新格式，代码回滚可按领域提交回退，但不可用清空真实数据代替回滚。
