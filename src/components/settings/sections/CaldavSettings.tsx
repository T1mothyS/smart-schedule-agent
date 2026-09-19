import { useCallback, useEffect, useState } from 'react';
import { Button } from 'tdesign-react';
import { SettingSection } from '../SettingSection';
import { SettingRow } from '../SettingRow';
import type { SettingsAuthHeaders } from '../types';

interface Summary { breakdown?: Record<string, number>; counts?: Record<string, number>; exclusions?: Record<string, number>; issues: Array<{ sourceId: string; code: string }>; complete?: boolean }
interface Plan extends Summary { sourceMappings?: Array<{ sourceId: string; cycleId: string; taskId: string; derivedSourceIds: string[]; current: boolean; status: string; enabled: boolean; included: boolean }>; planToken: string; scopeVersion: string; migrationRequired: boolean; requiresDeleteConfirmation: boolean; operations: Array<{ sourceId: string; action: string }> }
interface Status { includeCompleted?: boolean; enabled: boolean; mode: string; confirmedScope?: string; verifiedScope?: string; scopeVersion: string; automationAvailable: boolean; writeEnabled: boolean; busy: boolean; lastSuccess?: string; lastError?: string; nextAttempt?: number; summary?: Summary }
const labels: Record<string, string> = { event: '日程', todo: '已排期待办', cycle: '周期实例', pending: '未完成', current_cycle: '当前周期', historical_cycle: '历史周期', cancelled_cycle: '已取消周期', merged_copy: '已归并副本', completed: '已完成', unscheduled: '未排期', derived_cycle: '周期派生副本（去重）', disabled_cycle: '已停用周期', completed_cycle: '已结束周期', outside_scope: '范围外日历', unsupported_type: '不支持的类型', create: '新增', update: '更新', delete: '撤回', unchanged: '无变化', recover: '恢复确认', held: '保留待处理' };
const errors: Record<string, string> = {
  CALDAV_BRIDGE_DISABLED: '服务器尚未开启荣耀日历桥接。', CALDAV_BRIDGE_FORBIDDEN: '此账号未绑定荣耀日历桥接。',
  CALDAV_NETWORK_ERROR: '无法连接日历服务，将按计划重试。', CALDAV_AUTH_FAILED: '日历服务认证失败，请检查服务器凭据。',
  REMOTE_CHANGED: '手机目标资源被外部修改，同步已停止，请检查冲突。', MANUAL_CONFIRMATION_REQUIRED: '本次涉及大量撤回或账本升级，请重新预览并确认。',
  SCOPE_CONFIRMATION_REQUIRED: '同步范围有变化，请先预览并完成一次同步。', PHONE_VERIFICATION_REQUIRED: '请先完成手机核心验证。',
  RESTORE_REVIEW_REQUIRED: '备份恢复后同步已暂停，请重新预览核对。', INCOMPLETE_PROJECTION: '部分项目待处理，尚未完成全量同步。',
  ORPHANED_CYCLE_COPY: '发现缺少权威周期的派生副本，已停止同步；请检查来源映射。',
  SOURCE_SNAPSHOT_INCOMPLETE: '来源读取不完整，已停止同步以保护手机数据。', BRIDGE_BUSY: '同步正在执行，请稍后重试。',
  PREVIEW_CHANGED_OR_BLOCKED: '数据已变化，请重新预览。', BRIDGE_CONTROL_INVALID: '同步控制状态异常，请联系维护者。',
  AMBIGUOUS_ALL_DAY_RANGE: '全天日期范围需要在日程中确认', UNSUPPORTED_RECURRENCE: '暂不支持的重复规则',
  ALARMS_DISABLED: '该项目仅同步显示，手机提醒未启用', PILOT_LIMIT_EXCEEDED: '同步范围超过 500 条安全上限',
};
const explain = (code: string) => errors[code] || `需要检查：${code}`;

export function CaldavSettings({ authHeaders }: { authHeaders: SettingsAuthHeaders }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [phoneVerified, setPhoneVerified] = useState(false);
  const request = useCallback(async (action: string, body?: object) => {
    const response = await fetch(`/api/integrations/caldav/${action}`, { method: body ? 'POST' : 'GET', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json(); if (!response.ok) throw new Error(explain(result.error || 'CALDAV_BRIDGE_FAILED')); return result;
  }, [authHeaders]);
  const load = useCallback(async () => { try { setStatus(await request('status')); setError(''); } catch (e) { setError((e as Error).message); setStatus(null); } }, [request]);
  useEffect(() => { void load(); }, [load]);
  const act = async (action: string, body: object) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request(action, body);
      if (action === 'preview') setPlan(result);
      else { setPlan(null); setMessage(action === 'sync' ? (result.complete ? '本批次已写入 CalDAV，请在手机刷新后检查。' : '有效项目已同步，仍有待处理项目，尚非全量完成。') : '自动同步设置已保存。'); }
      await load();
    } catch (e) { setError((e as Error).message); setPlan(null); }
    finally { setBusy(false); }
  };
  const summary = plan || status?.summary;
  const actions: Record<string, number> = {};
  plan?.operations.forEach(op => { actions[op.action] = (actions[op.action] || 0) + 1; });
  return <SettingSection id="caldav" title="荣耀日历同步" description="AI Calendar 是唯一数据来源；手机只读。服务器每 5 分钟检查变化，手机刷新时间由系统决定。">
    <SettingRow label="同步状态">
      <div className="settings-status" role="status">
        <strong>{status ? (status.enabled ? '自动同步已开启' : '自动同步已暂停') : error ? '暂不可用' : '正在加载…'}</strong>
        {status && <span>{status.mode === 'full-one-way' ? '全部日历：已排期日程、待办及已保存周期（含历史、停用和取消）。新增日历也纳入。' : '当前仍为选定日历试点，全部范围尚未配置。'}</span>}
        <span>{status?.includeCompleted ? '已完成项目保留并标记状态，不产生手机提醒。' : '兼容策略：已完成项目仍排除；需服务器显式启用。'}无固定期限待办及未确认草稿不进入手机；待办与周期完成仍在网页登记。</span>
        {status?.lastSuccess && <span>最近写入 CalDAV：{new Date(status.lastSuccess).toLocaleString('zh-CN')}（不代表手机已刷新）</span>}
        {status?.nextAttempt && <span>下次重试：{new Date(status.nextAttempt).toLocaleString('zh-CN')}</span>}
        {status?.lastError && <span>{explain(status.lastError)}</span>}
        {error && <span role="alert">{error}</span>}{message && <span>{message}</span>}
      </div>
      <div className="settings-actions">
        <Button tag="button" variant="outline" disabled={busy} onClick={load}>刷新状态</Button>
        <Button tag="button" disabled={!status || busy} loading={busy} onClick={() => act('preview', {})}>预览变更</Button>
        {plan && <Button tag="button" theme="primary" disabled={busy || !status?.writeEnabled} onClick={() => {
          const count = actions.delete || 0;
          if (window.confirm(`确认执行本次预览？将撤回 ${count} 条手机投影，网页源数据不删除。${plan.migrationRequired ? '本次还会备份并升级同步账本。' : ''}`)) void act('sync', { planToken: plan.planToken });
        }}>确认同步</Button>}
      </div>
      {status && !status.writeEnabled && <p className="settings-help">服务器写入开关尚未开启，目前仅可预览。</p>}
      {summary && <div className="settings-status" style={{ display: 'grid', gap: 8 }}>
        <strong>{summary.complete ? '内容范围无待处理项' : '存在待处理项，尚未完成全量'}</strong>
        <span>{Object.entries(summary.counts || {}).map(([key, count]) => `${labels[key] || key} ${count}`).join(' · ')}</span>
        <span>状态分布（可重叠）：{Object.entries(summary.breakdown || {}).map(([key, count]) => `${labels[key] || key} ${count}`).join(' · ') || '暂无'}</span>
        <span>排除：{Object.entries(summary.exclusions || {}).map(([key, count]) => `${labels[key] || key} ${count}`).join(' · ') || '无'}</span>
        {plan && <span>本次变更：{Object.entries(actions).map(([key, count]) => `${labels[key] || key} ${count}`).join(' · ') || '无'}</span>}
        {plan?.requiresDeleteConfirmation && <strong>大量撤回已拦截自动执行，请核对预览后手动确认。</strong>}
        {!!plan?.operations.length && <details><summary>查看逐项变更（{plan.operations.length}）</summary><ul style={{ overflowWrap: 'anywhere' }}>{plan.operations.map((op, i) => <li key={i}>{labels[op.action] || op.action} · {op.sourceId}</li>)}</ul></details>}
        {!!plan?.sourceMappings?.length && <details><summary>周期来源映射（{plan.sourceMappings.length}）</summary><ul style={{ overflowWrap: 'anywhere' }}>{plan.sourceMappings.map(item => <li key={item.cycleId}>{item.current ? '当前' : '历史'} · {item.status === 'completed' ? '已完成' : item.status === 'cancelled' ? '已取消' : item.status === 'expired' ? '逾期' : '待完成'}{!item.enabled ? ' · 已停用' : ''}{item.included === false ? ' · 当前策略排除' : ''} · {item.taskId} / {item.cycleId} → {item.sourceId}；归并：{item.derivedSourceIds.join('、') || '无'}</li>)}</ul></details>}
        {!!summary.issues.length && <details><summary>查看 {summary.issues.length} 个提示或待处理项</summary><ul style={{ overflowWrap: 'anywhere' }}>{summary.issues.map((issue, i) => <li key={i}>{explain(issue.code)} · {issue.sourceId}</li>)}</ul></details>}
      </div>}
    </SettingRow>
    {status && <SettingRow label="自动同步">
      <p className="settings-help">首次启用前，请确认手机能收到新增、修改、删除、完成/恢复及周期历史（完成是否保留按当前策略核对），只读操作不影响后续同步。提醒另行验证，尚未通过的类型保持关闭。</p>
      {!status.enabled && status.verifiedScope !== status.scopeVersion && <label className="settings-help"><input type="checkbox" checked={phoneVerified} onChange={e => setPhoneVerified(e.target.checked)} /> 我已完成上述手机核心验证</label>}
      <div className="settings-actions"><Button tag="button" variant="outline" disabled={busy || (!status.enabled && (!status.automationAvailable || status.confirmedScope !== status.scopeVersion || (!phoneVerified && status.verifiedScope !== status.scopeVersion)))} onClick={() => act('automation', { enabled: !status.enabled, scopeVersion: status.scopeVersion, phoneVerified })}>{status.enabled ? '暂停自动同步' : '启用自动同步'}</Button></div>
      {!status.automationAvailable && <p className="settings-help">自动任务尚未获服务器启用；可继续手动同步。</p>}
    </SettingRow>}
  </SettingSection>;
}
