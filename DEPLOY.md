# 🚀 服务器部署指南

## 腾讯云轻量应用服务器部署

### 服务器配置要求
| 参数 | 最低配置 | 推荐配置 |
|------|---------|---------|
| CPU | 1核 | 2核 |
| 内存 | 1G | 2G |
| 带宽 | 1Mbps | 3Mbps |
| 系统盘 | 20GB | 40GB |

你的 **2核2G3M** 完全够用！

---

## 第一步：本地准备工作

### 1.1 构建前端
```bash
cd smart-schedule-agent
npm run build:client
```

### 1.2 上传代码到服务器
```bash
# 方法1：SCP 上传（本地执行）
scp -r ./smart-schedule-agent root@你的服务器IP:/root/

# 方法2：使用 Git
# 在服务器上安装 git，克隆你的代码仓库
ssh root@你的服务器IP
git clone https://your-repo/smart-schedule-agent.git
```

---

## 第二步：服务器初始化

### 2.1 连接服务器
```bash
ssh root@你的服务器IP
```

### 2.2 安装 Node.js 20
```bash
# Ubuntu/Debian 系统
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node --version  # 应该显示 v20.x.x
npm --version
```

### 2.3 安装 PM2（进程管理器）
```bash
sudo npm install -g pm2
```

PM2 的作用：
- 保持应用持续运行（崩溃后自动重启）
- 服务器重启后自动启动
- 查看日志方便

---

## 第三步：配置应用

### 3.1 进入项目目录
```bash
cd ~/smart-schedule-agent
```

### 3.2 安装依赖
```bash
npm install
```

### 3.3 创建 .env 配置文件
```bash
cat > .env << 'EOF'
# JWT 密钥（务必修改为随机字符串！）
JWT_SECRET=your-super-secret-jwt-key-change-this

# 163 邮箱 SMTP
SMTP_HOST=smtp.163.com
SMTP_PORT=465
SMTP_USER=your-email@163.com
SMTP_PASS=your-email-auth-code

# 邀请码（自定义）
ADMIN_INVITE_CODE=YourAdminCode123
USER_INVITE_CODE=YourUserCode456

# CodeBuddy AI API Key（必须）
CODEBUDDY_API_KEY=your-actual-codebuddy-api-key

# 服务器配置
PORT=3000
NODE_ENV=production
CODEBUDDY_INTERNET_ENVIRONMENT=internal
EOF
```

### 3.4 创建数据目录
```bash
mkdir -p data
```

---

## 第四步：构建并启动

### 4.1 构建前端
```bash
npm run build:client
```

### 4.2 复制前端文件到 server/public
```bash
mkdir -p server/public
cp -r dist/* server/public/
```

### 4.3 启动服务
```bash
pm2 start server/index.ts --name "smart-schedule" --interpreter tsx
```

### 4.4 保存 PM2 进程列表（开机自启）
```bash
pm2 save
pm2 startup
```

### 4.5 查看状态
```bash
pm2 status
pm2 logs smart-schedule
```

---

## 第五步：开放防火墙端口

### 腾讯云控制台操作
1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/)
2. 进入 **轻量应用服务器**
3. 点击你的服务器 → **防火墙**
4. 添加规则：允许 **3000** 端口

---

## 第六步：访问应用

打开浏览器访问：
```
http://你的服务器IP:3000
```

---

## 常用运维命令

```bash
# 查看日志
pm2 logs smart-schedule

# 重启服务
pm2 restart smart-schedule

# 停止服务
pm2 stop smart-schedule

# 删除服务
pm2 delete smart-schedule

# 查看实时日志
pm2 logs smart-schedule --lines 100 --follow

# 监控资源使用
pm2 monit
```

---

## 更新部署（后续维护）

### 方法1：手动更新
```bash
# 1. 进入目录
cd ~/smart-schedule-agent

# 2. 拉取最新代码（或上传新代码）

# 3. 重新安装依赖（如有更新）
npm install

# 4. 重新构建
npm run build:client
cp -r dist/* server/public/

# 5. 重启服务
pm2 restart smart-schedule
```

### 方法2：自动化脚本
```bash
#!/bin/bash
cd ~/smart-schedule-agent
git pull
npm install
npm run build:client
cp -r dist/* server/public/
pm2 restart smart-schedule
```

---

## HTTPS 配置（可选但推荐）

如果需要 HTTPS（微信小程序必须），使用 Nginx 反向代理：

```nginx
# /etc/nginx/conf.d/smart-schedule.conf
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    client_max_body_size 10M;

    location / {
        root /root/smart-schedule-agent/server/public;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 常见问题排查

### 1. 端口被占用
```bash
# 查看端口占用
lsof -i :3000

# 杀死占用进程
kill -9 <PID>
```

### 2. PM2 无法启动
```bash
# 查看详细错误
pm2 logs --err

# 检查 Node 版本
node --version
```

### 3. 前端页面空白
```bash
# 检查静态文件是否存在
ls -la server/public/
```

### 4. 数据库错误
```bash
# 检查数据目录权限
chmod 777 data
```

---

## 架构说明

```
用户浏览器
    │
    │ HTTP 请求
    ▼
Express 服务器 (:3000)
    │
    ├── /api/* → API 路由（处理数据）
    │
    └── /* → 静态文件 + SPA 路由
              │
              ▼
         server/public/
              │
              ├── index.html
              └── assets/
```

后端改动时，只需要：
1. 重启 PM2：`pm2 restart smart-schedule`
2. 前端用户刷新浏览器即可
