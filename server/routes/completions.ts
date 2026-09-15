import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { withPersistenceTransaction } from '../persistence.js';
import { query } from '@tencent-ai/agent-sdk';
import * as scheduleStore from '../schedule-store.js';
import * as reminderStore from '../reminder-store.js';
import * as reminderCalendarSync from '../reminder-calendar-sync.js';
import * as activityStore from '../activity-store.js';
import * as attachmentService from '../attachment-service.js';

export function createCompletionsRouter({ authenticate }: Pick<ReturnType<typeof createAuth>, 'authenticate'>) {
  const app = Router();
  app.get("/api/history", authenticate, (req, res) => {
    const userId = (req as any).user.userId;
    const completions = activityStore.listCompletions(userId, {
      sourceType: req.query.sourceType ? String(req.query.sourceType) : undefined,
      sourceId: req.query.sourceId ? String(req.query.sourceId) : undefined,
      date: req.query.date ? String(req.query.date) : undefined,
    }).map(item => ({ ...item, attachments: activityStore.listAttachments(userId, item.id) }));
    res.json({ completions });
  });

  app.post("/api/completions", authenticate, (req, res) => {
    try {
      const outcome = withPersistenceTransaction(() => {
        const userId = (req as any).user.userId;
        const sourceType = req.body.sourceType as activityStore.ActionSource;
        const sourceId = String(req.body.sourceId || '');
        const instanceId = sourceType === 'reminder' && req.body.instanceId ? String(req.body.instanceId) : null;
        if (sourceType === 'schedule') {
          const schedule = scheduleStore.getSchedule(sourceId);
          if (!schedule || schedule.user_id !== userId) return { status: 404, body: { error: '日程不存在' } };
          scheduleStore.updateSchedule(sourceId, { is_completed: true });
        } else if (sourceType === 'reminder') {
          if (!instanceId) return { status: 400, body: { error: '周期编号不能为空' } };
          const completedDate = req.body.completedAt
            ? String(req.body.completedAt).slice(0, 10)
            : reminderStore.todayInTimezone();
          const task = reminderStore.completeReminderCycle(sourceId, userId, instanceId, completedDate, req.body.note);
          if (!task) return { status: 404, body: { error: '周期事务不存在' } };
          const completedCycle = reminderStore.getReminderHistory(task.id, userId).find(cycle => cycle.id === instanceId);
          if (completedCycle) reminderCalendarSync.syncReminderCycleToCalendar(task, completedCycle);
          reminderCalendarSync.syncReminderTaskToCalendar(task);
        } else {
          return { status: 400, body: { error: '完成记录来源不正确' } };
        }
        const completionInput = {
          completedAt: req.body.completedAt,
          note: req.body.note,
          amountCents: req.body.amountCents == null ? null : Number(req.body.amountCents),
          currency: req.body.currency == null ? 'CNY' : String(req.body.currency),
          billDate: req.body.billDate,
        };
        const existingCompletion = activityStore.listCompletions(userId, { sourceType, sourceId })
          .find(item => item.instanceId === instanceId && !item.reopenedAt);
        const completion = existingCompletion
          ? activityStore.updateCompletion(existingCompletion.id, userId, completionInput)
          : activityStore.createCompletion({ userId, sourceType, sourceId, instanceId, ...completionInput });
        if (!completion) throw new Error('保存完成记录失败');
        return { status: 200, body: { completion } };
      });
      res.status(outcome.status).json(outcome.body);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '保存完成状态失败，请重试' });
    }
  });

  app.post("/api/completions/:id/reopen", authenticate, (req, res) => {
    try {
      const outcome = withPersistenceTransaction(() => {
        const userId = (req as any).user.userId;
        const current = activityStore.getCompletion(req.params.id, userId);
        if (!current) return { status: 404, body: { error: '完成记录不存在' } };
        if (current.sourceType === 'schedule') {
          const source = scheduleStore.getSchedule(current.sourceId);
          if (!source || source.user_id !== userId) return { status: 404, body: { error: '日程不存在' } };
          scheduleStore.updateSchedule(current.sourceId, { is_completed: false });
        }
        else if (current.instanceId) {
          const task = reminderStore.reopenReminderCycle(current.sourceId, userId, current.instanceId);
          if (!task) return { status: 404, body: { error: '周期事务不存在' } };
          const reopenedCycle = task
            ? reminderStore.getReminderHistory(task.id, userId).find(cycle => cycle.id === current.instanceId)
            : null;
          if (task && reopenedCycle) reminderCalendarSync.syncReminderCycleToCalendar(task, reopenedCycle);
          if (task) reminderCalendarSync.syncReminderTaskToCalendar(task);
        }
        return { status: 200, body: { completion: activityStore.reopenCompletion(current.id, userId) } };

      });
      res.status(outcome.status).json(outcome.body);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '保存完成状态失败，请重试' });
    }
  });

  app.put("/api/completions/:id", authenticate, (req, res) => {
    try {
      const completion = activityStore.updateCompletion(req.params.id, (req as any).user.userId, {
        completedAt: req.body.completedAt ? String(req.body.completedAt) : undefined,
        note: req.body.note === undefined ? undefined : String(req.body.note),
        amountCents: req.body.amountCents === undefined
          ? undefined
          : req.body.amountCents == null ? null : Number(req.body.amountCents),
        currency: req.body.currency === undefined ? undefined : String(req.body.currency),
        billDate: req.body.billDate === undefined ? undefined : String(req.body.billDate),
      });
      if (!completion) return res.status(404).json({ error: '完成记录不存在' });
      res.json({ completion });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '修改完成记录失败' });
    }
  });

  app.post("/api/completions/:id/attachments", authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      if (!activityStore.getCompletion(req.params.id, userId)) return res.status(404).json({ error: '完成记录不存在' });
      const files = Array.isArray(req.body.files) ? req.body.files : [];
      if (!files.length || files.length > 5) return res.status(400).json({ error: '请选择 1 到 5 个附件' });
      const attachments: activityStore.AttachmentRecord[] = [];
      try {
        for (const file of files) {
          attachments.push(attachmentService.saveBase64Attachment({
            userId,
            completionId: req.params.id,
            originalName: String(file.name || 'attachment'),
            mimeType: String(file.mimeType || ''),
            base64: String(file.base64 || ''),
          }));
        }
      } catch (error) {
        for (const attachment of attachments) {
          const removed = activityStore.deleteAttachment(attachment.id, userId);
          if (removed) attachmentService.deleteAttachmentFileIfUnused(removed);
        }
        throw error;
      }
      res.json({ attachments });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '上传附件失败' });
    }
  });

  app.get("/api/attachments/:id", authenticate, (req, res) => {
    try {
      const record = activityStore.getAttachment(req.params.id, (req as any).user.userId);
      if (!record) return res.status(404).json({ error: '附件不存在' });
      res.setHeader('Content-Type', record.mimeType);
      res.setHeader('Content-Disposition', 'inline; filename*=UTF-8\'\'' + encodeURIComponent(record.originalName));
      res.send(attachmentService.readAttachment(record));
    } catch (error: any) {
      res.status(404).json({ error: error?.message || '读取附件失败' });
    }
  });

  app.delete("/api/attachments/:id", authenticate, (req, res) => {
    const userId = (req as any).user.userId;
    const record = activityStore.deleteAttachment(req.params.id, userId);
    if (!record) return res.status(404).json({ error: '附件不存在' });
    attachmentService.deleteAttachmentFileIfUnused(record);
    res.json({ success: true });
  });

  // ============= 可读数据导出 =============
  return app;
}
