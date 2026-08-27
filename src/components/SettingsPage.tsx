import { useState, useEffect, useCallback } from 'react';
import {
  Input,
  Button,
  MessagePlugin,
  Select,
  Switch
} from 'tdesign-react';
import { CheckCircleFilledIcon } from 'tdesign-icons-react';
import { useAuth } from '../hooks/useAuth';
import {
  loadNotificationPreferences,
  saveAndReloadNotificationPreferences,
} from '../services/notification-preferences';

interface HomeLocation {
  name: string;
  admin1: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
}

interface DailyReportTokenStatus {
  exists: boolean;
  active: boolean;
  prefix: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// ==================== 工具函数 ====================

// 获取认证 headers
function getHeaders() {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem('aicalendar_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ==================== AI 模型配置 ====================

function ScheduleModelConfig() {
  const [models, setModels] = useState<{ modelId: string; name: string }[]>([]);
  const [selectedModel, setSelectedModelState] = useState('glm-5.1');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const headers = getHeaders();
    fetch('/api/schedule-model', { headers })
      .then(r => r.json())
      .then(d => { if (d.model) setSelectedModelState(d.model); })
      .catch(() => {});
    fetch('/api/models', { headers })
      .then(r => r.json())
      .then(d => { if (d.models?.length > 0) setModels(d.models); })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/schedule-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify({ model: selectedModel }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {}
    setLoading(false);
  };

  const modelOptions = models.length > 0 ? models : [
    { modelId: 'glm-5.1', name: 'GLM 5.1（推荐）' },
    { modelId: 'glm-4', name: 'GLM 4' },
    { modelId: 'deepseek-v3', name: 'DeepSeek V3' },
    { modelId: 'kimi-k2', name: 'Kimi K2' },
    { modelId: 'qwen2.5', name: 'Qwen 2.5' },
  ];

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
          日程 AI 模型
        </h2>
        <p className="text-sm mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
          选择 AI 日程助手使用的模型，影响日程解析和对话能力
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Select
          value={selectedModel}
          onChange={v => setSelectedModelState(v as string)}
          style={{ width: 280 }}
          placeholder="选择模型"
        >
          {modelOptions.map(m => (
            <Select.Option key={m.modelId} value={m.modelId} label={m.name || m.modelId} />
          ))}
        </Select>
        <Button theme="primary" size="small" loading={loading} onClick={handleSave}>
          {saved ? '✓ 已保存' : '保存'}
        </Button>
        <Button
          variant="outline"
          size="small"
          onClick={() => fetch('/api/models?refresh=1', { headers: getHeaders() }).then(r => r.json()).then(d => { if (d.models?.length > 0) setModels(d.models); }).catch(() => {})}
        >
          刷新模型列表
        </Button>
      </div>
    </div>
  );
}

// ==================== 主设置页面 ====================

interface LoginStatus {
  isLoggedIn: boolean;
  checking: boolean;
  hasApiKey?: boolean;
  usingSharedApi?: boolean;
  apiKey?: string;
  error?: string;
}

interface SettingsPageProps {
  onOpenAdmin?: () => void;
}

export function SettingsPage({ onOpenAdmin }: SettingsPageProps) {
  const { user, authHeaders, logout, isAuthenticated } = useAuth();

  // ---------- 当前账号的 AI 凭据 ----------
  const [showEnvConfig, setShowEnvConfig] = useState(false);
  const [envConfig, setEnvConfig] = useState({
    apiKey: '',
    baseUrl: '',
  });
  const [savingEnv, setSavingEnv] = useState(false);
  const [loginStatus, setLoginStatus] = useState<LoginStatus>({
    isLoggedIn: false,
    checking: true,
  });

  // 加载当前账号的 API Key
  const loadUserApiKey = useCallback(async () => {
    try {
      const res = await fetch('/api/user-api-key', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.hasKey) {
          setEnvConfig({ apiKey: '', baseUrl: data.baseUrl || '' });
        }
      }
    } catch {}
  }, [authHeaders]);

  const checkLoginStatus = useCallback(async () => {
    setLoginStatus(prev => ({ ...prev, checking: true }));
    try {
      // 添加超时机制：5秒内未响应则显示超时
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const res = await fetch('/api/check-login', { 
        headers: authHeaders(),
        signal: controller.signal 
      });
      clearTimeout(timeoutId);
      
      if (res.ok) {
        const data = await res.json();
        setLoginStatus({
          isLoggedIn: data.isLoggedIn ?? false,
          checking: false,
          hasApiKey: data.hasApiKey,
          usingSharedApi: data.usingSharedApi,
          apiKey: data.apiKey,
          error: data.error,
        });
      } else {
        setLoginStatus({ isLoggedIn: false, checking: false });
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setLoginStatus({ isLoggedIn: false, checking: false, error: '检查超时，请重试' });
      } else {
        setLoginStatus({ isLoggedIn: false, checking: false, error: '无法连接服务器' });
      }
    }
  }, [authHeaders]);

  // 验证 API Key 可用性
  const [verifying, setVerifying] = useState(false);
  const verifyApiKey = useCallback(async () => {
    setVerifying(true);
    try {
      const res = await fetch('/api/verify-api-key', { 
        method: 'POST',
        headers: authHeaders(),
        signal: AbortSignal.timeout(15000)
      });
      const data = await res.json();
      
      if (data.valid) {
        if (data.quotaExhausted) {
          // Key 有效但额度用完
          MessagePlugin.warning('API Key 有效，但额度已用完。请前往 CodeBuddy 控制台购买额度。', 6000);
        } else {
          MessagePlugin.success('API Key 验证成功！可用模型：' + data.modelCount + ' 个');
        }
      } else {
        MessagePlugin.error(data.error || 'API Key 验证失败');
      }
    } catch (e: any) {
      if (e.name === 'TimeoutError') {
        MessagePlugin.error('验证超时，请检查网络连接后重试');
      } else {
        MessagePlugin.error('验证失败：' + (e.message || '未知错误'));
      }
    } finally {
      setVerifying(false);
    }
  }, [authHeaders]);

  const saveEnvConfig = async () => {
    if (!envConfig.apiKey.trim()) {
      MessagePlugin.warning('请输入 API Key');
      return;
    }
    setSavingEnv(true);
    try {
      const response = await fetch('/api/user-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          apiKey: envConfig.apiKey.trim(),
          baseUrl: envConfig.baseUrl.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (data.success) {
        MessagePlugin.success('API Key 保存成功！');
        setShowEnvConfig(false);
        setTimeout(() => checkLoginStatus(), 500);
      } else {
        MessagePlugin.error(data.error || '保存失败');
      }
    } catch (error: any) {
      MessagePlugin.error(error?.message || '保存失败');
    } finally {
      setSavingEnv(false);
    }
  };

  // ---------- 提醒设置 ----------
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHour, setReminderHour] = useState(8);
  const [reminderMinute, setReminderMinute] = useState(0);
  const [reminderEmail, setReminderEmail] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(true);
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
  const [backupPassword, setBackupPassword] = useState('');
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupPreview, setBackupPreview] = useState<any>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState<'json' | 'csv' | null>(null);
  const [dailyReportStatus, setDailyReportStatus] = useState<DailyReportTokenStatus | null>(null);
  const [dailyReportToken, setDailyReportToken] = useState('');
  const [dailyReportBusy, setDailyReportBusy] = useState(false);

  const applyNotificationPreference = (preference: any) => {
    setReminderEnabled(preference.enabled ?? false);
    setReminderHour(preference.hour ?? 8);
    setReminderMinute(preference.minute ?? 0);
    setReminderEmail(preference.reminderEmail || user?.email || '');
    setEmailEnabled(preference.emailEnabled !== false);
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
    const booleanFields = ['enabled', 'emailEnabled', 'inAppEnabled', 'browserEnabled', 'quietHoursEnabled'] as const;
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
    try {
      const data = await loadNotificationPreferences(authHeaders());
      applyNotificationPreference(data.preference || {});
    } catch {}
  }, [authHeaders]);

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

  const encodedBackupPassword = () => {
    const bytes = new TextEncoder().encode(backupPassword);
    let binary = '';
    bytes.forEach(value => { binary += String.fromCharCode(value); });
    return btoa(binary);
  };

  const exportBackup = async () => {
    if (backupPassword.length < 8) return MessagePlugin.warning('备份密码至少需要 8 个字符');
    setBackupBusy(true);
    try {
      const response = await fetch('/api/backups/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ password: backupPassword }),
      });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || '导出失败'); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'ai-calendar-' + new Date().toISOString().slice(0, 10) + '.aicalendar-backup';
      anchor.click();
      URL.revokeObjectURL(url);
      MessagePlugin.success('加密备份已生成');
    } catch (error: any) { MessagePlugin.error(error?.message || '导出失败'); }
    finally { setBackupBusy(false); }
  };

  const inspectBackup = async (file: File) => {
    if (backupPassword.length < 8) return MessagePlugin.warning('请先输入该备份的密码');
    setBackupBusy(true);
    setBackupFile(file);
    try {
      const response = await fetch('/api/backups/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Backup-Password': encodedBackupPassword(), ...authHeaders() },
        body: await file.arrayBuffer(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '检查备份失败');
      setBackupPreview(data.backup);
    } catch (error: any) { setBackupPreview(null); MessagePlugin.error(error?.message || '检查备份失败'); }
    finally { setBackupBusy(false); }
  };

  const restoreBackup = async (mode: 'merge' | 'replace') => {
    if (!backupFile || !backupPreview) return;
    if (mode === 'replace' && !window.confirm('替换模式会先备份当前数据，然后替换当前账号的日历、周期事务和历史。是否继续？')) return;
    setBackupBusy(true);
    try {
      const response = await fetch('/api/backups/restore?mode=' + mode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Backup-Password': encodedBackupPassword(), ...authHeaders() },
        body: await backupFile.arrayBuffer(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '恢复失败');
      MessagePlugin.success('数据恢复完成，刷新页面后生效');
      setBackupFile(null); setBackupPreview(null);
    } catch (error: any) { MessagePlugin.error(error?.message || '恢复失败'); }
    finally { setBackupBusy(false); }
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

  const downloadReadableExport = async (format: 'json' | 'csv') => {
    setExportBusy(format);
    try {
      const response = await fetch(format === 'json' ? '/api/exports/user-data.json' : '/api/exports/schedules.csv', {
        headers: authHeaders(),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '导出失败');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = format === 'json'
        ? `ai-calendar-data-${new Date().toISOString().slice(0, 10)}.json`
        : `ai-calendar-schedules-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      MessagePlugin.success(format === 'json' ? 'JSON 数据已导出' : 'CSV 日程表已导出');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '导出失败');
    } finally {
      setExportBusy(null);
    }
  };

  const loadDailyReportStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/integrations/daily-report-token', { headers: authHeaders() });
      if (!response.ok) return;
      const result = await response.json();
      setDailyReportStatus(result.status);
    } catch { /* 集成状态加载失败不影响其他设置 */ }
  }, [authHeaders]);

  const generateReportToken = async () => {
    if (dailyReportStatus?.active && !window.confirm('生成新令牌会立即使旧令牌失效。是否继续？')) return;
    setDailyReportBusy(true);
    try {
      const response = await fetch('/api/integrations/daily-report-token', { method: 'POST', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '生成令牌失败');
      setDailyReportToken(result.token);
      setDailyReportStatus(result.status);
      MessagePlugin.success('只读令牌已生成，请立即复制保存');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '生成令牌失败');
    } finally {
      setDailyReportBusy(false);
    }
  };

  const revokeReportToken = async () => {
    if (!window.confirm('撤销后，日报项目将无法读取日程。是否继续？')) return;
    setDailyReportBusy(true);
    try {
      const response = await fetch('/api/integrations/daily-report-token', { method: 'DELETE', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '撤销令牌失败');
      setDailyReportToken('');
      setDailyReportStatus(result.status);
      MessagePlugin.success('日报令牌已撤销');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '撤销令牌失败');
    } finally {
      setDailyReportBusy(false);
    }
  };
  useEffect(() => {
    if (isAuthenticated) {
      loadReminder();
      loadDailyReportStatus();
    }
  }, [isAuthenticated, loadReminder, loadDailyReportStatus]);

  // ---------- 初始化 ----------
  useEffect(() => {
    checkLoginStatus();
    loadUserApiKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 空依赖数组，只在挂载时执行一次

  // ==================== JSX ====================
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-8">

        {/* ---------- 页面标题 ---------- */}
        <div>
          <h1
            className="text-2xl font-semibold mb-2"
            style={{ color: 'var(--td-text-color-primary)' }}
          >
            设置
          </h1>
          <p style={{ color: 'var(--td-text-color-secondary)' }}>
            管理登录配置和 AI 日程助手
          </p>
        </div>

        {/* ---------- 当前账号 ---------- */}
        <div>
          <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--td-text-color-primary)' }}>
            当前账号
          </h2>
          {user ? (
            <div className="mb-4 px-4 py-3 rounded-lg" style={{ backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0' }}>
              <div className="flex items-center gap-2">
                <CheckCircleFilledIcon size="20px" style={{ color: '#10B981' }} />
                <span className="font-medium" style={{ color: '#065F46' }}>{user.email}</span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{
                    backgroundColor: user.role === 'admin' ? '#EDE9FE' : '#DBEAFE',
                    color: user.role === 'admin' ? '#6D28D9' : '#1D4ED8',
                  }}
                >
                  {user.role === 'admin' ? '管理员' : '普通用户'}
                </span>
              </div>
              <div className="mt-2 text-xs" style={{ color: '#065F46', opacity: 0.7 }}>
                ID: {user.id}
              </div>
            </div>
          ) : (
            <div className="mb-4 px-4 py-3 rounded-lg" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
              <span className="font-medium" style={{ color: '#991B1B' }}>未登录</span>
            </div>
          )}
          <Button variant="outline" onClick={async () => {
            try {
              await fetch('/api/auth/logout', { method: 'POST' });
            } catch {}
            logout();
            window.location.href = '/login';
          }} size="small">退出登录</Button>
        </div>

        {/* ---------- 当前账号的 AI 凭据 ---------- */}
        <div>
          <h2 className="text-lg font-medium mb-3" style={{ color: 'var(--td-text-color-primary)' }}>
            AI 个人 API Key
          </h2>

          {/* 登录状态指示器 */}
          <div className="flex items-center gap-3 mb-4 p-3 rounded-lg flex-wrap" style={{ backgroundColor: loginStatus.isLoggedIn ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${loginStatus.isLoggedIn ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
            {loginStatus.checking ? (
              <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>检查登录状态中...</div>
            ) : loginStatus.isLoggedIn ? (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm font-medium text-green-600">已登录</span>
                </div>
                  <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
                  当前账号凭据：
                  {loginStatus.usingSharedApi ? (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: '#D1FAE5', color: '#047857' }}>管理员共享 API</span>
                  ) : loginStatus.hasApiKey ? (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>API Key</span>
                  ) : (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: '#E5E7EB', color: '#6B7280' }}>未配置</span>
                  )}
                </span>
                {loginStatus.usingSharedApi && (
                  <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>密钥仅在服务器端使用</span>
                )}
                {loginStatus.apiKey && (
                  <span className="text-xs ml-2" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    ({loginStatus.apiKey})
                  </span>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-sm font-medium text-red-500">未登录</span>
                </div>
                {loginStatus.error && (
                  <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>{loginStatus.error}</span>
                )}
              </>
            )}
            {/* 验证按钮 */}
            <Button
              size="small"
              variant="outline"
              loading={verifying}
              onClick={verifyApiKey}
              className="ml-auto"
            >
              验证 Key
            </Button>
          </div>

          {/* API Key 配置 */}
          <div>
            {showEnvConfig ? (
              <div className="space-y-4">
                {/* 获取 API Key 步骤 */}
                <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--td-component-border)' }}>
                  <div className="p-3" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
                    <p className="text-xs font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                      如何获取 API Key
                    </p>
                  </div>
                  <div className="p-4 space-y-3">
                    {/* 获取 API Key */}
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold">
                        1
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-medium mb-1" style={{ color: 'var(--td-text-color-primary)' }}>
                          获取 API Key
                        </p>
                        <ol className="text-[11px] space-y-0.5" style={{ color: 'var(--td-text-color-secondary)' }}>
                          <li>访问「<a href="https://www.codebuddy.cn/profile/keys" target="_blank" rel="noopener noreferrer" style={{ color: '#3B82F6' }}>API Key 管理页面</a>」</li>
                          <li>点击「创建」或「复制」已有 API Key</li>
                        </ol>
                        <p className="text-[10px] mt-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                          格式类似：<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">ck_fih6xg83en7k.xxxxxx</code>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 配置表单 */}
                <div className="space-y-3">
                  <div>
                    <label className="text-xs block mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                      API Key <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <Input
                      type="password"
                      size="small"
                      value={envConfig.apiKey}
                      onChange={v => setEnvConfig(prev => ({ ...prev, apiKey: v as string }))}
                      placeholder={loginStatus.hasApiKey ? '输入新的 API Key 以覆盖当前配置' : 'ck_xxxxxxxx.xxxxxxxxx'}
                      style={{ fontFamily: 'monospace' }}
                    />
                  </div>
                  <div>
                    <label className="text-xs block mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                      Base URL <span className="text-[10px] opacity-60 ml-1">(可选)</span>
                    </label>
                    <Input
                      size="small"
                      value={envConfig.baseUrl}
                      onChange={v => setEnvConfig(prev => ({ ...prev, baseUrl: v as string }))}
                      placeholder="https://api.codebuddy.cn"
                    />
                  </div>
                </div>

                {/* 按钮 */}
                <div className="flex items-center gap-2">
                  <Button size="small" theme="primary" onClick={saveEnvConfig} loading={savingEnv}>
                    保存
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => {
                      setShowEnvConfig(false);
                      setEnvConfig({ apiKey: '', baseUrl: '' });
                    }}
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button variant="outline" size="small" onClick={() => { loadUserApiKey(); setShowEnvConfig(true); }}>
                  {loginStatus.isLoggedIn ? '修改 API Key' : '配置 API Key'}
                </Button>
                <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                  仅保存到当前账号，服务器不使用全局默认 Key
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ---------- 分隔线 ---------- */}
        <div style={{ height: '1px', backgroundColor: 'var(--td-component-border)' }} />

        {/* ---------- 日程 AI 模型配置 ---------- */}
        <ScheduleModelConfig />

        {/* ---------- 每日邮件提醒 ---------- */}
        <div>
          <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--td-text-color-primary)' }}>
            每日邮件提醒
          </h2>
          <div
            className="mb-4 px-4 py-3 rounded-lg"
            style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-stroke)' }}
          >
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <span className="text-sm" style={{ color: 'var(--td-text-color-primary)' }}>提醒收件邮箱</span>
              <Input
                value={reminderEmail}
                onChange={v => setReminderEmail(v as string)}
                placeholder="默认使用注册邮箱"
                style={{ width: 280 }}
              />
              <Button size="small" loading={loadingReminder} onClick={saveReminderEmail}>保存邮箱</Button>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <span style={{ color: 'var(--td-text-color-primary)' }}>开启每日提醒</span>
              <Switch
                value={reminderEnabled}
                onChange={async (v) => {
                  const newVal = v as boolean;
                  setReminderEnabled(newVal);
                  setLoadingReminder(true);
                  try {
                    await saveAndConfirmNotificationPreferences(notificationPayload({ enabled: newVal }));
                    MessagePlugin.success(newVal ? '提醒已开启' : '提醒已关闭');
                  } catch (error: any) {
                    MessagePlugin.error(error?.message || '设置失败');
                    await loadReminder();
                  } finally {
                    setLoadingReminder(false);
                  }
                }}
              />
            </div>

            {reminderEnabled && (
              <div className="flex items-center gap-3">
                <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>提醒时间：</span>
                <Select
                  value={reminderHour}
                  onChange={v => setReminderHour(v as number)}
                  size="small"
                  style={{ width: 80 }}
                  options={Array.from({ length: 24 }, (_, i) => ({ label: `${String(i).padStart(2, '0')} 时`, value: i }))}
                />
                <span>:</span>
                <Select
                  value={reminderMinute}
                  onChange={v => setReminderMinute(v as number)}
                  size="small"
                  style={{ width: 80 }}
                  options={Array.from({ length: 12 }, (_, i) => ({ label: `${String(i * 5).padStart(2, '0')} 分`, value: i * 5 }))}
                />
                <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>北京时间（UTC+8）</span>
                <Button
                  size="small"
                  loading={loadingReminder}
                  onClick={async () => {
                    setLoadingReminder(true);
                    try {
                      await saveAndConfirmNotificationPreferences(notificationPayload());
                      MessagePlugin.success('提醒时间已更新');
                    } catch (error: any) {
                      MessagePlugin.error(error?.message || '设置失败');
                      await loadReminder();
                    } finally {
                      setLoadingReminder(false);
                    }
                  }}
                >
                  保存
                </Button>
              </div>
            )}

            <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--td-component-stroke)' }}>
              <div className="text-sm font-medium mb-2" style={{ color: 'var(--td-text-color-primary)' }}>常驻城市或区县</div>
              <div className="text-xs mb-3" style={{ color: 'var(--td-text-color-placeholder)' }}>
                用于每日邮件天气和未指定地点的天气提问；请单独输入城市或区县名称，只保存名称与坐标，不保存详细住址。
              </div>
              {homeLocation && <div className="settings-location-selected">
                <div>
                  <strong>{homeLocation.name}</strong>
                  <span>{[homeLocation.admin1, homeLocation.country].filter(Boolean).join(' · ')}</span>
                </div>
                <Button size="small" variant="text" loading={locationSaving} onClick={() => void saveHomeLocation(null)}>清除</Button>
              </div>}
              <div className="settings-location-search">
                <Input
                  value={locationQuery}
                  onChange={value => setLocationQuery(value as string)}
                  name="home-location-search"
                  type="search"
                  autocomplete="new-password"
                  disabled={locationSaving}
                  placeholder="搜索城市或区县，例如：深圳、南山"
                />
                {locationSearching && <span className="settings-location-loading">搜索中…</span>}
                {locationSaving && <span className="settings-location-loading">保存中…</span>}
                {locationResults.length > 0 && <div className="settings-location-results">
                  {locationResults.map(location => <button
                    type="button"
                    key={`${location.latitude}:${location.longitude}`}
                    disabled={locationSaving}
                    onClick={() => void saveHomeLocation(location)}
                  >
                    <strong>{location.name}</strong>
                    <span>{[location.admin1, location.country].filter(Boolean).join(' · ')}</span>
                  </button>)}
                </div>}
              </div>
            </div>

            <div className="mt-5 pt-4 space-y-3" style={{ borderTop: '1px solid var(--td-component-stroke)' }}>
              <div className="flex items-center gap-5 flex-wrap">
                <label className="flex items-center gap-2 text-sm"><Switch value={emailEnabled} onChange={v => setEmailEnabled(v as boolean)} /> 邮件</label>
                <label className="flex items-center gap-2 text-sm"><Switch value={inAppEnabled} onChange={v => setInAppEnabled(v as boolean)} /> 站内通知</label>
                <label className="flex items-center gap-2 text-sm"><Switch value={browserEnabled} onChange={async v => { const enabled = v as boolean; if (enabled && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); setBrowserEnabled(enabled); }} /> 浏览器前台通知</label>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-sm"><Switch value={quietHoursEnabled} onChange={v => setQuietHoursEnabled(v as boolean)} /> 免打扰时段</label>
                {quietHoursEnabled && <><input className="settings-time-input" type="time" value={quietStart} onChange={event => setQuietStart(event.target.value)} /><span>至</span><input className="settings-time-input" type="time" value={quietEnd} onChange={event => setQuietEnd(event.target.value)} /></>}
                <Button size="small" loading={loadingReminder} onClick={saveReminderEmail}>保存通知设置</Button>
              </div>
              <div className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>免打扰期间的提醒会延迟到结束时间，不会被删除。</div>
            </div>

            <div className="mt-2 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              每日摘要和周期提醒都会发送到这里；高优先级日程邮件是固定规则，不受邮件开关、免打扰和“开启每日提醒”影响；浏览器前台提醒仍可单独选择。官方发件邮箱：aicalendarofficial@163.com
            </div>
          </div>
        </div>

        <div style={{ height: '1px', backgroundColor: 'var(--td-component-border)' }} />

        <div>
          <h2 className="text-lg font-medium mb-2" style={{ color: 'var(--td-text-color-primary)' }}>数据备份与恢复</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--td-text-color-secondary)' }}>备份包含当前账号的日历、周期事务、完成历史和附件，不包含密码、角色或 API Key。</p>
          <div className="space-y-4 px-4 py-4 rounded-lg" style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-stroke)' }}>
            <div>
              <div className="text-sm font-medium mb-2" style={{ color: 'var(--td-text-color-primary)' }}>可读数据导出</div>
              <div className="text-xs mb-3" style={{ color: 'var(--td-text-color-placeholder)' }}>
                JSON 包含日程、周期事务、完成记录、附件元数据和非敏感偏好；CSV 是可直接用 Excel 打开的日程表。附件文件请使用下方加密备份。
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" loading={exportBusy === 'json'} onClick={() => downloadReadableExport('json')}>下载 JSON</Button>
                <Button variant="outline" loading={exportBusy === 'csv'} onClick={() => downloadReadableExport('csv')}>下载 CSV</Button>
              </div>
            </div>
            <div style={{ height: '1px', backgroundColor: 'var(--td-component-border)' }} />
            <div className="flex items-center gap-3 flex-wrap">
              <Input type="password" value={backupPassword} onChange={value => { setBackupPassword(value as string); setBackupPreview(null); }} placeholder="设置或输入备份密码（至少 8 位）" style={{ width: 300 }} />
              <Button loading={backupBusy} onClick={exportBackup}>导出加密备份</Button>
              <label className="tdesign-upload-button">
                <span>选择备份文件</span>
                <input type="file" accept=".aicalendar-backup,application/octet-stream" onChange={event => { const file = event.target.files?.[0]; if (file) inspectBackup(file); }} />
              </label>
            </div>
            <div className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>请妥善保存备份密码；密码遗失后无法解密，服务器也不会保存该密码。</div>
            {backupPreview && <div className="backup-preview">
              <div><strong>备份时间</strong><span>{new Date(backupPreview.exportedAt).toLocaleString('zh-CN')}</span></div>
              <div><strong>来源账号</strong><span>{backupPreview.sourceEmail || '未知'}</span></div>
              <div><strong>内容</strong><span>日程 {backupPreview.counts.schedules} · 周期事务 {backupPreview.counts.reminderTasks} · 完成记录 {backupPreview.counts.completions} · 附件 {backupPreview.counts.attachments}</span></div>
              <div className="flex gap-2 mt-2"><Button variant="outline" loading={backupBusy} onClick={() => restoreBackup('merge')}>合并恢复</Button><Button theme="danger" variant="outline" loading={backupBusy} onClick={() => restoreBackup('replace')}>替换当前数据</Button></div>
            </div>}
          </div>
        </div>

        <div style={{ height: '1px', backgroundColor: 'var(--td-component-border)' }} />

        <div>
          <h2 className="text-lg font-medium mb-2" style={{ color: 'var(--td-text-color-primary)' }}>日报令牌</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--td-text-color-secondary)' }}>
            专用令牌只能读取当前账号指定日期的日程，不能修改数据，也不会返回附件、密码或 API Key。
          </p>
          <div className="space-y-3 px-4 py-4 rounded-lg" style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-stroke)' }}>
            <div className="settings-token-status">
              <strong>{dailyReportStatus?.active ? '已启用' : dailyReportStatus?.exists ? '已撤销' : '尚未生成'}</strong>
              {dailyReportStatus?.prefix && <span>令牌前缀：{dailyReportStatus.prefix}…</span>}
              {dailyReportStatus?.lastUsedAt && <span>最近读取：{new Date(dailyReportStatus.lastUsedAt).toLocaleString('zh-CN')}</span>}
            </div>
            {dailyReportToken && <div className="settings-token-once">
              <div><strong>只显示一次</strong><span>离开设置页后无法再次查看明文。</span></div>
              <code>{dailyReportToken}</code>
              <Button size="small" onClick={async () => {
                try {
                  await navigator.clipboard.writeText(dailyReportToken);
                  MessagePlugin.success('令牌已复制');
                } catch {
                  MessagePlugin.error('自动复制失败，请手动选择令牌');
                }
              }}>复制令牌</Button>
            </div>}
            <div className="flex items-center gap-2 flex-wrap">
              <Button loading={dailyReportBusy} onClick={generateReportToken}>{dailyReportStatus?.active ? '轮换令牌' : '生成令牌'}</Button>
              {dailyReportStatus?.active && <Button theme="danger" variant="outline" loading={dailyReportBusy} onClick={revokeReportToken}>撤销令牌</Button>}
            </div>
          </div>
        </div>

        {/* ---------- 管理员提示（仅管理员） ---------- */}
        {user?.role === 'admin' && (
          <div>
            <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--td-text-color-primary)' }}>
              管理员功能
            </h2>
            <div className="px-4 py-3 rounded-lg" style={{ backgroundColor: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
              <p className="text-sm" style={{ color: 'var(--td-text-color-primary)' }}>
                您是管理员，可以访问用户管理和调试日志功能。
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
                点击 <button type="button" className="settings-admin-link" onClick={onOpenAdmin}>👥 管理面板</button> 访问。
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
