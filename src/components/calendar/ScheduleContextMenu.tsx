import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Edit3, Trash2 } from 'lucide-react';
import type { Schedule } from '../CalendarView';

interface ScheduleContextMenuProps {
  schedule: Schedule;
  x: number;
  y: number;
  onClose: () => void;
  onEdit: (schedule: Schedule) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ScheduleContextMenu({ schedule, x, y, onClose, onEdit, onToggle, onDelete }: ScheduleContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="schedule-context-menu"
      style={position}
      role="menu"
      onPointerDown={event => event.stopPropagation()}
    >
      <div className="schedule-context-title" title={schedule.title}>{schedule.title}</div>
      <button type="button" role="menuitem" onClick={() => { onEdit(schedule); onClose(); }}>
        <Edit3 size={15} />编辑日程
      </button>
      <button type="button" role="menuitem" onClick={() => { onToggle(schedule.id); onClose(); }}>
        {schedule.is_completed ? <Circle size={15} /> : <CheckCircle2 size={15} />}
        {schedule.is_completed ? '标记为未完成' : '标记为已完成'}
      </button>
      <div className="schedule-context-separator" />
      <button
        type="button"
        role="menuitem"
        className="danger"
        onClick={() => {
          if (window.confirm(`确定删除“${schedule.title}”吗？`)) onDelete(schedule.id);
          onClose();
        }}
      >
        <Trash2 size={15} />删除日程
      </button>
    </div>
  );
}
