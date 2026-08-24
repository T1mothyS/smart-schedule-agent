#!/bin/bash
# 部署继续脚本 - 第二步

set -e

cd ~/smart-schedule-agent

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("需要 Node.js 22.12.0 或更高版本，当前为 " + process.versions.node); process.exit(1); }'

echo "=== 安装依赖 ==="
npm ci

if [ ! -f .env ]; then
  cp .env.example .env
  echo "已创建 .env，请先填写所有 replace-with-* 配置并将唯一生产 worker 的 BACKGROUND_JOBS_ENABLED 设为 true，然后重新运行本脚本。"
  exit 1
fi

echo "=== 校验生产配置 ==="
node --input-type=module <<'NODE'
import fs from 'node:fs';
import dotenv from 'dotenv';

const env = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const failures = [];
const required = ['JWT_SECRET', 'ADMIN_INVITE_CODE', 'USER_INVITE_CODE', 'SMTP_PASS', 'BACKUP_ENCRYPTION_KEY', 'APP_URL'];
for (const name of required) {
  const value = String(env[name] || '').trim();
  if (!value || value.includes('replace-with-')) failures.push(`${name} 未配置`);
}
if (String(env.JWT_SECRET || '').length < 32) failures.push('JWT_SECRET 少于 32 个字符');
if (String(env.ADMIN_INVITE_CODE || '').length < 12 || String(env.USER_INVITE_CODE || '').length < 12) failures.push('生产邀请码少于 12 个字符');
if (env.ADMIN_INVITE_CODE === env.USER_INVITE_CODE) failures.push('管理员和普通用户邀请码不能相同');
try {
  const appUrl = new URL(String(env.APP_URL || ''));
  if (appUrl.protocol !== 'https:' || appUrl.username || appUrl.password || appUrl.hash) failures.push('APP_URL 必须是不含账号密码和片段的 HTTPS URL');
} catch {
  failures.push('APP_URL 不是完整 URL');
}
if (env.APP_ENV !== 'production') failures.push('APP_ENV 必须为 production');
if (env.BACKGROUND_JOBS_ENABLED !== 'true') failures.push('唯一生产 worker 的 BACKGROUND_JOBS_ENABLED 必须为 true');
if (env.MAINTENANCE_MODE === 'true') failures.push('正常部署时 MAINTENANCE_MODE 必须为 false');
if (failures.length) {
  console.error('生产配置检查失败：');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('生产配置检查通过（未输出任何密钥）');
NODE

echo "=== 上线前检查 ==="
npm run typecheck
npm test

echo "=== 构建生产文件 ==="
npm run build

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
