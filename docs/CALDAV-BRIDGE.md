# CalDAV 单向桥接：手动试点合同

- Status: CONTRACT / CONFIGURED-WRITE-ON-MANUAL / PRODUCTION PILOT，主应用桥接已绑定单个账号的单个日历；写入仅由获授权的手动预览/确认调用触发，没有自动 worker；首个批次已创建 25 条资源。
- Scope: 一个明确绑定账号、明确选择日历的 AI Calendar → CalDAV 手动投影。
- Baseline: 基于 `0.23.1-260918.2350` 的桥接兼容修正；具体提交/版本以 Git 和 package.json 为准。
- Authority: `server/caldav-projection.ts`、`server/caldav-bridge.ts`、`server/routes/caldav.ts` 与测试。
- Update trigger: 字段映射、认证、状态文件、接口、部署开关和真机结果变化。
- Do not use for: 宣称自动后台同步、双向同步、实际手机提醒或生产连接已验收。

## 评估结论与边界

[用户测试报告](CALDAV-HONOR-POC-TEST-REPORT-20260918.md)支持“普通/全天/跨日及简单重复的手机呈现可行”。但其中公网 cycle 证明的是协议客户端 CRUD，不能替代“手机已经收到修改和删除”的证据；手机只读 UI、实际提醒与后台稳定性仍不完整。报告对例外的限制意味着**未知/未确认**，不是已查明荣耀缺陷。

本次允许推进本地桥接实现和合成验证；真实数据及常驻自动化的放行门槛仍保留。首期选用成熟 Radicale 加应用进程内桥接，不自研 CalDAV 服务，不让外部 Python 打开 sql.js。没有新增定时 worker 或设置 UI；用户日程不会因部署代码而自动外发。

## 配置与 API

`.env.example` 给出开关；实际值只进入忽略配置或安全环境变量，不进入文档/日志。需要重启主应用进程以加载新的绑定：

| 配置 | 含义 |
|---|---|
| `CALDAV_BRIDGE_ENABLED` | 默认 false；启用仅开放手动接口 |
| `CALDAV_BRIDGE_WRITE_ENABLED` | 默认 false；true 才允许确认后写入 |
| `CALDAV_BRIDGE_USER_ID` | 唯一账号；JWT 当前用户必须完全匹配 |
| `CALDAV_BRIDGE_CALENDAR_IDS` | 逗号分隔的实际日历 ID，必须均属于该账号；1–10 个，不接受“全部” |
| `CALDAV_BRIDGE_COLLECTION_URL` | 已建立的目标集合 HTTPS URL，末尾 `/`；不含账号、查询或 fragment，不自动创建集合 |
| `CALDAV_BRIDGE_USERNAME/PASSWORD` | 独立写账号凭据；不复用手机只读密码或主应用登录密码 |
| `CALDAV_BRIDGE_TIMEZONE` | 无偏移源时间的显式解释；首期仅 Asia/Shanghai、Asia/Hong_Kong、UTC，默认上海 |
| `CALDAV_BRIDGE_ALARMS_ENABLED` | 默认 false；仅在明确测试提醒时启用 |
| `CALDAV_BRIDGE_INCLUDE_COMPLETED` | 默认 false；完成的源日程不投影到手机，但不会从网页源库删除；仅在明确需要历史镜像时设为 true |

API 复用 Bearer JWT 和当前账号检查；只读日报令牌及网页 Cookie 都不能授权。没有接收用户提供的上游 URL/账号/password 的 API，避免跨账号改目标。两接口受 30 次/分钟速率限制；维护模式拒绝执行。

当前实现没有 CalDAV 设置、预览或确认同步按钮；`preview`/`sync` 由受控手动试点调用。这是为了先验证真实数据、删除边界、ETag 冲突和手机呈现，不是最终产品交互。当前网站侧的“出行/工作/社交/生活/健康/其他”是日程分类，不是 `个人/工作/家庭` 日历选择器；产品化前必须将两者分开呈现。

- `POST /api/integrations/caldav/preview`，body `{}`：返回 `mode: manual-pilot`、`writeEnabled`、`planToken`、`operations`、`issues`、`excluded`。预览完整读取源与已知目标资源，不写本地状态、不写 CalDAV。仅返回归属当前用户的 sourceId/资源键与操作，不返回凭据或日程正文。
- `POST /api/integrations/caldav/sync`，body `{ "planToken": "预览结果" }`：重新检查源、状态和远端 ETag，计划仍完全匹配且写开关启用才执行。成功返回 `applied: true`。预检查发现变化返回 409；上游条件写入冲突返回 502/CALDAV_CONFLICT。排查后重新预览，不自动覆盖。
- 操作包括 `create/update/delete/unchanged/recover`；被排除的类型不会投影。原来已投影但后来删除、变为 todo 或未排期的事件，将在下一次预览列为 delete，需再次确认。
- 不支持的事件生成 `issues` 并令 `planToken` 为空，整个批次不执行，避免把转换失败视为源删除。`ALARMS_DISABLED` 是可继续的显式提示：日程同步，但手机提醒未同步。
- 关闭功能返回 404；未登录 401；其他用户/写开关关闭 403；输入错误 400；上游网络/协议失败 502；内部持久化/配置问题 503。错误只返回固定代码，不输出上游响应体或请求头。

## 映射与范围

- 仅 `type=event` 且已排期；默认不投影已完成日程，不投影 todo、周期事务、AI 草稿。按实际日历 ID 选择，不调用会同步周期事务的 GET schedules 或会初始化默认项的 getAllCalendars。todo 不是普通事件，若以后纳入需单独实现并验收 VTODO。
- UID/文件名由账号、日历、事件 ID 的确定性 SHA-256 生成。标题、备注变化保持同一 UID；跨日历移动会显示为旧投影撤回、新投影创建，预览明确列出。
- 支持 2000 年起的普通/跨午夜事件，明确偏移或 UTC 保持时间点，无偏移时间按配置解释后输出 UTC。首期不处理 DST 时区或历史时区变更；不猜服务器 OS 时区。
- 全天只支持现有 UI 的单日格式（日期或本地零点、无结束时间），输出 DATE 与次日排他 DTEND。历史多日/带偏移的全天格式明确阻断，需确认源语义后扩展。
- 普通事件没有结束时间时，源数据库保持不变；桥接输出按网页表单默认补一个 60 分钟的 `DTEND`，避免部分手机隐藏 start-only 事件。结束早于或等于开始仍阻断。
- `daily/weekly` 对应无终止 RRULE，因为现有源模型没有 COUNT/UNTIL；不将 POC 的 3 次样例约束伪造到业务数据。持续重复的手机表现要再次验收。monthly、复杂 RRULE、EXDATE/RECURRENCE-ID 均不支持。
- `description` 与 `notes` 非空时以空行连接到 DESCRIPTION；location 输出 LOCATION；不外发内部风险/完成/优先级等字段。文本转义、UTF-8 按字节折行，来源时间固定生成 DTSTAMP/CREATED/LAST-MODIFIED。
- 提醒默认关闭。显式开启后只接受非全天事件的单个 0–10080 分钟数字 DISPLAY 提醒，拒绝多提醒或异常字符串，不冒充源邮件调度行为。实际触发单独验收。
- 每批现有账本与目标事件的并集最多 500 个，包含本次待删除项。面向小范围试点，全部远端操作串行且单请求 15 秒超时。

## 状态、并发、失败和恢复

`DATA_DIR/caldav-bridge/state.json` 只保存绑定摘要、资源键、sourceId、内容摘要、ETag 和未决写入，不保存凭据/正文。采用现有 atomicWriteFile（临时文件/fsync/原子替换）；进程内互斥与排他 `.lock` 防止同时写同一本地账本。**只支持同一 DATA_DIR 的单写入进程**，不能在多个主机上使用独立账本同时操作同一集合。

执行顺序：完整纯读源快照 → 验证选中日历归属 → 转换全部支持的事件 → 读取已知资源/比对状态 → 确认令牌 → 先更新/创建，成功后再删已登记且已退出当前投影的对象。每次操作前重读源签名；源异常或变化即停止。网络异常不被解释为源消失。部分远端成功不能跨网络原子回滚，已完成操作记入账本，错误后重新预览；删除阶段中途失败也不会撤销之前合法完成的删除。

首次创建用 If-None-Match，更新/删除用 If-Match；不列出并清空整个集合，不处理 POC seed 或其他对象。同名未登记远端对象、ETag/内容被外部修改、状态损坏或绑定更换，都停止并要求排查，不自动接管覆盖。

远端 PUT 前保存未决意图；若响应丢失，下一次 GET 与预期规范化内容一致才恢复 ETag，避免重复创建。内容比较仅针对桥接产生的有限 VEVENT 语法，容忍属性顺序/折行差异，不是通用 ICS 解析器。不匹配时保持失败现场。

**备份边界：现有网页用户导出/全站加密快照不包含该新账本或 Radicale 数据。** 试点启用前，单独备份桥接目录、Radicale 合成集合与对应配置；恢复主应用前关闭桥接写开关，完成后重新预览比对。账本缺失不会自动重建所有权，会在已有对象处冲突停止。崩溃残留 `.lock` 须确认原进程已停止、备份现场后人工处理；禁止为“恢复同步”直接删账本或清空目标日历。

停用/回滚：先关闭桥接写开关与功能开关并重启主应用；保留账本和远端数据，不因停用清空手机日历。代码回滚按原主应用 runbook。当前 POC 服务保持原样；其未启用开机自启的状态不由本桥接擅自改变。

## 验证与下一步

自动化：`node --import tsx --test server/caldav-bridge.test.ts server/caldav-api.test.ts`（也在 npm test 内）。覆盖身份/归属、纯读预览、时间/文本、幂等/条件变更、源失败/冲突、未决恢复、锁与日志错误边界。

真实本地链路：独立 POC Python 环境执行 `python -X utf8 infra/caldav-poc/bridge_smoke.py`。自动使用临时数据库和随机 CalDAV 凭据，经过真实主应用 CRUD/API → 桥接 → Radicale → reader：6 类创建、修改、删除、重复执行、只读拒绝均通过，原有 9 个合成 seed 保留。此工具强制回环 HTTP，测试中显式替换虚构 HTTPS origin；**不证明公网 TLS、手机或生产部署**。

后续仍只做受控手动试点：用户观察手机新建/修改/删除、只读交互、近未来提醒和重连 → 再完成至少 24h 后台观察；不启用自动定时同步。当前首个真实批次仅覆盖绑定的单个个人日历，后续批次仍须先预览并明确确认。

2026-09-18 生产配置回执：主应用已配置单一账号、单一默认日历、独立 CalDAV 写入凭据和既有目标集合；`CALDAV_BRIDGE_WRITE_ENABLED=false`、提醒保持关闭。首个经认证预览返回 `200` / `manual-pilot`，操作数为 `0`，包含两个 `AMBIGUOUS_ALL_DAY_RANGE`，没有可用 `planToken`；桥接账本仍未创建，未发生远端写入。修正 POC 凭据文件所有者后，POC 本机和公网只读 `PROPFIND` 均返回 `207`。需先修正这两个源事件的全天日期语义，再重新预览并由用户确认具体批次。

2026-09-18 生产手动桥接回执（两条源日程重新保存后）：用户已将两个历史源记录改为各自日期内的普通定时日程，服务器复核分别为 `2026-08-20 09:00–10:00` 与 `2026-09-07 09:00–10:00`，本轮未再次修改源数据。重新认证预览返回 `200` / `manual-pilot`，25 条 `create`、无 `issue`、无排除项；开启写入后同步返回 `200` / `applied=true`，账本记录 25 条且 `pending=0`、无残留锁。目标集合本机 `PROPFIND` 返回 `207` 并看到 25 个桥接资源，主应用 health `ok`、PM2 `online`。本批次没有源侧更新/删除，也没有自动任务；手机变更呈现、提醒、断网恢复和 24h 后台观察仍未验收。
