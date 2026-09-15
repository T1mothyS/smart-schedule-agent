# Cloud 日报生成与发布排障手册

- Status: RUNBOOK
- Scope: 本文列明的源码结构、合同或验证方法；历史证据按时点使用。
- Last verified commit/version: `8854a38` / `0.21.0-260915.0924`（2026-09-15，源码核对）。
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
