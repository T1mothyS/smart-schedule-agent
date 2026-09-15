import { Clock, Edit3, MapPin, Trash2, X } from 'lucide-react';
import { CATEGORY_COLORS, CATEGORY_LABELS, formatTime, PRIORITY_COLORS } from './schedule-presentation';
import type { CompletionProofDisplay, Schedule } from './schedule-types';

export function ScheduleDetailModal({
  schedule,
  onClose,
  onDelete,
  onToggle,
  onEdit,
  completionProof,
  onEditCompletion,
}: {
  schedule: Schedule;
  onClose: () => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  onEdit: (s: Schedule) => void;
  completionProof?: CompletionProofDisplay | null;
  onEditCompletion?: () => void;
}) {
  const pColor = PRIORITY_COLORS[schedule.priority] || PRIORITY_COLORS.medium;
  const catColor = CATEGORY_COLORS[schedule.category] || '#6B7280';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onMouseDown={onClose}
    >
      <div
        className="rounded-2xl p-5 w-full max-w-sm shadow-2xl"
        style={{ backgroundColor: 'var(--td-bg-color-container)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${catColor}20`, color: catColor }}
              >
                {schedule.type === 'todo' ? '待办' : CATEGORY_LABELS[schedule.category]}
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${pColor.dot}18`, color: pColor.dot }}
              >
                {PRIORITY_COLORS[schedule.priority]?.label || '中优先'}
              </span>
            </div>
            <h3 className="schedule-title-primary text-base font-bold">
              {schedule.title}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-60 ml-2">
            <X className="w-4 h-4" style={{ color: 'var(--td-text-color-secondary)' }} />
          </button>
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
            <Clock className="w-4 h-4" />
            {schedule.all_day
              ? '全天'
              : `${formatTime(schedule.start_time)}${schedule.end_time ? ' - ' + formatTime(schedule.end_time) : ''}`
            }
          </div>
          {schedule.location && (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
              <MapPin className="w-4 h-4" />
              {schedule.location}
            </div>
          )}
          {schedule.notes && (
            <div className="mt-2 p-3 rounded-xl text-sm" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}>
              备注：{schedule.notes}
            </div>
          )}
          {schedule.description && (
            <div className="text-sm mt-2" style={{ color: 'var(--td-text-color-secondary)' }}>
              {schedule.description}
            </div>
          )}
          {completionProof && (
            <div className="mt-2 p-3 rounded-xl text-sm" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}>
              <strong style={{ color: 'var(--td-text-color-primary)' }}>完成记录</strong>
              {completionProof.note && <div className="mt-1">备注：{completionProof.note}</div>}
              {completionProof.amountCents != null && <div className="mt-1">金额：{(completionProof.amountCents / 100).toFixed(2)} {completionProof.currency}</div>}
              {completionProof.billDate && <div className="mt-1">账单日：{completionProof.billDate}</div>}
              {completionProof.attachments.length > 0 && <div className="mt-1">附件：{completionProof.attachments.map(file => file.originalName).join('、')}</div>}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => { onDelete(schedule.id); onClose(); }}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: '#FEF2F2', color: '#EF4444' }}
          >
            <Trash2 className="w-3.5 h-3.5" />删除
          </button>
          <button
            onClick={() => { onToggle(schedule.id); onClose(); }}
            className="flex-1 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--td-brand-color-light)', color: 'var(--td-brand-color)' }}
          >
            {schedule.is_completed ? '标记未完成' : '标记完成'}
          </button>
          <button
            onClick={() => { onEdit(schedule); onClose(); }}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}
          >
            <Edit3 className="w-3.5 h-3.5" />编辑
          </button>
          {onEditCompletion && <button
            onClick={onEditCompletion}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}
          >
            <Edit3 className="w-3.5 h-3.5" />编辑完成记录
          </button>}
        </div>
      </div>
    </div>
  );
}
