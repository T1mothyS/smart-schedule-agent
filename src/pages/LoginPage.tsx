/**
 * 登录/注册页面
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button, Input, MessagePlugin } from 'tdesign-react';
import { useAuth } from '../hooks/useAuth';

type Mode = 'login' | 'register';

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const { login, register, sendRegisterCode, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // 监听 isAuthenticated 变化，App 路由会同步切换，无需手动 navigate
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/today', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // 倒计时
  useEffect(() => {
    if (codeCountdown > 0) {
      const t = setTimeout(() => setCodeCountdown(codeCountdown - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [codeCountdown]);

  const handleSendCode = async () => {
    if (!email || !password || !inviteCode) {
      MessagePlugin.warning('请先填写邮箱、密码和邀请码');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      MessagePlugin.warning('请输入有效的邮箱地址');
      return;
    }
    if (password.length < 6) {
      MessagePlugin.warning('密码至少6位');
      return;
    }
    setSending(true);
    try {
      await sendRegisterCode(email, password, inviteCode);
      MessagePlugin.success('验证码已发送到您的邮箱');
      setCodeSent(true);
      setCodeCountdown(60);
    } catch (e: any) {
      MessagePlugin.error(e.message);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'login') {
      if (!email || !password) {
        MessagePlugin.warning('请填写邮箱和密码');
        return;
      }
      setLoading(true);
      try {
        await login(email, password);
        MessagePlugin.success('登录成功！');
        // 强制刷新确保所有全局状态重置
        window.location.href = '/today';
      } catch (e: any) {
        MessagePlugin.error(e.message);
      } finally {
        setLoading(false);
      }
    } else {
      if (!email || !password || !code || !inviteCode) {
        MessagePlugin.warning('请填写完整信息');
        return;
      }
      if (password !== confirmPassword) {
        MessagePlugin.warning('两次密码不一致');
        return;
      }
      if (password.length < 6) {
        MessagePlugin.warning('密码至少6位');
        return;
      }
      setLoading(true);
      try {
        await register(email, password, code, inviteCode);
        MessagePlugin.success('注册成功！');
      } catch (e: any) {
        MessagePlugin.error(e.message);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <div className="w-full max-w-md mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">📅</div>
          <h1 className="text-3xl font-bold text-white mb-1">AI Calendar</h1>
          <p className="text-white/70 text-sm">智能日程管理，让每一天更高效</p>
        </div>

        {/* 表单卡片 */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Tab 切换 */}
          <div className="flex mb-6 bg-gray-100 rounded-lg p-1">
            <button
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${mode === 'login' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => setMode('login')}
            >
              登录
            </button>
            <button
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${mode === 'register' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => setMode('register')}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>邮箱</label>
              <Input
                value={email}
                onChange={(v) => setEmail(v as string)}
                placeholder="请输入邮箱地址"
                size="large"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>密码</label>
              <Input
                value={password}
                onChange={(v) => setPassword(v as string)}
                placeholder={mode === 'register' ? '至少6位' : '请输入密码'}
                size="large"
                type="password"
              />
            </div>

            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>确认密码</label>
                  <Input
                    value={confirmPassword}
                    onChange={(v) => setConfirmPassword(v as string)}
                    placeholder="再次输入密码"
                    size="large"
                    type="password"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>邀请码</label>
                  <Input
                    value={inviteCode}
                    onChange={(v) => setInviteCode(v as string)}
                    placeholder="请输入邀请码"
                    size="large"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>邮箱验证码</label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Input
                        value={code}
                        onChange={(v) => setCode(v as string)}
                        placeholder="输入6位验证码"
                        size="large"
                        maxlength={6}
                      />
                    </div>
                    <Button
                      onClick={handleSendCode}
                      loading={sending}
                      disabled={codeCountdown > 0}
                      variant="outline"
                      style={{ flexShrink: 0 }}
                    >
                      {codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码'}
                    </Button>
                  </div>
                  {!codeSent && (
                    <div className="mt-1 text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                      点击「获取验证码」前请先填好邮箱、密码和邀请码
                    </div>
                  )}
                </div>
              </>
            )}

            <Button
              type="submit"
              variant="base"
              block
              size="large"
              loading={loading}
              style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)', color: '#fff', border: 'none', marginTop: '8px' }}
            >
              {mode === 'login' ? '登 录' : '完 成 注 册'}
            </Button>
          </form>

          {mode === 'login' && (
            <div className="mt-4 text-center">
              <p className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                还没有账号？<button className="text-blue-500 hover:underline" onClick={() => setMode('register')}>立即注册</button>
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-white/50 text-xs mt-6">
          AI Calendar © 2026
        </p>
      </div>
    </div>
  );
}
