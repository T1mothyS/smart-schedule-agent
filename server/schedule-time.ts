/** Shared by normal writes; legacy backup restoration deliberately bypasses this check. */
export function validateScheduleTime(value: { type?: string; is_unscheduled?: boolean; all_day?: boolean; start_time?: string; end_time?: string }): void {
  if (value.is_unscheduled) {
    if (value.type !== 'todo' || value.all_day) throw new Error('无固定期限仅适用于非全天待办');
    return;
  }
  const start = value.start_time || '';
  validateDateTime(start, Boolean(value.all_day), '开始');
  // 待办没有持续时长，结束字段在所有正常写入入口统一丢弃。
  const end = value.type === 'todo' ? undefined : value.end_time;
  if (end) {
    validateDateTime(end, Boolean(value.all_day), '结束');
    if (!value.all_day && /(?:Z|[+-]\d{2}:\d{2})$/.test(start) !== /(?:Z|[+-]\d{2}:\d{2})$/.test(end)) {
      throw new Error('开始和结束时间必须使用一致的时区格式');
    }
    const reversed = value.all_day
      ? end.slice(0, 10) < start.slice(0, 10)
      : Date.parse(end) < Date.parse(start);
    if (reversed) throw new Error('结束时间不能早于开始时间');
  }
}

function validateDateTime(value: string, allDay: boolean, label: string): void {
  const format = allDay
    ? /^\d{4}-\d{2}-\d{2}(?:T00:00(?::00(?:\.000)?)?)?$/
    : /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;
  if (typeof value !== 'string' || value.length > 64 || !format.test(value)) {
    throw new Error(allDay ? '全天事项必须使用日期或当天零点；请明确选择全天或定时' : `${label}时间格式不正确，请明确日期、时间及全天状态`);
  }
  const date = new Date(value.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${allDay ? '全天' : label}日期不正确`);
  }
}
