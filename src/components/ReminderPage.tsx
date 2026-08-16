import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Edit3,
  Mail,
  PauseCircle,
  PlayCircle,
  Plus,
  Repeat2,
  Smartphone,

  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import type { CreditCardConfig, GenericReminderConfig, ReminderStats, ReminderTask, ReminderTaskType, SimConfig } from '../reminder-types';

type Filter = 'all' | ReminderTaskType | 'expired';

interface ReminderPageProps {
  theme?: string;
  onToggleTheme?: () => void;
  onBackToCalendar: () => void;
  user?: { email: string; role: 'admin' | 'user' } | null;
  onLogout?: () => void;
}

interface FormState {
  type: ReminderTaskType;
  name: string;
  statementDay: string;
  paymentDay: string;
  paymentMonthOffset: string;
  provider: string;
  numberMasked: string;
  region: string;
  intervalDays: string;
  lastOperationDate: string;
  actionGuide: string;
  templateKey: GenericReminderConfig['templateKey'];
  frequency: 'once' | 'monthly' | 'yearly' | 'interval';
  anchorDate: string;
  dayOfMonth: string;
  month: string;
  ruleInterval: string;
  intervalUnit: 'day' | 'month' | 'year';
  advancePolicy: 'calendar' | 'completion';
  reminderOffsets: string;
  reminderTime: string;
  priority: 'high' | 'medium' | 'low';
}

const today = () => new Date().toISOString().slice(0, 10);
const initialForm: FormState = {
  type: 'credit_card',
  name: '',
  statementDay: '22',
  paymentDay: '20',
  paymentMonthOffset: '1',
  provider: '',
  numberMasked: '',
  region: '',
  intervalDays: '180',
  lastOperationDate: today(),
  actionGuide: '充值、消费、发送短信、拨打电话或使用流量',
  templateKey: 'custom',
  frequency: 'once',
  anchorDate: today(),
  dayOfMonth: '1',
  month: '1',
  ruleInterval: '1',
  intervalUnit: 'day',
  advancePolicy: 'calendar',
  reminderOffsets: '7,1',
  reminderTime: '09:00',
  priority: 'medium',
};

const templates: Array<{ key: GenericReminderConfig['templateKey']; name: string }> = [
  { key: 'subscription', name: '订阅续费' },
  { key: 'insurance', name: '保险' },
  { key: 'document', name: '证件' },
  { key: 'membership', name: '会员' },
  { key: 'rent', name: '房租' },
  { key: 'utilities', name: '水电账单' },
  { key: 'vehicle_inspection', name: '车辆年检' },
  { key: 'custom', name: '自定义事务' },
];

function statusLabel(status: string | undefined): { label: string; tone: string } {
  if (status === 'completed') return { label: '已完成', tone: 'success' };
  if (status === 'expired') return { label: '已逾期', tone: 'danger' };
  if (status === 'cancelled') return { label: '已停用', tone: 'muted' };
  return { label: '待处理', tone: 'info' };
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const start = new Date(today() + 'T00:00:00Z').getTime();
  const end = new Date(date + 'T00:00:00Z').getTime();
  return Math.round((end - start) / 86_400_000);
}

function formatDue(date: string | null): string {
  return date ? date.replace(/-/g, '.') : '尚未生成';
}

function configToForm(task: ReminderTask): FormState {
  if (task.type === 'credit_card') {
    const config = task.config as CreditCardConfig;
    return {
      ...initialForm,
      type: 'credit_card',
      name: task.name,
      statementDay: String(config.statementDay),
      paymentDay: String(config.paymentDay),
      paymentMonthOffset: String(config.paymentMonthOffset),
      reminderOffsets: (config.reminderOffsets || [15, 7, 1, 0]).join(','),
      reminderTime: config.reminderTime || '09:00',
      priority: config.priority || 'high',
    };
  }
  if (task.type === 'sim') {
    const config = task.config as SimConfig;
    return {
      ...initialForm,
      type: 'sim',
      name: task.name,
      provider: config.provider,
      numberMasked: config.numberMasked,
      region: config.region,
      intervalDays: String(config.intervalDays),
      lastOperationDate: config.lastOperationDate,
      actionGuide: config.actionGuide,
      reminderOffsets: (config.reminderOffsets || [30, 15, 7, 1, 0]).join(','),
      reminderTime: config.reminderTime || '09:00',
      priority: config.priority || 'medium',
    };
  }
  const config = task.config as GenericReminderConfig;
  const rule = config.rule;
  return {
    ...initialForm,
    type: 'generic',
    name: task.name,
    templateKey: config.templateKey,
    frequency: rule.frequency,
    anchorDate: task.currentCycle?.dueDate || rule.anchorDate,
    dayOfMonth: 'dayOfMonth' in rule ? String(rule.dayOfMonth) : rule.anchorDate.slice(8, 10),
    month: 'month' in rule ? String(rule.month) : rule.anchorDate.slice(5, 7),
    ruleInterval: 'interval' in rule ? String(rule.interval) : '1',
    intervalUnit: 'unit' in rule ? rule.unit : 'day',
    advancePolicy: rule.advancePolicy,
    reminderOffsets: config.reminderOffsets.join(','),
    reminderTime: config.reminderTime,
    priority: config.priority,
    actionGuide: config.actionGuide,
  };
}

export function ReminderPage() {
  const { authHeaders } = useAuth();
  const [tasks, setTasks] = useState<ReminderTask[]>([]);
  const [stats, setStats] = useState<ReminderStats>({ total: 0, active: 0, dueSoon: 0, expired: 0 });
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ReminderTask | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [completeTarget, setCompleteTarget] = useState<ReminderTask | null>(null);
  const [completeDate, setCompleteDate] = useState(today());
  const [completeNote, setCompleteNote] = useState('');

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/cycle-reminders', { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '获取提醒失败');
      setTasks(data.tasks || []);
      setStats(data.stats || { total: 0, active: 0, dueSoon: 0, expired: 0 });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : '获取提醒失败' });
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const visibleTasks = useMemo(() => tasks.filter(task => {
    if (filter === 'expired') return task.currentCycle?.status === 'expired';
    return filter === 'all' || task.type === filter;
  }), [filter, tasks]);

  const updateForm = (key: keyof FormState, value: string) => setForm(current => ({ ...current, [key]: value }));
  const openCreate = (type: ReminderTaskType = 'credit_card') => { setEditing(null); setForm({ ...initialForm, type, lastOperationDate: today() }); setFormOpen(true); };
  const openEdit = (task: ReminderTask) => { setEditing(task); setForm(configToForm(task)); setFormOpen(true); };

  const saveTask = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const config = form.type === 'credit_card'
        ? {
          statementDay: Number(form.statementDay),
          paymentDay: Number(form.paymentDay),
          paymentMonthOffset: Number(form.paymentMonthOffset),
          reminderOffsets: form.reminderOffsets.split(/[,，\s]+/).map(Number).filter(value => Number.isFinite(value)),
          reminderTime: form.reminderTime,
          priority: form.priority,
        }
        : form.type === 'sim'
        ? {
          provider: form.provider,
          numberMasked: form.numberMasked,
          region: form.region,
          intervalDays: Number(form.intervalDays),
          lastOperationDate: form.lastOperationDate,
          actionGuide: form.actionGuide,
          reminderOffsets: form.reminderOffsets.split(/[,，\s]+/).map(Number).filter(value => Number.isFinite(value)),
          reminderTime: form.reminderTime,
          priority: form.priority,
        }
        : {
          templateKey: form.templateKey,
          rule: {
            frequency: form.frequency,
            anchorDate: form.anchorDate,
            dayOfMonth: Number(form.dayOfMonth),
            month: Number(form.month),
            interval: Number(form.ruleInterval),
            unit: form.intervalUnit,
            advancePolicy: form.advancePolicy,
          },
          reminderOffsets: form.reminderOffsets.split(/[,，\s]+/).map(Number).filter(value => Number.isFinite(value)),
          reminderTime: form.reminderTime,
          actionGuide: form.actionGuide,
          priority: form.priority,
        };
      const response = await fetch(editing ? '/api/cycle-reminders/' + editing.id : '/api/cycle-reminders', {
        method: editing ? 'PATCH' : 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, type: form.type, config }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败');
      setFormOpen(false);
      setNotice({ type: 'success', message: editing ? '提醒任务已更新' : '提醒任务已创建' });
      await loadTasks();
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : '保存失败' });
    } finally { setSaving(false); }
  };

  const completeTask = async () => {
    if (!completeTarget?.currentCycle) return;
    setSaving(true);
    try {
      const response = await fetch('/api/cycle-reminders/' + completeTarget.id + '/complete', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycleId: completeTarget.currentCycle.id, completedDate: completeDate, note: completeNote }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '标记完成失败');
      setCompleteTarget(null);
      setCompleteNote('');
      setNotice({ type: 'success', message: '已完成登记，下一周期已生成' });
      await loadTasks();
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : '标记完成失败' });
    } finally { setSaving(false); }
  };

  const toggleTask = async (task: ReminderTask) => {
    try {
      const response = await fetch('/api/cycle-reminders/' + task.id, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !task.enabled }),
      });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || '更新状态失败'); }
      await loadTasks();
    } catch (error) { setNotice({ type: 'error', message: error instanceof Error ? error.message : '更新状态失败' }); }
  };

  const deleteTask = async (task: ReminderTask) => {
    if (!window.confirm('确定删除“' + task.name + '”及其历史记录吗？')) return;
    try {
      const response = await fetch('/api/cycle-reminders/' + task.id, { method: 'DELETE', headers: authHeaders() });
      if (!response.ok) throw new Error('删除失败');
      setNotice({ type: 'success', message: '提醒任务已删除' });
      await loadTasks();
    } catch (error) { setNotice({ type: 'error', message: error instanceof Error ? error.message : '删除失败' }); }
  };

  const sendTestEmail = async () => {
    try {
      const response = await fetch('/api/cycle-reminders/test-email', { method: 'POST', headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '测试邮件发送失败');
      setNotice({ type: 'success', message: '测试邮件已发送' });
    } catch (error) { setNotice({ type: 'error', message: error instanceof Error ? error.message : '测试邮件发送失败' }); }
  };

  return (
    <div className="reminder-page">
      <main className="reminder-content">
        <section className="reminder-hero"><div><div className="eyebrow">PERSONAL OPERATIONS</div><h1>把容易忘的事，交给日历记住。</h1><p>信用卡和 SIM 卡会按照各自规则生成周期。邮件负责提醒，页面负责登记完成。</p></div><button className="primary-button" onClick={() => openCreate()}><Plus size={17} /> 新建提醒</button></section>

        {notice && <div className={'notice ' + notice.type} role="status">{notice.type === 'success' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}<span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="关闭提示"><X size={15} /></button></div>}

        <section className="stats-grid">
          <div className="stat-card"><div className="stat-icon blue"><CalendarClock size={18} /></div><div><span>全部任务</span><strong>{stats.total}</strong></div></div>
          <div className="stat-card"><div className="stat-icon green"><CheckCircle2 size={18} /></div><div><span>正常运行</span><strong>{stats.active}</strong></div></div>
          <div className="stat-card"><div className="stat-icon amber"><BellRing size={18} /></div><div><span>7 天内到期</span><strong>{stats.dueSoon}</strong></div></div>
          <div className="stat-card"><div className="stat-icon red"><AlertTriangle size={18} /></div><div><span>需要补登记</span><strong>{stats.expired}</strong></div></div>
        </section>

        <section className="reminder-toolbar"><div><h2>我的提醒</h2><span>已发送的提醒会自动记录，不会重复发送。</span></div><div className="toolbar-actions"><div className="filter-pills">{([['all', '全部'], ['credit_card', '信用卡'], ['sim', 'SIM 卡'], ['generic', '生活事务'], ['expired', '逾期']] as [Filter, string][]).map(([value, label]) => <button key={value} className={filter === value ? 'filter-pill active' : 'filter-pill'} onClick={() => setFilter(value)}>{label}</button>)}</div><button className="secondary-button" onClick={sendTestEmail}><Mail size={15} /> 测试邮件</button></div></section>

        {loading ? <div className="empty-panel"><div className="loading-dot" /><span>正在加载提醒...</span></div> : visibleTasks.length === 0 ? <div className="empty-panel"><div className="empty-icon"><BellRing size={23} /></div><h3>{filter === 'all' ? '还没有周期提醒' : '没有符合条件的任务'}</h3><p>{filter === 'all' ? '先创建一张信用卡或一张 SIM 卡，日历会自动帮你安排提醒。' : '换一个筛选条件，或者新建一条提醒。'}</p>{filter === 'all' && <button className="primary-button" onClick={() => openCreate()}><Plus size={17} /> 新建第一条提醒</button>}</div> : (
          <section className="task-grid">{visibleTasks.map(task => {
            const cycle = task.currentCycle;
            const status = statusLabel(cycle?.status);
            const remaining = daysUntil(cycle?.dueDate || null);
            const cardConfig = task.config as CreditCardConfig;
            const simConfig = task.config as SimConfig;
            const genericConfig = task.config as GenericReminderConfig;
            return <article className={!task.enabled ? 'task-card disabled' : 'task-card'} key={task.id}>
              <div className="task-card-head"><div className={'task-type-icon ' + (task.type === 'credit_card' ? 'card' : task.type === 'sim' ? 'sim' : 'generic')}>{task.type === 'credit_card' ? <CreditCard size={20} /> : task.type === 'sim' ? <Smartphone size={20} /> : <Repeat2 size={20} />}</div><div className="task-title-wrap"><h3>{task.name}</h3></div><span className={'status-badge ' + status.tone}>{status.label}</span></div>
              <div className="task-due-block"><span>{task.type === 'credit_card' ? '本期还款日' : task.type === 'sim' ? '本次保号截止' : '本周期到期日'}</span><strong>{formatDue(cycle?.dueDate || null)}</strong><em>{remaining === null ? '—' : remaining < 0 ? '已逾期 ' + Math.abs(remaining) + ' 天' : remaining === 0 ? '今天到期' : '还有 ' + remaining + ' 天'}</em></div>
              <div className="task-details">{task.type === 'credit_card' ? <><span>账单日每月 {cardConfig.statementDay} 日</span><span>{cardConfig.paymentMonthOffset === 1 ? '次月' : '当月'} {cardConfig.paymentDay} 日还款</span><span>提前提醒：{(cardConfig.reminderOffsets || [15, 7, 1, 0]).map(value => value + ' 天').join(' · ')}</span></> : task.type === 'sim' ? <><span>{simConfig.provider || '未填写运营商'} · {simConfig.numberMasked || '未填写号码'}</span><span>每 {simConfig.intervalDays} 天检查一次</span><span>提前提醒：{(simConfig.reminderOffsets || [30, 15, 7, 1, 0]).map(value => value + ' 天').join(' · ')}</span></> : <><span>{genericConfig.actionGuide}</span><span>{genericConfig.reminderOffsets.map(value => '提前 ' + value + ' 天').join(' · ')}</span></>}</div>
              <div className="task-card-foot"><div className="task-reminder-meta"><span className="next-reminder">{task.enabled && task.nextReminderDate ? '下一提醒 ' + formatDue(task.nextReminderDate) : task.enabled ? '暂无待发送提醒' : '已暂停提醒'}</span><small className="last-reminder">{task.lastReminderDate ? '上次提醒 ' + formatDue(task.lastReminderDate) : '上次提醒：尚未发送'}</small></div><div className="card-actions">{task.enabled && cycle && cycle.status !== 'completed' && <button className="complete-button" onClick={() => { setCompleteTarget(task); setCompleteDate(today()); }}><CheckCircle2 size={15} /> 标记完成</button>}<button className="icon-button small" onClick={() => openEdit(task)} title="编辑"><Edit3 size={15} /></button><button className="icon-button small" onClick={() => toggleTask(task)} title={task.enabled ? '暂停' : '启用'}>{task.enabled ? <PauseCircle size={15} /> : <PlayCircle size={15} />}</button><button className="icon-button small danger-button" onClick={() => deleteTask(task)} title="删除"><Trash2 size={15} /></button></div></div>
            </article>;
          })}</section>
        )}
      </main>

      {formOpen && <div className="modal-backdrop" onMouseDown={() => setFormOpen(false)}>
        <form className="reminder-modal" onSubmit={saveTask} onMouseDown={event => event.stopPropagation()}>
          <div className="modal-head"><div><span className="eyebrow">REMINDER SETUP</span><h2>{editing ? '编辑提醒' : '新建提醒'}</h2></div><button type="button" className="icon-button" onClick={() => setFormOpen(false)}><X size={17} /></button></div>
          <label className="form-label">任务名称<input required value={form.name} onChange={event => updateForm('name', event.target.value)} placeholder="例如：房租、水费或会员续费" /></label>
          <div className="type-switch">
            <button type="button" className={form.type === 'credit_card' ? 'type-option active' : 'type-option'} onClick={() => updateForm('type', 'credit_card')}><CreditCard size={16} /> 信用卡</button>
            <button type="button" className={form.type === 'sim' ? 'type-option active' : 'type-option'} onClick={() => updateForm('type', 'sim')}><Smartphone size={16} /> SIM 卡</button>
            <button type="button" className={form.type === 'generic' ? 'type-option active' : 'type-option'} onClick={() => updateForm('type', 'generic')}><Repeat2 size={16} /> 生活事务</button>
          </div>
          {form.type === 'credit_card' ? <div className="form-grid">
            <label className="form-label">每月账单日<input type="number" min="1" max="31" required value={form.statementDay} onChange={event => updateForm('statementDay', event.target.value)} /><small>没有该日期的月份按最后一天计算</small></label>
            <label className="form-label">还款日<input type="number" min="1" max="31" required value={form.paymentDay} onChange={event => updateForm('paymentDay', event.target.value)} /></label>
            <label className="form-label full">还款日属于<select value={form.paymentMonthOffset} onChange={event => updateForm('paymentMonthOffset', event.target.value)}><option value="1">出账次月</option><option value="0">出账当月</option></select></label>
          </div> : form.type === 'sim' ? <div className="form-grid">
            <label className="form-label">运营商<input required value={form.provider} onChange={event => updateForm('provider', event.target.value)} placeholder="例如：中国移动" /></label>
            <label className="form-label">号码（建议脱敏）<input required value={form.numberMasked} onChange={event => updateForm('numberMasked', event.target.value)} placeholder="例如：138****1234" /></label>
            <label className="form-label">国家/地区<input value={form.region} onChange={event => updateForm('region', event.target.value)} placeholder="例如：中国大陆" /></label>
            <label className="form-label">周期天数<input type="number" min="1" max="3650" required value={form.intervalDays} onChange={event => updateForm('intervalDays', event.target.value)} /></label>
            <label className="form-label full">上一次有效操作日期<input type="date" required value={form.lastOperationDate} onChange={event => updateForm('lastOperationDate', event.target.value)} /><small>下一周期会从实际完成日期重新计算</small></label>
            <label className="form-label full">建议操作<input value={form.actionGuide} onChange={event => updateForm('actionGuide', event.target.value)} /></label>
          </div> : <div className="form-grid">
            <label className="form-label">事务模板<select value={form.templateKey} onChange={event => updateForm('templateKey', event.target.value)}>{templates.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
            <label className="form-label">周期类型<select value={form.frequency} onChange={event => updateForm('frequency', event.target.value)}><option value="once">单次</option><option value="monthly">每月</option><option value="yearly">每年</option><option value="interval">固定间隔</option></select></label>
            <label className="form-label">本期到期日<input type="date" required value={form.anchorDate} onChange={event => updateForm('anchorDate', event.target.value)} /></label>
            {form.frequency === 'monthly' && <label className="form-label">每月几号<input type="number" min="1" max="31" value={form.dayOfMonth} onChange={event => updateForm('dayOfMonth', event.target.value)} /><small>不存在该日时按月末</small></label>}
            {form.frequency === 'yearly' && <><label className="form-label">月份<input type="number" min="1" max="12" value={form.month} onChange={event => updateForm('month', event.target.value)} /></label><label className="form-label">日期<input type="number" min="1" max="31" value={form.dayOfMonth} onChange={event => updateForm('dayOfMonth', event.target.value)} /></label></>}
            {form.frequency === 'interval' && <><label className="form-label">间隔<input type="number" min="1" max="120" value={form.ruleInterval} onChange={event => updateForm('ruleInterval', event.target.value)} /></label><label className="form-label">单位<select value={form.intervalUnit} onChange={event => updateForm('intervalUnit', event.target.value)}><option value="day">天</option><option value="month">月</option><option value="year">年</option></select></label></>}
            {form.frequency !== 'once' && <label className="form-label">下一周期依据<select value={form.advancePolicy} onChange={event => updateForm('advancePolicy', event.target.value)}><option value="calendar">按原定日历</option><option value="completion">按实际完成日</option></select></label>}
            <label className="form-label">提醒时间<input type="time" value={form.reminderTime} onChange={event => updateForm('reminderTime', event.target.value)} /></label>
            <label className="form-label">提前提醒天数<input value={form.reminderOffsets} onChange={event => updateForm('reminderOffsets', event.target.value)} placeholder="例如：30,7,1" /></label>
            <label className="form-label">优先级<select value={form.priority} onChange={event => updateForm('priority', event.target.value)}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
            <label className="form-label full">建议操作<input value={form.actionGuide} onChange={event => updateForm('actionGuide', event.target.value)} /></label>
          </div>}
          {form.type !== 'generic' && <div className="form-grid">
            <label className="form-label">提醒时间<input type="time" value={form.reminderTime} onChange={event => updateForm('reminderTime', event.target.value)} /></label>
            <label className="form-label">提前提醒天数<input value={form.reminderOffsets} onChange={event => updateForm('reminderOffsets', event.target.value)} placeholder="例如：30,7,1" /><small>用逗号分隔，填 0 表示当天提醒</small></label>
            <label className="form-label full">优先级<select value={form.priority} onChange={event => updateForm('priority', event.target.value)}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
          </div>}
          <div className="modal-foot"><button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>取消</button><button className="primary-button" disabled={saving}>{saving ? '保存中…' : editing ? '保存修改' : '创建提醒'}</button></div>
        </form>
      </div>}

      {completeTarget && <div className="modal-backdrop" onMouseDown={() => setCompleteTarget(null)}><div className="complete-modal" onMouseDown={event => event.stopPropagation()}><div className="complete-icon"><CheckCircle2 size={24} /></div><h2>登记“{completeTarget.name}”已完成</h2><p>{completeTarget.type === 'sim' ? '请填写实际充值、消费或其他有效操作日期。' : '确认本期账单已经完成还款。'}</p><label className="form-label">实际完成日期<input type="date" value={completeDate} onChange={event => setCompleteDate(event.target.value)} /></label><label className="form-label">备注（可选）<textarea value={completeNote} onChange={event => setCompleteNote(event.target.value)} placeholder="例如：已开启自动还款" rows={3} /></label><div className="modal-foot"><button className="secondary-button" onClick={() => setCompleteTarget(null)}>取消</button><button className="primary-button" onClick={completeTask} disabled={saving}>{saving ? '保存中…' : '确认完成'}</button></div></div></div>}
    </div>
  );
}
