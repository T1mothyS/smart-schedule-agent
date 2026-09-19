# Cloud 日报生成与发布排障手册

- Status: RUNBOOK
- Scope: 本文列明的源码结构、合同或验证方法；历史证据按时点使用。
- Last verified commit/version: `0.27.2-260919.1711`（2026-09-19，媒体诊断与完整模板隔离测试）。
- Authority: 当前源码与自动化验证优先；文档职责见文档索引。
- Update trigger: 本领域 API、数据归属、媒体策略或验收入口变化。
- Supersedes: 原文中已纠正的漂移描述；保留历史快照时间边界。
- Do not use for: 推断当前生产部署、Work 配置或邮件收件箱状态。

本手册用于诊断生成端与服务端合同不一致。历史问题是定时提示遗漏邮件简报、金融与市场及观察名单；历史运行状态见 [Cloud 文档的快照区](CHATGPT-WORK-CLOUD.md#cloud-run-history)。修正实际云端提示词与可执行解析/渲染测试必须一起交付，不能只部署校验器。本手册不证明当前 Work 提示或生产版本已同步。

- V2 的 `prompts/cloud_scheduled_task.md` 是完整定时提示源，插件副本为 `references/scheduled-task.md`。服务端合同以 `server/daily-digest-contract.ts` 和 `read_inputs.markdownContract` 为准；Prompt 版本与服务端合同版本分别核对，不从历史版本号推定当前一致。
- 修改后须在实际云端任务保存并重新打开核对版本、全文及原频率，不能把本地文件更新视作云端已同步。
- 在 `DAILY_REPORT_V2_ROOT` 指向相应 V2 checkout 后运行 `npm run test:cross-project`。测试使用提示内的完整示例，经过生产解析器、完整性闸门以及 HTML/纯文本渲染，覆盖两封邮件、市场和两项观察对象。
- Cloud 发布仅托管正文明确提供的图片/来源图标，不根据来源名称自动访问 favicon。无 `mediaBatchId` 时逐图 Best Effort，失败项降级为空图片位并返回 `candidateImageCount`、`mediaFailureCount`、`mediaFailures`；当前兼容代码允许成功图片数为零，不能把它描述为完整媒体成功。带批次时必须满足 READY、账号/日期/运行归属和完整媒体校验，不能套用兼容降级。两条路径均保持正文完整性硬闸门。
- 生产 Shadow 可用明确标注的结构测试夹具验证合同；这不代表真实新闻生成或真实邮件投递验收。必须显式 `dry_run=true`，并核对历史未新增。
- 真实补发及收件箱验收分开记录。旧日报缺失的内容不会由模板修复追溯补齐。

残余风险：公开图片可能失效，兼容路径如实记录降级，严格批次失败则阻止发布；模型遗漏内容仍由完整性闸门阻止；定时提示是独立保存的配置，必须核对运行端。`dry_run=true` 不写日报或邮件队列，但兼容媒体托管可能写文件。正式发布、SMTP 和收件箱分别验收。

## 连续无图的定位顺序

先取对应运行回执的 `candidateImageCount`、`imageCount`、`mediaFailureCount` 和 `mediaFailures`，再看正式正文/渲染 DOM，不只看 PUBLISHED：

| 证据 | 优先排查 |
|---|---|
| 候选 0，成功 0，失败 0 | 生成端未提交图片；检查运行提示和实际选图步骤 |
| 候选大于 0，成功 0，有失败明细 | MIME、签名、SSRF、下载或上传失败，按具体原因处理 |
| 旧版有图，后续 UPDATED 无图 | 同日正文被更新；不是浏览器自动丢图 |
| 正文包含图片，但 DOM 没有 | 解析/渲染规则 |
| DOM 有图片但 naturalWidth 为 0 | 图片 URL、网络、权限、响应类型和 CSP |

本地 0.27.2 起，新正文版本保存有界媒体统计，具体字段、重试与恢复语义见 [Cloud 合同](CHATGPT-WORK-CLOUD.md#markdown-合同与解析诊断)。旧版本、dry-run 和未变正文的后续尝试不补写历史统计；仍需区分工具回执与任务摘要。不得将“日志没找到”当成“从未失败”。修改运行中的定时提示需授权并回读核对，不能自动重发历史或发送邮件。
