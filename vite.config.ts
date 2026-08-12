import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        // AI 将多条自然语言事项拆解为计划时，响应可能超过默认代理等待时间。
        // 保持与生产反向代理一致的 5 分钟上限，避免代理先返回 HTML 超时页。
        timeout: 300_000,
        proxyTimeout: 300_000,
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
