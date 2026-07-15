import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { 
  Calendar, 
  List, 
  Clock, 
  MapPin, 
  Tag, 
  CheckCircle, 
  Circle, 
  Plus, 
  ChevronLeft, 
  ChevronRight,
  Trash2,
  Edit3
} from 'lucide-react';

// 日程接口
interface Schedule {
  id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  location?: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  is_completed: boolean;
  is_repeated: boolean;
  reminders: string[];
}

// 分类接口
interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
}

const API_BASE = 'http://localhost:3000/api';

// 分类颜色映射
const categoryColors: Record<string, string> = {
  work: '#3B82F6',
  life: '#10B981',
  travel: '#F59E0B',
  social: '#EC4899',
  health: '#EF4444',
  other: '#6B7280'
};

// 优先级显示
const priorityLabels: Record<string, { label: string; color: string }> = {
  high: { label: '高', color: '#EF4444' },
  medium: { label: '中', color: '#F59E0B' },
  low: { label: '低', color: '#10B981' }
};

export function ScheduleView() {
  // 状态
  const { authHeaders } = useAuth();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [loading, setLoading] = useState(true);

  // 获取日程数据
  const fetchSchedules = useCallback(async () => {
    try {
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);
      
      const res = await fetch(`${API_BASE}/schedules?start=${start.toISOString()}&end=${end.toISOString()}`, { headers: authHeaders() });
      const data = await res.json();
      setSchedules(data.schedules || []);
    } catch (error) {
      console.error('获取日程失败:', error);
    }
  }, [selectedDate]);

  // 获取分类数据
  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/categories`);
      const data = await res.json();
      setCategories(data.categories || []);
    } catch (error) {
      console.error('获取分类失败:', error);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchSchedules(), fetchCategories()]);
      setLoading(false);
    };
    loadData();
  }, [fetchSchedules, fetchCategories]);

  // 切换日程完成状态
  const toggleComplete = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/schedules/${id}/toggle`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (data.schedule) {
        setSchedules(prev => prev.map(s => s.id === id ? data.schedule : s));
      }
    } catch (error) {
      console.error('切换状态失败:', error);
    }
  };

  // 删除日程
  const deleteSchedule = async (id: string) => {
    if (!confirm('确定要删除这个日程吗？')) return;
    try {
      await fetch(`${API_BASE}/schedules/${id}`, { method: 'DELETE', headers: authHeaders() });
      setSchedules(prev => prev.filter(s => s.id !== id));
    } catch (error) {
      console.error('删除失败:', error);
    }
  };

  // 格式化时间
  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  // 格式化日期
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('zh-CN', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  // 导航到上/下一天
  const goToPrevDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(newDate);
  };

  const goToNextDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  // 获取星期列表
  const getWeekDays = () => {
    const days = [];
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    
    for (let i = 0; i < 7; i++) {
      const day = new Date(startOfWeek);
      day.setDate(startOfWeek.getDate() + i);
      days.push(day);
    }
    return days;
  };

  // 按时间排序的日程
  const sortedSchedules = [...schedules].sort((a, b) => 
    new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 日历头部 */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Calendar className="w-7 h-7 text-blue-500" />
              智能日程表
            </h1>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={goToToday}
              className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
            >
              今天
            </button>
            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
              <button
                onClick={goToPrevDay}
                className="px-3 py-2 hover:bg-gray-100 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="px-4 py-2 text-sm font-medium bg-white min-w-[200px] text-center">
                {formatDate(selectedDate)}
              </span>
              <button
                onClick={goToNextDay}
                className="px-3 py-2 hover:bg-gray-100 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 日程列表 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-gray-500">加载中...</div>
            </div>
          ) : sortedSchedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <Calendar className="w-16 h-16 mb-4 text-gray-300" />
              <p className="text-lg">今天没有日程</p>
              <p className="text-sm mt-2">在左侧对话框中告诉小爱你想安排什么</p>
            </div>
          ) : (
            <div className="space-y-4">
              {sortedSchedules.map((schedule) => (
                <div
                  key={schedule.id}
                  className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden transition-all hover:shadow-md ${
                    schedule.is_completed ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex">
                    {/* 左侧时间条 */}
                    <div 
                      className="w-1"
                      style={{ backgroundColor: categoryColors[schedule.category] || '#6B7280' }}
                    />
                    
                    {/* 时间信息 */}
                    <div className="p-4 w-32 flex-shrink-0 border-r border-gray-100">
                      <div className="flex items-center gap-1 text-gray-600">
                        <Clock className="w-4 h-4" />
                        <span className="text-sm font-medium">
                          {formatTime(schedule.start_time)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        至 {formatTime(schedule.end_time)}
                      </div>
                    </div>

                    {/* 内容 */}
                    <div className="flex-1 p-4">
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleComplete(schedule.id)}
                          className="mt-1 flex-shrink-0"
                        >
                          {schedule.is_completed ? (
                            <CheckCircle className="w-5 h-5 text-green-500" />
                          ) : (
                            <Circle className="w-5 h-5 text-gray-300 hover:text-green-500 transition-colors" />
                          )}
                        </button>
                        
                        <div className="flex-1 min-w-0">
                          <h3 className={`font-medium text-gray-800 ${
                            schedule.is_completed ? 'line-through text-gray-500' : ''
                          }`}>
                            {schedule.title}
                          </h3>
                          
                          {schedule.description && (
                            <p className="text-sm text-gray-500 mt-1">{schedule.description}</p>
                          )}
                          
                          <div className="flex items-center gap-4 mt-2 flex-wrap">
                            {schedule.location && (
                              <div className="flex items-center gap-1 text-xs text-gray-500">
                                <MapPin className="w-3 h-3" />
                                {schedule.location}
                              </div>
                            )}
                            
                            <div 
                              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                              style={{ 
                                backgroundColor: `${categoryColors[schedule.category]}20`,
                                color: categoryColors[schedule.category]
                              }}
                            >
                              <Tag className="w-3 h-3" />
                              {categories.find(c => c.id === schedule.category)?.name || schedule.category}
                            </div>
                            
                            <div 
                              className="text-xs px-2 py-0.5 rounded-full"
                              style={{ 
                                backgroundColor: `${priorityLabels[schedule.priority].color}20`,
                                color: priorityLabels[schedule.priority].color
                              }}
                            >
                              {priorityLabels[schedule.priority].label}优先级
                            </div>
                          </div>
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => deleteSchedule(schedule.id)}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右侧统计面板 */}
        <div className="w-72 bg-white border-l border-gray-200 p-4 overflow-y-auto">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <List className="w-5 h-5 text-blue-500" />
            日程统计
          </h2>
          
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
              <div className="text-3xl font-bold">{sortedSchedules.length}</div>
              <div className="text-sm text-blue-100">今日日程</div>
            </div>
            
            <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white">
              <div className="text-3xl font-bold">
                {sortedSchedules.filter(s => s.is_completed).length}
              </div>
              <div className="text-sm text-green-100">已完成</div>
            </div>
            
            <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-4 text-white">
              <div className="text-3xl font-bold">
                {sortedSchedules.filter(s => !s.is_completed).length}
              </div>
              <div className="text-sm text-orange-100">待完成</div>
            </div>
          </div>

          {/* 分类统计 */}
          <h3 className="font-semibold text-gray-800 mt-6 mb-3">分类分布</h3>
          <div className="space-y-2">
            {Object.entries(categoryColors).map(([catId, color]) => {
              const count = sortedSchedules.filter(s => s.category === catId).length;
              if (count === 0) return null;
              return (
                <div key={catId} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-sm text-gray-600">
                      {categories.find(c => c.id === catId)?.name || catId}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-gray-800">{count}</span>
                </div>
              );
            })}
          </div>

          {/* 快速提示 */}
          <div className="mt-6 p-4 bg-blue-50 rounded-xl">
            <h4 className="font-medium text-blue-800 mb-2">💡 小贴士</h4>
            <p className="text-xs text-blue-600">
              在左侧对话框中输入自然语言，例如：
              <br />
              "明天下午3点去开会"
              <br />
              "安排周末去旅游"
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
