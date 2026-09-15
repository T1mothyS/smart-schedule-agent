import React, { useCallback, useEffect, useState } from 'react';
import {
CopyIcon,
DeleteIcon,
DownloadIcon,
RefreshIcon,
} from 'tdesign-icons-react';
import {
Button,
Input,
Loading,
MessagePlugin,
PaginationProps,
Select,
Table,
} from 'tdesign-react';
import { useAuth } from '../hooks/useAuth';
import './admin.css';

interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  disabled: boolean;
  admin_shared_api_enabled: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

type InviteRole = 'admin' | 'user';

interface InviteCodeStatus {
  role: InviteRole;
  active: boolean;
  createdAt: string | null;
  rotatedAt: string | null;
  version: number | null;
}

interface LogEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  data?: any;
}

const PRODUCTION_INVITE_COMMAND = `$sshKey = 'C:\\Users\\Elysia\\.ssh\\gotimothy_online_ed25519'
& ssh -i $sshKey root@47.95.114.137 "grep -E '^(ADMIN_INVITE_CODE|USER_INVITE_CODE)=' /root/smart-schedule-agent/.env"`;

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // 某些嵌入式浏览器会暴露 Clipboard API，但拒绝实际写入；继续使用兼容回退。
    }
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', 'true');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    input.remove();
  }
  if (!copied) throw new Error('当前浏览器不支持复制');
}

// ==================== 用户管理表格 ====================
function UserManagementTab({ onClose }: { onClose?: () => void }) {
  const { authHeaders, user: currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showInviteHelp, setShowInviteHelp] = useState(false);
  const [inviteCommandCopied, setInviteCommandCopied] = useState(false);
  const [inviteStatuses, setInviteStatuses] = useState<InviteCodeStatus[]>([]);
  const [inviteLoading, setInviteLoading] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [rotatingInviteRole, setRotatingInviteRole] = useState<InviteRole | null>(null);
  const [revealedInvite, setRevealedInvite] = useState<{ role: InviteRole; code: string; rotatedAt: string } | null>(null);
  const [revealedInviteCopied, setRevealedInviteCopied] = useState(false);

  // 使用 ref 存储 authHeaders 避免无限循环
  const authHeadersRef = React.useRef(authHeaders);
  authHeadersRef.current = authHeaders;

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/users?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(searchText)}`, {
        headers: authHeadersRef.current(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载用户列表失败');
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载用户列表失败';
      setLoadError(message);
      MessagePlugin.error(message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchText]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const loadInviteCodes = useCallback(async () => {
    setInviteLoading(true);
    setInviteError(null);
    try {
      const res = await fetch('/api/admin/invite-codes', {
        headers: authHeadersRef.current(),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载邀请码状态失败');
      if (!Array.isArray(data.codes)) throw new Error('邀请码状态格式不正确');
      setInviteStatuses(data.codes as InviteCodeStatus[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载邀请码状态失败';
      setInviteError(message);
      MessagePlugin.error(message);
    } finally {
      setInviteLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInviteCodes();
  }, [loadInviteCodes]);

  const isCurrentAccount = (target: User) => currentUser?.id === target.id;
  const isDangerousActionProtected = (target: User) => isCurrentAccount(target) || target.role === 'admin';
  const actionFailure = (error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : fallback;
    setActionError(message);
    MessagePlugin.error(message);
  };

  const handleRoleChange = async (userId: string, newRole: 'admin' | 'user') => {
    const actionKey = `${userId}:role`;
    setActionError(null);
    setLoadingAction(actionKey);
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '设置失败');
      MessagePlugin.success('角色已更新');
      await loadUsers();
    } catch (error) {
      actionFailure(error, '设置失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleToggleDisabled = async (userId: string, disabled: boolean) => {
    const actionKey = `${userId}:disabled`;
    setActionError(null);
    setLoadingAction(actionKey);
    try {
      const res = await fetch(`/api/admin/users/${userId}/disabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        body: JSON.stringify({ disabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '操作失败');
      MessagePlugin.success(disabled ? '已禁用' : '已启用');
      await loadUsers();
    } catch (error) {
      actionFailure(error, '操作失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleToggleAdminApiSharing = async (user: User) => {
    const previous = Boolean(user.admin_shared_api_enabled);
    const enabled = !previous;
    const actionKey = `${user.id}:api-share`;
    setActionError(null);
    setUsers(current => current.map(row => row.id === user.id ? { ...row, admin_shared_api_enabled: enabled } : row));
    setLoadingAction(actionKey);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/api-share`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '共享 API 权限更新失败');
      const confirmed = typeof data.enabled === 'boolean' ? data.enabled : enabled;
      setUsers(current => current.map(row => row.id === user.id ? { ...row, admin_shared_api_enabled: confirmed } : row));
      if (confirmed && data.adminApiAvailable === false) {
        MessagePlugin.warning('权限已开启，但当前没有可用的管理员 API Key');
      } else {
        MessagePlugin.success(confirmed ? '已共享管理员 API' : '已取消共享管理员 API');
      }
    } catch (error) {
      setUsers(current => current.map(row => row.id === user.id ? { ...row, admin_shared_api_enabled: previous } : row));
      actionFailure(error, '共享 API 权限更新失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const copyInviteCommand = async () => {
    try {
      await copyText(PRODUCTION_INVITE_COMMAND);
      setInviteCommandCopied(true);
      MessagePlugin.success('已复制');
      window.setTimeout(() => setInviteCommandCopied(false), 1800);
    } catch {
      MessagePlugin.error('自动复制失败，请手动选择命令');
    }
  };

  const copyRevealedInvite = async () => {
    if (!revealedInvite) return;
    try {
      await copyText(revealedInvite.code);
      setRevealedInviteCopied(true);
      MessagePlugin.success('新邀请码已复制');
      window.setTimeout(() => setRevealedInviteCopied(false), 1800);
    } catch {
      MessagePlugin.error('自动复制失败，请手动选择新邀请码');
    }
  };

  const handleRotateInviteCode = async (role: InviteRole) => {
    const roleLabel = role === 'admin' ? '管理员' : '普通用户';
    if (!window.confirm(`确定要轮换${roleLabel}邀请码吗？\n\n旧邀请码会立即失效，已有账号和登录状态不受影响。新邀请码只在成功后显示一次，请及时复制保存。`)) return;

    setInviteError(null);
    setRotatingInviteRole(role);
    try {
      const res = await fetch(`/api/admin/invite-codes/${role}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '轮换邀请码失败');
      if (typeof data.code !== 'string' || !data.code) throw new Error('服务器未返回新邀请码');
      setRevealedInvite({ role, code: data.code, rotatedAt: String(data.rotatedAt || new Date().toISOString()) });
      setRevealedInviteCopied(false);
      setInviteStatuses(current => current.map(status => status.role === role ? {
        ...status,
        active: true,
        createdAt: data.createdAt || status.createdAt,
        rotatedAt: data.rotatedAt || status.rotatedAt,
        version: typeof data.version === 'number' ? data.version : status.version,
      } : status));
      MessagePlugin.success(`${roleLabel}邀请码已轮换`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '轮换邀请码失败';
      setInviteError(message);
      MessagePlugin.error(message);
    } finally {
      setRotatingInviteRole(null);
    }
  };

  const handleClearData = async (user: User) => {
    if (!window.confirm(`确定要清空用户 ${user.email} 的所有数据吗？\n包括：日程、待办、AI对话历史、API Key 等。\n该用户的账号和密码将保留。`)) return;

    const actionKey = `${user.id}:clear`;
    setActionError(null);
    setLoadingAction(actionKey);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/clear-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        body: JSON.stringify({ confirmEmail: user.email }),
      });
      
      if (res.ok) {
        MessagePlugin.success(`已清空 ${user.email} 的数据`);
      } else {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || '操作失败');
      }
      await loadUsers();
    } catch (error) {
      actionFailure(error, '清空失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (!window.confirm(`⚠️ 危险操作！\n\n确定要删除用户 ${user.email} 吗？\n\n此操作将：\n- 删除该用户的所有日程和待办\n- 删除 AI 对话历史\n- 删除 API Key\n- 删除用户账号\n\n此操作不可恢复！`)) return;

    const actionKey = `${user.id}:delete`;
    setActionError(null);
    setLoadingAction(actionKey);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        body: JSON.stringify({ confirmEmail: user.email }),
      });
      
      if (res.ok) {
        MessagePlugin.success(`已删除用户 ${user.email}`);
      } else {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || '删除失败');
      }
      await loadUsers();
    } catch (error) {
      actionFailure(error, '删除失败');
    } finally {
      setLoadingAction(null);
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
          {row.role === 'admin' ? '管理员' : '用户'}{isCurrentAccount(row) ? ' · 当前账户' : ''}
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
      width: 380,
      cell: ({ row }: { row: User }) => (
        <div className="admin-user-actions" title={isCurrentAccount(row) ? '当前账户：不能修改自己的管理员身份、禁用、清空或删除' : row.role === 'admin' ? '其他管理员：请先降级为普通用户后再进行危险操作' : undefined}>
          <div className="admin-user-actions-row">
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
              loading={loadingAction === `${row.id}:role`}
              disabled={isCurrentAccount(row)}
            />
            {row.role === 'admin' && !isCurrentAccount(row) && <span className="admin-action-hint">先降级后操作</span>}
            {/* 管理员 API 共享 */}
            <Button
              size="small"
              variant="outline"
              theme={row.admin_shared_api_enabled ? 'primary' : 'default'}
              onClick={() => handleToggleAdminApiSharing(row)}
              loading={loadingAction === `${row.id}:api-share`}
            >
              {row.admin_shared_api_enabled ? '取消共享' : '共享 API'}
            </Button>
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: row.admin_shared_api_enabled ? '#D1FAE5' : '#F3F4F6',
                color: row.admin_shared_api_enabled ? '#047857' : '#6B7280',
              }}
            >
              {row.admin_shared_api_enabled ? '已共享' : '未共享'}
            </span>
          </div>
          <div className="admin-user-actions-row">
            {/* 启用/禁用 */}
            <Button
              size="small"
              variant="outline"
              onClick={() => handleToggleDisabled(row.id, !row.disabled)}
              loading={loadingAction === `${row.id}:disabled`}
              disabled={isDangerousActionProtected(row)}
            >
              {row.disabled ? '启用' : '禁用'}
            </Button>
            {/* 清空数据 */}
            <Button
              size="small"
              variant="outline"
              onClick={() => handleClearData(row)}
              loading={loadingAction === `${row.id}:clear`}
              disabled={isDangerousActionProtected(row)}
            >
              清空数据
            </Button>
            {/* 删除用户 */}
            <Button
              size="small"
              variant="outline"
              theme="danger"
              onClick={() => handleDeleteUser(row)}
              loading={loadingAction === `${row.id}:delete`}
              disabled={isDangerousActionProtected(row)}
            >
              删除
            </Button>
          </div>
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
    <div className="admin-user-management">
      <section className="admin-invite-panel mb-4 rounded-lg border p-3" style={{ borderColor: 'var(--td-component-stroke)', backgroundColor: 'var(--td-bg-color-page)' }}>
        <div className="admin-invite-panel-heading">
          <div>
            <h3 className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>邀请码管理</h3>
            <p>按角色手动轮换；旧邀请码会立即失效，已有账号和登录状态不受影响。</p>
          </div>
          <span className="admin-invite-security-note">数据库只保存哈希</span>
        </div>

        {inviteError && (
          <div className="admin-action-error admin-invite-error" role="alert">
            <span>{inviteError}</span>
            <Button size="small" variant="text" onClick={() => { void loadInviteCodes(); }}>重试</Button>
          </div>
        )}

        <div className="admin-invite-role-grid" aria-label="邀请码角色状态">
          {(['admin', 'user'] as InviteRole[]).map(role => {
            const status = inviteStatuses.find(item => item.role === role);
            const roleLabel = role === 'admin' ? '管理员' : '普通用户';
            return (
              <div key={role} className="admin-invite-role-card">
                <div className="admin-invite-role-heading">
                  <strong>{roleLabel}邀请码</strong>
                  <span className={status?.active ? 'admin-invite-status active' : 'admin-invite-status'}>
                    {inviteLoading ? '读取中…' : status?.active ? `已启用 · 第 ${status.version || 1} 版` : '未配置'}
                  </span>
                </div>
                <p>{status?.rotatedAt ? `最近轮换：${formatDate(status.rotatedAt)}` : '尚未记录轮换时间'}</p>
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => { void handleRotateInviteCode(role); }}
                  loading={rotatingInviteRole === role}
                  disabled={inviteLoading || !status?.active || (rotatingInviteRole !== null && rotatingInviteRole !== role)}
                >
                  轮换{roleLabel}邀请码
                </Button>
              </div>
            );
          })}
        </div>

        {revealedInvite && (
          <div className="admin-invite-reveal" role="alert">
            <div className="admin-invite-reveal-heading">
              <strong>新{revealedInvite.role === 'admin' ? '管理员' : '普通用户'}邀请码已生成</strong>
              <span>仅在本次操作后显示，请复制保存；关闭后页面不会再次显示。</span>
            </div>
            <div className="admin-invite-reveal-value">
              <code>{revealedInvite.code}</code>
              <Button size="small" variant="outline" icon={<CopyIcon />} onClick={copyRevealedInvite}>
                {revealedInviteCopied ? '已复制' : '复制新邀请码'}
              </Button>
            </div>
            <Button size="small" variant="text" onClick={() => { setRevealedInvite(null); setRevealedInviteCopied(false); }}>
              我已保存，关闭
            </Button>
          </div>
        )}

        <div className="admin-invite-legacy">
          <div className="admin-invite-legacy-heading">
            <h4>迁移期 SSH 查询（只读）</h4>
            <div className="relative">
              <button
                type="button"
                aria-label="查看生产环境邀请码查询说明"
                aria-expanded={showInviteHelp}
                title="查看查询说明"
                onClick={() => setShowInviteHelp(value => !value)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs font-semibold"
                style={{ borderColor: 'var(--td-component-stroke)', color: 'var(--td-text-color-secondary)' }}
              >
                ?
              </button>
              {showInviteHelp && (
                <div role="tooltip" className="absolute left-0 top-7 z-10 w-80 max-w-[calc(100vw-3rem)] rounded-lg border p-2 text-xs leading-5 shadow-lg" style={{ borderColor: 'var(--td-component-stroke)', color: 'var(--td-text-color-secondary)', backgroundColor: 'var(--td-bg-color-container)' }}>
                  这条命令只查看迁移期 .env 引导配置；数据库初始化或轮换后，当前生效值以数据库记录为准，网页不会读取或回显邀请码明文。
                </div>
              )}
            </div>
          </div>
          <p>仅在首次迁移或服务器排障时使用，需要当前电脑已配置 SSH Key 并拥有服务器访问权限。</p>
          <pre className="admin-invite-command"><code>{PRODUCTION_INVITE_COMMAND}</code></pre>
          <div className="admin-invite-command-actions">
            <Button size="small" variant="outline" icon={<CopyIcon />} onClick={copyInviteCommand}>
              {inviteCommandCopied ? '已复制' : '复制命令'}
            </Button>
          </div>
        </div>
      </section>
      {/* 搜索栏 */}
      <div className="admin-toolbar mb-4">
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
      {(loadError || actionError) && (
        <div className="admin-action-error mb-3" role="alert">
          {loadError || actionError}
        </div>
      )}

      {/* 表格 */}
      <div className="admin-user-table-wrap">
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
      <div className="admin-user-mobile-list" aria-label="用户列表">
        {loading ? <Loading /> : users.length === 0 ? (
          <div className="text-center py-8" style={{ color: 'var(--td-text-color-placeholder)' }}>暂无用户</div>
        ) : users.map(user => (
          <article key={user.id} className="admin-user-card">
            <div className="admin-user-card-head">
              <strong className="admin-user-card-email">{user.email}</strong>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: user.role === 'admin' ? '#EDE9FE' : '#DBEAFE',
                  color: user.role === 'admin' ? '#6D28D9' : '#1D4ED8',
                }}
              >
                {user.role === 'admin' ? '管理员' : '用户'}{isCurrentAccount(user) ? ' · 当前账户' : ''}
              </span>
            </div>
            <div className="admin-user-card-meta">
              <span>{user.disabled ? '已禁用' : '正常'} · 创建于 {formatDate(user.created_at)}</span>
              <span>登录 {formatDate(user.last_login_at)}</span>
            </div>
            <div className="admin-user-card-actions">
              <div className="admin-user-actions-row">
                <Select
                  size="small"
                  value={user.role}
                  onChange={(value) => handleRoleChange(user.id, value as 'admin' | 'user')}
                  options={[{ label: '管理员', value: 'admin' }, { label: '用户', value: 'user' }]}
                  loading={loadingAction === `${user.id}:role`}
                  disabled={isCurrentAccount(user)}
                />
                {user.role === 'admin' && !isCurrentAccount(user) && <span className="admin-action-hint">先降级后操作</span>}
                <Button
                  size="small"
                  variant="outline"
                  theme={user.admin_shared_api_enabled ? 'primary' : 'default'}
                  onClick={() => handleToggleAdminApiSharing(user)}
                  loading={loadingAction === `${user.id}:api-share`}
                >
                  {user.admin_shared_api_enabled ? '取消共享' : '共享 API'}
                </Button>
                <span className="admin-user-card-share-status">{user.admin_shared_api_enabled ? '已共享' : '未共享'}</span>
              </div>
              <div className="admin-user-actions-row">
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => handleToggleDisabled(user.id, !user.disabled)}
                  loading={loadingAction === `${user.id}:disabled`}
                  disabled={isDangerousActionProtected(user)}
                  title={isCurrentAccount(user) ? '不能禁用自己的账号' : user.role === 'admin' ? '请先降级为普通用户' : undefined}
                >
                  {user.disabled ? '启用' : '禁用'}
                </Button>
                <Button size="small" variant="outline" onClick={() => handleClearData(user)} loading={loadingAction === `${user.id}:clear`} disabled={isDangerousActionProtected(user)}>清空数据</Button>
                <Button size="small" variant="outline" theme="danger" onClick={() => handleDeleteUser(user)} loading={loadingAction === `${user.id}:delete`} disabled={isDangerousActionProtected(user)}>删除</Button>
              </div>
            </div>
            {user.role === 'admin' && !isCurrentAccount(user) && <div className="admin-user-card-hint">先降级为普通用户后可禁用、清空或删除</div>}
          </article>
        ))}
      </div>
    </div>
  );
}

// ==================== 调试日志 Tab ====================
function DebugLogsTab() {
  const { authHeaders } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [category, setCategory] = useState('all');
  const [level, setLevel] = useState('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [total, setTotal] = useState(0);
  const [maxLogs, setMaxLogs] = useState(0);
  const [exporting, setExporting] = useState(false);
  const logContainerRef = React.useRef<HTMLDivElement>(null);
  const intervalRef = React.useRef<number | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ category, level, limit: '200' });
      const res = await fetch(`/api/logs?${params.toString()}`, { headers: authHeaders() });
      const data = await res.json();
      setLogs(data.logs || []);
      setTotal(data.total ?? 0);
      setMaxLogs(data.max ?? 0);
    } catch (e) {
      console.error('获取日志失败', e);
    }
  }, [authHeaders, category, level]);

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

  const handleExportLogs = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await fetch('/api/logs/export?format=txt', { headers: authHeaders() });
      if (!response.ok) {
        let message = '导出失败';
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const disposition = response.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || 'schedule-logs.txt';
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      MessagePlugin.success('日志已导出');
    } catch (error) {
      MessagePlugin.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
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
      case 'reminder': return '#F59E0B';
      case 'weather': return '#0EA5E9';
      case 'mail': return '#0EA5E9';
      case 'daily-report': return '#0284C7';
      case 'library': return '#0F766E';
      case 'auth': return '#14B8A6';
      case 'admin': return '#EF4444';
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
        <Button size="small" variant="outline" icon={<DownloadIcon />} onClick={handleExportLogs} loading={exporting}>
          一键导出
        </Button>
        <Button size="small" variant="outline" icon={<DeleteIcon />} onClick={handleClearLogs}>
          清空
        </Button>
        <span className="ml-auto text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
          已保留 {total} 条{maxLogs ? `（上限 ${maxLogs} 条，重启后保留）` : ''}
        </span>
      </div>

      {/* 分类和级别过滤 */}
      <div className="admin-log-filter-section">
        <div className="admin-log-filter-row" aria-label="日志级别筛选">
          <span className="admin-filter-label">级别</span>
          {[
            ['all', '全部'], ['info', '信息'], ['warn', '警告'], ['error', '错误'], ['debug', '调试'],
          ].map(([value, label]) => (
            <button key={value} type="button" onClick={() => setLevel(value)} className={`admin-filter-chip${level === value ? ' active' : ''}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="admin-log-filter-row" aria-label="日志功能筛选">
          <span className="admin-filter-label">功能</span>
          {[
            ['all', '全部'], ['schedule', '日程'], ['reminder', '提醒'], ['weather', '天气'], ['ai', 'AI'], ['mail', '邮件'],
            ['daily-report', '日报'], ['library', '知识库'], ['auth', '认证'], ['admin', '管理'], ['db', '数据库'], ['system', '系统'],
          ].map(([value, label]) => (
            <button key={value} type="button" onClick={() => setCategory(value)} className={`admin-filter-chip${category === value ? ' active' : ''}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 日志列表 */}
      <div
        ref={logContainerRef}
        className="admin-log-list"
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
              className="admin-log-row"
            >
              <div className="admin-log-main">
                <time className="admin-log-timestamp">{log.timestamp}</time>
                <span
                  className="admin-log-level px-1 rounded text-white"
                  style={{ backgroundColor: getLevelColor(log.level) }}
                >
                  {log.level.toUpperCase()}
                </span>
                <span
                  className="admin-log-category px-1 rounded text-white"
                  style={{ backgroundColor: getCategoryColor(log.category) }}
                >
                  {log.category}
                </span>
                <span className="admin-log-message" style={{ color: 'var(--td-text-color-primary)' }}>{log.message}</span>
              </div>
              {log.data && (
                <pre className="admin-log-data" style={{ color: 'var(--td-text-color-secondary)' }} aria-label="日志数据">
                  {JSON.stringify(log.data, null, 2)}
                </pre>
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

  useEffect(() => {
    if (!visible) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, visible]);

  if (!visible) return null;

  return (
    <div className="admin-modal-backdrop" onMouseDown={onClose}>
      <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title" onMouseDown={event => event.stopPropagation()}>
        {/* 标题 */}
        <button
          type="button"
          onClick={onClose}
          className="admin-modal-close"
          aria-label="关闭管理面板"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
        </button>
        <div className="admin-modal-header">
          <div>
          <h2 id="admin-modal-title">
            管理面板
          </h2>
          <p>
            用户管理和调试日志
          </p>
          </div>
        </div>

        <div className="admin-modal-body">
          {/* 桌面端为侧边分区，窄屏时由 CSS 改为顶部横向 Tab。 */}
          <div className="admin-modal-tabs" role="tablist" aria-label="管理面板分区">
            <button
              type="button"
              onClick={() => setTab('users')}
              className={`admin-modal-tab${tab === 'users' ? ' active' : ''}`}
              role="tab"
              aria-selected={tab === 'users'}
            >
              用户管理
            </button>
            <button
              type="button"
              onClick={() => setTab('logs')}
              className={`admin-modal-tab${tab === 'logs' ? ' active' : ''}`}
              role="tab"
              aria-selected={tab === 'logs'}
            >
              调试日志
            </button>
          </div>

          {/* Tab 内容 */}
          <div className="admin-modal-content">
            {tab === 'users' && <UserManagementTab />}
            {tab === 'logs' && <DebugLogsTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
