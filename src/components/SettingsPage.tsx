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
          onClick={() => fetch('/api/models', { headers: getHeaders() }).then(r => r.json()).then(d => { if (d.models?.length > 0) setModels(d.models); }).catch(() => {})}
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
  apiKey?: string;
  error?: string;
}

export function SettingsPage() {
  const { user, authHeaders, logout, isAuthenticated } = useAuth();

  // ---------- 环境变量配置 ----------
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

  // 加载用户的 API Key
  const loadUserApiKey = useCallback(async () => {
    try {
      const res = await fetch('/api/user-api-key', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.hasKey) {
          setEnvConfig({ apiKey: data.apiKey, baseUrl: data.baseUrl || '' });
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
  }, []);

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
  const [loadingReminder, setLoadingReminder] = useState(false);

  const loadReminder = useCallback(async () => {
    try {
      const res = await fetch('/api/reminders', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setReminderEnabled(data.reminder?.enabled ?? false);
        setReminderHour(data.reminder?.hour ?? 8);
        setReminderMinute(data.reminder?.minute ?? 0);
        setReminderEmail(data.reminder?.reminderEmail || user?.email || '');
      }
    } catch {}
  }, [authHeaders]);

  const saveReminderEmail = async () => {
    setLoadingReminder(true);
    try {
      const response = await fetch('/api/reminders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ enabled: reminderEnabled, hour: reminderHour, minute: reminderMinute, reminderEmail: reminderEmail.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败');
      setReminderEmail(data.reminder?.reminderEmail || reminderEmail.trim());
      MessagePlugin.success('提醒邮箱已保存');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '保存失败');
    } finally {
      setLoadingReminder(false);
    }
  };
  useEffect(() => {
    if (isAuthenticated) loadReminder();
  }, [isAuthenticated]);

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

        {/* ---------- AI CodeBuddy 登录配置 ---------- */}
        <div>
          <h2 className="text-lg font-medium mb-3" style={{ color: 'var(--td-text-color-primary)' }}>
            AI CodeBuddy 登录
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
                  方式：
                  {loginStatus.hasApiKey ? (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>API Key</span>
                  ) : (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: '#E5E7EB', color: '#6B7280' }}>未配置</span>
                  )}
                </span>
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
                      placeholder="ck_xxxxxxxx.xxxxxxxxx"
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
                  API Key 将自动保存到您的账户
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
                    await fetch('/api/reminders', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json', ...authHeaders() },
                      body: JSON.stringify({ enabled: newVal, hour: reminderHour, minute: reminderMinute, reminderEmail: reminderEmail.trim() }),
                    });
                    MessagePlugin.success(newVal ? '提醒已开启' : '提醒已关闭');
                  } catch {
                    MessagePlugin.error('设置失败');
                    setReminderEnabled(!newVal);
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
                      await fetch('/api/reminders', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', ...authHeaders() },
                        body: JSON.stringify({ enabled: reminderEnabled, hour: reminderHour, minute: reminderMinute, reminderEmail: reminderEmail.trim() }),
                      });
                      MessagePlugin.success('提醒时间已更新');
                    } catch {
                      MessagePlugin.error('设置失败');
                    } finally {
                      setLoadingReminder(false);
                    }
                  }}
                >
                  保存
                </Button>
              </div>
            )}

            <div className="mt-2 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              每日提醒和周期提醒都会发送到这里；官方发件邮箱：aicalendarofficial@163.com
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
                点击右上角的 <span className="font-medium" style={{ color: '#6D28D9' }}>👥 管理面板</span> 按钮访问。
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
