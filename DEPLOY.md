# 阿里云轻量服务器部署指南

当前 2 核 2 GB、40 GB 系统盘可以运行个人/小规模使用的本项目。AI 图片识别限制为单任务并发，附件和备份会消耗磁盘与内存，需要持续监控。

## 1. 部署前保护现有数据

首次替换旧应用前先创建阿里云快照，并在服务器备份应用数据：

```bash
cd /root/smart-schedule-agent
pm2 stop smart-schedule || true
tar -czf /root/ai-calendar-data-before-upgrade-$(date +%F-%H%M).tar.gz data .env
```

不要把 `.env`、`data/` 或备份文件提交到 Git。

## 2. 运行环境

阿里云旧 Node.js 14 镜像不满足要求，请升级到 Node.js 20：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2
node --version
npm --version
```

期望 Node.js 显示 `v20.x`。

## 3. 安装、配置与构建

将仓库放到 `/root/smart-schedule-agent` 后执行：

```bash
cd /root/smart-schedule-agent
npm ci
cp .env.example .env
chmod 600 .env
mkdir -p data
```

编辑 `.env`，至少填写：

- 独立随机的 `JWT_SECRET` 与 `BACKUP_ENCRYPTION_KEY`；
- `ADMIN_INVITE_CODE`、`USER_INVITE_CODE`；
- 官方 163 邮箱的 `SMTP_PASS` 授权码；
- `CODEBUDDY_API_KEY`；
- 正式域名对应的 `APP_URL`。

邮箱自动识别是可选能力。启用时再填写 `IMAP_PASS`，并在 163 邮箱后台开启 IMAP/SMTP；SMTP 和 IMAP 可以使用同一官方邮箱，但授权码应按邮箱后台实际配置为准。

检查并构建生产文件：

```bash
npm run typecheck
npm test
npm run build
```

## 4. PM2 启动

```bash
pm2 start npm --name smart-schedule -- run server
pm2 save
pm2 startup
```

执行 `pm2 startup` 输出的那条 `sudo ...` 命令，然后检查：

```bash
pm2 status
pm2 logs smart-schedule --lines 100
curl http://127.0.0.1:3000/api/health
```

## 5. Nginx 与防火墙

应用只监听服务器本机的 3000 端口，由 Nginx 对外提供 HTTPS：

```nginx
server {
    listen 80;
    server_name calendar.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name calendar.example.com;

    ssl_certificate /etc/letsencrypt/live/calendar.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/calendar.example.com/privkey.pem;
    client_max_body_size 650m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

阿里云防火墙只对公网保留 `80`、`443`，并把 `22` 限制为你的固定公网 IP。关闭截图中向 `0.0.0.0/0` 开放的 `3000/3001`、`465` 和 ICMP；应用主动连接 163 SMTP/IMAP 与 OSS 不需要入站开放 465/993。

## 6. OSS 私有灾备

创建与服务器同地域的私有 Bucket，开启“阻止公共访问”，使用内网 Endpoint。为专用 RAM 用户仅授予该 Bucket 备份目录的 `PutObject` 和 `DeleteObject` 权限，不授予公共读权限。

`.env` 示例：

```dotenv
OSS_BUCKET=your-private-bucket
OSS_ENDPOINT=oss-cn-beijing-internal.aliyuncs.com
OSS_ACCESS_KEY_ID=replace-me
OSS_ACCESS_KEY_SECRET=replace-me
```

应用每天 03:30 创建一致性加密快照，本机至少保留最近 7 份；上传失败的快照不会被轮换掉，并每 30 分钟重试。OSS 中每日对象保留 30 天，每月 1 日对象保留 12 个月。

## 7. 恢复演练

用户恢复应先在设置页“检查备份”，确认数据计数后选择合并或替换。替换前应用会自动保存该用户当前数据。

全站恢复必须：

1. 先停止外部访问并设置 `MAINTENANCE_MODE=true`；
2. 由管理员上传全站备份并输入确认文字 `RESTORE AI CALENDAR`；
3. 服务自动生成恢复前快照并退出；
4. 将 `MAINTENANCE_MODE=false` 后重新启动并执行登录、日历、周期、附件和通知回归。

```bash
pm2 restart smart-schedule --update-env
```

## 8. 更新与回滚

```bash
cd /root/smart-schedule-agent
git pull --ff-only
npm ci
npm test
npm run build
pm2 restart smart-schedule --update-env
```

若升级失败，恢复升级前阿里云快照或数据压缩包，再切回上一个 Git 提交。不要直接复制运行中的 sql.js 数据文件作为备份，应优先使用应用生成的一致性快照。
