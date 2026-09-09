# Knowledge Library V2 首次部署与文档追踪手册

本手册描述 AI Calendar 一侧如何准备并验收 Knowledge Library V2 的第一次本地/隔离部署。它只说明配置位置、权限和检查层级，不包含真实服务地址、令牌、账号或用户数据。

Knowledge Library V2 的稳定边界是：本地项目负责 Markdown 加工、`source-manifest.json`、`relations.json` 和生命周期选择；AI Calendar 负责账号隔离、只读呈现、评论、导出和发布令牌鉴权。网页端不编辑正文，也不替代本地关系校验。

## 1. 首次部署前置条件

- AI Calendar 已完成 `npm run typecheck`、`npm test` 和 `npm run build`，并能通过 `/api/health`。
- 目标账号可以登录，并在“设置 → 知识库集成”看到令牌状态。
- 本地 Knowledge Library 项目包含 `scripts/process-migration-folder.ps1`、`scripts/publish-library.ps1`、`docs/` 和批次目录。
- 服务端启用 HTTPS 时，日报/知识库客户端使用同一可信目标；隔离测试使用显式的本地端口和测试账号。
- 生产首次部署另行遵循 `DEPLOY.md` 的备份、原子切换、PM2、健康检查和回滚流程；本手册不授予生产部署或发布授权。

## 2. 生成与保存发布令牌

在登录后的 AI Calendar 设置页：

1. 打开“设置 → 知识库集成”。
2. 生成令牌；轮换会立即使旧令牌失效。
3. 令牌明文只显示一次，立即复制到本地 Knowledge Library 的忽略配置或当前 PowerShell 会话。
4. 不要把令牌写入命令行参数、PowerShell 历史、Prompt、报告、日志、备份导出或 Git。

令牌只有以下权限：

- 发布、更新当前账号的 Markdown 条目和关系；
- 显式执行 `publish`、`retire`、`restore`、`purge` 生命周期操作；
- 不能登录网页、读取知识库列表、评论、修改日程、修改记事或访问其他账号。

服务器只保存令牌哈希。令牌状态接口为登录态 `GET /api/integrations/library-token`，它只返回状态、前缀和使用时间，不返回明文。

## 3. 第一次批次的本地流程

在 PowerShell 中进入本地 Knowledge Library 项目根目录。以下变量只是占位符，不要把真实令牌写入脚本或命令参数：

```powershell
Set-Location '<LibraryRoot>'
$runId = 'YYYYMMDD-first-deployment-01'

# 只在当前会话中提供令牌；也可以使用本地配置文件，不要把令牌作为脚本参数传入。
$env:LIBRARY_BASE_URL = 'https://<AI-Calendar-host>'
$env:LIBRARY_PUBLISH_TOKEN = '<只保存在当前会话的令牌>'

pwsh -NoProfile -File .\scripts\process-migration-folder.ps1 `
  -SourceRoot '<SourceRoot>' `
  -RunId $runId `
  -DryRun
```

第一次必须先使用 `-DryRun`。检查通过后再由人工确认是否执行普通 `publish`。普通处理默认发布；`retire`、`restore` 和 `purge` 永远必须显式选择，不能复用上一次操作。

批次至少应包含：

```text
knowledge-library-runs\<RunId>\
  originals\
  processed\
  source-manifest.json
  relations.json
  validation-report.json
```

## 4. AI Calendar API 合同

本地发布客户端使用发布令牌调用：

| API | 用途 | 首次部署检查 |
| --- | --- | --- |
| `GET /api/integrations/library-token` | 登录用户查看令牌状态 | 页面只显示状态，不出现明文 |
| `POST /api/integrations/library` | 幂等创建或更新条目 | `sourceId + 当前账号` 唯一定位 |
| `POST /api/integrations/library/retire` | 撤回条目 | 关系清理后仍可 `restore` |
| `POST /api/integrations/library/restore` | 恢复条目 | 必须随后重新发布本地关系 |
| `POST /api/integrations/library/purge` | 彻底清除 | 必须额外确认，服务器端不可恢复 |

发布正文使用本地已校验的 Markdown；关系使用本地 `relations.json`。同一 `sourceId`、正文和元数据重复提交应返回 `UNCHANGED`，内容变化返回 `UPDATED`，新条目返回 `CREATED`。

## 5. 分层验收

按以下层级记录结果，不要把上层结果替代下层证据：

1. **本地校验**：`validation-report.json` 为 `PASS`，无错误和未解析关系；原文 SHA-256 可复核。
2. **发布接口**：`upload-report.json` 的操作与本次意图一致，响应为 `CREATED`/`UPDATED`/`UNCHANGED`；报告不含令牌。
3. **服务健康**：`GET /api/health` 返回 `status: ok`；日志没有认证、关系或数据库错误。
4. **网页复核**：登录目标账号打开知识库列表、详情、关系、评论和导出，确认正文与本地处理稿一致。
5. **回滚复核**：保留本地 `originals/` 和历史批次；错误内容优先发布修正后的同一 `sourceId`，需要隐藏时选择 `retire`。

`PUBLISHED`、`CREATED`、`UPDATED`、`UNCHANGED` 或健康检查只能证明对应层级，不能证明用户已在浏览器看到正确内容，更不能证明邮件到达。

## 6. 失败处理与回滚

- 令牌缺失或目标不明确：停止，不尝试猜测目标，也不把令牌写入日志。
- 校验失败：只修复本地 `processed/`、`source-manifest.json` 或 `relations.json`，生成新的 `RunId` 后重跑 `-DryRun`。
- 发布部分完成：依据 `upload-report.json` 找到 `CREATED`/`UPDATED` 条目，使用同一稳定 `sourceId` 重跑，利用幂等性收敛结果。
- 需要撤回：显式执行 `retire`，保留本地原文和报告；需要恢复时显式执行 `restore`，再发布当前本地版本。
- `purge`：只有用户明确选择并完成二次确认才执行；服务器当前条目、评论和版本不可恢复，本地历史批次不会自动删除。

## 7. 文档追踪

本手册只记录 AI Calendar 侧合同。Knowledge Library 侧的首次部署、批次处理、`RunId`、干跑、关系报告和生命周期命令见本地项目的 `docs/knowledge-library-first-deployment.md` 与 `docs/knowledge-library-operations.md`。

每次更新接口、令牌权限、批次字段、关系状态或回滚流程时，应同时更新两份手册，并在下一次本地 `-DryRun` 或显式发布报告中记录代码版本、文档版本和验证结果。
