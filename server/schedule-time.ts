/** Shared by normal writes; legacy backup restoration deliberately bypasses this check. */
export function validateScheduleTime(value: { type?: string; is_unscheduled?: boolean; all_day?: boolean; start_time?: string }): void {
  if (value.is_unscheduled) {
    if (value.type !== 'todo' || value.all_day) throw new Error('无固定期限仅适用于非全天待办');
    return;
  }
  if (value.all_day) {
    const date = value.start_time || '';
    if (!/^\d{4}-\d{2}-\d{2}(?:T00:00(?::00(?:\.000)?)?)?$/.test(date)) {
      throw new Error('全天事项必须使用日期或当天零点；请明确选择全天或定时');
    }
    const parsed = new Date(date.slice(0, 10) + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date.slice(0, 10)) throw new Error('全天日期不正确');
  }
}
