import * as reminderStore from './reminder-store.js';

export function validDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normaliseReminderOffsets(input: unknown, maximum: number, fallback: number[]): number[] {
  if (!Array.isArray(input)) return fallback;
  return [...new Set<number>(input.map(Number).filter(value => Number.isInteger(value) && value >= 0 && value <= maximum))];
}

export function normaliseReminderConfig(type: reminderStore.ReminderTaskType, input: any): reminderStore.ReminderConfig {
  if (type === 'credit_card') {
    const statementDay = Number(input?.statementDay);
    const paymentDay = Number(input?.paymentDay);
    const paymentMonthOffset = Number(input?.paymentMonthOffset) === 1 ? 1 : 0;
    if (statementDay < 1 || statementDay > 31 || paymentDay < 1 || paymentDay > 31) {
      throw new Error('账单日和还款日必须在 1 到 31 之间');
    }
    return {
      statementDay,
      paymentDay,
      paymentMonthOffset,
      reminderOffsets: normaliseReminderOffsets(input?.reminderOffsets, 60, [15, 7, 1, 0]),
      reminderTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(input?.reminderTime) ? input.reminderTime : reminderStore.DEFAULT_CYCLE_REMINDER_TIME,
      priority: ['high', 'medium', 'low'].includes(input?.priority) ? input.priority : 'high',
    };
  }

  if (type === 'generic') {
    const allowedTemplates = ['subscription', 'insurance', 'document', 'membership', 'rent', 'utilities', 'vehicle_inspection', 'custom'];
    const templateKey = allowedTemplates.includes(input?.templateKey) ? input.templateKey : 'custom';
    const frequency = ['once', 'monthly', 'yearly', 'interval'].includes(input?.rule?.frequency) ? input.rule.frequency : 'once';
    const anchorDate = String(input?.rule?.anchorDate || reminderStore.todayInTimezone());
    if (!validDateOnly(anchorDate)) throw new Error('周期起始日期不正确');
    const interval = Math.min(Math.max(Number(input?.rule?.interval || 1), 1), 120);
    const advancePolicy = input?.rule?.advancePolicy === 'completion' ? 'completion' : 'calendar';
    let rule: reminderStore.RecurrenceRule;
    if (frequency === 'monthly') {
      const dayOfMonth = Math.min(Math.max(Number(input?.rule?.dayOfMonth || Number(anchorDate.slice(8, 10))), 1), 31);
      rule = { frequency, anchorDate, dayOfMonth, interval, advancePolicy };
    } else if (frequency === 'yearly') {
      const month = Math.min(Math.max(Number(input?.rule?.month || Number(anchorDate.slice(5, 7))), 1), 12);
      const dayOfMonth = Math.min(Math.max(Number(input?.rule?.dayOfMonth || Number(anchorDate.slice(8, 10))), 1), 31);
      rule = { frequency, anchorDate, month, dayOfMonth, interval, advancePolicy };
    } else if (frequency === 'interval') {
      const unit = ['day', 'month', 'year'].includes(input?.rule?.unit) ? input.rule.unit : 'day';
      rule = { frequency, anchorDate, unit, interval, advancePolicy };
    } else {
      rule = { frequency: 'once', anchorDate, advancePolicy: 'calendar' };
    }
    const reminderOffsets = normaliseReminderOffsets(input?.reminderOffsets, 365, [7, 1]);
    return {
      templateKey,
      rule,
      reminderOffsets,
      reminderTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(input?.reminderTime) ? input.reminderTime : reminderStore.DEFAULT_CYCLE_REMINDER_TIME,
      actionGuide: String(input?.actionGuide || '完成本周期事务并登记证明').trim(),
      priority: ['high', 'medium', 'low'].includes(input?.priority) ? input.priority : 'medium',
    };
  }

  const intervalDays = Number(input?.intervalDays || 180);
  if (!validDateOnly(input?.lastOperationDate) || intervalDays < 1 || intervalDays > 3650) {
    throw new Error('SIM 卡周期和上次有效操作日期不正确');
  }
  return {
    provider: String(input?.provider || '').trim(),
    numberMasked: String(input?.numberMasked || '').trim(),
    region: String(input?.region || '').trim(),
    intervalDays,
    lastOperationDate: input.lastOperationDate,
    actionGuide: String(input?.actionGuide || '完成一次充值、消费、短信、通话或流量操作').trim(),
    reminderOffsets: normaliseReminderOffsets(input?.reminderOffsets, 180, [30, 15, 7, 1, 0]),
    reminderTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(input?.reminderTime) ? input.reminderTime : reminderStore.DEFAULT_CYCLE_REMINDER_TIME,
    priority: ['high', 'medium', 'low'].includes(input?.priority) ? input.priority : 'medium',
  };
}
