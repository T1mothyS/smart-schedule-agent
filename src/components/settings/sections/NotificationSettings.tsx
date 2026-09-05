import { useState, useEffect, useCallback } from 'react';
import { Button, MessagePlugin, Switch, Select } from 'tdesign-react';
import { SettingSection } from '../SettingSection';
import { SettingRow, SettingInput } from '../SettingRow';
import { loadNotificationPreferences, saveAndReloadNotificationPreferences } from '../../../services/notification-preferences';
import type { HomeLocation, SettingsAuthHeaders } from '../types';

export function NotificationSettings({ authHeaders, userEmail }: { authHeaders: SettingsAuthHeaders; userEmail: string }) {
  // ---------- 提醒设置 ----------
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHour, setReminderHour] = useState(8);
  const [reminderMinute, setReminderMinute] = useState(0);
  const [reminderEmail, setReminderEmail] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [reportEmailEnabled, setReportEmailEnabled] = useState(false);
  const [inAppEnabled, setInAppEnabled] = useState(true);
  const [browserEnabled, setBrowserEnabled] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('08:00');
  const [homeLocation, setHomeLocation] = useState<HomeLocation | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<HomeLocation[]>([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const [locationSaving, setLocationSaving] = useState(false);
  const [loadingReminder, setLoadingReminder] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const applyNotificationPreference = (preference: any) => {
    setReminderEnabled(preference.enabled ?? false);
    setReminderHour(preference.hour ?? 8);
    setReminderMinute(preference.minute ?? 0);
    setReminderEmail(preference.reminderEmail || userEmail || '');
    setEmailEnabled(preference.emailEnabled !== false);
    setReportEmailEnabled(preference.reportEmailEnabled === true);
    setInAppEnabled(preference.inAppEnabled !== false);
    setBrowserEnabled(preference.browserEnabled !== false);
    setQuietHoursEnabled(!!preference.quietHoursEnabled);
    setQuietStart(preference.quietStart || '22:00');
    setQuietEnd(preference.quietEnd || '08:00');
    setHomeLocation(preference.homeLocation || null);
  };

  const sameHomeLocation = (left: any, right: any): boolean => {
    if (left == null || right == null) return left == null && right == null;
    return ['name', 'admin1', 'country', 'latitude', 'longitude', 'timezone'].every(key => left[key] === right[key]);
  };

  const preferenceMatchesPayload = (payload: Record<string, unknown>, preference: any): boolean => {
    const booleanFields = ['enabled', 'emailEnabled', 'reportEmailEnabled', 'inAppEnabled', 'browserEnabled', 'quietHoursEnabled'] as const;
    for (const field of booleanFields) {
      if (field in payload && Boolean(payload[field]) !== Boolean(preference?.[field])) return false;
    }
    if ('hour' in payload && Number(payload.hour) !== Number(preference?.hour)) return false;
    if ('minute' in payload && Number(payload.minute) !== Number(preference?.minute)) return false;
    if ('reminderEmail' in payload && String(payload.reminderEmail || '').trim() !== String(preference?.reminderEmail || '').trim()) return false;
    if ('quietStart' in payload && String(payload.quietStart || '') !== String(preference?.quietStart || '')) return false;
    if ('quietEnd' in payload && String(payload.quietEnd || '') !== String(preference?.quietEnd || '')) return false;
    if ('homeLocation' in payload && !sameHomeLocation(payload.homeLocation, preference?.homeLocation)) return false;
    return true;
  };

  const loadReminder = useCallback(async () => {
    setInitialLoading(true);
    setLoadError('');
    try {
      const data = await loadNotificationPreferences(authHeaders());
      applyNotificationPreference(data.preference || {});
    } catch { setLoadError('通知设置加载失败，请重试后再修改。'); }
    finally { setInitialLoading(false); }
  }, [authHeaders, userEmail]);

  const saveAndConfirmNotificationPreferences = async (payload: Record<string, unknown>) => {
    const data = await saveAndReloadNotificationPreferences(payload, authHeaders());
    const preference = data.preference || {};
    if (!preferenceMatchesPayload(payload, preference)) {
      throw new Error('服务器保存的通知设置与当前选择不一致，请重试');
    }
    applyNotificationPreference(preference);
    return preference;
  };

  const notificationPayload = (overrides: Record<string, unknown> = {}) => ({
    enabled: reminderEnabled,
    hour: reminderHour,
    minute: reminderMinute,
    reminderEmail: reminderEmail.trim(),
    emailEnabled,
    reportEmailEnabled,
    inAppEnabled,
    browserEnabled,
    quietHoursEnabled,
    quietStart,
    quietEnd,
    homeLocation,
    ...overrides,
  });

  const saveReminderEmail = async () => {
    setLoadingReminder(true);
    try {
      await saveAndConfirmNotificationPreferences(notificationPayload());
      MessagePlugin.success('通知设置已保存');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '保存失败');
    } finally {
      setLoadingReminder(false);
    }
  };

  const saveHomeLocation = async (location: HomeLocation | null) => {
    setLocationSaving(true);
    try {
      const preference = await saveAndConfirmNotificationPreferences(notificationPayload({ homeLocation: location }));
      setLocationQuery('');
      setLocationResults([]);
      MessagePlugin.success(preference.homeLocation ? `常驻地点已保存：${preference.homeLocation.name}` : '常驻地点已清除');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '常驻地点保存失败');
    } finally {
      setLocationSaving(false);
    }
  };

  useEffect(() => {
    const query = locationQuery.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query)) {
      // Chrome 可能忽略 autocomplete 并把登录邮箱误填到后面的文本框；地点搜索不接受邮箱。
      setLocationQuery('');
      setLocationResults([]);
      setLocationSearching(false);
      return;
    }
    if (query.length < 2) {
      setLocationResults([]);
      setLocationSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLocationSearching(true);
      try {
        const response = await fetch('/api/weather/locations?q=' + encodeURIComponent(query), {
          headers: authHeaders(),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '地点搜索失败');
        setLocationResults(result.locations || []);
      } catch (error: any) {
        if (error?.name !== 'AbortError') {
          setLocationResults([]);
          MessagePlugin.error(error?.message || '地点搜索失败');
        }
      } finally {
        if (!controller.signal.aborted) setLocationSearching(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [locationQuery, authHeaders]);


  useEffect(() => { void loadReminder(); }, [loadReminder]);
  const disabled = initialLoading || !!loadError || loadingReminder || locationSaving;
  const saveToggle = async (field: 'enabled' | 'reportEmailEnabled', value: boolean) => {
    if (field === 'enabled') setReminderEnabled(value); else setReportEmailEnabled(value);
    setLoadingReminder(true);
    try {
      await saveAndConfirmNotificationPreferences(notificationPayload({ [field]: value }));
      MessagePlugin.success(`${field === 'enabled' ? '每日提醒' : '日报邮件'}已${value ? '开启' : '关闭'}`);
    } catch (error: any) {
      MessagePlugin.error(error?.message || '设置失败');
      await loadReminder();
    } finally { setLoadingReminder(false); }
  };

  return (
    <SettingSection id="notifications" title="通知与提醒" description="设置收件邮箱、提醒时间、天气地点和通知渠道。">
      {initialLoading && <p className="settings-help" role="status">加载通知设置中…</p>}
      {loadError && <div className="settings-status" role="alert">{loadError}<Button tag="button" variant="outline" onClick={loadReminder}>重试通知设置</Button></div>}
      <fieldset className="settings-fields" disabled={disabled}>
        <SettingRow label="提醒收件邮箱" htmlFor="settings-reminder-email" description="每日摘要、周期提醒和日报邮件共用；默认使用注册邮箱。">
          <SettingInput id="settings-reminder-email" value={reminderEmail} onChange={v => setReminderEmail(String(v))} placeholder="默认使用注册邮箱" disabled={disabled} />
          <div className="settings-actions"><Button tag="button" loading={loadingReminder} disabled={disabled} onClick={saveReminderEmail}>保存邮箱</Button></div>
        </SettingRow>
        <SettingRow label="开启每日提醒" description="每天发送日程摘要；切换后立即保存。">
          <Switch aria-label="开启每日提醒" aria-checked={reminderEnabled} value={reminderEnabled} disabled={disabled} onChange={v => void saveToggle('enabled', Boolean(v))} />
        </SettingRow>
        {reminderEnabled && <SettingRow label="提醒时间" description="北京时间（UTC+8）">
          <div className="settings-time-pair">
            <Select aria-label="提醒小时" value={reminderHour} disabled={disabled} onChange={v => setReminderHour(Number(v))} options={Array.from({ length: 24 }, (_, i) => ({ label: `${String(i).padStart(2, '0')} 时`, value: i }))} />
            <span>:</span>
            <Select aria-label="提醒分钟" value={reminderMinute} disabled={disabled} onChange={v => setReminderMinute(Number(v))} options={Array.from({ length: 12 }, (_, i) => ({ label: `${String(i * 5).padStart(2, '0')} 分`, value: i * 5 }))} />
          </div>
          <div className="settings-actions"><Button tag="button" loading={loadingReminder} disabled={disabled} onClick={saveReminderEmail}>保存提醒时间</Button></div>
        </SettingRow>}
        <SettingRow label="日报邮件" description="与每日摘要、提醒渠道和免打扰独立。开启后，新发布或更新的内容版本会入队，同一版本不会重复发送。切换后立即保存。">
          <Switch aria-label="日报邮件" aria-checked={reportEmailEnabled} value={reportEmailEnabled} disabled={disabled} onChange={v => void saveToggle('reportEmailEnabled', Boolean(v))} />
        </SettingRow>
        <SettingRow label="常驻城市或区县" htmlFor="settings-home-location" description="用于每日邮件天气和未指定地点的天气提问。只保存地点名称与坐标。">
          {homeLocation && <div className="settings-location-selected"><div><strong>{homeLocation.name}</strong><span>{[homeLocation.admin1, homeLocation.country].filter(Boolean).join(' · ')}</span></div><Button tag="button" variant="text" disabled={disabled} loading={locationSaving} onClick={() => void saveHomeLocation(null)}>清除</Button></div>}
          <div className="settings-location-search">
            <SettingInput id="settings-home-location" value={locationQuery} onChange={value => setLocationQuery(String(value))} name="home-location-search" type="search" autocomplete="new-password" disabled={disabled} placeholder="搜索城市或区县，例如：深圳、南山" />
            {(locationSearching || locationSaving) && <p className="settings-help" role="status">{locationSaving ? '保存中…' : '搜索中…'}</p>}
            {locationResults.length > 0 && <div className="settings-location-results" aria-label="地点搜索结果">{locationResults.map(location => <button type="button" key={`${location.latitude}:${location.longitude}`} disabled={disabled} onClick={() => void saveHomeLocation(location)}><strong>{location.name}</strong><span>{[location.admin1, location.country].filter(Boolean).join(' · ')}</span></button>)}</div>}
          </div>
        </SettingRow>
        <SettingRow label="通知渠道" description="修改渠道和免打扰后，点击“保存通知设置”。">
          <div className="settings-switches">
            <label><Switch aria-label="邮件通知" aria-checked={emailEnabled} value={emailEnabled} disabled={disabled} onChange={v => setEmailEnabled(Boolean(v))} /><span>邮件</span></label>
            <label><Switch aria-label="站内通知" aria-checked={inAppEnabled} value={inAppEnabled} disabled={disabled} onChange={v => setInAppEnabled(Boolean(v))} /><span>站内通知</span></label>
            <label><Switch aria-label="浏览器前台通知" aria-checked={browserEnabled} value={browserEnabled} disabled={disabled} onChange={async v => { const enabled = Boolean(v); if (enabled && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); setBrowserEnabled(enabled); }} /><span>浏览器前台通知</span></label>
          </div>
        </SettingRow>
        <SettingRow label="免打扰时段" description="期间的提醒会延迟到结束时间，不会被删除。">
          <Switch aria-label="免打扰时段" aria-checked={quietHoursEnabled} value={quietHoursEnabled} disabled={disabled} onChange={v => setQuietHoursEnabled(Boolean(v))} />
          {quietHoursEnabled && <div className="settings-time-pair"><input aria-label="免打扰开始时间" className="settings-time-input" type="time" value={quietStart} onChange={event => setQuietStart(event.target.value)} /><span>至</span><input aria-label="免打扰结束时间" className="settings-time-input" type="time" value={quietEnd} onChange={event => setQuietEnd(event.target.value)} /></div>}
          <div className="settings-actions"><Button tag="button" loading={loadingReminder} disabled={disabled} onClick={saveReminderEmail}>保存通知设置</Button></div>
        </SettingRow>
      </fieldset>
      <p className="settings-note">高优先级日程邮件是固定规则，不受邮件开关、免打扰和“开启每日提醒”影响。官方发件邮箱：aicalendarofficial@163.com</p>
    </SettingSection>
  );
}
