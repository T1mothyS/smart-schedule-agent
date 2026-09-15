import { Bell, Calendar, CheckCircle2, Clock, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SCHEDULE_CATEGORIES } from '../../utils/scheduleCategories';
import { CATEGORY_COLORS, formatScheduleDate, formatTime, PRIORITY_COLORS, toDateKey } from './schedule-presentation';
import type { Schedule } from './schedule-types';

function SmartTimePicker({
  value,
  onChange,
  minTime,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  minTime?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  const currentHour = parseInt(value?.split(':')[0] || '0');
  const currentMinute = parseInt(value?.split(':')[1] || '0');
  const [selHour, setSelHour] = useState(currentHour);
  const [selMinute, setSelMinute] = useState(currentMinute);
  const hourRef = useRef<HTMLDivElement>(null);
  const minRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelHour(currentHour);
    setSelMinute(currentMinute);
  }, [value]);

  // 滚动到选中项
  useEffect(() => {
    if (open) {
      const hourItem = hourRef.current?.querySelector(`[data-hour="${selHour}"]`);
      const minItem = minRef.current?.querySelector(`[data-minute="${selMinute}"]`);
      hourItem?.scrollIntoView({ block: 'center' });
      minItem?.scrollIntoView({ block: 'center' });
    }
  }, [open, selHour, selMinute]);

  const handleHourChange = (h: number) => {
    setSelHour(h);
    // 更改小时时预览更新，但不关闭选择器
    onChange(`${String(h).padStart(2, '0')}:${String(selMinute).padStart(2, '0')}`);
  };

  const handleMinuteChange = (m: number) => {
    setSelMinute(m);
    onChange(`${String(selHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };

  const handleConfirm = () => {
    onChange(`${String(selHour).padStart(2, '0')}:${String(selMinute).padStart(2, '0')}`);
    setOpen(false);
  };

  return (
    <div className="relative flex-1" ref={useRef(null)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg text-sm text-left flex items-center justify-between transition-all"
        style={{
          backgroundColor: 'var(--td-bg-color-component)',
          color: 'var(--td-text-color-primary)',
          border: `1.5px solid ${open ? 'var(--td-brand-color)' : 'var(--td-component-stroke)'}`,
        }}
      >
        <div className="flex items-center gap-2">
          {label && <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>{label}</span>}
          <span className="font-mono">{value || '00:00'}</span>
        </div>
        <Clock className="w-4 h-4" style={{ color: 'var(--td-text-color-secondary)' }} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded-xl shadow-2xl overflow-hidden"
          style={{
            backgroundColor: 'var(--td-bg-color-container)',
            border: '1px solid var(--td-component-stroke)',
            width: '220px',
          }}
        >
          <div className="flex">
            {/* 小时滚轮 */}
            <div className="flex-1 border-r" style={{ borderColor: 'var(--td-component-stroke)' }}>
              <div className="px-2 py-1.5 text-xs text-center font-medium" style={{ color: 'var(--td-text-color-secondary)', borderBottom: '1px solid var(--td-component-stroke)' }}>
                时
              </div>
              <div ref={hourRef} className="h-32 overflow-y-auto scrollbar-hide" style={{ scrollBehavior: 'auto' }}>
                {hours.map(h => (
                  <div
                    key={h}
                    data-hour={h}
                    onClick={() => handleHourChange(h)}
                    className="px-3 py-1.5 text-center text-sm cursor-pointer transition-all"
                    style={{
                      backgroundColor: selHour === h ? 'var(--td-brand-color)' : 'transparent',
                      color: selHour === h ? '#fff' : 'var(--td-text-color-primary)',
                      fontWeight: selHour === h ? 600 : 400,
                    }}
                  >
                    {String(h).padStart(2, '0')}
                  </div>
                ))}
              </div>
            </div>
            {/* 分钟滚轮 */}
            <div className="flex-1">
              <div className="px-2 py-1.5 text-xs text-center font-medium" style={{ color: 'var(--td-text-color-secondary)', borderBottom: '1px solid var(--td-component-stroke)' }}>
                分
              </div>
              <div ref={minRef} className="h-32 overflow-y-auto scrollbar-hide" style={{ scrollBehavior: 'auto' }}>
                {minutes.map(m => (
                  <div
                    key={m}
                    data-minute={m}
                    onClick={() => handleMinuteChange(m)}
                    className="px-3 py-1.5 text-center text-sm cursor-pointer transition-all"
                    style={{
                      backgroundColor: selMinute === m ? 'var(--td-brand-color)' : 'transparent',
                      color: selMinute === m ? '#fff' : 'var(--td-text-color-primary)',
                      fontWeight: selMinute === m ? 600 : 400,
                    }}
                  >
                    {String(m).padStart(2, '0')}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* 确认按钮 */}
          <div className="px-3 py-2 border-t flex gap-2" style={{ borderColor: 'var(--td-component-stroke)' }}>
            <button
              onClick={() => {
                // 取消，恢复原始值
                setSelHour(currentHour);
                setSelMinute(currentMinute);
                setOpen(false);
              }}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'var(--td-brand-color)', color: '#fff' }}
            >
              确定
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReminderPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(parseInt(value) || 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const presetOptions = [
    { label: '不提醒', value: '' },
    { label: '5分钟', value: '5' },
    { label: '10分钟', value: '10' },
    { label: '15分钟', value: '15' },
    { label: '30分钟', value: '30' },
    { label: '1小时', value: '60' },
    { label: '2小时', value: '120' },
    { label: '1天', value: '1440' },
  ];

  const isCustom = value && !presetOptions.find(o => o.value === value);

  const formatReminder = (mins: string) => {
    if (!mins) return '不提醒';
    const m = parseInt(mins);
    if (m >= 1440) return `${m / 1440}天`;
    if (m >= 60) return `${m / 60}小时`;
    return `${m}分钟`;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg text-sm text-left flex items-center justify-between transition-all"
        style={{
          backgroundColor: 'var(--td-bg-color-component)',
          color: 'var(--td-text-color-primary)',
          border: `1.5px solid ${open ? 'var(--td-brand-color)' : 'var(--td-component-stroke)'}`,
        }}
      >
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4" style={{ color: 'var(--td-text-color-secondary)' }} />
          <span>{isCustom ? `提前${formatReminder(value)}` : formatReminder(value)}</span>
        </div>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded-xl shadow-2xl overflow-hidden"
          style={{
            backgroundColor: 'var(--td-bg-color-container)',
            border: '1px solid var(--td-component-stroke)',
            width: '180px',
          }}
        >
          {/* 预设选项 */}
          <div className="p-2">
            <div className="text-xs mb-1.5 px-1" style={{ color: 'var(--td-text-color-secondary)' }}>快速选择</div>
            <div className="grid grid-cols-2 gap-1">
              {presetOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className="py-1.5 px-2 rounded-lg text-xs transition-all flex items-center gap-1"
                  style={{
                    backgroundColor: value === opt.value ? 'var(--td-brand-color)' : 'var(--td-bg-color-component)',
                    color: value === opt.value ? '#fff' : 'var(--td-text-color-primary)',
                  }}
                >
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
          {/* 自定义输入 */}
          <div className="px-3 py-2 border-t" style={{ borderColor: 'var(--td-component-stroke)' }}>
            <div className="text-xs mb-1.5 px-1" style={{ color: 'var(--td-text-color-secondary)' }}>自定义分钟数</div>
            <div className="flex gap-1.5">
              <input
                type="number"
                min="1"
                max="10080"
                value={customMinutes || ''}
                onChange={e => setCustomMinutes(parseInt(e.target.value) || 0)}
                placeholder="输入分钟"
                className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none"
                style={{
                  backgroundColor: 'var(--td-bg-color-component)',
                  color: 'var(--td-text-color-primary)',
                  border: '1px solid var(--td-component-stroke)',
                }}
              />
              <button
                onClick={() => {
                  if (customMinutes > 0) {
                    onChange(String(customMinutes));
                    setOpen(false);
                  }
                }}
                className="px-2 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: 'var(--td-brand-color)', color: '#fff' }}
              >
                设置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ScheduleFormModal({
  defaultDate,
  editingSchedule,
  defaultCategory,
  onSave,
  onClose,
}: {
  defaultDate: Date;
  editingSchedule?: Schedule | null;
  defaultCategory?: string;
  onSave: (s: Partial<Schedule>) => void;
  onClose: () => void;
}) {
  const isEditing = !!editingSchedule;
  const [form, setForm] = useState({
    type: (editingSchedule?.type || 'event') as 'event' | 'todo',
    title: editingSchedule?.title || '',
    date: editingSchedule
      ? editingSchedule.start_time.split('T')[0]
      : toDateKey(defaultDate),
    isUnscheduled: editingSchedule?.is_unscheduled === true,
    startTime: editingSchedule && !editingSchedule.all_day
      ? formatTime(editingSchedule.start_time)
      : '09:00',
    endTime: editingSchedule?.type === 'event' && editingSchedule.end_time && !editingSchedule.all_day
      ? formatTime(editingSchedule.end_time)
      : '10:00',
    all_day: editingSchedule?.all_day || false,
    location: editingSchedule?.location || '',
    category: editingSchedule?.category || (SCHEDULE_CATEGORIES.some(category => category.id === defaultCategory) ? defaultCategory! : 'other'),
    priority: (editingSchedule?.priority || 'medium') as 'high' | 'medium' | 'low',
    notes: editingSchedule?.notes || '',
    reminder: (editingSchedule?.reminders?.[0] || '') as string,
    calendarId: editingSchedule?.calendar_id || 'personal',
    // 循环设置
    repeat: (editingSchedule?.is_repeated ? (editingSchedule as any).repeat_rule || 'daily' : '') as '' | 'daily' | 'weekly' | 'monthly',
  });

  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));
  const selectedDate = formatScheduleDate(form.date);
  const isUnscheduled = form.type === 'todo' && form.isUnscheduled;

  // 类别颜色配置
  const catColor = CATEGORY_COLORS[form.category] || '#6B7280';

  const handleSave = () => {
    if (!form.title.trim()) return;
    const startTime = isUnscheduled
      ? new Date().toISOString()
      : form.all_day
      ? `${form.date}T00:00:00`
      : `${form.date}T${form.startTime}:00`;
    // 待办是时间点；结束时间只属于有持续时长的事件。
    const endTime = form.type === 'todo' || isUnscheduled || form.all_day
      ? undefined
      : `${form.date}T${form.endTime}:00`;

    onSave({
      type: form.type,
      title: form.title.trim(),
      calendar_id: form.calendarId,
      start_time: startTime,
      end_time: endTime,
      all_day: isUnscheduled ? false : form.all_day,
      is_unscheduled: isUnscheduled,
      location: form.location || undefined,
      notes: form.notes || undefined,
      category: form.category,
      priority: form.priority,
      reminders: isUnscheduled ? [] : (form.reminder ? [form.reminder] : []),
      is_repeated: isUnscheduled ? false : !!form.repeat,
      repeat_rule: isUnscheduled ? undefined : (form.repeat || undefined),
    });
  };

  const priorityConfig = PRIORITY_COLORS[form.priority];

  // 类别选项
  const categoryOptions = SCHEDULE_CATEGORIES.map(category => ({
    key: category.id,
    label: category.name,
    color: category.color,
  }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onMouseDown={onClose}
    >
      <div
        className="schedule-form-modal rounded-2xl p-6 w-full max-w-md shadow-2xl"
        style={{ backgroundColor: 'var(--td-bg-color-container)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="schedule-form-scroll">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="schedule-form-heading" style={{ color: 'var(--td-text-color-primary)' }}>
            {isEditing ? '编辑日程' : '新增日程'}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-60">
            <X className="w-4 h-4" style={{ color: 'var(--td-text-color-secondary)' }} />
          </button>
        </div>

        <div className="space-y-4">
          {/* 类型切换 */}
          <div className="flex gap-2">
            {(['event', 'todo'] as const).map(t => (
              <button
                key={t}
                onClick={() => setForm(prev => ({
                  ...prev,
                  type: t,
                  isUnscheduled: t === 'todo' ? prev.isUnscheduled : false,
                }))}
                className="schedule-type-option flex-1 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  backgroundColor: form.type === t ? 'var(--td-brand-color)' : 'var(--td-bg-color-component)',
                  color: form.type === t ? '#fff' : 'var(--td-text-color-secondary)',
                }}
              >
                {t === 'event' ? <><Calendar size={16} />日程</> : <><CheckCircle2 size={16} />待办</>}
              </button>
            ))}
          </div>

          {/* 标题 */}
          <input
            type="text"
            placeholder="输入日程标题..."
            value={form.title}
            onChange={e => set('title', e.target.value)}
            autoFocus
            className="schedule-title-input w-full px-3 py-2.5 rounded-lg outline-none"
            style={{
              backgroundColor: 'var(--td-bg-color-component)',
              color: 'var(--td-text-color-primary)',
              border: '1.5px solid var(--td-component-stroke)',
            }}
          />

          {/* 日期 - 待办可以切换为无固定期限 */}
          <div className="schedule-date-field">
            <div
              className={`relative overflow-hidden rounded-lg transition-all ${isUnscheduled ? 'is-unscheduled' : 'cursor-pointer hover:border-brand-color'}`}
              style={{
                backgroundColor: 'var(--td-bg-color-component)',
                border: '1.5px solid var(--td-component-stroke)',
              }}
              onClick={() => {
                if (isUnscheduled) return;
                const input = document.getElementById('schedule-date-input') as HTMLInputElement;
                input?.showPicker?.();
              }}
            >
              {!isUnscheduled && (
                <input
                  id="schedule-date-input"
                  type="date"
                  value={form.date}
                  onChange={e => set('date', e.target.value)}
                  className="w-full px-3 py-2 text-sm outline-none cursor-pointer"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--td-text-color-primary)',
                    position: 'absolute',
                    opacity: 0,
                    width: '100%',
                    height: '100%',
                    top: 0,
                    left: 0,
                  }}
                />
              )}
              <div className="schedule-date-summary">
                <Calendar className="w-5 h-5" />
                <div>
                  <strong>{isUnscheduled ? '无固定期限' : selectedDate.date}</strong>
                  {isUnscheduled ? <span>完成前持续保留，不绑定具体日期</span> : selectedDate.weekday && <span>{selectedDate.weekday}</span>}
                </div>
                {!isUnscheduled && selectedDate.isToday && <em>今天</em>}
              </div>
            </div>
            {form.type === 'todo' && (
              <label className="schedule-unscheduled-toggle">
                <input
                  type="checkbox"
                  checked={form.isUnscheduled}
                  onChange={event => setForm(prev => ({
                    ...prev,
                    isUnscheduled: event.target.checked,
                    reminder: event.target.checked ? '' : prev.reminder,
                    repeat: event.target.checked ? '' : prev.repeat,
                  }))}
                />
                <span>
                  <strong>无固定期限待办</strong>
                  <small>暂不绑定执行日期，之后可以再切回日期待办</small>
                </span>
              </label>
            )}
          </div>

          {/* 时间（仅日程类型） */}
          {form.type === 'event' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.all_day}
                  onChange={e => set('all_day', e.target.checked)}
                />
                <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>全天事件</span>
              </label>
              {!form.all_day && (
                <div className="flex gap-3 items-center">
                  <SmartTimePicker
                    value={form.startTime}
                    onChange={v => {
                      set('startTime', v);
                      // 自动设置结束时间为开始时间+1小时
                      const [h, m] = v.split(':').map(Number);
                      const endH = (h + 1) % 24;
                      if (form.endTime <= v) {
                        set('endTime', `${String(endH).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
                      }
                    }}
                    label="开始"
                  />
                  <span style={{ color: 'var(--td-text-color-secondary)', fontSize: '12px' }}>至</span>
                  <SmartTimePicker
                    value={form.endTime}
                    onChange={v => set('endTime', v)}
                    minTime={form.startTime}
                    label="结束"
                  />
                </div>
              )}
            </div>
          )}

          {/* 待办时间点选择器，不设置持续时长 */}
          {form.type === 'todo' && !isUnscheduled && (
            <div>
              <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
                待办时间点
              </div>
              <div className="flex gap-3 items-center">
                <SmartTimePicker
                  value={form.startTime}
                  onChange={v => set('startTime', v)}
                  label="时间点"
                />
                <span style={{ color: 'var(--td-text-color-secondary)', fontSize: '12px' }}>不设置持续时长</span>
              </div>
            </div>
          )}

          {/* 提前提醒 - 使用新的ReminderPicker */}
          {!isUnscheduled && <div>
            <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
              提前提醒
            </div>
            <ReminderPicker
              value={form.reminder}
              onChange={v => set('reminder', v)}
            />
          </div>}

          <div className="schedule-advanced-options schedule-form-details">
          {/* 地点 */}
          <input
            type="text"
            placeholder="添加地点（可选）"
            value={form.location}
            onChange={e => set('location', e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{
              backgroundColor: 'var(--td-bg-color-component)',
              color: 'var(--td-text-color-primary)',
              border: '1.5px solid var(--td-component-stroke)',
            }}
          />

          {/* 分类选择 - 横向标签风格 */}
          <div>
            <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
              日程分类
            </div>
            <div className="flex flex-wrap gap-2">
              {categoryOptions.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => set('category', opt.key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1"
                  style={{
                    backgroundColor: form.category === opt.key ? opt.color + '20' : 'var(--td-bg-color-component)',
                    color: form.category === opt.key ? opt.color : 'var(--td-text-color-secondary)',
                    border: `1.5px solid ${form.category === opt.key ? opt.color : 'transparent'}`,
                  }}
                >
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 优先级选择 */}
          <div>
            <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
              优先级
            </div>
            <div className="flex gap-2">
              {[
                { key: 'high', label: '高', bg: '#FEF2F2', color: '#EF4444' },
                { key: 'medium', label: '中', bg: '#FFFBEB', color: '#F59E0B' },
                { key: 'low', label: '低', bg: '#F0FDF4', color: '#10B981' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => set('priority', opt.key)}
                  className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundColor: form.priority === opt.key ? opt.bg : 'var(--td-bg-color-component)',
                    color: form.priority === opt.key ? opt.color : 'var(--td-text-color-secondary)',
                    border: `1.5px solid ${form.priority === opt.key ? opt.color : 'transparent'}`,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 备注 */}
          <textarea
            placeholder="添加备注（可选）"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
            style={{
              backgroundColor: 'var(--td-bg-color-component)',
              color: 'var(--td-text-color-primary)',
              border: '1.5px solid var(--td-component-stroke)',
            }}
          />

          {/* 循环设置 */}
          {!isUnscheduled && <div>
            <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
              循环重复
            </div>
            <div className="flex gap-2">
              {[
                { key: '', label: '不重复', color: '#6B7280' },
                { key: 'daily', label: '每日', color: '#3B82F6' },
                { key: 'weekly', label: '每周', color: '#10B981' },
                { key: 'monthly', label: '每月', color: '#8B5CF6' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => set('repeat', opt.key)}
                  className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundColor: form.repeat === opt.key ? opt.color + '20' : 'var(--td-bg-color-component)',
                    color: form.repeat === opt.key ? opt.color : 'var(--td-text-color-secondary)',
                    border: `1.5px solid ${form.repeat === opt.key ? opt.color : 'transparent'}`,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>}
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!form.title.trim()}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: form.title.trim() ? 'var(--td-brand-color)' : 'var(--td-bg-color-component)',
              color: form.title.trim() ? '#fff' : 'var(--td-text-color-disabled)',
            }}
          >
            {isEditing ? '保存修改' : '添加日程'}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
