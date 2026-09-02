import * as activityStore from './activity-store.js';
import * as db from './db.js';
import * as reminderStore from './reminder-store.js';
import * as scheduleStore from './schedule-store.js';
import * as noteItemService from './note-item-service.js';

export interface ReadableUserExport {
  format: 'ai-calendar-readable-export';
  version: 1;
  exportedAt: string;
  account: {
    email: string;
    createdAt: string;
  };
  preferences: Record<string, unknown> | null;
  calendars: scheduleStore.Calendar[];
  categories: scheduleStore.Category[];
  schedules: scheduleStore.Schedule[];
  recurringTasks: reminderStore.ReminderTask[];
  recurringCycles: reminderStore.ReminderCycle[];
  noteItems: noteItemService.NoteItem[];
  completions: activityStore.CompletionRecord[];
  dailyReports: activityStore.DailyReportRecord[];
  attachments: Array<{
    id: string;
    completionId: string | null;
    importId: string | null;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    createdAt: string;
  }>;
}

function readablePreferences(reminder: db.DbReminder | null): Record<string, unknown> | null {
  if (!reminder) return null;
  return {
    dailyReminderEnabled: Boolean(reminder.enabled),
    dailyReminderTime: `${String(reminder.hour).padStart(2, '0')}:${String(reminder.minute).padStart(2, '0')}`,
    reminderEmail: reminder.reminder_email || null,
    emailEnabled: Boolean(reminder.email_enabled),
    reportEmailEnabled: Boolean(reminder.report_email_enabled),
    inAppEnabled: Boolean(reminder.in_app_enabled),
    browserEnabled: Boolean(reminder.browser_enabled),
    timezone: reminder.timezone || 'Asia/Shanghai',
    quietHours: {
      enabled: Boolean(reminder.quiet_hours_enabled),
      start: reminder.quiet_start || '22:00',
      end: reminder.quiet_end || '08:00',
    },
    homeLocation: reminder.home_location_name ? {
      name: reminder.home_location_name,
      admin1: reminder.home_location_admin1 || null,
      country: reminder.home_location_country || null,
      latitude: reminder.home_latitude ?? null,
      longitude: reminder.home_longitude ?? null,
      timezone: reminder.home_timezone || null,
    } : null,
  };
}

export function createReadableUserExport(userId: string, exportedAt = new Date().toISOString()): ReadableUserExport {
  const account = db.exportUserAccountData(userId);
  if (!account.user) throw new Error('账号不存在');
  const schedule = scheduleStore.exportUserScheduleData(userId);
  const reminder = reminderStore.exportUserReminderData(userId);
  return {
    format: 'ai-calendar-readable-export',
    version: 1,
    exportedAt,
    account: {
      email: account.user.email,
      createdAt: account.user.created_at,
    },
    preferences: readablePreferences(account.reminder),
    calendars: schedule.calendars,
    categories: schedule.categories,
    schedules: schedule.schedules,
    recurringTasks: reminder.tasks,
    recurringCycles: reminder.cycles,
    noteItems: noteItemService.exportNoteItems(userId),
    completions: activityStore.listCompletions(userId),
    dailyReports: activityStore.listDailyReports(userId),
    attachments: activityStore.listAttachments(userId).map(file => ({
      id: file.id,
      completionId: file.completionId,
      importId: file.importId,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      createdAt: file.createdAt,
    })),
  };
}

export function protectCsvFormula(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown): string {
  const safe = protectCsvFormula(value).replace(/"/g, '""');
  return /[",\r\n]/.test(safe) ? `"${safe}"` : safe;
}

export function renderSchedulesCsv(schedules: scheduleStore.Schedule[]): string {
  const headers = [
    '标题', '类型', '开始时间', '结束时间', '全天', '地点', '备注', '分类', '优先级', '完成状态', '重复', '创建时间', '更新时间',
  ];
  const rows = schedules.map(item => [
    item.title,
    item.type,
    item.start_time,
    item.end_time || '',
    item.all_day ? '是' : '否',
    item.location || '',
    item.notes || '',
    item.category,
    item.priority,
    item.is_completed ? '已完成' : '未完成',
    item.is_repeated ? '是' : '否',
    item.created_at,
    item.updated_at,
  ]);
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function createSchedulesCsv(userId: string): string {
  return renderSchedulesCsv(scheduleStore.getAllSchedules(userId));
}
