import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { type JwtPayload } from '../auth.js';
import { query } from '@tencent-ai/agent-sdk';
import * as scheduleStore from '../schedule-store.js';
import * as reminderStore from '../reminder-store.js';
import * as activityStore from '../activity-store.js';
import * as attachmentService from '../attachment-service.js';
import * as backupService from '../backup-service.js';
import { addLog } from '../log-service.js';
import { listInviteCodeStatuses, rotateInviteCode, type InviteRole } from '../invite-code-service.js';
import * as db from '../db.js';

export function createAdminRouter({ authenticate, requireAdmin }: Pick<ReturnType<typeof createAuth>, 'authenticate' | 'requireAdmin'>) {
  const app = Router();
  app.get("/api/admin/users", authenticate, requireAdmin, (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '10'), 10) || 10));
    const search = String(req.query.search || '').trim().slice(0, 200);
    const result = db.getUsersPaginated(page, pageSize, search);
    res.json(result);
  });

  // 邀请码只返回状态信息；明文只会在轮换成功的响应中返回一次。
  app.get("/api/admin/invite-codes", authenticate, requireAdmin, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ codes: listInviteCodeStatuses() });
  });

  app.post("/api/admin/invite-codes/:role/rotate", authenticate, requireAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const role = String(req.params.role || '');
    if (role !== 'admin' && role !== 'user') {
      return res.status(400).json({ error: '邀请码角色必须是 admin 或 user' });
    }

    try {
      const rotated = rotateInviteCode(role as InviteRole);
      const payload = (req as any).user as JwtPayload;
      addLog('info', 'auth', '管理员轮换邀请码', {
        event: 'invite_code_rotated',
        operatorUserId: payload.userId,
        role,
        rotatedAt: rotated.status.rotatedAt,
      });
      return res.json({
        success: true,
        role: rotated.role,
        code: rotated.code,
        createdAt: rotated.status.createdAt,
        rotatedAt: rotated.status.rotatedAt,
        version: rotated.status.version,
      });
    } catch (error) {
      console.error('[InviteCode] Rotation failed:', error instanceof Error ? error.message : error);
      return res.status(400).json({ error: error instanceof Error ? error.message : '轮换邀请码失败' });
    }
  });

  // 修改用户角色（管理员）
  app.put("/api/admin/users/:id/role", authenticate, requireAdmin, (req, res) => {
    const { role } = req.body;
    if (role !== 'admin' && role !== 'user') {
      return res.status(400).json({ error: '角色必须是 admin 或 user' });
    }
    const payload = (req as any).user as JwtPayload;
    const targetUser = db.getUserById(req.params.id);
    if (!targetUser) return res.status(404).json({ error: '用户不存在' });
    if (targetUser.id === payload.userId) {
      return res.status(403).json({ error: '无法修改自己的管理员身份' });
    }

    const success = db.updateUserRole(req.params.id, role);
    if (!success) return res.status(404).json({ error: '用户不存在' });
    addLog('info', 'admin', `修改用户角色: ${req.params.id} → ${role}`);
    res.json({ success: true });
  });

  // 禁用/启用用户（管理员）
  app.put("/api/admin/users/:id/disabled", authenticate, requireAdmin, (req, res) => {
    const { disabled } = req.body;
    const payload = (req as any).user as JwtPayload;
    const targetUser = db.getUserById(req.params.id);
    if (!targetUser) return res.status(404).json({ error: '用户不存在' });
    if (targetUser.id === payload.userId) return res.status(403).json({ error: '无法禁用自己的账号' });
    if (targetUser.role === 'admin') return res.status(403).json({ error: '无法禁用管理员账号' });
    const success = db.updateUserDisabled(req.params.id, disabled ? 1 : 0);
    if (!success) return res.status(404).json({ error: '用户不存在' });
    addLog('info', 'admin', `${disabled ? '禁用' : '启用'}用户: ${req.params.id}`);
    res.json({ success: true });
  });

  // 管理员按用户开启/关闭共享 API 权限；共享的是服务端调用权限，不返回管理员 API Key。
  app.put("/api/admin/users/:id/api-share", authenticate, requireAdmin, (req, res) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled 必须是布尔值' });
    }

    const targetUser = db.getUserById(req.params.id);
    if (!targetUser) return res.status(404).json({ error: '用户不存在' });

    const success = db.updateUserAdminApiSharing(req.params.id, enabled ? 1 : 0);
    if (!success) return res.status(404).json({ error: '用户不存在' });

    addLog('info', 'admin', `${enabled ? '开启' : '关闭'}用户管理员 API 共享: ${req.params.id}`);
    res.json({
      success: true,
      enabled,
      adminApiAvailable: Boolean(db.getAdminSharedApiKey()),
    });
  });

  // 删除用户及其所有数据（管理员）
  app.delete("/api/admin/users/:id", authenticate, requireAdmin, (req, res) => {
    const targetUserId = req.params.id;

    // 禁止删除自己
    const payload = (req as any).user as JwtPayload;
    if (targetUserId === payload.userId) {
      return res.status(403).json({ error: '无法删除自己的账号' });
    }

    // 禁止删除管理员
    const targetUser = db.getUserById(targetUserId);
    if (!targetUser) return res.status(404).json({ error: '用户不存在' });
    if (targetUser?.role === 'admin') {
      return res.status(403).json({ error: '无法删除管理员账号' });
    }
    if (String(req.body?.confirmEmail || '').trim().toLowerCase() !== targetUser.email.toLowerCase()) {
      return res.status(400).json({ error: '确认邮箱不匹配，删除操作已取消' });
    }
    let preDeleteBackup: ReturnType<typeof backupService.createSystemSnapshot>;
    try { preDeleteBackup = backupService.createSystemSnapshot(); }
    catch (error: any) {
      return res.status(503).json({ error: '删除前全站备份失败，未修改任何用户数据：' + (error?.message || '未知错误') });
    }

    const scheduleData = scheduleStore.deleteUserScheduleData(targetUserId);
    const deletedReminderTasks = reminderStore.deleteReminderTasksByUser(targetUserId);
    const activityData = activityStore.deleteUserActivity(targetUserId);
    const deletedAttachmentFiles = attachmentService.deleteUserAttachmentFiles(activityData.attachments);

    // 删除用户及其关联数据
    const success = db.deleteUser(targetUserId);
    if (!success) return res.status(404).json({ error: '用户不存在' });

    addLog('info', 'admin', `删除用户及其账号数据: ${targetUserId}`, {
      ...scheduleData,
      reminderTasks: deletedReminderTasks,
      attachmentFiles: deletedAttachmentFiles,
    });
    res.json({ success: true, backup: preDeleteBackup.filename, scheduleData, deletedReminderTasks, activityData: { ...activityData, attachments: activityData.attachments.length }, deletedAttachmentFiles });
  });

  // 清空用户数据（保留账号）（管理员）
  app.post("/api/admin/users/:id/clear-data", authenticate, requireAdmin, (req, res) => {
    const targetUserId = req.params.id;

    // 禁止清空自己的数据
    const payload = (req as any).user as JwtPayload;
    if (targetUserId === payload.userId) {
      return res.status(403).json({ error: '无法清空自己的数据' });
    }
    const targetUser = db.getUserById(targetUserId);
    if (!targetUser) return res.status(404).json({ error: '用户不存在' });
    if (targetUser.role === 'admin') return res.status(403).json({ error: '无法清空管理员账号的数据' });
    if (String(req.body?.confirmEmail || '').trim().toLowerCase() !== targetUser.email.toLowerCase()) {
      return res.status(400).json({ error: '确认邮箱不匹配，清空操作已取消' });
    }
    let preClearBackup: ReturnType<typeof backupService.createSystemSnapshot>;
    try { preClearBackup = backupService.createSystemSnapshot(); }
    catch (error: any) {
      return res.status(503).json({ error: '清空前全站备份失败，未修改任何用户数据：' + (error?.message || '未知错误') });
    }

    const scheduleData = scheduleStore.deleteUserScheduleData(targetUserId);
    const deletedReminderTasks = reminderStore.deleteReminderTasksByUser(targetUserId);
    const activityData = activityStore.deleteUserActivity(targetUserId);
    const deletedAttachmentFiles = attachmentService.deleteUserAttachmentFiles(activityData.attachments);

    // 清空用户其他数据（API Key、提醒设置等）
    const result = db.clearUserData(targetUserId);

    addLog('info', 'admin', `清空用户数据: ${targetUserId}`, {
      ...scheduleData,
      reminderTasks: deletedReminderTasks,
      attachmentFiles: deletedAttachmentFiles,
    });
    res.json({ success: true, backup: preClearBackup.filename, scheduleData, deletedReminderTasks, clearedSessions: result.sessions, activityData: { ...activityData, attachments: activityData.attachments.length }, deletedAttachmentFiles });
  });

  // ============= 今日行动中心 / 完成记录 / 通知中心 =============
  return app;
}
