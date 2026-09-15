import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { describeErrorData } from '../runtime/logging.js';
import { query } from '@tencent-ai/agent-sdk';
import { v4 as uuidv4 } from 'uuid';
import * as scheduleStore from '../schedule-store.js';
import * as reminderStore from '../reminder-store.js';
import * as reminderCalendarSync from '../reminder-calendar-sync.js';
import { toggleScheduleCompletion } from '../schedule-completion-service.js';
import { shiftScheduleDateValue } from '../schedule-actions.js';
import { addLog } from '../log-service.js';
import { normaliseScheduleApiFields } from '../schedule-input.js';

export function createSchedulesRouter({ authenticate }: Pick<ReturnType<typeof createAuth>, 'authenticate'>) {
  const app = Router();
  app.get("/api/schedules", authenticate, (req, res) => {
    try {
      const userId = (req as any).user?.userId;
      const { start, end } = req.query;
      if (userId) reminderCalendarSync.syncReminderTasksToCalendar(reminderStore.listReminderTasks(userId));
      let schedules;

      if (start && end) {
        schedules = scheduleStore.getSchedulesByDateRange(start as string, end as string, userId);
      } else {
        schedules = scheduleStore.getAllSchedules(userId);
      }

      res.json({ schedules });
    } catch (error: any) {
      console.error("[Schedules] Error:", error);
      res.status(500).json({ error: error?.message || "获取日程失败" });
    }
  });

  // 获取指定日期的日程
  app.get("/api/schedules/date/:date", authenticate, (req, res) => {
    try {
      const userId = (req as any).user?.userId;
      const { date } = req.params;
      if (userId) reminderCalendarSync.syncReminderTasksToCalendar(reminderStore.listReminderTasks(userId));
      const schedules = scheduleStore.getSchedulesByDate(date, userId);
      res.json({ schedules });
    } catch (error: any) {
      console.error("[Schedules] Error:", error);
      res.status(500).json({ error: error?.message || "获取日程失败" });
    }
  });

  // 获取单个日程
  app.get("/api/schedules/:id", authenticate, (req, res) => {
    try {
      const userId = (req as any).user?.userId;
      const { id } = req.params;
      const schedule = scheduleStore.getSchedule(id);

      if (!schedule) {
        return res.status(404).json({ error: "日程不存在" });
      }

      // 验证日程属于当前用户
      if (schedule.user_id !== userId) {
        return res.status(403).json({ error: "无权访问该日程" });
      }

      res.json({ schedule });
    } catch (error: any) {
      console.error("[Schedule] Error:", error);
      res.status(500).json({ error: error?.message || "获取日程失败" });
    }
  });

  // 创建日程
  app.post("/api/schedules", authenticate, (req, res) => {
    try {
      const userId = (req as any).user?.userId;
      const fields = normaliseScheduleApiFields(req.body || {}, userId);
      const schedule = {
        id: uuidv4(),
        user_id: userId,
        ...fields,
      } as Omit<scheduleStore.Schedule, 'created_at' | 'updated_at'>;

      const created = scheduleStore.createSchedule(schedule);
      addLog('info', 'schedule', '手动创建日程', {
        event: 'schedule_created',
        userId,
        id: created?.id,
        type: created?.type,
        priority: created?.priority,
        all_day: schedule.all_day,
        is_unscheduled: created?.is_unscheduled,
        is_completed: created?.is_completed,
        start_time: schedule.start_time,
        category: schedule.category
      });
      res.json({ schedule: created });
    } catch (error: any) {
      addLog('error', 'schedule', `创建日程失败: ${error.message}`);
      console.error("[Create Schedule] Error:", error);
      res.status(400).json({ error: error?.message || "创建日程失败" });
    }
  });

  // 更新日程（PATCH）
  app.patch("/api/schedules/:id", authenticate, (req, res) => {
    try {
      const userId = (req as any).user?.userId;
      const { id } = req.params;

      // 验证日程属于当前用户
      const existing = scheduleStore.getSchedule(id);
      if (!existing) {
        return res.status(404).json({ error: "日程不存在" });
      }
      if (existing.user_id !== userId) {
        return res.status(403).json({ error: "无权修改该日程" });
      }

      const updates = normaliseScheduleApiFields(req.body || {}, userId, existing);
      const updated = scheduleStore.updateSchedule(id, updates);
      addLog('info', 'schedule', '更新日程', {
        event: 'schedule_updated',
        userId,
        id: updated?.id,
        type: updated?.type,
        priority: updated?.priority,
        start_time: updated?.start_time,
        all_day: updated?.all_day,
        is_unscheduled: updated?.is_unscheduled,
        is_completed: updated?.is_completed,
        changedFields: Object.keys(req.body || {}).slice(0, 30),
      });
      res.json({ schedule: updated });
    } catch (error: any) {
      addLog('error', 'schedule', `更新日程失败: ${error.message}`);
      console.error("[Update Schedule] Error:", error);
      res.status(400).json({ error: error?.message || "更新日程失败" });
    }
  });

  // 更新日程（PUT - 与 PATCH 行为相同）
  app.put("/api/schedules/:id", authenticate, (req, res) => {
    try {
      const userId = (req as any).user?.userId;
      const { id } = req.params;

      const existing = scheduleStore.getSchedule(id);
      if (!existing) {
        return res.status(404).json({ error: "日程不存在" });
      }
      if (existing.user_id !== userId) {
        return res.status(403).json({ error: "无权修改该日程" });
      }

      const updates = normaliseScheduleApiFields(req.body || {}, userId, existing);
      const updated = scheduleStore.updateSchedule(id, updates);
      addLog('info', 'schedule', '更新日程', {
        event: 'schedule_updated',
        userId,
        id: updated?.id,
        type: updated?.type,
        priority: updated?.priority,
        start_time: updated?.start_time,
        all_day: updated?.all_day,
        is_unscheduled: updated?.is_unscheduled,
        is_completed: updated?.is_completed,
        changedFields: Object.keys(req.body || {}).slice(0, 30),
      });
      res.json({ schedule: updated });
    } catch (error: any) {
      addLog('error', 'schedule', '更新日程失败', describeErrorData(error, {
        event: 'schedule_update_failed',
        userId: (req as any).user?.userId,
        scheduleId: req.params.id,
      }));
      res.status(400).json({ error: error?.message || "更新日程失败" });
    }
  });

  // 删除日程
  app.delete("/api/schedules/:id", authenticate, (req, res) => {
    try {
      const userId = (req as any).user?.userId;
      const { id } = req.params;

      const existing = scheduleStore.getSchedule(id);
      if (!existing) {
        return res.status(404).json({ error: "日程不存在" });
      }
      if (existing.user_id !== userId) {
        return res.status(403).json({ error: "无权删除该日程" });
      }

      const success = scheduleStore.deleteSchedule(id);
      addLog('warn', 'schedule', `删除日程: ${id}`);
      res.json({ success: true });
    } catch (error: any) {
      addLog('error', 'schedule', `删除日程失败: ${error.message}`);
      console.error("[Delete Schedule] Error:", error);
      res.status(500).json({ error: error?.message || "删除日程失败" });
    }
  });

  // 切换日程完成状态
  app.post("/api/schedules/:id/toggle", authenticate, (req, res) => {
    try {
      const userId = (req as any).user?.userId;
      const { id } = req.params;

      const existing = scheduleStore.getSchedule(id);
      if (!existing) {
        return res.status(404).json({ error: "日程不存在" });
      }
      if (existing.user_id !== userId) {
        return res.status(403).json({ error: "无权操作该日程" });
      }

      const schedule = toggleScheduleCompletion(id, userId);
      const action = schedule?.is_completed ? '标记完成' : '取消完成';
      addLog('info', 'schedule', action, { id: schedule?.id });
      res.json({ schedule });
    } catch (error: any) {
      addLog('error', 'schedule', `切换状态失败: ${error.message}`);
      console.error("[Toggle Schedule] Error:", error);
      res.status(500).json({ error: error?.message || "操作失败" });
    }
  });

  app.post("/api/schedules/:id/actions", authenticate, (req, res) => {
    try {
      const userId = (req as any).user?.userId;
      const schedule = scheduleStore.getSchedule(req.params.id);
      if (!schedule) return res.status(404).json({ error: '日程不存在' });
      if (schedule.user_id !== userId) return res.status(403).json({ error: '无权操作该日程' });
      if (schedule.id.startsWith('reminder-cycle:')) return res.status(400).json({ error: '周期事务请在周期事务页面操作' });
      if (schedule.is_completed) return res.status(400).json({ error: '已完成事项不能执行该操作' });

      const action = String(req.body?.action || '');
      if (action === 'defer-one-day') {
        if (schedule.is_unscheduled) return res.status(400).json({ error: '无固定期限待办不能顺延' });
        const updated = scheduleStore.updateSchedule(schedule.id, {
          start_time: shiftScheduleDateValue(schedule.start_time),
          end_time: schedule.end_time ? shiftScheduleDateValue(schedule.end_time) : undefined,
        });
        if (!updated) return res.status(404).json({ error: '日程不存在' });
        addLog('info', 'schedule', '行动中心顺延日程一天', { userId, scheduleId: schedule.id });
        return res.json({ action, schedule: updated });
      }

      if (action === 'convert-to-unscheduled') {
        if (schedule.is_unscheduled) return res.status(400).json({ error: '事项已经是无固定期限待办' });
        const updated = scheduleStore.updateSchedule(schedule.id, {
          type: 'todo',
          start_time: new Date().toISOString(),
          end_time: undefined,
          all_day: false,
          is_unscheduled: true,
          reminders: [],
          is_repeated: false,
          repeat_rule: undefined,
        });
        if (!updated) return res.status(404).json({ error: '日程不存在' });
        addLog('info', 'schedule', '行动中心转为无固定期限待办', { userId, scheduleId: schedule.id });
        return res.json({ action, schedule: updated });
      }

      return res.status(400).json({ error: '未知日程操作' });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '日程操作失败' });
    }
  });

  // 获取所有分类
  app.get("/api/categories", authenticate, (req, res) => {
    try {
      const categories = scheduleStore.getAllCategories((req as any).user.userId);
      res.json({ categories });
    } catch (error: any) {
      console.error("[Categories] Error:", error);
      res.status(500).json({ error: error?.message || "获取分类失败" });
    }
  });

  // 创建分类
  app.post("/api/categories", authenticate, (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: '分类名称不能为空' });
      if (name.length > 50) return res.status(400).json({ error: '分类名称不能超过 50 个字符' });
      const category = {
        id: uuidv4(),
        user_id: (req as any).user.userId,
        name,
        color: String(req.body?.color || '#5b8ff9').slice(0, 32),
        icon: String(req.body?.icon || 'folder').slice(0, 64),
      };

      const created = scheduleStore.createCategory(category);
      addLog('info', 'schedule', '创建分类', { id: created?.id });
      res.json({ category: created });
    } catch (error: any) {
      addLog('error', 'schedule', `创建分类失败: ${error.message}`);
      console.error("[Create Category] Error:", error);
      res.status(500).json({ error: error?.message || "创建分类失败" });
    }
  });

  // 删除分类
  app.delete("/api/categories/:id", authenticate, (req, res) => {
    try {
      const { id } = req.params;
      const success = scheduleStore.deleteCategory(id, (req as any).user.userId);

      if (!success) {
        return res.status(400).json({ error: "无法删除该分类" });
      }

      addLog('warn', 'schedule', `删除分类: ${id}`);
      res.json({ success: true });
    } catch (error: any) {
      addLog('error', 'schedule', `删除分类失败: ${error.message}`);
      console.error("[Delete Category] Error:", error);
      res.status(500).json({ error: error?.message || "删除分类失败" });
    }
  });

  // ============= 日程表（Calendars）API =============

  // 获取所有日程表
  app.get("/api/calendars", authenticate, (req, res) => {
    try {
      const calendars = scheduleStore.getAllCalendars((req as any).user.userId);
      res.json({ calendars });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "获取日程表失败" });
    }
  });

  // 创建日程表
  app.post("/api/calendars", authenticate, (req, res) => {
    try {
      const name = String(req.body?.name || '新日程表').trim();
      const color = String(req.body?.color || '#3B82F6').trim();
      const icon = String(req.body?.icon || '📅').trim();
      if (!name || name.length > 50) return res.status(400).json({ error: '日历名称必须为 1 到 50 个字符' });
      if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return res.status(400).json({ error: '日历颜色格式不正确' });
      if (!icon || icon.length > 32) return res.status(400).json({ error: '日历图标格式不正确' });
      const calendar = {
        id: uuidv4(),
        user_id: (req as any).user.userId,
        name,
        color,
        icon,
        is_visible: true,
        is_default: false,
      };
      const created = scheduleStore.createCalendar(calendar);
      addLog('info', 'schedule', '创建日历', { id: created?.id });
      res.json({ calendar: created });
    } catch (error: any) {
      addLog('error', 'schedule', `创建日历失败: ${error.message}`);
      res.status(500).json({ error: error?.message || "创建日程表失败" });
    }
  });

  // 更新日程表
  app.put("/api/calendars/:id", authenticate, (req, res) => {
    try {
      const { id } = req.params;
      const updates: any = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();
        if (!name || name.length > 50) return res.status(400).json({ error: '日历名称必须为 1 到 50 个字符' });
        updates.name = name;
      }
      if (req.body?.color !== undefined) {
        const color = String(req.body.color).trim();
        if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return res.status(400).json({ error: '日历颜色格式不正确' });
        updates.color = color;
      }
      if (req.body?.icon !== undefined) {
        const icon = String(req.body.icon).trim();
        if (!icon || icon.length > 32) return res.status(400).json({ error: '日历图标格式不正确' });
        updates.icon = icon;
      }
      if (req.body?.is_visible !== undefined) {
        if (typeof req.body.is_visible !== 'boolean') return res.status(400).json({ error: '日历可见状态格式不正确' });
        updates.is_visible = req.body.is_visible;
      }
      const updated = scheduleStore.updateCalendar(id, updates, (req as any).user.userId);
      if (!updated) return res.status(404).json({ error: "日程表不存在" });
      addLog('info', 'schedule', '更新日历', { id: updated.id });
      res.json({ calendar: updated });
    } catch (error: any) {
      addLog('error', 'schedule', `更新日历失败: ${error.message}`);
      res.status(500).json({ error: error?.message || "更新日程表失败" });
    }
  });

  // 删除日程表
  app.delete("/api/calendars/:id", authenticate, (req, res) => {
    try {
      const { id } = req.params;
      const success = scheduleStore.deleteCalendar(id, (req as any).user.userId);
      if (!success) return res.status(400).json({ error: "无法删除该日程表（默认日程表不可删除）" });
      addLog('warn', 'schedule', `删除日历: ${id}`);
      res.json({ success: true });
    } catch (error: any) {
      addLog('error', 'schedule', `删除日历失败: ${error.message}`);
      res.status(500).json({ error: error?.message || "删除日程表失败" });
    }
  });

  // ============= AI 智能对话接口（双向交互） =============

  // 【增强】解析用户消息中的日期（支持更多相对日期）

  app.get("/api/schedules/by-date/:date", authenticate, (req, res) => {
    try {
      const userId = (req as any).user?.userId;
      const { date } = req.params;
      const schedules = scheduleStore.getSchedulesByDate(date, userId);
      res.json({ schedules });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || '获取失败' });
    }
  });
  return app;
}
