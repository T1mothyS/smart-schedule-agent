import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const raw = String(process.env.ELECTRON_APP_URL || process.env.APP_URL || '').trim();
if (!raw) throw new Error('构建 Electron 安装包前必须配置 ELECTRON_APP_URL 或 APP_URL');
const parsed = new URL(raw);
if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
  throw new Error('Electron 生产地址必须是不含账号密码的 HTTPS URL');
}
const projectRoot = process.cwd();
const targetDir = path.resolve(projectRoot, 'dist-desktop');
if (path.dirname(targetDir) !== projectRoot || path.basename(targetDir) !== 'dist-desktop') {
  throw new Error('Electron staging path escaped the project root');
}

const requiredFiles = {
  main: path.resolve(projectRoot, 'dist-electron/main.js'),
  preload: path.resolve(projectRoot, 'dist-electron/preload.js'),
  icon: path.resolve(projectRoot, 'public/navigation-icons/schedule.png'),
};
for (const [label, source] of Object.entries(requiredFiles)) {
  if (!fs.existsSync(source)) throw new Error(`Electron ${label} build input is missing: ${source}`);
}

const rootPackage = JSON.parse(fs.readFileSync(path.resolve(projectRoot, 'package.json'), 'utf8'));
fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(requiredFiles.main, path.join(targetDir, 'main.js'));
fs.copyFileSync(requiredFiles.preload, path.join(targetDir, 'preload.js'));
fs.copyFileSync(requiredFiles.icon, path.join(targetDir, 'schedule.png'));
fs.writeFileSync(path.join(targetDir, 'app-url.json'), JSON.stringify({ appUrl: parsed.toString() }, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({
  name: 'ai-calendar-desktop-shell',
  version: rootPackage.version,
  description: rootPackage.description,
  author: rootPackage.author,
  main: 'main.js',
  type: 'module',
}, null, 2) + '\n', 'utf8');
console.log('[Electron] Minimal desktop staging directory prepared');
