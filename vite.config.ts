import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const devHost = process.env.VITE_DEV_HOST?.trim() || '127.0.0.1';
const extraAllowedHost = process.env.VITE_ALLOWED_HOST?.trim();

export default defineConfig({
  plugins: [react()],
  server: {
    host: devHost,
    port: 5173,
    allowedHosts: extraAllowedHost ? ['localhost', '127.0.0.1', extraAllowedHost] : ['localhost', '127.0.0.1'],
    proxy: {
      '/daily-report-media': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        timeout: 30_000,
        proxyTimeout: 30_000,
      },
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        // AI 将多条自然语言事项拆解为计划时，响应可能超过默认代理等待时间。
        // 保持与生产反向代理一致的 5 分钟上限，避免代理先返回 HTML 超时页。
        timeout: 300_000,
        proxyTimeout: 300_000,
      },
      '/tools': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        timeout: 30_000,
        proxyTimeout: 30_000,
        // /tools 本身是 React 菜单；只有具体挂载应用路径交给后端门禁。
        bypass(request) {
          const pathname = new URL(request.url || '/', 'http://vite.local').pathname;
          return pathname === '/tools' || pathname === '/tools/' ? '/index.html' : undefined;
        },
      }
    }
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true
      }
    }
  }
});
