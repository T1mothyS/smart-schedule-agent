# AI Calendar Roadmap

本路线图只记录当前阶段顺序和明确边界。新需求先判断属于哪个区段，再单独确认范围，不把未来想法混入当前实现。

# Now

- 保持 Settings V2 稳定，沿用统一的 Section、Row、Dialog 和窄屏验收。
- 使用可提交的 AGENTS.md、架构/UI/测试文档和 GitHub Actions CI 固化协作基础。
- 对导航图标完成低风险体积优化；持续使用 npm typecheck、test、build 和浏览器分层验收。
- Phase Four 知识库 MVP 已完成首版：统一 Fragment/Article、普通搜索、账号隔离、Markdown 安全渲染、版本/评论、独立发布令牌和 dry-run 迁移入口。

# Next

- 进入 Phase Five：先评估 Note Board / Daily Report → Knowledge Fragment 的单向入口，再设计跨 `chat.db` 与 `schedule.db` 的日程关联校验。
- 在实际修改某个领域时，按增量方式从 server/index.ts 提取对应 router，并保持初始化、认证和测试边界。
- 先建立不依赖真实账号的 UI fixture，再评估把项目级 smoke test 纳入 CI。

# Later

- Note → Knowledge Fragment。
- Daily Report → Knowledge Fragment。
- Ctrl + K 全局搜索日程、记事、日报和知识。
- 文章收藏、附件和更完整的版本 diff。

# Ideas

- AI 辅助整理为草稿，必须用户确认后保存。
- 知识来源引用、段落级摘要和跨项目阅读入口。
- 有实际数据证明普通搜索不足后，再评估 embedding、hybrid search、reranker 和 RAG。

# Won't Do

- Google Docs 式实时协作、CRDT 和多人实时编辑。
- 本地 Markdown 与服务器正文双向同步。
- 向量数据库、RAG 或自动 AI 覆盖原知识，直到普通知识库稳定且有真实使用需求。
- 自动网页抓取、浏览器插件、复杂富文本编辑器、公共知识社区和无限层级文件夹。
- 为了形式一次性重写整个 server/index.ts 或建立复杂 Search Service。
