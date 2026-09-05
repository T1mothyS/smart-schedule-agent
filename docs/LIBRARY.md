# 知识库 MVP

本文件记录 Phase Four 的可提交实现边界。知识库第一版把“正式知识（Article）”和“知识碎片（Fragment）”放进同一个账号私有系统，先解决保存、阅读、搜索、整理、迁移和恢复，不提前引入全局搜索、RAG 或日程双向同步。

## 1. 当前能力

- `/library`：列表、普通关键词搜索、形态/类型/状态筛选、标签展示。
- `/library/:id`：Markdown 阅读、轻量编辑、导出、评论、版本数量、来源信息和未来关联预留。
- Fragment：网页快速创建，可选标题，支持编辑、加标签、归档、永久删除、导出和“整理为正式知识”。
- Article：需要标题；本地 Markdown 发布是首选 source of truth，服务器保存当前正文并保留内容版本。
- 迁移：默认 `dry-run`，导入通过 API 完成，不直接打开运行中的 `chat.db`。

复杂富文本编辑、AI 自动改写、附件上传、Note/Daily Report 联动、Ctrl+K、Embedding、向量检索和 RAG 不在本阶段。

## 2. 数据边界

知识库数据存储在 `chat.db`，由 `server/db.ts` 的 sql.js 访问层管理：

| 表 | 用途 |
| --- | --- |
| `library_entries` | 当前条目、Markdown 正文、摘要、标签、来源、状态和内容哈希 |
| `library_entry_versions` | Article 的正文/标题/摘要/标签历史 |
| `library_comments` | 条目级评论；第一版不做行级 anchor 或协同编辑 |
| `library_publish_tokens` | 每个账号至多一个发布令牌，只保存 SHA-256 哈希 |

`content` 是 Markdown source；`html` 在读取详情时由 `server/library-markdown.ts` 重新生成，不把渲染结果作为第二份可编辑事实。标签第一版使用 JSON，保留未来拆成 tag 表的接口空间。`relations` 响应始终包含 `calendarEvents` 和 `libraryEntries` 数组，供 Phase Five 增加关系校验而不破坏详情接口。

所有查询、修改、评论和删除都由登录态解析的 `user_id` 限定；请求体不能指定目标账号。外部发布令牌只拥有正式知识写入能力，不具备登录会话、日程或其他账号 API 权限。

## 3. API 合同

### 网页登录态

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/library` | 列表、`q/kind/type/status/tag/sourceType/page/pageSize` 筛选 |
| POST | `/api/library` | 创建 Fragment 或 Article |
| GET | `/api/library/:id` | 详情、渲染 HTML、版本和评论 |
| PATCH | `/api/library/:id` | 更新条目 |
| POST | `/api/library/:id/archive` | 可恢复归档 |
| POST | `/api/library/:id/promote` | Fragment 复制为 Article 草稿 |
| DELETE | `/api/library/:id` | 需要 JSON `{ "confirm": true }` 的永久删除 |
| GET | `/api/library/:id/export` | 下载带 frontmatter 的 Markdown |
| POST/DELETE | `/api/library/:id/comments`、`/api/library/:id/comments/:commentId` | 条目级评论 |

### 本地发布

登录用户在知识库页面生成令牌；令牌明文只返回一次。令牌管理路径为：

- `GET/POST/DELETE /api/integrations/library-token`
- 同义网页路径：`GET/POST/DELETE /api/library/publish-token`

发布路径为 `POST /api/integrations/library`，兼容别名为 `POST /api/library/publish`。请求至少包含：

```json
{
  "sourceId": "migration:knowledge:stable-id",
  "type": "framework",
  "title": "一篇正式知识",
  "content": "# Markdown 正文",
  "tags": ["迁移", "框架"],
  "sourceType": "migration",
  "sourceRef": "knowledge/框架/example.md"
}
```

`sourceId + user_id` 定义文章身份：同一 `contentHash` 重试返回 `UNCHANGED`，正文/标题/摘要/标签变化时返回 `UPDATED` 并新增一个版本。首次发布返回 `CREATED`。服务端不记录令牌明文或正文日志。

## 4. 迁移流程

迁移工具 `scripts/migrate-library.ts` 只扫描指定目录中的 Markdown，并跳过 `README.md`、`HANDOFF.md`。知识库目录按 `框架/`、`认知/`、`经历/` 映射为 `framework`、`insight`、`experience`；教程目录按文件名中的“速查/手册/工具箱/攻略”映射为 `reference`，其他为 `tutorial`。来源行中的标签和 URL 会被提取；原始正文始终保留。

推荐先 dry-run：

```powershell
npm exec -- tsx scripts/migrate-library.ts `
  --dry-run `
  --knowledge-dir '<已处理知识库目录>' `
  --tutorial-dir '<已处理教程库目录>' `
  --report '<临时报告路径>'
```

确认报告后，再在当前用户的本地私密环境中执行导入：

```powershell
$env:LIBRARY_BASE_URL = 'https://<your-calendar-host>'
$env:LIBRARY_PUBLISH_TOKEN = '<只在当前 PowerShell 会话中使用的令牌>'
npm exec -- tsx scripts/migrate-library.ts `
  --import `
  --knowledge-dir '<已处理知识库目录>' `
  --tutorial-dir '<已处理教程库目录>' `
  --report '<临时报告路径>'
```

报告只保存文件路径、标题、类型、稳定 `sourceId`、状态和 warning，不保存正文或令牌。首批目录的 dry-run 结果应能解释为知识 23 条、教程 7 条；导入后还需按 `CREATED/UPDATED/UNCHANGED`、再次 GET、搜索可见性和网页详情抽查。真实导入、生产部署和真实邮件不由本地实现自动触发。

没有 frontmatter `sourceId` 的原始文件使用 `migration:<family>:<relative-path-hash>` 作为初始稳定 ID。导出的 Markdown 会带 `sourceId` frontmatter，后续改名后可继续复用该 ID；如果要把原始文件改名并保持身份，先保留导出 frontmatter 或在本地补写 `sourceId`。

## 5. Markdown 安全

服务端使用保守 renderer：原始 HTML 会转义；链接仅允许 `http`、`https`、`mailto` 和安全相对路径；危险链接不产生可点击地址；代码块、表格、图片和列表由受限规则生成。正文、标题、标签、摘要、评论和 metadata 都有大小/数量上限。图片第一版仅作为安全 URL 引用，不接受任意服务器文件路径或上传。

## 6. 备份与未来接口

用户加密备份和可读导出包含当前 `libraryEntries`；恢复时会重新建立 Article 的初始版本。发布令牌不进入备份正文，避免备份泄露写入权限；恢复后需要在网页重新生成令牌。账号删除和清空账号数据都会删除条目、版本、评论并撤销发布令牌。

后续阶段可以在不改 Article/Fragment 基础合同的前提下增加：

1. Note Board / Daily Report 的 `sourceType` 和 `sourceRef` 写入入口；
2. `relations` 中的日程 ID 与内容 ID，并由服务层校验跨数据库所有权；
3. 共享/收藏、附件和更丰富的版本 diff；
4. 在普通搜索有真实瓶颈后再加 FTS、embedding 或 RAG。

## 7. 验收入口

```powershell
npm exec -- tsx --test server/library.test.ts
npm run typecheck
npm test
npm run build
git diff --check
```

知识库页面还需在 `390×844`、`430×932`、`768×1024`、`1440×900` 检查无横向溢出、搜索/标签换行、Markdown 正文、代码块内部滚动、表格可滚动、图片不撑宽、评论区和操作按钮。生产健康、部署、真实账号导入和公网最终阅读属于单独授权的后续验收，不由本分支宣称完成。
