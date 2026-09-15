import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { v4 as uuidv4 } from 'uuid';
import * as scheduleStore from '../schedule-store.js';
import { resolveUserCalendarId } from '../schedule-input.js';

export function createSuspendedTodosRouter({ authenticate }: Pick<ReturnType<typeof createAuth>, 'authenticate'>) {
  const app = Router();
  app.post("/api/suspended-todos", authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const title = String(req.body?.title || '').trim();
      if (!title) return res.status(400).json({ error: '请输入待办内容。' });
      const priority = ['high', 'medium', 'low'].includes(req.body?.priority) ? req.body.priority : 'medium';
      const created = scheduleStore.createSchedule({
        id: uuidv4(),
        user_id: userId,
        calendar_id: resolveUserCalendarId(userId, req.body?.calendarId),
        type: 'todo',
        title: title.slice(0, 160),
        description: undefined,
        start_time: new Date().toISOString(),
        end_time: undefined,
        all_day: false,
        is_unscheduled: true,
        location: undefined,
        notes: String(req.body?.notes || '').trim() || undefined,
        category: 'other',
        priority,
        is_completed: false,
        is_repeated: false,
        repeat_rule: undefined,
        reminders: [],
        is_high_risk: false,
      });
      res.status(201).json({ todo: created });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '创建挂起待办失败。' });
    }
  });

  app.patch("/api/suspended-todos/:id", authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const existing = scheduleStore.getSchedule(req.params.id);
      if (!existing || existing.user_id !== userId || !existing.is_unscheduled) return res.status(404).json({ error: '挂起待办不存在。' });
      const updates: any = {};
      if (req.body?.title !== undefined) {
        const title = String(req.body.title).trim();
        if (!title) return res.status(400).json({ error: '待办内容不能为空。' });
        updates.title = title.slice(0, 160);
      }
      if (req.body?.notes !== undefined) updates.notes = String(req.body.notes || '').trim() || undefined;
      if (req.body?.priority !== undefined && ['high', 'medium', 'low'].includes(req.body.priority)) updates.priority = req.body.priority;
      const updated = scheduleStore.updateSchedule(existing.id, updates);
      res.json({ todo: updated });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '更新挂起待办失败。' });
    }
  });

  app.delete("/api/suspended-todos/:id", authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const existing = scheduleStore.getSchedule(req.params.id);
      if (!existing || existing.user_id !== userId || !existing.is_unscheduled) return res.status(404).json({ error: '挂起待办不存在。' });
      res.json({ success: scheduleStore.deleteSchedule(existing.id) });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '删除挂起待办失败。' });
    }
  });
  return app;
}
