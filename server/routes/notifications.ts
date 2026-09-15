import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { type JwtPayload } from '../auth.js';
import { describeErrorData } from '../runtime/logging.js';

import { v4 as uuidv4 } from 'uuid';
import * as dbModule from '../db.js';
import * as activityStore from '../activity-store.js';
import { getWeatherErrorKind, searchLocations } from '../weather-service.js';
import { addLog } from '../log-service.js';
import * as db from '../db.js';

export function createNotificationsRouter({ authenticate }: Pick<ReturnType<typeof createAuth>, 'authenticate'>) {
  const app = Router();
  app.get("/api/notification-preferences", authenticate, (req, res) => {
    const payload = (req as any).user as JwtPayload;
    const preference = db.getReminder(payload.userId);
    res.json({
      preference: {
        enabled: !!preference?.enabled,
        hour: preference?.hour ?? 8,
        minute: preference?.minute ?? 0,
        reminderEmail: preference?.reminder_email || payload.email,
        emailEnabled: preference?.email_enabled !== 0,
        reportEmailEnabled: preference?.report_email_enabled === 1,
        inAppEnabled: preference?.in_app_enabled !== 0,
        browserEnabled: preference?.browser_enabled !== 0,
        timezone: preference?.timezone || 'Asia/Shanghai',
        quietHoursEnabled: !!preference?.quiet_hours_enabled,
        quietStart: preference?.quiet_start || '22:00',
        quietEnd: preference?.quiet_end || '08:00',
        homeLocation: preference?.home_location_name && preference.home_latitude != null && preference.home_longitude != null
          ? {
              name: preference.home_location_name,
              admin1: preference.home_location_admin1 || null,
              country: preference.home_location_country || null,
              latitude: Number(preference.home_latitude),
              longitude: Number(preference.home_longitude),
              timezone: preference.home_timezone || preference.timezone || 'Asia/Shanghai',
            }
          : null,
      },
    });
  });

  app.put("/api/notification-preferences", authenticate, (req, res) => {
    const payload = (req as any).user as JwtPayload;
    try {
      const current = db.getReminder(payload.userId);
      const reminderEmail = String(req.body.reminderEmail ?? current?.reminder_email ?? payload.email).trim();
      const hour = Number(req.body.hour ?? current?.hour ?? 8);
      const minute = Number(req.body.minute ?? current?.minute ?? 0);
      const timezone = String(req.body.timezone ?? current?.timezone ?? 'Asia/Shanghai').trim();
      const quietStart = String(req.body.quietStart ?? current?.quiet_start ?? '22:00');
      const quietEnd = String(req.body.quietEnd ?? current?.quiet_end ?? '08:00');
      const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reminderEmail)) throw new Error('提醒邮箱格式不正确');
      if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
        throw new Error('每日提醒时间不正确');
      }
      if (!timePattern.test(quietStart) || !timePattern.test(quietEnd)) throw new Error('免打扰时间格式不正确');
      try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); }
      catch { throw new Error('提醒时区不正确'); }
      const homeFields: Partial<dbModule.DbReminder> = {};
      if (Object.prototype.hasOwnProperty.call(req.body, 'homeLocation')) {
        const location = req.body.homeLocation;
        if (location == null) {
          Object.assign(homeFields, {
            home_location_name: null,
            home_location_admin1: null,
            home_location_country: null,
            home_latitude: null,
            home_longitude: null,
            home_timezone: null,
          });
        } else {
          const name = String(location.name || '').trim();
          const latitude = Number(location.latitude);
          const longitude = Number(location.longitude);
          const timezone = String(location.timezone || '').trim();
          if (!name || name.length > 100) throw new Error('常驻地名称不正确');
          if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
            throw new Error('常驻地坐标不正确');
          }
          try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); }
          catch { throw new Error('常驻地时区不正确'); }
          Object.assign(homeFields, {
            home_location_name: name,
            home_location_admin1: String(location.admin1 || '').trim().slice(0, 100) || null,
            home_location_country: String(location.country || '').trim().slice(0, 100) || null,
            home_latitude: latitude,
            home_longitude: longitude,
            home_timezone: timezone,
          });
        }
      }
      const now = new Date().toISOString();
      const saved = db.upsertReminder({
        id: current?.id || uuidv4(),
        user_id: payload.userId,
        enabled: (req.body.enabled ?? !!current?.enabled) ? 1 : 0,
        hour,
        minute,
        reminder_email: reminderEmail,
        email_enabled: req.body.emailEnabled === undefined ? (current?.email_enabled ?? 1) : (req.body.emailEnabled ? 1 : 0),
        report_email_enabled: req.body.reportEmailEnabled === undefined ? (current?.report_email_enabled ?? 0) : (req.body.reportEmailEnabled ? 1 : 0),
        in_app_enabled: req.body.inAppEnabled === undefined ? (current?.in_app_enabled ?? 1) : (req.body.inAppEnabled ? 1 : 0),
        browser_enabled: req.body.browserEnabled === undefined ? (current?.browser_enabled ?? 1) : (req.body.browserEnabled ? 1 : 0),
        timezone,
        quiet_hours_enabled: req.body.quietHoursEnabled === undefined ? (current?.quiet_hours_enabled ?? 0) : (req.body.quietHoursEnabled ? 1 : 0),
        quiet_start: quietStart,
        quiet_end: quietEnd,
        ...homeFields,
        created_at: current?.created_at || now,
        updated_at: now,
      });
      const persisted = db.getReminder(payload.userId) || saved;
      addLog('info', 'reminder', '通知设置已保存', {
        event: 'notification_preferences_saved',
        userId: payload.userId,
        before: current ? {
          enabled: Boolean(current.enabled),
          time: `${String(current.hour).padStart(2, '0')}:${String(current.minute).padStart(2, '0')}`,
          reminderEmail: current.reminder_email || null,
          emailEnabled: current.email_enabled !== 0,
          reportEmailEnabled: current.report_email_enabled === 1,
          inAppEnabled: current.in_app_enabled !== 0,
          browserEnabled: current.browser_enabled !== 0,
          timezone: current.timezone || 'Asia/Shanghai',
        } : null,
        after: {
          enabled: Boolean(persisted.enabled),
          time: `${String(persisted.hour).padStart(2, '0')}:${String(persisted.minute).padStart(2, '0')}`,
          reminderEmail: persisted.reminder_email || null,
          emailEnabled: persisted.email_enabled !== 0,
          reportEmailEnabled: persisted.report_email_enabled === 1,
          inAppEnabled: persisted.in_app_enabled !== 0,
          browserEnabled: persisted.browser_enabled !== 0,
          timezone: persisted.timezone || 'Asia/Shanghai',
        },
      });
      res.json({ success: true, preference: saved });
    } catch (error: any) {
      addLog('error', 'reminder', '通知设置保存失败', describeErrorData(error, {
        event: 'notification_preferences_save_failed',
        userId: payload.userId,
      }));
      res.status(400).json({ error: error?.message || '保存通知设置失败' });
    }
  });

  app.get('/api/weather/locations', authenticate, async (req, res) => {
    try {
      const query = String(req.query.q || '').trim();
      if (query.length < 2) return res.status(400).json({ error: '请至少输入两个字符搜索地点' });
      const locations = await searchLocations(query);
      res.json({ locations });
    } catch (error: any) {
      addLog('warn', 'weather', '天气地点搜索失败', {
        event: 'weather_location_search_failed',
        failureKind: getWeatherErrorKind(error),
        queryLength: String(req.query.q || '').trim().length,
      });
      res.status(getWeatherErrorKind(error) === 'timeout' ? 504 : 502).json({ error: error?.message || '地点搜索暂时不可用' });
    }
  });

  app.get("/api/notifications", authenticate, (req, res) => {
    const userId = (req as any).user.userId;
    const notifications = activityStore.listNotifications(userId, {
      status: req.query.status ? String(req.query.status) : undefined,
      channel: req.query.channel ? String(req.query.channel) : undefined,
      unreadOnly: req.query.unread === '1',
      limit: Number(req.query.limit || 100),
    });
    res.json({ notifications, unread: activityStore.listNotifications(userId, { unreadOnly: true, limit: 500 }).length });
  });

  app.post("/api/notifications/:id/read", authenticate, (req, res) => {
    const item = activityStore.markNotificationRead(req.params.id, (req as any).user.userId);
    if (!item) return res.status(404).json({ error: '通知不存在' });
    res.json({ notification: item });
  });

  app.post("/api/notifications/:id/retry", authenticate, (req, res) => {
    const userId = (req as any).user.userId;
    const current = activityStore.getNotification(req.params.id, userId);
    if (current?.kind === 'daily_report' && req.body?.confirm !== true) {
      return res.status(400).json({ error: '日报邮件重试需要明确确认' });
    }
    const item = activityStore.retryNotification(req.params.id, userId);
    if (!item) {
      addLog('warn', 'reminder', '手动重试通知失败：通知不存在或状态不可重试', {
        event: 'notification_retry_not_found',
        userId,
        notificationId: req.params.id,
      });
      return res.status(404).json({ error: '失败通知不存在' });
    }
    addLog('info', 'reminder', '用户手动重试通知', {
      event: 'notification_retry_requested',
      userId,
      notificationId: item.id,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      channel: item.channel,
      kind: item.kind,
      status: item.status,
      attempts: item.attempts,
      nextRetryAt: item.nextRetryAt,
    });
    res.json({ notification: item });
  });
  return app;
}
