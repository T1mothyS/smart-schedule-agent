# Phase 2 前端加载边界验收

- Status: AUDIT-SNAPSHOT
- Date/version: 2026-09-15 / 0.21.1-260915.1408
- Baseline: Phase 1 `6a45408`，应用源码 `8854a38`。
- Scope: 本地前端加载边界；没有后端、数据库、依赖、生产发布和真实邮件修改。

## 完成内容

1. 共享日程类型、呈现工具、表单与详情独立；Today 不再静态引用 CalendarView。
2. 顶层功能页面与 Settings/Admin 弹窗按需加载。产品壳仍可导航；失败提供刷新，弹窗等待/失败可取消或 Escape 关闭，键盘焦点不会进入背景。
3. Library 列表与详情分包；KaTeX 及其 CSS 仅在公式节点出现时加载。Mermaid 按内容加载、主题重绘、源码降级与取消检查保留。
4. Library/Admin 专属 CSS 跟随功能；公共/混合选择器保留。Settings CSS 沿用原入口。

## 实测结果

| 检查 | 结果 |
|---|---|
| npm run typecheck | PASS |
| npm test | 179/179 PASS |
| node --test scripts/measure-bundle.test.mjs | 4/4 PASS |
| npm run build | PASS，Web/Electron 构建与桌面暂存 |
| npm run build:client -- --manifest | PASS |
| 首屏模块闭包 | 6 JS；CalendarView、lunar、Library、KaTeX、Admin 均未进入 |
| 提取函数体对照 | SmartTimePicker、ReminderPicker、ScheduleFormModal、ScheduleDetailModal、SchedulePage、AiAssistantPage 与 Phase 1 原函数体一致 |
| CSS 规则对照 | 原 1,355 条规则的选择器、声明、媒体条件全部保留；增加 4 条加载状态规则 |
| git diff --check | PASS |
| 合成浏览器 smoke | Edge headless，24 个页面/窗口组合无横向溢出，未捕获运行时异常 |

生产构建在不含真实 .env/data 的临时源码副本完成，沿用现有 node_modules；Electron URL 使用合成地址。未执行全新 npm ci 或远程 CI，未启动真实后端。

[完整体积对照](BUNDLE-BASELINE.md)、[构建快照](baselines/bundle-phase2-2026-09-15.json)、[模块闭包证据](baselines/modules-phase2-2026-09-15.json)。JS gzip 从 456,761 降至 113,164（-75.22%），CSS 从 56,269 降至 29,830（-46.99%）。全部 JS gzip 略增 0.94%，这是加载时机优化，不是全部资源总体积减少，也不代表 LCP 已测。

模块证据来自相同源码/配置的 Vite generateBundle 观察插件：从 isEntry chunk 沿 imports 遍历，检查每个 chunk.modules；不沿 dynamicImports 遍历。插件只观察、write:false，不改构建配置或依赖。

## 浏览器范围与复现

入口：[scripts/browser-smoke.cjs](../scripts/browser-smoke.cjs)，用法见 [TEST-MATRIX](TEST-MATRIX.md)。只启动回环静态服务器，API 全部合成，外部网络阻断。

- 390×844、430×932、768×1024、1440×900：Today、日程、周期提醒、AI、日报、知识库空数据/合成列表加载。
- 四尺寸 Settings 浅色/暗色打开关闭；Admin 打开关闭，截图检查。
- 日程日期深链、输入草稿保持、取消；Settings Escape 关闭与返回触发按钮焦点。
- 客户端导航进入知识详情并浏览器返回。
- 普通文章无 KaTeX/Mermaid 请求；公式与 Mermaid 浅色/暗色渲染。
- Settings 分包延迟/失败：状态可见，Tab 焦点循环，Escape 可取消。
- KaTeX 分包失败：原公式可读，Mermaid 仍能渲染。
- 浏览器结果 JSON、截图保存在本次本地临时证据目录，未提交截图、真实数据或构建产物。

## 发现与边界

- 首轮合成指南缺少 items/rules/examples，引起设置错误边界；按真实接口字段修正 fixture 后通过，未改变生产设置逻辑。
- 首轮 Mermaid fixture 使用 pre，代码复制按钮被计入源码；改为服务端实际 span 结构后通过，未改变生产渲染逻辑。
- 原有无目录文章宽屏布局：未渲染 TOC 时，正文占用三列网格的第一列而偏窄。相关 JSX 与 CSS 未改变；本轮记录为后续局部 UI 修复项。
- 未验证：真实登录/持久化写入、真实 AI/邮件、管理员危险动作、所有数据分支、Electron 实机交互、Safari/Firefox、生产网络冷启动性能。数据库一致性与恢复问题属于 Phase 3。

## 简短 premortem

1. 后续重新静态导入 CalendarView 导致首屏回涨：保留共享层与模块证据，后续改导入时重测；目前没有强制 CI 体积预算。
2. 部署更新后旧页面请求失效 chunk：错误边界提供刷新/取消；仍依赖部署端的静态资源生命周期，离线时无法恢复网络。
3. 异步富内容在跳转/切主题时旧任务覆盖新页面：保留 generation/cancelled 检查与主题重绘；浏览器 smoke 不穷举所有竞态和图表类型。

## 计划状态

| Phase | 状态 | 下一步 |
|---|---|---|
| 1 文档与基线 | 完成 | 保留历史快照 |
| 2 前端加载边界 | 完成 | 本地提交，不自动 push/deploy |
| 3 数据写入与恢复 | 未执行 | 按 T01→T02→T03→T04 注入失败并逐项验证 |
| 4 app/runtime 与低耦合路由 | 未执行 | Phase 3 后推进 |
| 5 高耦合域与 query 边界 | 未执行 | 按域小步实施 |
