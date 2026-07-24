import { useState, useEffect, useCallback } from 'react';
import { Plus, Check, Trash2, Edit3, Eye, EyeOff, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export interface CalendarItem {
  id: string;
  name: string;
  color: string;
  icon: string;
  is_visible: boolean;
  is_default: boolean;
  created_at: string;
}

interface ScheduleSidebarProps {
  activeCalendarIds: string[];
  onActiveChange: (ids: string[]) => void;
  onCalendarsLoaded?: (names: Record<string, string>) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const PRESET_COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#EF4444',
  '#F59E0B', '#10B981', '#06B6D4', '#6B7280',
];

function CalendarFormModal({
  editing,
  onSave,
  onClose,
}: {
  editing?: CalendarItem | null;
  onSave: (data: { name: string; color: string; icon: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(editing?.name || '');
  const [color, setColor] = useState(editing?.color || '#3B82F6');
  const icon = '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onMouseDown={onClose}
    >
      <div
        className="rounded-2xl p-5 w-72 shadow-2xl"
        style={{ backgroundColor: 'var(--td-bg-color-container)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
            {editing ? '编辑分类' : '增加分类'}
          </h3>
          <button onClick={onClose}>
            <X className="w-4 h-4" style={{ color: 'var(--td-text-color-secondary)' }} />
          </button>
        </div>

        {/* 名称 */}
        <input
          type="text"
          placeholder="分类名称"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          className="w-full px-3 py-2 rounded-lg text-sm outline-none mb-3"
          style={{
            backgroundColor: 'var(--td-bg-color-component)',
            color: 'var(--td-text-color-primary)',
            border: '1px solid var(--td-component-stroke)',
          }}
        />

        {/* 颜色选择 */}
        <div className="mb-4">
          <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>颜色</div>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                style={{ backgroundColor: c, outline: color === c ? `3px solid ${c}` : 'none', outlineOffset: '2px' }}
              >
                {color === c && <Check className="w-3.5 h-3.5 text-white" />}
              </button>
            ))}
          </div>
        </div>

        {/* 预览 */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg mb-4"
          style={{ backgroundColor: `${color}15`, border: `1px solid ${color}30` }}
        >
          <span className="calendar-color-dot large" style={{ backgroundColor: color }} />
          <span className="text-sm font-medium" style={{ color }}>{name || '分类名称'}</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-1.5 rounded-lg text-sm"
            style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}
          >
            取消
          </button>
          <button
            onClick={() => { if (name.trim()) onSave({ name: name.trim(), color, icon }); }}
            disabled={!name.trim()}
            className="flex-1 py-1.5 rounded-lg text-sm font-medium"
            style={{
              backgroundColor: name.trim() ? color : 'var(--td-bg-color-component)',
              color: name.trim() ? '#fff' : 'var(--td-text-color-disabled)',
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScheduleSidebar({
  activeCalendarIds,
  onActiveChange,
  onCalendarsLoaded,
  collapsed = false,
  onToggleCollapsed,
}: ScheduleSidebarProps) {
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingCalendar, setEditingCalendar] = useState<CalendarItem | null>(null);
  const { authHeaders } = useAuth();

  const fetchCalendars = useCallback(async () => {
    try {
      const res = await fetch('/api/calendars', { headers: authHeaders() });
      const data = await res.json();
      const items: CalendarItem[] = data.calendars || [];
      setCalendars(items);

      // 通知父组件日历名称映射
      const nameMap: Record<string, string> = {};
      items.forEach(c => { nameMap[c.id] = c.name; });
      onCalendarsLoaded?.(nameMap);

      // 初始化时全选
      if (activeCalendarIds.length === 0 && items.length > 0) {
        onActiveChange(items.map(c => c.id));
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);

  const toggleCalendar = (id: string) => {
    if (activeCalendarIds.includes(id)) {
      // 至少保留1个
      if (activeCalendarIds.length > 1) {
        onActiveChange(activeCalendarIds.filter(i => i !== id));
      }
    } else {
      onActiveChange([...activeCalendarIds, id]);
    }
  };

  const handleCreate = async (data: { name: string; color: string; icon: string }) => {
    try {
      const res = await fetch('/api/calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (result.calendar) {
        setCalendars(prev => [...prev, result.calendar]);
        onActiveChange([...activeCalendarIds, result.calendar.id]);
      }
      setShowForm(false);
    } catch {}
  };

  const handleEdit = async (data: { name: string; color: string; icon: string }) => {
    if (!editingCalendar) return;
    try {
      const res = await fetch(`/api/calendars/${editingCalendar.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (result.calendar) {
        setCalendars(prev => prev.map(c => c.id === editingCalendar.id ? result.calendar : c));
      }
      setEditingCalendar(null);
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (id === 'personal') return; // 默认日程表不可删
    if (!confirm('确定删除该日程表？其下所有日程也会被删除。')) return;
    try {
      await fetch(`/api/calendars/${id}`, { method: 'DELETE', headers: authHeaders() });
      setCalendars(prev => prev.filter(c => c.id !== id));
      onActiveChange(activeCalendarIds.filter(i => i !== id));
    } catch {}
  };

  const allSelected = calendars.length > 0 && activeCalendarIds.length === calendars.length;

  return (
    <div className="schedule-sidebar-panel flex flex-col h-full">
      <div className="schedule-sidebar-heading">
        <strong>我的日历</strong>
        <div className="schedule-sidebar-heading-actions">
          {!collapsed && (
            <button type="button" onClick={() => setShowForm(true)} aria-label="增加分类" title="增加分类">
              <Plus size={15} />
            </button>
          )}
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? '展开我的日历' : '隐藏我的日历'}
              title={collapsed ? '展开我的日历' : '隐藏我的日历'}
            >
              {collapsed ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          {/* 全选 */}
          <div className="px-3 py-2 flex-shrink-0">
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-xs"
              style={{
                backgroundColor: allSelected ? 'var(--td-brand-color-light)' : 'transparent',
                color: allSelected ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)',
              }}
              onClick={() => {
                if (allSelected) {
                  // 只保留第一个
                  onActiveChange([calendars[0]?.id].filter(Boolean));
                } else {
                  onActiveChange(calendars.map(c => c.id));
                }
              }}
            >
              <div
                className="w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0"
                style={{
                  backgroundColor: allSelected ? 'var(--td-brand-color)' : 'transparent',
                  borderColor: allSelected ? 'var(--td-brand-color)' : 'var(--td-component-stroke)',
                }}
              >
                {allSelected && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              <span>全部</span>
            </button>
          </div>

          {/* 日程表列表 */}
          <div className="flex-1 overflow-y-auto px-3 pb-2">
            {calendars.map(cal => {
              const isActive = activeCalendarIds.includes(cal.id);
              return (
                <div
                  key={cal.id}
                  className="group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors mb-0.5"
                  style={{
                    backgroundColor: isActive ? `${cal.color}12` : 'transparent',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--td-bg-color-component-hover)';
                  }}
                  onMouseLeave={e => {
                    if (!isActive) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
                  }}
                  onClick={() => toggleCalendar(cal.id)}
                >
                  {/* 勾选框 */}
                  <div
                    className="w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      backgroundColor: isActive ? cal.color : 'transparent',
                      borderColor: isActive ? cal.color : 'var(--td-component-stroke)',
                    }}
                  >
                    {isActive && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>

                  {/* 图标 */}
                  <span className="calendar-color-dot" style={{ backgroundColor: cal.color }} />

                  {/* 名称 */}
                  <span
                    className="flex-1 text-xs font-medium truncate"
                    style={{ color: isActive ? cal.color : 'var(--td-text-color-secondary)' }}
                  >
                    {cal.name}
                  </span>

                  {/* 操作按钮（hover 时显示） */}
                  <div className="calendar-item-actions flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => { e.stopPropagation(); setEditingCalendar(cal); }}
                      className="p-1 rounded hover:opacity-70"
                      style={{ color: 'var(--td-text-color-secondary)' }}
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    {!cal.is_default && (
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(cal.id); }}
                        className="p-1 rounded hover:opacity-70"
                        style={{ color: '#EF4444' }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 增加分类弹窗 */}
      {showForm && (
        <CalendarFormModal
          onSave={handleCreate}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* 编辑弹窗 */}
      {editingCalendar && (
        <CalendarFormModal
          editing={editingCalendar}
          onSave={handleEdit}
          onClose={() => setEditingCalendar(null)}
        />
      )}
    </div>
  );
}
