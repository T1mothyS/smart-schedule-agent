# 荣耀 CalDAV 隔离 POC

本目录只运行 Radicale 合成数据实验，不导入主应用、不读取 `data/`、不接入正式账号。研究结论与真机验收统一见 [研究记录](../../docs/CALDAV-HONOR-POC.md)。不要把本工具作为生产同步桥接使用。

## 运行与验证

Windows / PowerShell，在仓库根目录执行。使用独立环境，不修改系统 Python 或全局包：

```powershell
python -m venv infra/caldav-poc/.venv
$pocPython = 'infra/caldav-poc/.venv/Scripts/python.exe'
& $pocPython -m pip install --index-url https://pypi.org/simple -r infra/caldav-poc/requirements.txt
& $pocPython -X utf8 -m unittest discover -s infra/caldav-poc -p test_poc.py -v
```

测试自动启动 loopback 服务，创建临时目录和随机凭据，完成后停止进程；留下的目录只含合成数据、密码哈希和允许字段日志。为保留失败证据，不自动删除。Windows 中文路径使用 `-X utf8`；不改全局编码。测试用低成本 bcrypt 仅用于临时随机凭据，正式 POC 账号由 `create_users.py` 使用默认成本生成。

依赖全部固定在 `requirements.txt`，无主应用 npm 依赖变更。升级任何依赖后重新运行 POC 验证。`serve.py` 是 Radicale 的 WSGI 包装，由 Waitress 提供有界连接/线程；只监听 `127.0.0.1`，公网 HTTPS 由现有 Nginx 终止。不调用 Radicale 自带调试日志。

## 部署准备与授权边界

当前选用 Linux systemd 独立服务；不安装 Docker。实际目标、SSH、入口和现场状态仅保存在忽略的本机 `DEPLOY.md`。服务器缺少 ensurepip 时，使用 `venv --without-pip` 加本地 pip wheel 引导，不需要 apt 或全局 pip。

```powershell
./infra/caldav-poc/prepare-bundle.ps1 -Python $pocPython -OutputDirectory '<新的本地产物目录>'
```

该命令下载适用于 Linux x86_64 / Python 3.12 的二进制 wheels，复制审阅过的源码和模板，生成 `SHA256SUMS`。不上传、不安装、不启动。发布前将模板中的域名/路径变更写入本机 runbook，并重新生成包。产物不得存进 Git。

授权后部署顺序（下列为 Linux 服务器命令，与 Windows 本地命令区分）：

1. 确认 `/opt/ai-calendar-caldav-poc`、配置和数据目录无已有服务；独立上传包并执行 `sha256sum -c SHA256SUMS`、`sh -n install-runtime.sh`。
2. 执行 `sh /opt/ai-calendar-caldav-poc/install-runtime.sh`。只安装预构建 wheels 到独立环境，不在服务器构建或测试主应用。
3. 在安全的交互终端运行 `/opt/ai-calendar-caldav-poc/venv/bin/python -X utf8 /opt/ai-calendar-caldav-poc/create_users.py --output /var/lib/ai-calendar-caldav-poc/users`，随后设置文件所有者 `caldav-poc:caldav-poc`、权限 `600`。密码只在不回显的提示中输入，不放命令、报告或 shell history。记入用户自己的密码管理器。
4. `systemctl daemon-reload`，启动 `ai-calendar-caldav-poc`（测试阶段不 enable）。先验证 loopback；只读权限与合成数据按下节初始化。
5. 备份**当前 Nginx 配置**到 root 私有目录。在现有 HTTPS `server` 块添加 `include /etc/ai-calendar-caldav-poc/nginx-path.conf;`，审阅 diff，`nginx -t` 成功后 reload；同时复查主站健康和匿名页面行为。若现场配置自准备后变化，重新生成差异，不直接覆盖。
6. 公网验证有效证书、实际发现 href 的路径前缀、登录、只读查询与所有方法；不使用 `verify=False`，不开放 5232 公网端口。资源上限 192 MB、25% CPU 是 POC 初始约束，需实际观察是否触限。

若已有 Docker，后续可另行准备固定镜像；本次没有提供或声称验证 Docker 路径。真实公网 Nginx/systemd 验收仍需授权部署后完成。

## 初始化与协议检查

固定账号：`poc-writer` 为测试数据管理员；`poc-reader` 为手机只读账号；`poc-phone` 仅用于可写实验；`poc-outsider` 为越权测试账号。手机只读登录可自动发现 `/poc-reader/poc/`。专用 writer 创建两个父目录，再建立测试日历；不授予 reader 创建目录权限。

```powershell
# 初次创建合成日历；既有对象返回 412，保留不覆盖。
& $pocPython -X utf8 infra/caldav-poc/probe.py --url 'https://calendar.example.com/caldav-poc/' --mode seed --allow-write
# 默认只读：检查发现、日历和 REPORT。
& $pocPython -X utf8 infra/caldav-poc/probe.py --url 'https://calendar.example.com/caldav-poc/'
# 创建随机对象，验证只读拒绝、越权拒绝、ETag 与更新删除；不删除已有样例。
& $pocPython -X utf8 infra/caldav-poc/probe.py --url 'https://calendar.example.com/caldav-poc/' --mode cycle --allow-write
```

只对独立 POC 入口使用 `seed/cycle`。所有密码交互输入；客户端拒绝 URL 内的凭据与查询参数，拒绝外网 HTTP，不跟随重定向。失败只输出检查标签，避免 HTTP 异常带出凭据。`cycle` 失败可能留下 `probe-*.ics` 合成对象，保留用于诊断，不批量清空日历。

样例包括普通、全天、跨午夜、显式时区、中文特殊字符长文本、每日/每周重复、单次例外及提醒，共 9 个资源。默认日期为东八区次日，可通过 `--date YYYY-MM-DD` 指定。`alarm.ics` 为创建时起 15 分钟后的事件，提前 5 分钟提醒；若手机尚未同步或文件已存在，应在独立可写日历手动创建新的近未来提醒，不能把“显示提醒设置”记为实际触发。

## 协议证据与日志边界

`serve.py` 只输出 JSON 允许字段：UTC 时间、方法、归一化路径、状态、Depth、受限 Content-Type、Basic 是否存在、条件请求是否存在、ETag/If-Match 摘要和已知 XML 元素名。UID、日程内容、URL 查询参数、XML 值、Cookie、User-Agent、认证头及密码不输出。未知路径统一替换，XML 外部实体拒绝解析。摘要只用于比对，不作为实际 ETag 回传。

Nginx 的 POC location 关闭原始 access log；错误日志不收集原始请求。第三方库日志禁止输出，不能开启 Radicale debug 来排障。先通过 `PrivacyTests`，再运行真实测试。TLS 建连前错误和主站自己的日志不属于该包装器控制范围；不要在 URL 放凭据。

记录 `journalctl -u ai-calendar-caldav-poc` 的允许字段输出，并按手机操作时间关联。启动失败只有固定错误码；排障先检查权限、配置、端口和包版本。如需进一步日志，用本地合成复现，不转储线上请求。轮转/保留采用现有 journal 配额；测试结束停服务，实验日志按用户确认的保留期处理。

## 回滚

先恢复本次备份的 Nginx 配置，`nginx -t` 通过后 reload；检查主站。再停止 POC 服务，保留独立数据、包和日志供诊断。不停止主应用、不恢复主数据库。新建服务账号、目录和 systemd 文件可暂留；删除须另行核对准确路径并授权，不在脚本中自动执行。手机上移除测试账号由用户操作。
