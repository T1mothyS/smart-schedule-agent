#!/bin/bash
# 部署继续脚本 - 第二步

set -e

cd ~/smart-schedule-agent

echo "=== 安装依赖 ==="
npm ci

echo "=== 上线前检查 ==="
npm run typecheck
npm test

echo "=== 构建生产文件 ==="
npm run build

if [ ! -f .env ]; then
  cp .env.example .env
  echo "已创建 .env，请先填写所有 replace-with-* 配置后重新运行本脚本。"
  exit 1
fi

echo "=== 创建数据目录 ==="
mkdir -p data

echo "=== 启动服务 ==="
if pm2 describe smart-schedule >/dev/null 2>&1; then
  pm2 restart smart-schedule --update-env
else
  pm2 start npm --name "smart-schedule" -- run server
fi

echo "=== 保存 PM2 进程列表 ==="
pm2 save

echo "如尚未设置开机自启，请执行 pm2 startup 并复制执行它输出的 sudo 命令。"

echo ""
echo "=== 部署完成！ ==="
echo "请通过 Nginx 配置的 HTTPS 域名访问，不要向公网开放 3000 端口。"
echo ""
echo "常用命令："
echo "  pm2 logs smart-schedule    # 查看日志"
echo "  pm2 restart smart-schedule # 重启"
echo "  pm2 stop smart-schedule    # 停止"
