import { BriefcaseBusiness, CarFront, Check, HeartPulse, House, MoreHorizontal, UsersRound } from 'lucide-react';
import { SCHEDULE_CATEGORIES } from '../utils/scheduleCategories';

interface ScheduleSidebarProps {
  activeCategoryIds: string[];
  onActiveChange: (ids: string[]) => void;
}

function CategoryIcon({ id }: { id: string }) {
  const props = { size: 15, strokeWidth: 1.9 };
  if (id === 'travel') return <CarFront {...props} />;
  if (id === 'work') return <BriefcaseBusiness {...props} />;
  if (id === 'social') return <UsersRound {...props} />;
  if (id === 'life') return <House {...props} />;
  if (id === 'health') return <HeartPulse {...props} />;
  return <MoreHorizontal {...props} />;
}

export function ScheduleSidebar({ activeCategoryIds, onActiveChange }: ScheduleSidebarProps) {
  const allSelected = activeCategoryIds.length === SCHEDULE_CATEGORIES.length;

  const toggleCategory = (id: string) => {
    if (activeCategoryIds.includes(id)) {
      if (activeCategoryIds.length > 1) {
        onActiveChange(activeCategoryIds.filter(item => item !== id));
      }
      return;
    }
    onActiveChange([...activeCategoryIds, id]);
  };

  return (
    <div className="schedule-sidebar-panel flex flex-col h-full">
      <div className="schedule-sidebar-heading">
        <div>
          <strong>日程分类</strong>
          <span className="schedule-sidebar-subtitle">与创建日程和 AI 使用同一套分类</span>
        </div>
      </div>

      <div className="px-3 py-2 flex-shrink-0">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-xs"
          style={{
            backgroundColor: allSelected ? 'var(--td-brand-color-light)' : 'transparent',
            color: allSelected ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)',
          }}
          onClick={() => onActiveChange(allSelected ? [SCHEDULE_CATEGORIES[0].id] : SCHEDULE_CATEGORIES.map(category => category.id))}
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
          <span>全部分类</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {SCHEDULE_CATEGORIES.map(category => {
          const isActive = activeCategoryIds.includes(category.id);
          return (
            <button
              key={category.id}
              type="button"
              className="group flex items-center gap-2 w-full px-2 py-2 rounded-lg cursor-pointer transition-colors mb-0.5 text-left"
              style={{
                backgroundColor: isActive ? `${category.color}12` : 'transparent',
                color: isActive ? category.color : 'var(--td-text-color-secondary)',
              }}
              onClick={() => toggleCategory(category.id)}
            >
              <div
                className="w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-all"
                style={{
                  backgroundColor: isActive ? category.color : 'transparent',
                  borderColor: isActive ? category.color : 'var(--td-component-stroke)',
                }}
              >
                {isActive && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              <span className="schedule-category-icon" style={{ color: category.color }}><CategoryIcon id={category.id} /></span>
              <span className="flex-1 text-xs font-medium truncate">{category.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
