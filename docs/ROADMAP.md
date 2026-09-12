# AI Calendar Roadmap

本路线图只记录当前阶段顺序和明确边界。新需求先判断属于哪个区段，再单独确认范围，不把未来想法混入当前实现。

# Now

- 保持 Settings V2 稳定，沿用统一的 Section、Row、Dialog 和窄屏验收。
- 使用可提交的 AGENTS.md、架构/UI/测试文档和 GitHub Actions CI 固化协作基础。
- 对导航图标完成低风险体积优化；持续使用 npm typecheck、test、build 和浏览器分层验收。
- Phase Four 知识库 MVP 已完成首版；当前改造为 Phase Four V2 链路：知识库 V2 本地加工、关系清单、服务器只读呈现、评论、版本、全库导出和隔离发布验收。
- 阶段 A 已完成：GitHub CI 只运行主项目内服务契约测试，真实日报 V2 通过显式本地跨项目命令验证。
- 阶段 C 已完成本地实现：AI 对话移动端结构、NoteBoard 独立入口/未完成角标、输入区和管理员面板响应式布局已按 Settings V2 风格复核。
- 阶段 D 已完成本地实现：统一只读搜索覆盖日程、NoteBoard、Daily Report、Knowledge Library，日程结果支持日期和详情直达；AI 对话已接入当前账号 active 知识库的轻量词法检索，并展示来源卡片。
- 阶段 B 已完成自动化故障矩阵和本地回归合同；连续三次实际运行、受控生产发布和收件箱到达仍保留为后续分层验收，不在本轮自动触发。

# Next

- 在明确授权且准备好隔离/生产证据后，观察至少三次日报实际运行、至少两个日期，并单独记录 notification、queue、SMTP accepted、provider feedback 和 inbox arrival。
- 继续按现有本地预构建、备份、原子切换、health/静态资源和回滚规则做生产发布，并分层记录邮件内容、SMTP 接受和收件箱到达证据。
- 根据真实搜索数据量和响应时间再决定是否增加索引；当前 AI 检索保持词法匹配，不引入向量库、Embedding、RAG 或外部搜索服务。

# Later

- 文章收藏、附件和更完整的版本 diff。

# Ideas

- AI 辅助整理为草稿，必须用户确认后保存。
- 更精确的知识来源引用、段落级摘要和跨项目阅读入口。
- 有实际数据证明普通搜索不足后，再评估 embedding、hybrid search、reranker 和 RAG。

# Won't Do

- Google Docs 式实时协作、CRDT 和多人实时编辑。
- 本地 Markdown 与服务器正文双向同步。
- NoteBoard 或 Daily Report 自动单向生成 Knowledge Fragment；两者继续在各自本地流程维护并上传到各自目标系统。
- 向量数据库、RAG 或自动 AI 覆盖原知识，直到普通知识库稳定且有真实使用需求。
- 自动网页抓取、浏览器插件、复杂富文本编辑器、公共知识社区和无限层级文件夹。
- 为了形式一次性重写整个 server/index.ts 或建立复杂全文搜索服务。
