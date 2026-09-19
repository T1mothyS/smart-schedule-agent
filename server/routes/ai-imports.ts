import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { normaliseReminderConfig } from '../reminder-input.js';
import { getMissingCodeBuddyCredentialMessage, resolveAiImportCredential } from '../ai-credentials.js';
import { pollEmailImports } from '../email-import-service.js';
import { describeError } from '../runtime/logging.js';
import { executeOnce } from '../operation-service.js';

import { v4 as uuidv4 } from 'uuid';
import * as dbModule from '../db.js';
import * as scheduleStore from '../schedule-store.js';
import * as reminderStore from '../reminder-store.js';
import * as reminderCalendarSync from '../reminder-calendar-sync.js';
import * as activityStore from '../activity-store.js';
import { parseAiImport, type AiImportDraft } from '../ai-import-service.js';
import { addLog } from '../log-service.js';

export function createAiImportsRouter({ authenticate }: Pick<ReturnType<typeof createAuth>, 'authenticate'>) {
  const app = Router();
  app.post("/api/ai/imports/parse", authenticate, async (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const credential = resolveAiImportCredential(userId);
      if (!credential) return res.status(400).json({ error: getMissingCodeBuddyCredentialMessage(userId) });
      const images = Array.isArray(req.body.images) ? req.body.images.map((image: any) => ({
        name: String(image.name || 'image'),
        mimeType: String(image.mimeType || ''),
        base64: String(image.base64 || ''),
      })) : [];
      const draft = await parseAiImport({
        text: String(req.body.text || ''),
        images,
        ...credential,
      });
      const record = activityStore.createAiImport({
        userId,
        sourceType: images.length ? 'image' : 'text',
        inputText: String(req.body.text || '') || null,
        draft,
      });
      res.json({ import: record });
    } catch (error: any) {
      const status = String(error?.message || '').includes('上一项导入') ? 429 : 400;
      res.status(status).json({ error: error?.message || 'AI 识别失败' });
    }
  });

  app.get("/api/ai/imports", authenticate, (req, res) => {
    res.json({ imports: activityStore.listAiImports((req as any).user.userId, String(req.query.status || 'draft')) });
  });

  app.get("/api/ai/imports/:id", authenticate, (req, res) => {
    const record = activityStore.getAiImport(req.params.id, (req as any).user.userId);
    if (!record) return res.status(404).json({ error: '导入草稿不存在' });
    res.json({ import: record });
  });

  app.post("/api/ai/imports/:id/confirm", authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const replay = dbModule.getOperationResult(userId, 'ai-import', req.params.id);
      if (replay !== undefined) return res.json(replay);
      const current = activityStore.getAiImport(req.params.id, userId);
      if (!current || current.status !== 'draft') return res.status(404).json({ error: '导入草稿不存在或已经处理' });
      const draft = { ...current.draft, ...req.body.draft } as unknown as AiImportDraft;
      if (!draft.title || !/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) return res.status(400).json({ error: '标题和到期日期不能为空' });
      const response = executeOnce(userId, 'ai-import', req.params.id, () => {
        let created: unknown;
        if (draft.kind === 'recurring') {
          const date = draft.dueDate;
          const task = reminderStore.createReminderTask({
            userId,
            type: 'generic',
            name: draft.title,
            timezone: reminderStore.DEFAULT_CYCLE_REMINDER_TIMEZONE,
            config: normaliseReminderConfig('generic', {
              templateKey: draft.templateKey,
              rule: {
                frequency: draft.recurrence?.frequency || 'once',
                anchorDate: date,
                dayOfMonth: Number(date.slice(8, 10)),
                month: Number(date.slice(5, 7)),
                interval: draft.recurrence?.interval || 1,
                unit: draft.recurrence?.unit || 'day',
                advancePolicy: draft.recurrence?.advancePolicy || 'calendar',
              },
              reminderOffsets: draft.reminderOffsets,
              reminderTime: draft.dueTime || reminderStore.DEFAULT_CYCLE_REMINDER_TIME,
              actionGuide: draft.actionGuide,
              priority: 'medium',
            }),
          });
          reminderCalendarSync.syncReminderTaskToCalendar(task);
          created = task;
        } else {
          created = scheduleStore.createSchedule({
            id: uuidv4(),
            user_id: userId,
            calendar_id: 'personal',
            type: 'todo',
            title: draft.title,
            description: draft.notes || undefined,
            start_time: draft.dueDate + 'T' + (draft.dueTime || '00:00') + ':00',
            end_time: undefined,
            all_day: !draft.dueTime,
            location: undefined,
            notes: draft.actionGuide || undefined,
            category: 'other',
            priority: 'medium',
            is_completed: false,
            is_repeated: false,
            repeat_rule: undefined,
            reminders: (draft.reminderOffsets || []).map(value => String(value)),
            is_high_risk: false,
          });
        }
        const confirmed = activityStore.confirmAiImport(req.params.id, userId, draft as unknown as Record<string, unknown>);
        return { import: confirmed, created };
      });
      res.json(response);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '确认导入失败' });
    }
  });

  app.delete("/api/ai/imports/:id", authenticate, (req, res) => {
    const success = activityStore.deleteAiImport(req.params.id, (req as any).user.userId);
    if (!success) return res.status(404).json({ error: '导入草稿不存在' });
    res.json({ success: true });
  });

  app.get("/api/email-import/settings", authenticate, (req, res) => {
    res.json({
      setting: activityStore.getEmailImportSetting((req as any).user.userId),
      imapConfigured: !!process.env.IMAP_USER && !!process.env.IMAP_PASS,
    });
  });

  app.put("/api/email-import/settings", authenticate, (req, res) => {
    const setting = activityStore.updateEmailImportSetting((req as any).user.userId, !!req.body.enabled, !!req.body.regenerate);
    res.json({ setting });
  });

  app.post("/api/email-import/check", authenticate, async (req, res) => {
    const userId = (req as any).user.userId;
    const setting = activityStore.getEmailImportSetting(userId);
    if (!setting.enabled) return res.status(400).json({ error: '请先开启邮箱自动识别' });

    const result = await pollEmailImports({
      onlyUserId: userId,
      resolveCredential: resolveAiImportCredential,
      log: (message, error) => error
        ? addLog('error', 'ai', message, { error: describeError(error) })
        : addLog('info', 'ai', message),
    });
    const statusCode = result.status === 'error' ? 502 : result.status === 'busy' ? 409 : 200;
    res.status(statusCode).json({ result });
  });

  // ============= 日程管理 API =============
  return app;
}
