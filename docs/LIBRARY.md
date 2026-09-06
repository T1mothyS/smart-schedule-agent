# 知识库 V2 本地发布与只读呈现

本阶段把“知识库 V2”确定为唯一内容入口：

`C:\Users\Elysia\Documents\Codex_Knowledge_Library`

Codex 在本地批次中复制原始材料、保留 SHA-256、生成处理后的 Markdown 和 `relations.json`；AI Calendar 服务器只负责账号隔离、保存原文、只读呈现、评论、版本和导出。服务器不做 AI 提炼、摘要生成或关系推理。

## 1. 当前能力

- `/library`：只读列表、搜索、形态/类型/状态筛选、标签展示和全库导出。
- `/library/:id`：安全 Markdown 阅读、来源、标签、关系状态、版本内容、评论和单条原文导出。
- 服务器保留 Fragment/Article 兼容模型和底层归档/删除/整理函数，网页公开写入接口统一返回 `405 READ_ONLY_LIBRARY`。
- Article 只能通过本地发布令牌写入；同一 `sourceId + user_id` 支持 `CREATED`、`UPDATED`、`UNCHANGED` 幂等行为。
- 关系单独保存为 `relations_json`，允许 `confirmed`、`suggested`、`unresolved`；服务器只保存和返回，不计算目标是否存在。
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
  prompts\knowledge-processing.md
  scripts\publish-library.ps1
```

`originals/` 是不可修改的本批次备份；`processed/` 是唯一上传输入。发布脚本从自身所在的 V2 项目根目录解析批次，不接受 `--knowledge-dir`、`--tutorial-dir` 等旧目录参数。

当前三篇试运行样本已放在 `20260906-sample-01`：一篇认知、一篇框架和一篇教程/速查参考。原始旧目录只被复制读取，未被修改。

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

内容发布路径为 `POST /api/integrations/library`，兼容别名为 `POST /api/library/publish`。令牌只允许发布当前账号的正式 Article，不能登录、读取列表、添加评论、操作日程/记事或改变账号归属。

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
    "runId": "20260906-sample-01",
    "legacyId": "framework-003"
  }
}
```

同一 `sourceId + user_id` 下，正文或元数据不变返回 `UNCHANGED`；正文、标题、摘要、标签或关系变化返回 `UPDATED` 并保留版本；新条目返回 `CREATED`。服务器不记录正文、令牌或完整请求体日志。

## 5. 本地加工与发布流程

当用户在知识库 V2 项目中明确说“把这篇材料放进知识库”时：

1. 复制材料到本批次 `originals/`，不修改来源文件。
2. 计算原始 SHA-256，写入 `source-manifest.json`。
3. Codex 只读取 V2 项目内副本，生成 `processed/` Markdown、摘要、标签和稳定 `sourceId`。
4. 将既有显式关系迁移到 `relations.json`；目标不在本批次时使用 `unresolved`，推断关系使用 `suggested`。
5. 运行发布脚本的默认干跑，确认 `validation-report.json` 为 0 errors、0 warnings。
6. 只有明确授权上传时，才在当前 PowerShell 会话设置 `LIBRARY_PUBLISH_TOKEN` 并加 `-Upload`。

默认干跑：

```powershell
Set-Location 'C:\Users\Elysia\Documents\Codex_Knowledge_Library'
pwsh -NoProfile -File .\scripts\publish-library.ps1 -RunId 20260906-sample-01
```

隔离环境上传：

```powershell
$env:LIBRARY_BASE_URL = 'http://127.0.0.1:<isolated-port>'
$env:LIBRARY_PUBLISH_TOKEN = '<只保存在当前会话的令牌>'
pwsh -NoProfile -File .\scripts\publish-library.ps1 -RunId 20260906-sample-01 -Upload
Remove-Item Env:LIBRARY_PUBLISH_TOKEN
```

脚本只读取当前批次 `processed/`、`source-manifest.json` 和 `relations.json`；报告只写 sourceId、处理路径、正文 SHA-256、状态和脱敏错误，不保存令牌。

## 6. 全库导出

`GET /api/library/export` 当前返回一个不需要额外依赖的 JSON 包。`entries` 数组中每项包含：

- `path`：建议物化为 `entries/<sourceId>.md`；
- `markdown`：服务器保存的原始 Markdown 字符串；
- `entry`：标题、标签、来源、哈希和元数据。

包顶层另有 `manifest`、`relations`、`comments` 和 `versions`。因此客户端可以在本地无损物化为计划中的 `entries/`、`manifest.json`、`relations.json`、`comments.json` 和 `versions.json`，不会把安全 HTML 或任何凭据当作原文写回。

## 7. Markdown 安全

服务端允许安全 Markdown 展示：原始 HTML 会转义；链接仅允许 `http`、`https`、`mailto` 和安全相对路径；危险链接不产生可点击地址；代码块、表格、图片和列表由受限规则生成。渲染不参与摘要、分类或关系生成。

## 8. 验收入口

```powershell
npm run typecheck
npm test
$env:ELECTRON_APP_URL = 'https://build.invalid.local'
npm run build
Remove-Item Env:ELECTRON_APP_URL
git diff --check
```

知识库测试覆盖网页只读 `405`、令牌哈希和权限边界、`sourceId` 幂等、版本保存、关系原样返回、评论隔离、单条/全库导出和无凭据导出。真实生产数据库、生产令牌、push、merge、部署和真实邮件不属于本分支。

## 9. 后续阶段

三篇样本确认后，再按顺序考虑：

1. 批量处理剩余 23 条知识和 7 条教程；
2. 补齐本地关系网络并确认 suggested 关系；
3. 增加 Note Board → Knowledge Fragment 单向入口；
4. 增加 Daily Report → Knowledge Fragment 单向入口；
5. 设计知识与日程的关联；
6. 最后再评估全文搜索、Embedding 或 RAG。
