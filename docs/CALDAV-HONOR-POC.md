# AI Calendar × 荣耀 CalDAV：研究与 POC

- Status: RESEARCH / PUBLIC-POC-VERIFIED，荣耀真机 NOT TESTED
- Scope: 合成日程的独立 CalDAV 服务；不连接正式数据库、不实现生产同步。
- Baseline: `010a2b3` / `0.22.0-260917.2044` 源码调查，2026-09-18。
- Authority: 源码、隔离测试、带日期的真机证据；官方说明仅证明列明范围。
- Update trigger: 真机结果、运行依赖、部署路径或接入架构变化。
- Do not use for: 认定荣耀双向支持、后台提醒可靠或正式同步已上线。

## 目标与研究结论

用户选择首期 AI Calendar → 荣耀日历单向显示/提醒，保留未来双向能力。用户报告设备为荣耀 Magic7 标准版、MagicOS `10.0.0.175`，能看到 CalDAV 登录入口；日历应用版本待真机测试补记。

[荣耀配置说明](https://www.honor.com/cn/support/content/zh-cn15893090/)介绍用户名、密码和服务器地址，但页面适用产品有限，不能外推为本机型所有协议行为已确认。[Radicale 官方文档](https://radicale.org/v3.html)提供 WSGI、认证和权限接口；本 POC 使用固定 `3.8.0` 版本。[RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html)为日历数据语义依据，[RFC 4791](https://www.rfc-editor.org/rfc/rfc4791.html)为 CalDAV 协议依据。

**当前结论：服务端方案具备继续真机试验的条件；尚未达到正式同步开发门槛。** 本地协议客户端不是荣耀客户端。优先候选是成熟服务加单向桥接，避免第一阶段承担整个协议栈，但最终选择依真机与维护成本证据确定。

## 当前项目字段与缺口

主要证据：`server/schedule-store.ts`、`server/schedule-input.ts`、`src/components/calendar/ScheduleFormModal.tsx`；通知语义补充见 `server/notification-scheduler.ts`，周期事务见 `server/reminder-calendar-sync.ts`。

| 当前数据/行为 | iCalendar 对应与研究建议 | 缺口或约束 |
|---|---|---|
| `id`、`user_id`、`calendar_id` | 稳定 UID；按账号与选定日历投影集合 | 需独立同步映射，不能把跨账号 ID 当权限判断 |
| `title`、`description`、`location`、`notes` | SUMMARY、DESCRIPTION、LOCATION | 表单主要填写 notes；正式设计需明确 notes/description 合并与往返保留 |
| `start_time/end_time` 字符串 | DTSTART/DTEND | 网页存无偏移本地时间，其他入口可存 ISO；不能一律当 UTC |
| 账号提醒时区/APP_TIMEZONE | 无偏移时间解释依据，输出 TZID 或 UTC | Schedule 无事件级 timezone；禁止依服务器 OS 时区猜测 |
| `all_day` | DATE 类型，DTEND 不含结束当天 | 网页全天用当天零点且无 end；单日可映射为次日排他结束，多日/历史值需单独确认 |
| 缺少 end_time | 根据事件语义处理，不能擅自补一小时 | 非全天无结束时间在标准与手机显示间需验证 |
| `is_repeated/repeat_rule` | 候选映射 daily/weekly/monthly → RRULE | 字段仅字符串，没有完整次数、终止、例外模型；当前检索未发现这些字段驱动标准系列展开 |
| `reminder-linked` | 不作为 RRULE 输出 | 周期事务生成的对象为 todo，首期排除 |
| `reminders: string[]` | 表单分钟数字可映射 DISPLAY VALARM | API 只校验数组及长度，任意历史字符串不能直接转分钟；无提醒与零分钟须区分 |
| 高优先级邮件提醒 | 与手机提醒分开验证 | 邮件调度按高优先级/窗口筛选，跳过全天，不等同于逐条 reminders 的 VALARM |
| `created_at/updated_at` | CREATED/LAST-MODIFIED 的候选来源 | 无独立 revision；时间戳不能直接当可靠 ETag，ETag 应绑定确定性表示 |
| DELETE 直接删除行 | 同步端删除/消失检测 | 无 tombstone/change journal；需持久化映射与完整快照成功标记 |
| `type/is_unscheduled` | 首期仅已排期 event | 排除 todo、未排期、周期事务和 AI 草稿 |

额外边界：当前 `GET /api/schedules` 会触发周期事务日历同步；正式桥接不应把这个入口当纯读导出。应提供有账号权限的纯读投影，在主应用唯一进程内部读取，禁止外部 Python 进程直接打开或修改 sql.js 文件。

## 路线比较与后续设计约束

| 维度 | 成熟 CalDAV 服务 + 单向桥接（优先候选） | 主应用内 CalDAV 适配 |
|---|---|---|
| 协议兼容 | 服务提供发现、REPORT、ETag、日历格式校验 | 自行承担 WebDAV/XML/发现/条件写入和兼容测试 |
| 部署维护 | 增加独立轻量服务、凭据、备份；两份表示 | 少一个进程，但 Node 项目引入协议栈与持续维护 |
| 单向删除/重试 | 需稳定映射、幂等写入、成功快照与差异删除 | 仍需 ETag、同步 token 与删除变更追踪 |
| 账号隔离 | 桥接拥有写权限，手机只读；账号与集合映射 | 独立应用密码、撤销、最小权限；复用业务所有权验证 |
| 重复/例外 | 服务可存储标准数据，但无法自动弥补源模型缺口 | 必须同步补充领域语义；不可只改序列化 |
| 双向扩展 | 增加回写、冲突、回环避免和字段保留 | 共用领域服务，但协议写入同样需要冲突及保留策略 |

正式首期必须保持主应用为唯一数据源，使用只读手机凭据；同一 UID 更新不重复创建；网络错误不删除；只删除桥接拥有且本次完整源快照确认消失的对象。任意不支持的语义明确显示，不能静默转换。双向暂不启用，不开放新的业务 API、不迁移 Schedule schema。

## 隔离实现与本地证据（2026-09-18）

运行与部署模板见 [POC 操作说明](../infra/caldav-poc/README.md)。依赖固定为 Radicale `3.8.0`、Waitress `3.0.2`、bcrypt `4.3.0` 及锁定的传递依赖，Windows Python `3.12.7` 进行本地测试。9 个合成资源通过独立解析器校验。

| 验证内容 | 结果 | 证明边界 |
|---|---|---|
| XML 实体拒绝、日志允许字段、请求体保持/大小上限、URL 限制 | PASS | 不记录测试注入的认证/内容/未知路径 |
| UTF-8、75 octet folding、全天排他结束、重复例外 | PASS | 样例语法与结构，不是手机呈现 |
| principal、home、calendar discovery、calendar-query | PASS | Python 客户端与真实 Radicale HTTP |
| 只读账号创建/修改/删除拒绝、集合删除/创建拒绝 | PASS | 403，拒绝后仍能读取且 ETag 不变 |
| 匿名与其他账号隔离 | PASS | 401/403，不能访问目标日程 |
| 写账号创建/修改/删除、过期 ETag | PASS | 成功更新与删除，旧条件返回 412 |
| 可写测试日历、calendar-multiget、sync-collection | PASS | 服务支持探测，不是荣耀实际使用证据 |
| 重复 seed、服务重启 | PASS | 原对象保留、无覆盖，重启后对象/ETag 保留 |
| 公网 TLS、Nginx 路径、Linux systemd | PASS（2026-09-18） | 独立服务已部署；HTTPS 路径、认证边界、loopback-only 监听和资源限制已验收 |
| 荣耀同步、只读体验、提醒触发、24 小时稳定性 | NOT TESTED | 等待用户真机参与 |

本地集成测试只持有随机临时凭据，日志另检验明文及 Basic Base64 均未出现。第一次启动发现 Windows 默认编码不能读取中文配置路径，使用进程级 UTF-8 修正；第一次集合创建返回 409，确认为父集合尚未创建，修正 writer 初始化而不增加 reader 权限。失败现场仅保留在临时目录。

服务器只读预检确认 Linux/Python/Nginx 路线可继续准备，没有 Docker，缺少 ensurepip；具体资源、域名、证书、连接参数和回滚现场仅记入本机 runbook。2026-09-18 已完成隔离 POC 部署：systemd 服务 active 且未 enable，5232 仅 loopback 监听；公网无凭据 PROPFIND 返回 401，`poc-reader` discovery/calendar-query 通过并读取 9 个合成资源，四账号 cycle 的 CRUD、只读、越权和 ETag 检查通过；主站 health/home 保持 200，服务日志敏感模式计数为 0。上述结果不包含荣耀真机行为或提醒可靠性。

## 真机执行表与判定

测试前填写：日历 App 版本、实际服务 URL（只放本机记录）、服务版本、测试日期、账号类型。清晰标注本机报告和实际观察的来源。

1. 先添加 `poc-reader`：填写实际 HTTPS `/caldav-poc/` 入口。核对测试日历名称，手动刷新并记录首次出现耗时。专用路径不占用主站 `/.well-known/caldav`；若根地址发现不可用，记录实际可用 URL，不归咎于客户端。
2. 检查普通、全天、跨午夜、中文/长文本、时区；修改/删除测试服务上的专用临时事件，分别记录手机更新和删除延迟。使用测试日历，不改手机已有个人日历。
3. 尝试编辑只读事件：记录 UI 是不可编辑、拒绝还是本地副本；再次同步后检查无重复、无卡住，不把服务器 403 等同于良好手机体验。
4. 安排未来事件并等待提醒实际弹出；记录同步完成时间、触发时间、通知权限、锁屏/省电状态。显示 VALARM 与实际提醒分别验收。
5. 观察至少 24 小时，记录手动与后台的延迟，覆盖锁屏、离线恢复、网络切换、服务重启、重连及删除不复活。后台延迟仅报告实测分布，不承诺推送实时性。
6. 再添加 `poc-phone` 做双向预研：新建/修改/删除、重复整组和单次例外。失败不自动阻断单向目标，但必须写明限制。

| 真机项目 | 状态 | 证据要求 |
|---|---|---|
| 登录/发现/服务器 URL | NOT TESTED | 操作时间 + 归一化方法路径/状态 |
| 服务端创建/修改/删除 → 手机 | NOT TESTED | 两端操作和呈现时间，无重复 |
| 只读 UI 与拒绝后的继续同步 | NOT TESTED | 手机结果 + 服务端权限证据 |
| 时间、全天、跨日、时区 | NOT TESTED | 源值与手机显示对照 |
| 提醒显示/锁屏实际触发 | NOT TESTED | 两项分别记录 |
| 后台 24h、断网/重启恢复 | NOT TESTED | 日期、网络、延迟与错误 |
| 手机写入/重复/例外 | NOT TESTED | 独立可写日历 + 合成 VEVENT 差异 |

协议调查填写“观察到 / 未观察到 / 无法判断”：OPTIONS、PROPFIND、REPORT、GET、PUT、DELETE，principal/home/collection 属性，calendar-query/multiget/sync-collection，If-Match/If-None-Match。Python 探测与手机请求按时间分开；未观察到不能写成不支持。默认日志只保留 XML 元素名，复杂的 UID/RECURRENCE-ID 往返差异使用独立合成日历的授权读取，不收集真实个人日程。

## 阶段门槛与交接

- 当前已完成：源码映射、路线比较、隔离运行代码、协议/脱敏测试、服务器只读预检、离线部署、Nginx 路径和公网协议验收。
- 下一步：使用 `poc-reader` 执行荣耀手机登录、发现、只读呈现、更新删除和提醒测试；完成后再决定是否进入正式单向接入设计。
- 放行条件：连接、普通/全天更新删除、只读体验、时区和实际提醒通过；后台观察无数据破坏或无法恢复问题，延迟如实记录并确认满足使用需求。
- 未通过时：记录 FAIL/PARTIAL 与可复现证据，先排除配置/网络，再决定替代服务或接入方式；不自动改 Radicale、不擅自接入真实数据。
- 研究结束后：提交正式单向接入实现设计，再实施；未来双向另立阶段。

风险集中在手机后台调度/省电、重复与时区语义、两份表示的一致性。隔离试验和只读首期分别降低破坏风险，不能消除未经真机验证的不确定性。
