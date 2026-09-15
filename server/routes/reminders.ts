import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { type JwtPayload } from '../auth.js';
import { describeErrorData } from '../runtime/logging.js';
import { withPersistenceTransaction } from '../persistence.js';
import * as reminderStore from '../reminder-store.js';
import * as reminderCalendarSync from '../reminder-calendar-sync.js';
import { sendReminderTestEmail, summarizeEmailSendResult } from '../email-service.js';
import * as activityStore from '../activity-store.js';
import { addLog } from '../log-service.js';
import * as db from '../db.js';
import { validDateOnly, normaliseReminderConfig } from '../reminder-input.js';

export function createRemindersRouter({ authenticate }: Pick<ReturnType<typeof createAuth>, 'authenticate'>) {
  const app = Router();
  app.get("/api/cycle-reminders", authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const tasks = reminderStore.listReminderTasks(userId);
      reminderCalendarSync.syncReminderTasksToCalendar(tasks);
      res.json({
        tasks,
        stats: reminderStore.getReminderStats(userId),
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || '获取周期提醒失败' });
    }
  });

  app.get("/api/cycle-reminder-templates", authenticate, (_req, res) => {
    res.json({ templates: [
      { key: 'subscription', name: '订阅续费', frequency: 'monthly', reminderOffsets: [7, 1], icon: 'RefreshCw' },
      { key: 'insurance', name: '保险', frequency: 'yearly', reminderOffsets: [30, 7, 1], icon: 'ShieldCheck' },
      { key: 'document', name: '证件', frequency: 'once', reminderOffsets: [90, 30, 7], icon: 'BadgeCheck' },
      { key: 'membership', name: '会员', frequency: 'yearly', reminderOffsets: [14, 3, 1], icon: 'Crown' },
      { key: 'rent', name: '房租', frequency: 'monthly', reminderOffsets: [3, 1, 0], icon: 'House' },
      { key: 'utilities', name: '水电账单', frequency: 'monthly', reminderOffsets: [3, 1, 0], icon: 'ReceiptText' },
      { key: 'vehicle_inspection', name: '车辆年检', frequency: 'yearly', reminderOffsets: [30, 7, 1], icon: 'Car' },
      { key: 'custom', name: '自定义事务', frequency: 'once', reminderOffsets: [7, 1], icon: 'Settings2' },
    ] });
  });

  app.post("/api/cycle-reminders", authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const type = req.body.type as reminderStore.ReminderTaskType;
      if (type !== 'credit_card' && type !== 'sim' && type !== 'generic') {
        return res.status(400).json({ error: '任务类型不正确' });
      }
      const task = reminderStore.createReminderTask({
        userId,
        type,
        name: String(req.body.name || ''),
        timezone: reminderStore.DEFAULT_CYCLE_REMINDER_TIMEZONE,
        config: normaliseReminderConfig(type, req.body.config),
      });
      reminderCalendarSync.syncReminderTaskToCalendar(task);
      addLog('info', 'reminder', '创建周期提醒任务', { taskId: task.id, type });
      res.json({ task });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '创建周期提醒失败' });
    }
  });

  app.patch("/api/cycle-reminders/:id", authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const current = reminderStore.getReminderTask(req.params.id, userId);
      if (!current) return res.status(404).json({ error: '周期提醒不存在' });
      const updates: any = {};
      if (req.body.name !== undefined) updates.name = String(req.body.name);
      if (req.body.enabled !== undefined) updates.enabled = !!req.body.enabled;
      if (req.body.timezone !== undefined) {
        updates.timezone = reminderStore.DEFAULT_CYCLE_REMINDER_TIMEZONE;
      }
      if (req.body.config !== undefined) updates.config = normaliseReminderConfig(current.type, req.body.config);
      const task = reminderStore.updateReminderTask(req.params.id, userId, updates);
      if (task) reminderCalendarSync.syncReminderTaskToCalendar(task);
      res.json({ task });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '更新周期提醒失败' });
    }
  });

  app.delete("/api/cycle-reminders/:id", authenticate, (req, res) => {
    const userId = (req as any).user.userId;
    const cycles = reminderStore.getReminderHistory(req.params.id, userId);
    reminderCalendarSync.deleteReminderSchedules(userId, cycles);
    const success = reminderStore.deleteReminderTask(req.params.id, userId);
    if (!success) return res.status(404).json({ error: '周期提醒不存在' });
    addLog('warn', 'reminder', '删除周期提醒任务: ' + req.params.id);
    res.json({ success: true });
  });

  app.post("/api/cycle-reminders/:id/complete", authenticate, (req, res) => {
    try {
      const outcome = withPersistenceTransaction(() => {
        const userId = (req as any).user.userId;
        const completedDate = req.body.completedDate || reminderStore.todayInTimezone();
        if (!validDateOnly(completedDate)) return { status: 400, body: { error: '完成日期格式不正确' } };
        const task = reminderStore.completeReminderCycle(
          req.params.id,
          userId,
          String(req.body.cycleId || ''),
          completedDate,
          req.body.note,
        );
        if (!task) return { status: 404, body: { error: '任务或周期不存在' } };
        const completedCycle = reminderStore.getReminderHistory(task.id, userId)
          .find(cycle => cycle.id === String(req.body.cycleId || ''));
        if (completedCycle) reminderCalendarSync.syncReminderCycleToCalendar(task, completedCycle);
        reminderCalendarSync.syncReminderTaskToCalendar(task);
        const existingCompletion = activityStore.listCompletions(userId, { sourceType: 'reminder', sourceId: task.id })
          .find(item => item.instanceId === String(req.body.cycleId || '') && !item.reopenedAt);
        const completionInput = {
          completedAt: new Date(completedDate + 'T12:00:00+08:00').toISOString(),
          note: req.body.note == null ? null : String(req.body.note),
          amountCents: req.body.amountCents == null ? null : Number(req.body.amountCents),
          currency: req.body.currency == null ? 'CNY' : String(req.body.currency),
          billDate: req.body.billDate == null ? null : String(req.body.billDate),
        };
        const completion = existingCompletion
          ? activityStore.updateCompletion(existingCompletion.id, userId, completionInput)
          : activityStore.createCompletion({
            userId,
            sourceType: 'reminder',
            sourceId: task.id,
            instanceId: String(req.body.cycleId || ''),
            ...completionInput,
          });
        if (!completion) throw new Error('保存完成记录失败');
        return { status: 200, body: { task, completion } };
      });
      if (outcome.status === 200 && 'task' in outcome.body && outcome.body.task) {
        addLog('info', 'reminder', '标记周期提醒完成', { taskId: outcome.body.task.id });
      }
      res.status(outcome.status).json(outcome.body);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '保存完成状态失败，请重试' });
    }
  });

  app.get("/api/cycle-reminders/:id/history", authenticate, (req, res) => {
    const userId = (req as any).user.userId;
    const history = reminderStore.getReminderHistory(req.params.id, userId);
    res.json({ history });
  });

  app.post("/api/cycle-reminders/test-email", authenticate, async (req, res) => {
    try {
      const payload = (req as any).user as JwtPayload;
      const reminderEmail = db.getReminderEmail(payload.userId) || payload.email;
      const sendResult = await sendReminderTestEmail(reminderEmail);
      addLog('info', 'mail', '周期提醒测试邮件发送成功', {
        event: 'reminder_test_email_sent',
        userId: payload.userId,
        recipient: reminderEmail,
        ...summarizeEmailSendResult(sendResult),
      });
      res.json({ success: true });
    } catch (error: any) {
      addLog('error', 'mail', '周期提醒测试邮件发送失败', describeErrorData(error, {
        event: 'reminder_test_email_failed',
        userId: (req as any).user?.userId,
      }));
      res.status(500).json({ error: error?.message || '测试邮件发送失败' });
    }
  });

  // ============= AI 智能导入（草稿确认制） =============
  return app;
}
