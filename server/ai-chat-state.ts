import { normaliseScheduleApiFields } from './schedule-input.js';
import { normaliseReminderConfig } from './reminder-input.js';
import { getLocalDateString } from './local-date.js';
import { withPersistenceTransaction } from './persistence.js';

import { v4 as uuidv4 } from 'uuid';
import * as dbModule from './db.js';
import * as scheduleStore from './schedule-store.js';
import * as reminderStore from './reminder-store.js';
import * as reminderCalendarSync from './reminder-calendar-sync.js';
import { getDailyWeather, type WeatherLocation } from './weather-service.js';
import { addLog } from './log-service.js';
import { type KnowledgeSearchMatch } from './search-service.js';
import { rawOperationsFromSnapshot, type PendingAiOperation } from './ai-plan.js';
import * as db from './db.js';
import { parseHistoryJson } from './ai-history.js';

export function parseQueryDatesForCards(message: string, todayStr: string): string[] {
  const now = new Date();
  const today = todayStr || getLocalDateString(now);
  const msgLower = message.toLowerCase();
  const msgRaw = message;
  const dates: string[] = [];

  const addDate = (dateStr: string) => {
    if (!dates.includes(dateStr)) dates.push(dateStr);
  };

  // 【关键修复】先检测"今天"，否则默认返回今天
  const hasToday = msgLower.includes('今天') || msgLower.includes('今日') || msgLower.includes('本日');
  if (hasToday) {
    addDate(today);
  }

  // 辅助函数：计算N天后的日期（本地时区）
  const getDateStr = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return getLocalDateString(d);
  };

  const tomorrowStr = getDateStr(1);
  const dayAfterTomorrowStr = getDateStr(2);
  const yesterdayStr = getDateStr(-1);

  // 检测"明天"
  const hasTomorrow = msgLower.includes('明天') || msgLower.includes('明日') || msgLower.includes('tomorrow');
  if (hasTomorrow) {
    addDate(tomorrowStr);
  }

  // 检测"后天"
  const hasDayAfter = msgLower.includes('后天') || msgLower.includes('后日');
  if (hasDayAfter) {
    addDate(dayAfterTomorrowStr);
  }

  // 【新增】检测"两天后"、"3天后"等
  const afterMatch = msgRaw.match(/(\d+)天后?/);
  if (afterMatch) {
    const days = parseInt(afterMatch[1]);
    if (days >= 1 && days <= 30) {
      addDate(getDateStr(days));
    }
  }

  // 检测"昨天"
  const hasYesterday = msgLower.includes('昨天') || msgLower.includes('昨日') || msgLower.includes('yesterday');
  if (hasYesterday) {
    addDate(yesterdayStr);
  }

  // 【新增】检测"大前天"、"前天"
  const hasDayBeforeYesterday = msgLower.includes('大前天') || msgLower.includes('大前日');
  if (hasDayBeforeYesterday) {
    addDate(getDateStr(-3));
  }
  const hasTwoDaysAgo = msgLower.includes('前天');
  if (hasTwoDaysAgo) {
    addDate(getDateStr(-2));
  }

  // 【新增】检测"本周"
  const hasThisWeek = msgLower.includes('本周') || msgLower.includes('这周') || msgLower.includes('this week');
  if (hasThisWeek) {
    // 本周：从今天到本周日
    const dayOfWeek = now.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    for (let i = 0; i <= daysUntilSunday; i++) {
      addDate(getDateStr(i));
    }
  }

  // 【新增】检测"下周"
  const hasNextWeek = msgLower.includes('下周') || msgLower.includes('下星期') || msgLower.includes('next week');
  if (hasNextWeek) {
    const nextWeekStart = getDateStr(7 - now.getDay() + 1); // 下周一
    for (let i = 0; i < 7; i++) {
      addDate(getDateStr(7 - now.getDay() + 1 + i));
    }
  }

  // 【新增】检测"本月"
  const hasThisMonth = msgLower.includes('本月') || msgLower.includes('这月');
  if (hasThisMonth) {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let d = now.getDate(); d <= lastDay; d++) {
      const dt = new Date(now.getFullYear(), now.getMonth(), d);
      addDate(getLocalDateString(dt));
    }
  }

  // 下周几
  const getNextWeekday = (d: number) => {
    const daysUntil = (d - now.getDay() + 7) % 7 || 7;
    const dt = new Date(now);
    dt.setDate(dt.getDate() + daysUntil);
    return getLocalDateString(dt);
  };

  if (msgLower.includes('下周一') || msgLower.includes('下星期一')) addDate(getNextWeekday(1));
  if (msgLower.includes('下周二') || msgLower.includes('下星期二')) addDate(getNextWeekday(2));
  if (msgLower.includes('下周三') || msgLower.includes('下星期三')) addDate(getNextWeekday(3));
  if (msgLower.includes('下周四') || msgLower.includes('下星期四')) addDate(getNextWeekday(4));
  if (msgLower.includes('下周五') || msgLower.includes('下星期五')) addDate(getNextWeekday(5));
  if (msgLower.includes('下周六') || msgLower.includes('下星期六')) addDate(getNextWeekday(6));
  if (msgLower.includes('下周日') || msgLower.includes('下星期日') || msgLower.includes('下周末')) addDate(getNextWeekday(0));

  // 周几（本周）
  const getThisWeekday = (d: number) => {
    const daysUntil = (d - now.getDay() + 7) % 7;
    const dt = new Date(now);
    dt.setDate(dt.getDate() + daysUntil);
    return getLocalDateString(dt);
  };

  if (msgLower.includes('周一') || msgLower.includes('星期一')) addDate(getThisWeekday(1));
  if (msgLower.includes('周二') || msgLower.includes('星期二')) addDate(getThisWeekday(2));
  if (msgLower.includes('周三') || msgLower.includes('星期三')) addDate(getThisWeekday(3));
  if (msgLower.includes('周四') || msgLower.includes('星期四')) addDate(getThisWeekday(4));
  if (msgLower.includes('周五') || msgLower.includes('星期五')) addDate(getThisWeekday(5));
  if (msgLower.includes('周六') || msgLower.includes('星期六')) addDate(getThisWeekday(6));
  if (msgLower.includes('周日') || msgLower.includes('星期日') || msgLower.includes('周末')) addDate(getThisWeekday(0));

  // 具体日期：4月10号、4-10、2026-04-10
  const patterns = [/(\d{1,2})月(\d{1,2})[日号]?/g, /(\d{1,2})-(\d{1,2})/g, /(\d{4})-(\d{1,2})-(\d{1,2})/g];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(msgRaw)) !== null) {
      let year = now.getFullYear(), month, day;
      if (m[3]) { year = parseInt(m[1]); month = parseInt(m[2]); day = parseInt(m[3]); }
      else { month = parseInt(m[1]); day = parseInt(m[2]); }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const dt = new Date(year, month - 1, day);
        const daysDiff = Math.floor((dt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff >= -7 && daysDiff <= 60) addDate(getLocalDateString(dt));
      }
    }
  }

  // 【关键】默认只返回今天
  if (dates.length === 0) {
    addDate(today);
    // 如果没有检测到任何日期引用，默认也添加明天以便AI有更多上下文
    addDate(tomorrowStr);
  }

  return dates;
}

// 检查登录状态的辅助函数
export const AI_CATEGORY_LABELS_CN: Record<string, string> = {
  travel: '出行', work: '工作', social: '社交', life: '生活', health: '健康', other: '其他'
};

export function formatAiQueryDateLabel(dateStr: string) {
  const date = new Date(`${dateStr}T12:00:00`);
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日（${weekday}）`;
}

export function joinAiLabels(labels: string[]) {
  if (labels.length <= 1) return labels.join('');
  if (labels.length === 2) return labels.join('和');
  return labels.slice(0, -1).join('、') + '和' + labels[labels.length - 1];
}

export function buildCompactScheduleQueryReply(items: any[], queryDates: string[], today: string) {
  const subject = queryDates.length === 1 && queryDates[0] === today
    ? '今天'
    : queryDates.map(formatAiQueryDateLabel).join('、') || '所选日期';
  if (items.length === 0) return `${subject}暂无安排。`;

  const describePeriod = (label: string, periodItems: any[]) => {
    if (periodItems.length === 0) return '';
    const categories = [...new Set(periodItems.map(item => AI_CATEGORY_LABELS_CN[item.category] || '其他'))];
    return `${label}有${joinAiLabels(categories)}安排`;
  };
  const allDayItems = items.filter(item => item.all_day);
  const timedItems = items.filter(item => !item.all_day);
  const morning = timedItems.filter(item => Number(item.start_time.slice(11, 13)) < 12);
  const afternoon = timedItems.filter(item => {
    const hour = Number(item.start_time.slice(11, 13));
    return hour >= 12 && hour < 18;
  });
  const evening = timedItems.filter(item => Number(item.start_time.slice(11, 13)) >= 18);
  const details = [
    describePeriod('上午', morning),
    describePeriod('下午', afternoon),
    describePeriod('晚上', evening),
    allDayItems.length > 0 ? `另有 ${allDayItems.length} 项全天安排` : '',
  ].filter(Boolean);
  const density = items.length >= 4 ? '日程较满' : '已有安排';
  const summary = details.length > 0
    ? `${subject}${density}，${details.join('，')}，请注意合理安排时间。`
    : `${subject}${density}，请注意合理安排时间。`;
  return `${subject}共有 ${items.length} 项安排，以下是详情：\n\n${summary}`;
}

export function weatherDateForQuestion(text: string, timezone: string, fallback?: string): string {
  const today = reminderStore.todayInTimezone(timezone);
  if (/后天/.test(text)) return reminderStore.addDays(today, 2);
  if (/明天/.test(text)) return reminderStore.addDays(today, 1);
  return fallback && /^\d{4}-\d{2}-\d{2}$/.test(fallback) ? fallback : today;
}

export function homeWeatherLocation(preference: dbModule.DbReminder | undefined): WeatherLocation | null {
  if (!preference?.home_location_name || preference.home_latitude == null || preference.home_longitude == null) return null;
  return {
    id: 0,
    name: preference.home_location_name,
    admin1: preference.home_location_admin1 || null,
    admin2: null,
    country: preference.home_location_country || null,
    countryCode: null,
    latitude: Number(preference.home_latitude),
    longitude: Number(preference.home_longitude),
    timezone: preference.home_timezone || preference.timezone || 'Asia/Shanghai',
    displayName: [preference.home_location_name, preference.home_location_admin1, preference.home_location_country].filter(Boolean).join(' · '),
  };
}

export function formatWeatherReply(location: WeatherLocation, weather: Awaited<ReturnType<typeof getDailyWeather>>): string {
  const temperatures = weather.temperatureMin == null || weather.temperatureMax == null
    ? '气温数据暂缺'
    : `${Math.round(weather.temperatureMin)}～${Math.round(weather.temperatureMax)}℃`;
  const rain = weather.precipitationProbabilityMax == null
    ? ''
    : `，最高降雨概率 ${Math.round(weather.precipitationProbabilityMax)}%`;
  const wind = weather.windSpeedMax == null ? '' : `，最大风速约 ${Math.round(weather.windSpeedMax)} km/h`;
  const source = weather.source === 'cache'
    ? `天气数据来自 Open-Meteo 缓存（${weather.retrievedAt} 获取，已缓存约 ${Math.max(1, Math.round(weather.cacheAgeMs / 60_000))} 分钟），仅供参考`
    : '天气数据来自 Open-Meteo 实时请求';
  return `${location.displayName} ${weather.date}：${weather.description}，${temperatures}${rain}${wind}。${source}，出行前建议再关注临近预报。`;
}

export interface PendingAiSchedulePlan {
  id: string;
  userId: string;
  targetCalendarId: string;
  today: string;
  intent: string;
  reply: string;
  warnings: string[];
  operations: PendingAiOperation[];
  expiresAt: number;
  historyMessageId?: string;
  confirmedResult?: any;
}

export interface AiChatRequestRecord {
  userId: string;
  state: 'processing' | 'completed';
  expiresAt: number;
  response?: any;
}

export const AI_SCHEDULE_PLAN_TTL_MS = 15 * 60 * 1000;
export const aiSchedulePlans = new Map<string, PendingAiSchedulePlan>();
export const aiChatRequestRecords = new Map<string, AiChatRequestRecord>();

export function buildAiKnowledgeSources(matches: KnowledgeSearchMatch[]) {
  return matches.map(match => ({
    id: match.id,
    title: match.title,
    summary: match.summary,
    snippet: match.snippet,
    sourceId: match.sourceId,
    sourceType: match.sourceType,
    sourceRef: match.sourceRef,
    sourceUrl: match.sourceUrl,
    type: match.type,
    tags: match.tags,
    updatedAt: match.updatedAt,
    target: match.target,
  }));
}

export function saveAiScheduleHistoryMessage(input: {
  userId: string;
  role: 'user' | 'assistant';
  type: string;
  content: string;
  intent?: string | null;
  scheduleItems?: unknown;
  plan?: unknown;
  knowledgeSources?: unknown;
}): dbModule.DbAiScheduleMessage {
  return db.createAiScheduleMessage({
    id: uuidv4(),
    user_id: input.userId,
    role: input.role,
    type: input.type,
    content: input.content,
    intent: input.intent || null,
    schedule_items: input.scheduleItems === undefined ? null : JSON.stringify(input.scheduleItems),
    plan: input.plan === undefined ? null : JSON.stringify(input.plan),
    knowledge_sources: input.knowledgeSources === undefined ? null : JSON.stringify(input.knowledgeSources),
    created_at: new Date().toISOString(),
  });
}

export function saveAiScheduleResponseHistory(userId: string, response: any): dbModule.DbAiScheduleMessage {
  const type = response.requiresConfirmation
    ? 'plan'
    : response.intent === 'chat' || response.intent === 'query' || response.intent === 'weather'
      ? 'text'
      : response.intent === 'update' || response.intent === 'delete'
        ? 'update'
        : 'schedules';
  return saveAiScheduleHistoryMessage({
    userId,
    role: 'assistant',
    type,
    content: String(response.reply || ''),
    intent: response.intent || null,
    scheduleItems: response.scheduleItems || [],
    plan: response.plan,
    knowledgeSources: response.knowledgeSources || [],
  });
}

export function cleanupExpiredAiScheduleState(): void {
  const now = Date.now();
  for (const [id, plan] of aiSchedulePlans) if (plan.expiresAt <= now) aiSchedulePlans.delete(id);
  for (const [id, request] of aiChatRequestRecords) if (request.expiresAt <= now) aiChatRequestRecords.delete(id);
}

export function hydratePendingAiSchedulePlans(userId: string, messages: dbModule.DbAiScheduleMessage[]): void {
  for (const message of messages) {
    if (message.role !== 'assistant' || message.type !== 'plan' || !message.plan) continue;
    const snapshot = parseHistoryJson(message.plan);
    if (!snapshot?.id || !snapshot?.expiresAt || Date.parse(String(snapshot.expiresAt)) <= Date.now()) continue;
    const operations = rawOperationsFromSnapshot(snapshot);
    if (!operations.length) continue;
    aiSchedulePlans.set(String(snapshot.id), {
      id: String(snapshot.id),
      userId,
      targetCalendarId: String(snapshot.targetCalendarId || 'personal'),
      today: String(snapshot.today || getLocalDateString()),
      intent: String(snapshot.intent || 'create'),
      reply: String(snapshot.reply || '已整理出待确认的执行计划。'),
      warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings.map(String) : [],
      operations,
      expiresAt: Date.parse(String(snapshot.expiresAt)),
      historyMessageId: message.id,
      confirmedResult: dbModule.getOperationResult(userId, 'ai-plan', String(snapshot.id)),
    });
  }
}

export function isAiChatRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{12,120}$/.test(value);
}

export function buildAiPlanWarnings(text: string, operations: any[], modelWarnings: unknown): string[] {
  const warnings = new Set<string>(Array.isArray(modelWarnings) ? modelWarnings.map(String).slice(0, 10) : []);
  const hasRecurringLanguage = /(每天|每日|每周|每月|每年|每隔\s*\d*\s*[天周月年])/.test(text);
  const hasRecurringOperation = operations.some(operation => operation?.type === 'create_recurring');
  if (hasRecurringLanguage && !hasRecurringOperation) {
    warnings.add('原文包含周期表述，但计划未生成周期事项；确认前请改为“周期事项”或补充周期。');
  }
  if (/(周[一二三四五六日天].{0,3}(前|内)|周内|下周|本周)/.test(text)) {
    warnings.add('原文含相对日期，请逐项核对计划中显示的公历日期与时间。');
  }
  if (operations.length > 1) {
    warnings.add('这是多事项计划；确认后会一次执行全部列出的操作。');
  }
  return [...warnings].slice(0, 10);
}

export function executeAiScheduleOperations(plan: PendingAiSchedulePlan) {
  const aggregate: ReturnType<typeof executeAiScheduleOperationBatch> = { createdSchedules: [], updatedSchedules: [], deletedIds: [], createdReminderTasks: [], failures: [], changed: false };
  for (const [index, operation] of plan.operations.entries()) {
    try {
      const result = withPersistenceTransaction(() => {
        const item = executeAiScheduleOperationBatch({ ...plan, operations: [operation] });
        if (item.failures.length) throw new Error(item.failures.map(failure => failure.message).join('；'));
        return item;
      });
      aggregate.createdSchedules.push(...result.createdSchedules);
      aggregate.updatedSchedules.push(...result.updatedSchedules);
      aggregate.deletedIds.push(...result.deletedIds);
      aggregate.createdReminderTasks.push(...result.createdReminderTasks);
      aggregate.changed ||= result.changed;
    } catch (error: any) {
      aggregate.failures.push({ index, type: String(operation.type), message: error?.message || '操作失败' });
    }
  }
  return aggregate;
}

export function executeAiScheduleOperationBatch(plan: PendingAiSchedulePlan) {
  const createdSchedules: any[] = [];
  const updatedSchedules: any[] = [];
  const deletedIds: string[] = [];
  const createdReminderTasks: any[] = [];
  const failures: Array<{ index: number; type: string; message: string }> = [];

  for (const [index, op] of plan.operations.entries()) {
    if (op.type === 'create' && op.data?.title) {
      try {
        const fields = normaliseScheduleApiFields({
          ...op.data,
          calendar_id: plan.targetCalendarId,
          type: op.data.type === 'todo' ? 'todo' : 'event',
          title: String(op.data.title).slice(0, 160),
          start_time: op.data.start_time || (plan.today + 'T09:00:00'),
          end_time: op.data.end_time || undefined,
          is_unscheduled: op.data.is_unscheduled,
          all_day: op.data.all_day,
          category: ['travel', 'work', 'social', 'life', 'health', 'other'].includes(op.data.category) ? op.data.category : 'other',
          priority: ['high', 'medium', 'low'].includes(op.data.priority) ? op.data.priority : 'medium',
          is_completed: false,
          is_repeated: false,
          reminders: [],
          is_high_risk: false,
        }, plan.userId);
        const created = scheduleStore.createSchedule({
          id: uuidv4(),
          user_id: plan.userId,
          ...fields,
        } as Omit<scheduleStore.Schedule, 'created_at' | 'updated_at'>);
        if (created) {
          createdSchedules.push(created);
          addLog('info', 'schedule', 'AI 确认事务暂存日程', { id: created.id, planId: plan.id });
        }
      } catch (error: any) {
        failures.push({ index, type: 'create', message: error?.message || '创建日程失败' });
        addLog('error', 'schedule', 'AI 计划创建失败', { error: error?.message, planId: plan.id });
      }
    } else if (op.type === 'create_recurring' && op.data?.title) {
      try {
        const recurrence = op.recurrence || op.data.recurrence || {};
        const anchorDate = recurrence.anchorDate || String(op.data.start_time || '').slice(0, 10) || plan.today;
        const task = reminderStore.createReminderTask({
          userId: plan.userId,
          type: 'generic',
          name: String(op.data.title).slice(0, 160),
          timezone: reminderStore.DEFAULT_CYCLE_REMINDER_TIMEZONE,
          config: normaliseReminderConfig('generic', {
            templateKey: 'custom',
            rule: {
              frequency: recurrence.frequency || 'interval',
              anchorDate,
              interval: recurrence.interval || 1,
              unit: recurrence.unit || 'day',
              advancePolicy: recurrence.advancePolicy || 'calendar',
              dayOfMonth: recurrence.dayOfMonth,
              month: recurrence.month,
            },
            reminderOffsets: recurrence.reminderOffsets || [1, 0],
            reminderTime: recurrence.reminderTime || reminderStore.DEFAULT_CYCLE_REMINDER_TIME,
            actionGuide: op.data.notes || '完成本周期事项并登记结果',
            priority: op.data.priority || 'medium',
          }),
        });
        createdReminderTasks.push(task);
        addLog('info', 'reminder', 'AI 确认事务暂存周期事项', { taskId: task.id, planId: plan.id });
        try {
          reminderCalendarSync.syncReminderTaskToCalendar(task);
        } catch (syncError: any) {
          failures.push({
            index,
            type: 'create_recurring_calendar_sync',
            message: `周期事项及日历同步未提交：${syncError?.message || '未知错误'}`,
          });
          addLog('warn', 'reminder', 'AI 周期事项同步失败，将回滚该操作', {
            taskId: task.id,
            planId: plan.id,
            error: syncError?.message,
          });
        }
      } catch (error: any) {
        failures.push({ index, type: 'create_recurring', message: error?.message || '创建周期事项失败' });
        addLog('error', 'reminder', 'AI 周期事项创建失败', { error: error?.message, planId: plan.id });
      }
    } else if (op.type === 'update' && op.scheduleId && op.data) {
      try {
        const target = scheduleStore.getSchedule(op.scheduleId);
        if (!target || target.user_id !== plan.userId) throw new Error('目标日程不存在或无权访问');
        const updates = normaliseScheduleApiFields(op.data, plan.userId, target);
        const updated = scheduleStore.updateSchedule(op.scheduleId, updates);
        if (!updated) throw new Error('更新日程失败');
        updatedSchedules.push(updated);
      } catch (error: any) {
        failures.push({ index, type: 'update', message: error?.message || '更新日程失败' });
        addLog('warn', 'schedule', 'AI 计划更新日程失败', { userId: plan.userId, scheduleId: op.scheduleId, planId: plan.id });
      }
    } else if (op.type === 'delete' && op.scheduleId) {
      try {
        const target = scheduleStore.getSchedule(op.scheduleId);
        if (!target || target.user_id !== plan.userId) throw new Error('目标日程不存在或无权访问');
        if (!scheduleStore.deleteSchedule(op.scheduleId)) throw new Error('删除日程失败');
        deletedIds.push(op.scheduleId);
      } catch (error: any) {
        failures.push({ index, type: 'delete', message: error?.message || '删除日程失败' });
        addLog('warn', 'schedule', 'AI 计划删除日程失败', { userId: plan.userId, scheduleId: op.scheduleId, planId: plan.id });
      }
    } else {
      failures.push({ index, type: String(op?.type || 'unknown'), message: '计划操作格式不正确' });
    }
  }

  return {
    createdSchedules,
    updatedSchedules,
    deletedIds,
    createdReminderTasks,
    failures,
    changed: createdSchedules.length + updatedSchedules.length + deletedIds.length + createdReminderTasks.length > 0,
  };
}
