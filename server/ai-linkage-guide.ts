export const AI_LINKAGE_GUIDE_VERSION = 'ai-linkage-2026-09-09.1';

export interface AiLinkageGuideItem {
  id: string;
  title: string;
  purpose: string;
  configuration: string;
  steps: string[];
  test: string;
  commonFailures: string[];
  boundary: string;
}

export interface AiLinkageRule {
  id: string;
  title: string;
  rule: string;
}

export interface AiLinkageExample {
  title: string;
  prompt: string;
  expected: string;
}

export const AI_LINKAGE_GUIDE_ITEMS: AiLinkageGuideItem[] = [
  {
    id: 'codebuddy',
    title: 'CodeBuddy API Key 与 Base URL',
    purpose: '为日程助手、普通 AI 对话和结构化导入提供当前账号的模型调用凭据。',
    configuration: '登录后进入“设置 → AI 设置”，只保存当前账号的 API Key 与可选 Base URL；页面不会显示完整 Key。',
    steps: ['在 CodeBuddy 的密钥管理页创建 API Key。', '回到“设置 → AI 设置”粘贴 Key，只有需要自定义网关时再填写 Base URL。', '点击“验证 API Key”，再用一条不涉及写入的查询测试日程助手。'],
    test: '设置页的“验证 API Key”；日程助手的“今天有什么安排”只读查询。',
    commonFailures: ['Key 已撤销、过期或权限不足。', 'Base URL 多了路径、协议不正确或与账号环境不匹配。', '管理员共享 Key 未配置时，普通账号不能自行修复共享凭据。'],
    boundary: 'Key 只在账号级安全存储中使用，不会进入提示词、日报、日志、导出或本指南接口。',
  },
  {
    id: 'open-meteo',
    title: 'Open-Meteo 天气与常驻地点',
    purpose: '提供地点搜索和天气预报；Open-Meteo 不需要 API Key。',
    configuration: '登录后进入“设置 → 通知与提醒”，搜索并保存常驻城市或区县；只保存名称、坐标和时区。',
    steps: ['在常驻地点输入至少两个字符并选择搜索结果。', '保存后，日报天气和未指定地点的 AI 天气问题会使用该地点。', '天气请求失败时按实时请求、有限重试、新鲜缓存、同地点同日期过期缓存的顺序降级。'],
    test: '设置页的地点搜索；AI 输入“查询我常驻地今天的天气”。',
    commonFailures: ['地点搜索网络超时或 Open-Meteo 返回限流/服务错误。', '未保存常驻地点且问题中没有明确地点。', '过期缓存超过 6 小时后只能明确提示天气暂不可用。'],
    boundary: '天气由受控服务返回；AI 不允许根据模型记忆猜测实时天气，缓存结果会标注“仅供参考”。',
  },
  {
    id: 'smtp-163',
    title: '163 SMTP 发件配置',
    purpose: '发送验证码、每日摘要、周期提醒和日报邮件。',
    configuration: '仅在服务端 `.env` 配置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER` 和 `SMTP_PASS`；用户页面只设置收件邮箱。',
    steps: ['在 163 邮箱后台开启 SMTP 并创建客户端授权码。', '在服务端配置文件填写授权码，保持发件账号与官方发件邮箱一致。', '重启服务后先检查 `/api/health` 与管理员日志，再使用周期提醒页面的测试邮件。'],
    test: '周期提醒页面的“测试邮件”；这是实际发信操作，应只对测试收件邮箱使用。',
    commonFailures: ['把网页登录密码当作客户端授权码。', 'SMTP 主机、端口、TLS 或官方发件账号不一致。', 'SMTP accepted 只代表传输层接受，不代表收件箱最终到达。'],
    boundary: 'SMTP 密钥只在服务端配置中使用，不能写入前端、提示词、日志、文档或 Git。',
  },
  {
    id: 'qq-imap',
    title: 'QQ IMAP 未读邮件读取',
    purpose: '为日报邮件简报读取当前账号 QQ 邮箱的未读摘要，不修改已读状态。',
    configuration: '登录后进入“设置 → 日报邮箱（QQ）”，填写 QQ 邮箱和客户端授权码；授权码加密保存，页面不会再次显示。',
    steps: ['在 QQ 邮箱后台开启 IMAP 并生成客户端授权码。', '在设置页保存账号和授权码，按需启用日报读取。', '点击“测试读取”，确认只返回未读摘要和数量。'],
    test: '设置页的“测试读取”按钮。',
    commonFailures: ['未开启 IMAP 或授权码错误。', '服务器缺少邮箱凭据加密密钥。', 'QQ 邮箱安全策略暂时拒绝登录或网络无法访问 `imap.qq.com:993`。'],
    boundary: '授权码不会返回给前端，也不会进入日报、AI 提示词、日志或知识库。',
  },
  {
    id: 'daily-report-token',
    title: '日报发布令牌',
    purpose: '让独立日报 V2 按当前账号读取日程/邮件摘要、上传已校验媒体并发布日报。',
    configuration: '登录后进入“设置 → 日报集成”生成或轮换令牌；明文只显示一次。',
    steps: ['生成令牌并立即复制到本地日报项目的忽略配置。', '先用日报 V2 的 `-NoSend` 和本地验证流程检查结构与媒体。', '只在校验通过后调用日报读取、媒体上传和发布接口。'],
    test: '设置页查看令牌状态；日报 V2 的本地 `-NoSend`/接口健康检查。',
    commonFailures: ['令牌已撤销、轮换或不属于当前账号。', '媒体未先托管到 AI Calendar，日报发布被拒绝。', '把 `PUBLISHED`、`QUEUED` 或 SMTP accepted 误认为收件箱最终到达。'],
    boundary: '令牌是日报专用最小权限凭据，不能修改日程、读取授权码或访问其他账号数据。',
  },
  {
    id: 'knowledge-library-token',
    title: 'Knowledge Library 发布令牌',
    purpose: '让本地 Knowledge Library V2 发布和更新已校验的 Markdown、关系和生命周期操作。',
    configuration: '登录后进入“设置 → 知识库集成”生成或轮换令牌；服务器只保存哈希。',
    steps: ['生成令牌并只保存在本地 Knowledge Library 的忽略配置或当前 PowerShell 会话。', '先运行 `-DryRun`，检查 `source-manifest.json`、`relations.json` 和校验报告。', '普通发布通过校验后执行 `publish`；`retire`、`restore`、`purge` 必须单独选择。'],
    test: '设置页令牌状态；本地批次的 `-DryRun` 和发布报告检查。',
    commonFailures: ['令牌被撤销或目标账号不匹配。', 'sourceId、关系目标或批次内容不完整导致校验失败。', '把令牌放入命令行参数、报告、日志或 Git。'],
    boundary: '服务器只读呈现、评论和导出；正文、关系和生命周期的唯一编辑源是本地 Knowledge Library。',
  },
  {
    id: 'oss-backup',
    title: 'OSS 私有备份',
    purpose: '把本地加密系统快照复制到私有 OSS，作为离机灾备，不参与普通用户读取。',
    configuration: '仅在服务端 `.env` 配置 `BACKUP_ENCRYPTION_KEY`、`OSS_BUCKET`、`OSS_ENDPOINT`、`OSS_ACCESS_KEY_ID` 和 `OSS_ACCESS_KEY_SECRET`。',
    steps: ['为备份加密和 OSS RAM 用户分别创建独立的最小权限凭据。', '先验证本地加密快照可生成，再由管理员备份入口触发上传。', '保留未上传的本地快照；上传失败会进入重试，不删除唯一副本。'],
    test: '管理员备份入口和管理员日志；测试应使用隔离环境或明确的测试 Bucket。',
    commonFailures: ['缺少独立的备份加密密钥或 OSS 四项配置。', 'Bucket、Endpoint、签名或 RAM 权限不匹配。', '误把私有备份当成可公开访问的文件地址。'],
    boundary: 'OSS 凭据只在服务端签名请求中使用；备份内容保持加密，前端和 AI 不读取备份密钥。',
  },
  {
    id: 'imap-import',
    title: '163 IMAP 自动导入',
    purpose: '可选地轮询官方 163 邮箱转发邮件，生成待确认的 AI 导入草稿。',
    configuration: '仅在服务端 `.env` 配置 `IMAP_HOST`、`IMAP_PORT`、`IMAP_USER` 和 `IMAP_PASS`，并在邮箱导入页面启用当前账号设置。',
    steps: ['在 163 邮箱后台开启 IMAP 并准备客户端授权码。', '配置服务端 IMAP 变量，重启后台任务后在邮箱导入页面启用。', '查看管理员日志中的导入轮询结果；草稿必须人工确认后才写入。'],
    test: '邮箱导入设置页的启用状态和管理员日志；不会自动把邮件变成正式日程。',
    commonFailures: ['服务端没有 IMAP 授权码或后台任务未启用。', 'Message-ID/发件人规则不匹配，邮件被跳过。', 'AI 识别失败或置信度不足，草稿停留在待确认状态。'],
    boundary: '自动导入只生成结构化草稿；日期、周期、金额和操作都必须经过用户确认，授权码不会进入 AI。',
  },
];

export const AI_LINKAGE_RULES: AiLinkageRule[] = [
  { id: 'real-schedule-data', title: '日程事实优先', rule: '查询、修改和删除日程必须依赖系统提供的真实数据；模型不能凭记忆补造标题、时间、地点或 ID。' },
  { id: 'write-confirmation', title: '写入先确认', rule: '创建、修改、删除日程和创建周期事务都先生成可编辑计划，只有用户明确确认后才写入正式数据。' },
  { id: 'controlled-weather', title: '天气走受控服务', rule: '天气问题只能使用 Open-Meteo 服务或带来源标记的缓存；请求失败时明确不可用，不允许模型凭记忆猜测。' },
  { id: 'structured-import', title: '导入结构化', rule: 'AI 导入必须输出结构化 JSON、日期/周期字段和逐字段 confidence；不确定字段降低置信度并写入 warnings。' },
  { id: 'scope-boundaries', title: '联动边界', rule: '记事送入对话不等于自动写入；日报只使用专用只读/发布令牌；Knowledge Library 由本地 Markdown 和关系清单维护，网页只读呈现。' },
];

export const AI_LINKAGE_EXAMPLES: AiLinkageExample[] = [
  {
    title: '只读查询日程',
    prompt: '查询今天的安排，只根据系统提供的真实日程回答；如果没有加载到日程数据，请明确说明，不要猜测。',
    expected: '只读查询，不生成写入计划。',
  },
  {
    title: '创建周期事务',
    prompt: '每月 20 日提醒我缴房租，周期提醒默认使用 Asia/Shanghai 12:00。请先给出待确认计划，不要直接写入。',
    expected: '生成可编辑周期计划，确认后才创建；用户仍可把提醒时间改成其他合法时间。',
  },
  {
    title: '受控天气查询',
    prompt: '查询上海今天的天气。只使用系统天气服务；如果返回的是缓存，请明确标注“使用缓存，仅供参考”，不要自行推断降雨。',
    expected: '走 Open-Meteo 受控天气链路，不使用模型记忆补全实时事实。',
  },
  {
    title: '账单图片导入',
    prompt: '请把这张账单识别为待确认的周期事务，输出结构化字段、每个关键字段的 confidence 和需要我核对的 warnings。不能确定的日期不要编造。',
    expected: '生成结构化草稿；确认前不创建周期事务。',
  },
];

export const AI_LINKAGE_SYSTEM_RULES = AI_LINKAGE_RULES
  .map((item, index) => `${index + 1}. ${item.rule}`)
  .join('\n');

export const AI_IMPORT_LINKAGE_RULES = [
  '只输出结构化 JSON，不输出 Markdown；不能确定的日期、周期或标题必须降低 confidence 并写入 warnings。',
  '周期事务确认后默认使用 Asia/Shanghai 12:00 作为 reminderTime；一次性日程的 dueTime 仍按识别到的具体时间处理。',
  '导入只生成待确认草稿，不能绕过用户确认直接创建日程或周期事务。',
].join('\n');

export function getAiLinkageGuides() {
  return {
    version: AI_LINKAGE_GUIDE_VERSION,
    title: 'AI Calendar 接入与联动指南',
    items: AI_LINKAGE_GUIDE_ITEMS,
    rules: AI_LINKAGE_RULES,
    examples: AI_LINKAGE_EXAMPLES,
  };
}
