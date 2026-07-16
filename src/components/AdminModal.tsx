import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  PaginationProps,
  Input,
  Button,
  Loading,
  MessagePlugin,
  Select,
} from 'tdesign-react';
import {
  RefreshIcon,
  DeleteIcon,
} from 'tdesign-icons-react';
import { useAuth } from '../hooks/useAuth';

interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  disabled: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

interface LogEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  data?: any;
}

// ==================== 用户管理表格 ====================
function UserManagementTab({ onClose }: { onClose?: () => void }) {
  const { authHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // 使用 ref 存储 authHeaders 避免无限循环
  const authHeadersRef = React.useRef(authHeaders);
  authHeadersRef.current = authHeaders;

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(searchText)}`, {
        headers: authHeadersRef.current(),
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setTotal(data.total || 0);
      }
    } catch {
      MessagePlugin.error('加载用户列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchText]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleRoleChange = async (userId: string, newRole: 'admin' | 'user') => {
    setLoadingAction(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        MessagePlugin.success('角色已更新');
        loadUsers();
      } else {
        const d = await res.json();
        MessagePlugin.error(d.error || '设置失败');
      }
    } catch {
      MessagePlugin.error('设置失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleToggleDisabled = async (userId: string, disabled: boolean) => {
    setLoadingAction(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/disabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        body: JSON.stringify({ disabled }),
      });
      if (res.ok) {
        MessagePlugin.success(disabled ? '已禁用' : '已启用');
        loadUsers();
      }
    } catch {
      MessagePlugin.error('操作失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleClearData = async (user: User) => {
    if (!window.confirm(`确定要清空用户 ${user.email} 的所有数据吗？\n包括：日程、待办、AI对话历史、API Key 等。\n该用户的账号和密码将保留。`)) return;

    try {
      console.log('[Admin] Clearing data for user:', user.id);
      const res = await fetch(`/api/admin/users/${user.id}/clear-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
      });
      console.log('[Admin] Clear data response:', res.status, await res.clone().text());
      
      if (res.ok) {
        MessagePlugin.success(`已清空 ${user.email} 的数据`);
        loadUsers();
      } else {
        const d = await res.json();
        MessagePlugin.error(d.error || '操作失败');
      }
    } catch (e) {
      console.error('[Admin] Clear data error:', e);
      MessagePlugin.error('清空失败，请查看控制台');
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (!window.confirm(`⚠️ 危险操作！\n\n确定要删除用户 ${user.email} 吗？\n\n此操作将：\n- 删除该用户的所有日程和待办\n- 删除 AI 对话历史\n- 删除 API Key\n- 删除用户账号\n\n此操作不可恢复！`)) return;

    try {
      console.log('[Admin] Deleting user:', user.id);
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
      });
      console.log('[Admin] Delete response:', res.status, await res.clone().text());
      
      if (res.ok) {
        MessagePlugin.success(`已删除用户 ${user.email}`);
        loadUsers();
      } else {
        const d = await res.json();
        MessagePlugin.error(d.error || '删除失败');
      }
    } catch (e) {
      console.error('[Admin] Delete user error:', e);
      MessagePlugin.error('删除失败，请查看控制台');
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const columns: any[] = [
    {
      colKey: 'email',
      title: '邮箱',
      width: 200,
      ellipsis: true,
    },
    {
      colKey: 'role',
      title: '角色',
      width: 80,
      cell: ({ row }: { row: User }) => (
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: row.role === 'admin' ? '#EDE9FE' : '#DBEAFE',
            color: row.role === 'admin' ? '#6D28D9' : '#1D4ED8',
          }}
        >
          {row.role === 'admin' ? '管理员' : '用户'}
        </span>
      ),
    },
    {
      colKey: 'disabled',
      title: '状态',
      width: 80,
      cell: ({ row }: { row: User }) => (
        row.disabled ? (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
            已禁用
          </span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#D1FAE5', color: '#059669' }}>
            正常
          </span>
        )
      ),
    },
    {
      colKey: 'created_at',
      title: '创建时间',
      width: 160,
      cell: ({ row }: { row: User }) => (
        <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
          {formatDate(row.created_at)}
        </span>
      ),
    },
    {
      colKey: 'last_login_at',
      title: '最后登录',
      width: 160,
      cell: ({ row }: { row: User }) => (
        <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
          {formatDate(row.last_login_at)}
        </span>
      ),
    },
    {
      colKey: 'actions',
      title: '操作',
      width: 320,
      cell: ({ row }: { row: User }) => (
        <div className="flex items-center gap-1 flex-wrap">
          {/* 角色切换 */}
          <Select
            size="small"
            value={row.role}
            onChange={(v) => handleRoleChange(row.id, v as 'admin' | 'user')}
            style={{ width: 90 }}
            options={[
              { label: '管理员', value: 'admin' },
              { label: '用户', value: 'user' },
            ]}
          />
          {/* 启用/禁用 */}
          <Button
            size="small"
            variant="outline"
            onClick={() => handleToggleDisabled(row.id, !row.disabled)}
            loading={loadingAction === row.id}
          >
            {row.disabled ? '启用' : '禁用'}
          </Button>
          {/* 清空数据 */}
          <Button
            size="small"
            variant="outline"
            onClick={() => handleClearData(row)}
            loading={loadingAction === row.id}
          >
            清空数据
          </Button>
          {/* 删除用户 */}
          <Button
            size="small"
            variant="outline"
            theme="danger"
            onClick={() => handleDeleteUser(row)}
            loading={loadingAction === row.id}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  const pagination: PaginationProps = {
    current: page,
    pageSize,
    total,
    showJumper: true,
    onCurrentChange: (v) => setPage(v as number),
    onPageSizeChange: (v) => { setPageSize(v as number); setPage(1); },
  };

  return (
    <div>
      {/* 搜索栏 */}
      <div className="flex items-center gap-3 mb-4">
        <Input
          placeholder="搜索邮箱..."
          value={searchText}
          onChange={(v) => { setSearchText(v as string); setPage(1); }}
          style={{ width: 240 }}
          size="small"
        />
        <Button size="small" variant="outline" icon={<RefreshIcon />} onClick={loadUsers}>
          刷新
        </Button>
        <span className="text-xs ml-auto" style={{ color: 'var(--td-text-color-secondary)' }}>
          共 {total} 个用户
        </span>
      </div>

      {/* 表格 */}
      <Table
        data={users}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={pagination}
        stripe
        hover
        size="small"
      />
    </div>
  );
}

// ==================== 调试日志 Tab ====================
function DebugLogsTab() {
  const { authHeaders } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [category, setCategory] = useState('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [total, setTotal] = useState(0);
  const logContainerRef = React.useRef<HTMLDivElement>(null);
  const intervalRef = React.useRef<number | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/logs?category=${category}&limit=200`, { headers: authHeaders() });
      const data = await res.json();
      setLogs(data.logs || []);
      setTotal(data.total ?? 0);
    } catch (e) {
      console.error('获取日志失败', e);
    }
  }, [authHeaders, category]);

  useEffect(() => {
    if (autoRefresh) {
      fetchLogs();
      intervalRef.current = window.setInterval(fetchLogs, 2000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchLogs]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleClearLogs = async () => {
    try {
      await fetch('/api/logs', { method: 'DELETE', headers: authHeaders() });
      setLogs([]);
      setTotal(0);
      MessagePlugin.success('日志已清空');
    } catch {
      MessagePlugin.error('清空失败');
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error': return '#EF4444';
      case 'warn': return '#F59E0B';
      case 'debug': return '#8B5CF6';
      default: return '#10B981';
    }
  };

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case 'schedule': return '#3B82F6';
      case 'ai': return '#8B5CF6';
      case 'db': return '#10B981';
      case 'system': return '#6B7280';
      default: return '#6B7280';
    }
  };

  return (
    <div>
      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--td-text-color-secondary)' }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            className="w-3 h-3"
          />
          自动刷新
        </label>
        <Button size="small" variant="outline" icon={<RefreshIcon />} onClick={fetchLogs}>
          刷新
        </Button>
        <Button size="small" variant="outline" icon={<DeleteIcon />} onClick={handleClearLogs}>
          清空
        </Button>
        <span className="ml-auto text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
          缓冲区共 {total} 条
        </span>
      </div>

      {/* 分类过滤 */}
      <div className="flex gap-2 mb-3">
        {['all', 'schedule', 'ai', 'db', 'system'].map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-2 py-1 text-xs rounded ${
              category === cat ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800'
            }`}
            style={{ color: category === cat ? '#fff' : 'var(--td-text-color-secondary)' }}
          >
            {cat === 'all' ? '全部' : cat.toUpperCase()}
          </button>
        ))}
      </div>

      {/* 日志列表 */}
      <div
        ref={logContainerRef}
        className="h-80 overflow-y-auto rounded border p-2 font-mono text-xs"
        style={{
          backgroundColor: 'var(--td-bg-color-component)',
          borderColor: 'var(--td-component-stroke)',
        }}
      >
        {logs.length === 0 ? (
          <div className="text-center py-8" style={{ color: 'var(--td-text-color-placeholder)' }}>
            暂无日志
          </div>
        ) : (
          logs.map((log, idx) => (
            <div
              key={idx}
              className="py-0.5 flex gap-2 items-start"
              style={{ borderBottom: '1px solid var(--td-component-stroke)' }}
            >
              <span className="opacity-50 flex-shrink-0 whitespace-nowrap">{log.timestamp}</span>
              <span
                className="px-1 rounded text-white flex-shrink-0"
                style={{ backgroundColor: getLevelColor(log.level) }}
              >
                {log.level.toUpperCase()}
              </span>
              <span
                className="px-1 rounded text-white flex-shrink-0"
                style={{ backgroundColor: getCategoryColor(log.category) }}
              >
                {log.category}
              </span>
              <span style={{ color: 'var(--td-text-color-primary)' }}>{log.message}</span>
              {log.data && (
                <span className="opacity-60" style={{ color: 'var(--td-text-color-secondary)' }}>
                  {JSON.stringify(log.data)}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ==================== 管理员弹窗组件 ====================
interface AdminModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AdminModal({ visible, onClose }: AdminModalProps) {
  const [tab, setTab] = useState('users');

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onMouseDown={onClose}
    >
      <div
        className="rounded-2xl shadow-2xl overflow-hidden relative"
        style={{
          backgroundColor: 'var(--td-bg-color-container)',
          width: '900px',
          maxWidth: '95vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* 固定在右上角的关闭按钮 */}
        <button
          onClick={onClose}
          className="fixed p-1.5 rounded-lg hover:opacity-60 z-50"
          style={{
            top: 'calc(50vh - 42.5vh + 16px)',
            right: 'calc(50vw - 450px + 16px)',
            backgroundColor: 'var(--td-bg-color-container)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--td-text-color-secondary)' }}><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
        </button>

        {/* 标题 */}
        <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--td-component-stroke)' }}>
          <h2 className="text-lg font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
            管理面板
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
            用户管理和调试日志
          </p>
        </div>

        {/* 自定义 Tab 切换 */}
        <div className="flex border-b" style={{ borderColor: 'var(--td-component-stroke)' }}>
          <button
            onClick={() => setTab('users')}
            className={`px-6 py-3 text-sm font-medium transition-all ${
              tab === 'users' ? 'border-b-2' : 'opacity-60 hover:opacity-80'
            }`}
            style={{
              borderColor: tab === 'users' ? 'var(--td-brand-color)' : 'transparent',
              color: tab === 'users' ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)',
            }}
          >
            用户管理
          </button>
          <button
            onClick={() => setTab('logs')}
            className={`px-6 py-3 text-sm font-medium transition-all ${
              tab === 'logs' ? 'border-b-2' : 'opacity-60 hover:opacity-80'
            }`}
            style={{
              borderColor: tab === 'logs' ? 'var(--td-brand-color)' : 'transparent',
              color: tab === 'logs' ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)',
            }}
          >
            调试日志
          </button>
        </div>

        {/* Tab 内容 */}
        <div className="flex-1 overflow-auto p-4">
          {tab === 'users' && <UserManagementTab />}
          {tab === 'logs' && <DebugLogsTab />}
        </div>
      </div>
    </div>
  );
}
