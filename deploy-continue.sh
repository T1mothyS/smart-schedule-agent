#!/bin/bash
# 部署继续脚本 - 第二步

set -e

cd ~/smart-schedule-agent

echo "=== 安装依赖 ==="
npm install

echo "=== 构建前端 ==="
npm run build:client

echo "=== 复制 dist 到 server/public ==="
mkdir -p server/public
cp -r dist/* server/public/

echo "=== 创建 .env 配置文件 ==="
cat > .env << 'EOF'
# JWT 密钥（务必修改！）
JWT_SECRET=your-super-secret-jwt-key-change-this

# 163 邮箱 SMTP
SMTP_HOST=smtp.163.com
SMTP_PORT=465
SMTP_USER=your-email@163.com
SMTP_PASS=your-email-auth-code

# 邀请码
ADMIN_INVITE_CODE=Admin123
USER_INVITE_CODE=User123

# CodeBuddy AI API Key
CODEBUDDY_API_KEY=your-codebuddy-api-key

# 服务器配置
PORT=3000
NODE_ENV=production
CODEBUDDY_INTERNET_ENVIRONMENT=internal
EOF

echo "=== 创建数据目录 ==="
mkdir -p data

echo "=== 启动服务 ==="
pm2 start server/index.ts --name "smart-schedule" --interpreter tsx

echo "=== 保存 PM2 进程列表 ==="
pm2 save

echo "=== 设置开机自启 ==="
pm2 startup

echo ""
echo "=== 部署完成！ ==="
echo "访问 http://你的服务器IP:3000"
echo ""
echo "常用命令："
echo "  pm2 logs smart-schedule    # 查看日志"
echo "  pm2 restart smart-schedule # 重启"
echo "  pm2 stop smart-schedule    # 停止"
