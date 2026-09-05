# AI Calendar Test Matrix

本矩阵区分自动化、浏览器手工和生产验收。单元测试通过不等于浏览器 UI 正常；浏览器页面正常也不等于生产部署、SMTP 接受或收件箱最终到达。

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
| AI 记事 | note-item.test.ts、note-export.test.ts、note-color-migration.test.ts | NoteBoard 创建/编辑/完成/恢复/删除、TXT/CSV、窄屏抽屉 | 生产数据备份、恢复和账号隔离；不把记事当待办 |
| 设置 | Settings V2 浏览器证据、notification-preferences-client.test.ts、user-mail-api.test.ts | 390×844、430×932、768×1024、1440×900；浅色/暗色、长文本、保存/取消/删除/撤销 | 真实设置读取/保存需授权；不把 synthetic API 证据写成生产验收 |
| 附件、导出和备份 | export-service.test.ts、core.test.ts、attachment 相关实现 | 下载、大小/MIME、检查备份、合并/替换取消路径 | 备份前快照、恢复演练、附件权限和回滚 |
| 管理员 | admin-api-sharing.test.ts、管理员 API | 普通用户隐藏管理入口；管理员危险操作有确认 | 维护模式、全站备份、恢复和删除必须单独授权 |
| 知识库 | 当前未实现 | Phase 4 设计稳定后再增加 | 未进入生产验收范围 |

## 3. UI Smoke Test 决策

仓库当前没有项目级 Playwright/Cypress 依赖和独立浏览器 fixture。Phase 2 使用了本机提供的 Playwright 与 Headless Edge，适合本地验收但不能直接证明 CI 可复现。

本阶段不新增浏览器依赖或庞大 E2E 套件，原因是：

- 需要先确定无真实账号/生产数据的登录和 API fixture；
- Playwright 浏览器下载会增加锁文件、CI 时间和维护边界；
- 当前 CI 先保证 npm ci、类型、服务端测试和构建稳定。

现阶段的最小 UI smoke 范围仍是 /login、/today、/schedule、/assistant、/reminders、/import、/reports、/settings。下次引入项目级浏览器测试时，必须先补 fixture、console error 处理、viewport 断言和 CI 浏览器安装，再决定是否加入 workflow。
