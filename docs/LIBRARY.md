# 知识库 V2 本地发布与只读呈现

本阶段把“知识库 V2”确定为唯一内容入口：

`C:\Users\Elysia\Documents\Codex_Knowledge_Library`

Codex 在本地批次中复制原始材料、保留 SHA-256、生成处理后的 Markdown 和 `relations.json`；AI Calendar 服务器只负责账号隔离、保存原文、只读呈现、评论、版本和导出。服务器不做 AI 提炼、摘要生成或关系推理。

## 1. 当前能力

- `/library`：只读列表、搜索、形态/类型/状态筛选、标签展示和全库导出。
- `/library/:id`：安全 Markdown 阅读、来源、标签、关系状态、版本内容、评论和单条原文导出；代码块使用浅灰背景并支持一键复制。
- 服务器保留 Fragment/Article 兼容模型，网页公开正文写入、归档和删除接口统一返回 `405 READ_ONLY_LIBRARY`；发布令牌另提供显式的 `publish`、`retire`、`restore`、`purge` 生命周期操作。
- Article 只能通过本地发布令牌写入；同一 `sourceId + user_id` 支持 `CREATED`、`UPDATED`、`UNCHANGED` 幂等行为。
- 关系单独保存为 `relations_json`，允许 `confirmed`、`suggested`、`unresolved`；服务器不做 AI 推理，但 `retire`/`purge` 会事务性清理指向目标的当前关系。
- 详情正文支持 `[[目标标题]]` 和 `[[目标 sourceId|显示文字]]`；归档目标不再作为站内跳转目标，目标不存在时显示为未解析文本。
- 令牌生成、轮换和撤销位于“设置 → 知识库集成”，知识内容页面不再显示令牌或正文编辑入口。

## 2. V2 批次结构

```text
C:\Users\Elysia\Documents\Codex_Knowledge_Library\
  docs\knowledge-library-runs\20260906-sample-01\
    originals\
    processed\
    relations.json
    source-manifest.json
    validation-report.json
    upload-report.json
  scripts\process-migration-folder.ps1
  prompts\knowledge-processing.md
  scripts\publish-library.ps1
  docs\knowledge-library-operations.md
```

`originals/` 是不可修改的本批次备份；`processed/` 是唯一上传输入。发布脚本从自身所在的 V2 项目根目录解析批次，不接受 `--knowledge-dir`、`--tutorial-dir` 等旧目录参数。

当前三篇试运行样本已放在 `20260906-sample-01`；针对 `C:\Users\Elysia\Desktop\知识库迁移` 的全量本地加工结果已放在 `20260906-full-01`，包含 33 篇业务材料、6 个排除的维护文档、原文副本、处理稿、130 条双向关系和上传报告。原始旧目录只被复制读取，未被修改；本轮全量批次已上传到本地隔离服务，未上传生产。

## 3. 数据边界

知识库数据存储在 `chat.db`，由 `server/db.ts` 的 sql.js 访问层管理：

| 表 | 用途 |
| --- | --- |
| `library_entries` | 当前条目、原始 Markdown、摘要、标签、来源、元数据、关系 JSON、状态和正文哈希 |
| `library_entry_versions` | Article 的正文、标题、摘要、标签和关系历史 |
| `library_comments` | 条目级评论；评论按账号隔离 |
| `library_publish_tokens` | 每个账号至多一个发布令牌，只保存哈希 |

`content` 是 Markdown source；`html` 在读取详情时由 `server/library-markdown.ts` 重新生成，只作为安全展示结果，不回写正文。关系没有独立表，第一阶段保持 JSON 字段以减少迁移面。

用户加密备份、可读导出和全库知识导出都保留关系信息；令牌明文不进入日志、备份或导出包。

## 4. API 合同

### 网页登录态

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/library` | 列表、`q/kind/type/status/tag/sourceType/page/pageSize` 筛选 |
| GET | `/api/library/:id` | 详情、渲染 HTML、关系、版本和评论 |
| GET | `/api/library/:id/versions` | 读取版本列表 |
| GET | `/api/library/:id/export` | 下载服务器保存的原始 Markdown 字节内容 |
| GET | `/api/library/export` | 下载 JSON 全库包，包含 `entries/*.md` 的路径/原文、manifest、relations、comments、versions |
| POST/DELETE | `/api/library/:id/comments`、`/api/library/:id/comments/:commentId` | 新增评论、删除当前账号自己的评论 |

以下网页正文写入接口仍保留路由以便旧客户端得到明确反馈，但不再执行写入：

- `POST /api/library`
- `PATCH /api/library/:id`
- `POST /api/library/:id/archive`
- `POST /api/library/:id/promote`
- `DELETE /api/library/:id`

它们统一返回 `405` 和 `error.code = READ_ONLY_LIBRARY`。

### 本地发布令牌

令牌管理路径为：

- `GET/POST/DELETE /api/integrations/library-token`
- 兼容别名：`GET/POST/DELETE /api/library/publish-token`

内容发布路径为 `POST /api/integrations/library`，兼容别名为 `POST /api/library/publish`。生命周期路径为：

- `POST /api/integrations/library/retire`：撤回并清理当前关系，可恢复；
- `POST /api/integrations/library/restore`：恢复为 active，之后应重新发布本地关系；
- `POST /api/integrations/library/purge`：需要 `confirm: true`，删除当前条目、评论和版本并清理当前关系。

上述路径均有 `/api/library/publish/<operation>` 兼容别名。令牌只允许操作当前账号的知识库，不能登录、读取列表、添加评论、操作日程/记事或改变账号归属。

请求至少包含：

```json
{
  "sourceId": "kb:framework-003",
  "type": "framework",
  "title": "标题",
  "summary": "一句话摘要",
  "content": "# Markdown 原文",
  "tags": ["标签"],
  "sourceType": "codex",
  "sourceRef": "knowledge-v2/20260906-sample-01/processed/example.md",
  "relations": [],
  "metadata": {
    "sourceProject": "知识库V2",
    "runId": "20260906-full-01",
    "legacyId": "framework-003",
    "aliases": ["边际买家见顶信号"]
  }
}
```

同一 `sourceId + user_id` 下，正文或元数据不变返回 `UNCHANGED`；正文、标题、摘要、标签或关系变化返回 `UPDATED` 并保留版本；新条目返回 `CREATED`。服务器不记录正文、令牌或完整请求体日志。

## 5. 本地加工与发布流程

当用户在知识库 V2 项目中明确说“把这篇材料放进知识库”时：

1. 复制材料到本批次 `originals/`，不修改来源文件。
2. 计算原始 SHA-256，写入 `source-manifest.json`。
3. Codex 只读取 V2 项目内副本，生成 `processed/` Markdown、摘要、标签和稳定 `sourceId`。
4. 先检索当前批次和此前批次的 `processed/` 内容，只有能指出共同概念、互补框架、上下位关系或实际使用关系时才建立关联；正文引用、`legacyId` 和别名会统一解析为本地关系。
5. 将既有显式关系迁移到 `relations.json`；推断关系先写 `suggested`，目标暂时不存在时写 `unresolved`，并为当前批次内的关系同时写入反向记录。
6. 明确选择 `publish`、`retire`、`restore` 或 `purge`；脚本缺少 `-Operation` 时只显示操作清单并停止，绝不默认上传。
7. 运行发布脚本；只有检查而不改变服务器时才显式加 `-DryRun`，并确认 `validation-report.json` 为 0 errors、0 warnings。
8. `process-migration-folder.ps1` 在处理结束后调用发布脚本；撤回/彻底清除批次会把目标排除出 active 关系并清理正文中的 `[[链接]]`，令牌只在当前 PowerShell 会话设置。

默认干跑：

```powershell
Set-Location 'C:\Users\Elysia\Documents\Codex_Knowledge_Library'
pwsh -NoProfile -File .\scripts\publish-library.ps1 -RunId 20260906-sample-01 -Operation publish -DryRun
```

全量迁移目录的本地加工和显式发布：

```powershell
$newRunId = '20260907-next-01'
pwsh -NoProfile -File .\scripts\process-migration-folder.ps1 -RunId $newRunId -Operation publish
```

仅检查、不上传：

```powershell
pwsh -NoProfile -File .\scripts\publish-library.ps1 -RunId 20260906-full-01 -Operation publish -DryRun
```

隔离环境上传：

```powershell
$env:LIBRARY_BASE_URL = 'http://127.0.0.1:<isolated-port>'
$env:LIBRARY_PUBLISH_TOKEN = '<只保存在当前会话的令牌>'
pwsh -NoProfile -File .\scripts\publish-library.ps1 -RunId 20260906-sample-01 -Operation publish
Remove-Item Env:LIBRARY_PUBLISH_TOKEN
```

`LIBRARY_BASE_URL` 未设置时默认使用 `http://127.0.0.1:3000`；生产运行环境应预先设置为生产地址。每次写服务器前都必须由操作者明确选择操作；处理完成后不会自动替换为其他操作，但仍必须通过校验并具备当前会话令牌。完整参数、撤回/恢复/彻底清除和文档维护规则见 V2 项目的 `docs/knowledge-library-operations.md`。

脚本只读取当前批次 `processed/`、`source-manifest.json` 和 `relations.json`；会把 `suggested` 关系以“待确认”状态同步到服务器，并校验当前批次内部关系是否有反向记录。报告只写 sourceId、处理路径、正文 SHA-256、状态和脱敏错误，不保存令牌。

## 6. 全库导出

`GET /api/library/export` 当前返回一个不需要额外依赖的 JSON 包。`entries` 数组中每项包含：

- `path`：建议物化为 `entries/<sourceId>.md`；
- `markdown`：服务器保存的原始 Markdown 字符串；
- `entry`：标题、标签、来源、哈希和元数据。

包顶层另有 `manifest`、`relations`、`comments` 和 `versions`。因此客户端可以在本地无损物化为计划中的 `entries/`、`manifest.json`、`relations.json`、`comments.json` 和 `versions.json`，不会把安全 HTML 或任何凭据当作原文写回。

## 7. Markdown 安全

服务端允许安全 Markdown 展示：原始 HTML 会转义；链接仅允许 `http`、`https`、`mailto` 和安全相对路径；危险链接不产生可点击地址；代码块、表格、图片和列表由受限规则生成。代码块展示为浅灰背景、黑色文字，并提供复制按钮。站内 `[[...]]` 链接只解析到当前账号自己的知识条目。渲染不参与摘要、分类或关系生成。

## 8. 验收入口

```powershell
npm run typecheck
npm test
$env:ELECTRON_APP_URL = 'https://build.invalid.local'
npm run build
Remove-Item Env:ELECTRON_APP_URL
git diff --check
```

知识库测试覆盖网页只读 `405`、令牌哈希和权限边界、`sourceId` 幂等、版本保存、关系清理、撤回/恢复/彻底清除、评论隔离、单条/全库导出和无凭据导出。真实生产数据库、生产令牌、push、merge、部署和真实邮件不属于本分支。

## 9. 后续阶段

全量本地批次上传完成后，再按顺序考虑：

1. 人工查看 130 条关系，重点确认 2 条 `suggested` 关系；
2. 后续新增文章按“本地处理 → 校验 → 明确选择操作 → 上传 → 前端复核”的链路执行；
3. 增加 Note Board → Knowledge Fragment 单向入口；
4. 增加 Daily Report → Knowledge Fragment 单向入口；
5. 设计知识与日程的关联；
6. 最后再评估全文搜索、Embedding 或 RAG。
