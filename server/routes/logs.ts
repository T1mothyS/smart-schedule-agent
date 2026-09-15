import { Router } from 'express';
import type { createAuth } from '../auth.js';

import { addLog, allLogs, clearLogs, listLogs } from '../log-service.js';

export function createLogsRouter({ authenticate, requireAdmin }: Pick<ReturnType<typeof createAuth>, 'authenticate' | 'requireAdmin'>) {
  const app = Router();
  app.get("/api/logs", authenticate, requireAdmin, (req, res) => {
    const { level, category, limit } = req.query;
    res.json(listLogs({
      level: level ? String(level) : undefined,
      category: category ? String(category) : undefined,
      limit: limit ? Number(limit) : undefined,
    }));
  });

  app.delete("/api/logs", authenticate, requireAdmin, (req, res) => {
    clearLogs();
    addLog('info', 'system', '日志已清空');
    res.json({ success: true });
  });

  // 导出日志为文本文件
  app.get("/api/logs/export", authenticate, requireAdmin, (req, res) => {
    const { format = 'txt' } = req.query;
    const now = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    const filename = `schedule-logs-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const logs = allLogs();

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json({ exportedAt: now.toISOString(), total: logs.length, logs });
    } else {
      // 默认 txt 格式
      const lines = logs.map(l => {
        const data = l.data ? `  ${JSON.stringify(l.data)}` : '';
        return `[${l.timestamp}] [${l.level.toUpperCase().padEnd(5)}] [${l.category.padEnd(8)}] ${l.message}${data}`;
      });
      const header = `智能日程表 - 调试日志导出\n导出时间: ${now.toLocaleString('zh-CN')}\n共 ${logs.length} 条记录\n${'='.repeat(80)}\n\n`;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.txt"`);
      res.send(header + lines.join('\n'));
    }
  });
  return app;
}
