import { Router } from 'express';
import type { createAuth } from '../auth.js';
import express from 'express';

import path from 'path';
import * as reminderStore from '../reminder-store.js';
import * as backupService from '../backup-service.js';

export function createBackupsRouter({ authenticate, requireAdmin }: Pick<ReturnType<typeof createAuth>, 'authenticate' | 'requireAdmin'>) {
  const app = Router();
  app.post("/api/backups/export", authenticate, (req, res) => {
    try {
      const password = String(req.body.password || '');
      const buffer = backupService.createUserBackup((req as any).user.userId, password);
      const filename = 'ai-calendar-' + reminderStore.todayInTimezone() + '.aicalendar-backup';
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
      res.send(buffer);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '导出备份失败' });
    }
  });

  const backupRawBody = express.raw({ type: 'application/octet-stream', limit: '600mb' });

  app.post("/api/backups/inspect", authenticate, backupRawBody, (req, res) => {
    try {
      const password = Buffer.from(String(req.header('x-backup-password') || ''), 'base64').toString('utf8');
      res.json({ backup: backupService.inspectUserBackup(req.body as Buffer, password) });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '检查备份失败' });
    }
  });

  app.post("/api/backups/restore", authenticate, backupRawBody, (req, res) => {
    try {
      const password = Buffer.from(String(req.header('x-backup-password') || ''), 'base64').toString('utf8');
      const mode = req.query.mode === 'replace' ? 'replace' : 'merge';
      const result = backupService.restoreUserBackup((req as any).user.userId, req.body as Buffer, password, mode);
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '恢复备份失败' });
    }
  });

  app.get("/api/admin/backups", authenticate, requireAdmin, (_req, res) => {
    res.json({ backups: backupService.listSystemSnapshots() });
  });

  app.post("/api/admin/backups", authenticate, requireAdmin, async (_req, res) => {
    try {
      const backup = backupService.createSystemSnapshot(true);
      const oss = await backupService.uploadPendingSystemSnapshots();
      res.json({ backup, oss });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '创建系统备份失败' });
    }
  });

  app.get("/api/admin/backups/:filename", authenticate, requireAdmin, (req, res) => {
    try {
      const buffer = backupService.readSystemSnapshot(req.params.filename);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="' + path.basename(req.params.filename) + '"');
      res.send(buffer);
    } catch (error: any) {
      res.status(404).json({ error: error?.message || '备份不存在' });
    }
  });

  app.post("/api/admin/backups/restore", authenticate, requireAdmin, backupRawBody, (req, res) => {
    try {
      backupService.restoreSystemSnapshot(req.body as Buffer, String(req.header('x-restore-confirmation') || ''));
      res.json({ success: true, restartRequired: true });
      setTimeout(() => process.exit(0), 500);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '系统恢复失败' });
    }
  });

  // ============= 周期提醒 API =============
  return app;
}
