/**
 * 认证状态管理 Hook
 * 管理 JWT token、用户信息、登录状态
 */
import { useState, useEffect, useCallback } from 'react';

interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const TOKEN_KEY = 'aicalendar_token';

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: localStorage.getItem(TOKEN_KEY),
    isLoading: true,
    isAuthenticated: false,
  });

  // 检查登录状态
  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setState(s => ({ ...s, isLoading: false, isAuthenticated: false, user: null }));
      return;
    }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setState({ user: data.user, token, isLoading: false, isAuthenticated: true });
      } else {
        localStorage.removeItem(TOKEN_KEY);
        setState({ user: null, token: null, isLoading: false, isAuthenticated: false });
      }
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setState(s => ({ ...s, isLoading: false, isAuthenticated: false }));
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // 登录
  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '登录失败');
    localStorage.setItem(TOKEN_KEY, data.token);
    setState({ user: data.user, token: data.token, isLoading: false, isAuthenticated: true });
  };

  // 注册
  const register = async (email: string, password: string, code: string, invite_code: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, code, invite_code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '注册失败');
    localStorage.setItem(TOKEN_KEY, data.token);
    setState({ user: data.user, token: data.token, isLoading: false, isAuthenticated: true });
  };

  // 发送注册验证码
  const sendRegisterCode = async (email: string, password: string, invite_code: string) => {
    const res = await fetch('/api/auth/send-register-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, invite_code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '发送验证码失败');
  };

  // 登出
  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setState({ user: null, token: null, isLoading: false, isAuthenticated: false });
  };

  // 获取带 token 的 fetch 选项
  const authHeaders = useCallback((): Record<string, string> => ({
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
  }), [state.token]);

  return { ...state, login, register, sendRegisterCode, logout, checkAuth, authHeaders };
}
