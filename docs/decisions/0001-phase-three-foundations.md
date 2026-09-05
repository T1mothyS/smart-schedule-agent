# Decision 0001：Phase 3 协作基础的最小实现

日期：2026-09-05

## 背景

Phase 1/2 已完成项目审计和 Settings V2。当前源码确认 server/index.ts 仍是集中式 Express 组合入口，仓库没有项目级 GitHub Actions、Playwright 或 Cypress 依赖；本机曾使用环境自带浏览器能力完成 Settings V2 验收。导航 PNG 为 1254×1254，但产品壳实际只显示约 27–29px。

## 决定

1. 将通用协作、安全、验证和 Git 规则放入可提交的 AGENTS.md；本机路径、部署习惯和跨项目 checkout 信息放入被忽略的 AGENTS.local.md。
2. 新增架构、UI、测试矩阵和路线图文档，并保留本地持续记录和部署 runbook 的职责分离。
3. 新增只执行 npm ci、typecheck、test、build 的 GitHub Actions；不加入生产部署、真实发信或外部服务操作。
4. Phase 3 不新增 Playwright 依赖。先用测试矩阵记录 UI smoke 范围和引入条件，待无真实数据 fixture 和 CI 浏览器安装方案明确后再评估。
5. 不在本阶段整体拆分 server/index.ts；未来只在对应领域修改时提取 router，并通过原有测试和权限边界验证。
6. 将导航图标缩放为 128×128 的透明 PNG，保持文件名、颜色、透明边界和调用路径不变；这属于低风险静态资源优化。

## 结果和回滚

文档、CI 和 .gitignore 变更可独立回滚。图标仍由同一路径加载，Git 可恢复原始二进制文件；版本号随静态资源发布变更递增 patch。任何后续视觉差异必须以实际浏览器渲染复验，而不是只看文件大小。
