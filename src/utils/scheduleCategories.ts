export interface ScheduleCategoryOption {
  id: string;
  name: string;
  color: string;
}

export const SCHEDULE_CATEGORIES: ScheduleCategoryOption[] = [
  { id: 'travel', name: '出行', color: '#F59E0B' },
  { id: 'work', name: '工作', color: '#3B82F6' },
  { id: 'social', name: '社交', color: '#EC4899' },
  { id: 'life', name: '生活', color: '#10B981' },
  { id: 'health', name: '健康', color: '#EF4444' },
  { id: 'other', name: '其他', color: '#6B7280' },
];

export const SCHEDULE_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  SCHEDULE_CATEGORIES.map(category => [category.id, category.name]),
);

export const SCHEDULE_CATEGORY_COLORS: Record<string, string> = Object.fromEntries(
  SCHEDULE_CATEGORIES.map(category => [category.id, category.color]),
);

export function getScheduleCategory(categoryId: string | undefined): ScheduleCategoryOption {
  return SCHEDULE_CATEGORIES.find(category => category.id === categoryId) || SCHEDULE_CATEGORIES[SCHEDULE_CATEGORIES.length - 1];
}
