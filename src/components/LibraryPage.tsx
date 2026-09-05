import { useCallback, useEffect, useState } from 'react';
import { Archive, ArrowLeft, BookOpen, Check, Copy, Download, FileText, Plus, RefreshCw, Search, Send, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

type LibraryKind = 'fragment' | 'article';
type LibraryType = 'knowledge' | 'insight' | 'framework' | 'experience' | 'tutorial' | 'reference';
type LibraryStatus = 'draft' | 'active' | 'archived';

interface LibraryEntry {
  id: string;
  kind: LibraryKind;
  type: LibraryType;
  sourceId: string | null;
  slug: string | null;
  title: string | null;
  content?: string;
  html?: string;
  summary: string;
  tags: string[];
  status: LibraryStatus;
  sourceType: string;
  sourceRef: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
}

interface LibraryVersion {
  id: string;
  entryId: string;
  contentHash: string;
  title: string | null;
  summary: string;
  content: string;
  tags: string[];
  createdAt: string;
}

interface LibraryComment {
  id: string;
  entryId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface LibraryDetail {
  entry: LibraryEntry;
  versions: LibraryVersion[];
  comments: LibraryComment[];
  relations: { calendarEvents: string[]; libraryEntries: string[] };
}

interface TokenStatus {
  exists: boolean;
  active: boolean;
  prefix: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const typeLabels: Record<LibraryType, string> = {
  knowledge: '知识',
  insight: '认知',
  framework: '框架',
  experience: '经历',
  tutorial: '教程',
  reference: '速查',
};

const kindLabels: Record<LibraryKind, string> = { fragment: '知识碎片', article: '正式知识' };
const statusLabels: Record<LibraryStatus, string> = { draft: '草稿', active: '有效', archived: '已归档' };

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

async function readError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = await response.json();
    const message = data?.error?.message || data?.error || fallback;
    return new Error(String(message));
  } catch {
    return new Error(fallback);
  }
}

function templateFor(type: LibraryType): string {
  if (type === 'framework') return '# 标题\n\n## 这个框架解决什么问题\n\n## 使用方法\n\n## 判断步骤\n\n## 适用条件\n\n## 不适用条件\n\n## 实际案例\n\n## 如何验证\n';
  if (type === 'tutorial') return '# 标题\n\n## 目标\n\n## 适用环境\n\n## 前置条件\n\n## 操作步骤\n\n## 常见问题\n\n## 完成标准\n\n## 来源\n';
  if (type === 'reference') return '# 标题\n\n## 快速结论\n\n## 常用命令 / 操作\n\n## 参数说明\n\n## 常见问题\n\n## 来源\n';
  return '# 标题\n\n## 核心结论\n\n## 背景\n\n## 我的理解\n\n## 适用场景\n\n## 误区 / 边界\n\n## 后续更新\n';
}

function tagsToText(tags: string[]): string {
  return tags.join(', ');
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean))].slice(0, 30);
}

function LibraryEditor({
  initial,
  kind,
  saving,
  error,
  onCancel,
  onSave,
}: {
  initial?: Partial<LibraryEntry>;
  kind: LibraryKind;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [type, setType] = useState<LibraryType>(initial?.type || 'knowledge');
  const [title, setTitle] = useState(initial?.title || '');
  const [summary, setSummary] = useState(initial?.summary || '');
  const [tags, setTags] = useState(tagsToText(initial?.tags || []));
  const [status, setStatus] = useState<LibraryStatus>(initial?.status || (kind === 'article' ? 'draft' : 'active'));
  const [content, setContent] = useState(initial?.content || '');
  const isEditing = Boolean(initial?.id);

  useEffect(() => {
    setType(initial?.type || 'knowledge');
    setTitle(initial?.title || '');
    setSummary(initial?.summary || '');
    setTags(tagsToText(initial?.tags || []));
    setStatus(initial?.status || (kind === 'article' ? 'draft' : 'active'));
    setContent(initial?.content || '');
  }, [initial, kind]);

  const applyTemplate = () => {
    if (content.trim() && !window.confirm('这会替换当前正文，是否继续？')) return;
    setContent(templateFor(type));
  };

  return (
    <form
      className="library-editor"
      onSubmit={event => {
        event.preventDefault();
        void onSave({ type, title, summary, tags: parseTags(tags), status, content });
      }}
    >
      <div className="library-editor-head">
        <div>
          <span className="library-eyebrow">{isEditing ? 'EDIT ENTRY' : 'NEW ENTRY'}</span>
          <h2>{isEditing ? '编辑内容' : kindLabels[kind]}</h2>
        </div>
        <button type="button" className="library-icon-button" onClick={onCancel} aria-label="取消编辑">×</button>
      </div>
      <div className="library-form-grid">
        <label className="library-field">
          <span>内容类型</span>
          <select value={type} onChange={event => setType(event.target.value as LibraryType)}>
            {(Object.keys(typeLabels) as LibraryType[]).map(option => <option key={option} value={option}>{typeLabels[option]}</option>)}
          </select>
        </label>
        <label className="library-field">
          <span>状态</span>
          <select value={status} onChange={event => setStatus(event.target.value as LibraryStatus)}>
            <option value="draft">草稿</option>
            <option value="active">有效</option>
            <option value="archived">归档</option>
          </select>
        </label>
        <label className="library-field library-field-full">
          <span>标题{kind === 'fragment' ? '（可选）' : ''}</span>
          <input value={title} onChange={event => setTitle(event.target.value)} placeholder={kind === 'fragment' ? '不填也可以，列表会显示正文摘要' : '给这篇正式知识一个清晰标题'} />
        </label>
        <label className="library-field library-field-full">
          <span>一句话摘要（可选）</span>
          <input value={summary} onChange={event => setSummary(event.target.value)} placeholder="留空时由服务端从正文提取摘要" />
        </label>
        <label className="library-field library-field-full">
          <span>标签</span>
          <input value={tags} onChange={event => setTags(event.target.value)} placeholder="用逗号分隔，例如 AI, 工作, 框架" />
        </label>
        <label className="library-field library-field-full">
          <span className="library-field-label-row"><span>Markdown 正文</span><button type="button" className="library-inline-button" onClick={applyTemplate}>套用模板</button></span>
          <textarea value={content} onChange={event => setContent(event.target.value)} rows={18} placeholder="支持标题、列表、代码块、表格、链接和图片" />
        </label>
      </div>
      {error && <div className="library-notice error" role="alert">{error}</div>}
      <div className="library-editor-foot">
        <button type="button" className="library-secondary-button" onClick={onCancel}>取消</button>
        <button type="submit" className="library-primary-button" disabled={saving}>
          {saving ? <RefreshCw size={14} className="spin" /> : <Check size={14} />}
          {saving ? '保存中…' : '保存内容'}
        </button>
      </div>
    </form>
  );
}

function LibraryHomePage() {
  const { authHeaders } = useAuth();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | LibraryKind>('all');
  const [type, setType] = useState<'all' | LibraryType>('all');
  const [status, setStatus] = useState<'active' | 'all' | 'draft' | 'archived'>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorKind, setEditorKind] = useState<LibraryKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, kind, type, pageSize: '100' });
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`/api/library?${params.toString()}`, { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '知识库加载失败');
      const data = await response.json();
      setEntries(data.items || []);
      setTotal(Number(data.total || 0));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '知识库加载失败');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, kind, query, status, type]);

  const loadTokenStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/library/publish-token', { headers: authHeaders() });
      if (response.ok) setTokenStatus((await response.json()).status || null);
    } catch {}
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadTokenStatus(); }, [loadTokenStatus]);

  const openEditor = (nextKind: LibraryKind) => {
    setEditorError(null);
    setEditorKind(nextKind);
  };

  const saveNew = async (payload: Record<string, unknown>) => {
    if (saving) return;
    setSaving(true);
    setEditorError(null);
    try {
      const response = await fetch('/api/library', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, kind: editorKind }),
      });
      if (!response.ok) throw await readError(response, '保存知识失败');
      const data = await response.json();
      setEditorKind(null);
      await load();
      navigate(`/library/${data.entry.id}`);
    } catch (saveError) {
      setEditorError(saveError instanceof Error ? saveError.message : '保存知识失败');
    } finally {
      setSaving(false);
    }
  };

  const generateToken = async () => {
    if (tokenLoading) return;
    if (!window.confirm('生成新令牌会立即撤销旧令牌，是否继续？')) return;
    setTokenLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/library/publish-token', { method: 'POST', headers: authHeaders() });
      if (!response.ok) throw await readError(response, '生成发布令牌失败');
      const data = await response.json();
      setToken(data.token || null);
      setTokenStatus(data.status || null);
    } catch (tokenError) {
      setError(tokenError instanceof Error ? tokenError.message : '生成发布令牌失败');
    } finally {
      setTokenLoading(false);
    }
  };

  const copyToken = async () => {
    if (!token) return;
    await navigator.clipboard?.writeText(token);
  };

  return (
    <div className="library-page">
      <header className="library-header">
        <div>
          <span className="library-eyebrow">PRIVATE LIBRARY</span>
          <h1>知识库</h1>
          <p>把值得长期保存的正式知识和知识碎片放在同一个可检索的内容系统里。</p>
        </div>
        <div className="library-header-actions">
          <button type="button" className="library-secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : undefined} />刷新</button>
          <button type="button" className="library-secondary-button" onClick={() => openEditor('fragment')}><Plus size={14} />新建碎片</button>
          <button type="button" className="library-primary-button" onClick={() => openEditor('article')}><FileText size={14} />新建正式知识</button>
        </div>
      </header>

      {error && <div className="library-notice error" role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></div>}

      <section className="library-toolbar" aria-label="知识库筛选">
        <form className="library-search" onSubmit={event => { event.preventDefault(); setQuery(searchText); }}>
          <Search size={16} aria-hidden="true" />
          <input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="搜索标题、摘要、正文或标签" aria-label="搜索知识库" />
          <button type="submit">搜索</button>
        </form>
        <div className="library-filters">
          <select value={kind} onChange={event => setKind(event.target.value as typeof kind)} aria-label="筛选内容形态">
            <option value="all">全部形态</option><option value="article">正式知识</option><option value="fragment">知识碎片</option>
          </select>
          <select value={type} onChange={event => setType(event.target.value as typeof type)} aria-label="筛选内容类型">
            <option value="all">全部类型</option>{(Object.keys(typeLabels) as LibraryType[]).map(option => <option key={option} value={option}>{typeLabels[option]}</option>)}
          </select>
          <select value={status} onChange={event => setStatus(event.target.value as typeof status)} aria-label="筛选内容状态">
            <option value="active">有效内容</option><option value="draft">草稿</option><option value="archived">已归档</option><option value="all">全部状态</option>
          </select>
        </div>
      </section>

      <section className="library-token-card">
        <div>
          <strong>本地发布接口</strong>
          <p>{tokenStatus?.active ? `已启用 ${tokenStatus.prefix || 'klp_…'}，令牌只保存摘要。` : '需要从本地 Markdown 迁移正式知识时，再生成一个独立发布令牌。'}</p>
        </div>
        <div className="library-token-actions">
          {token ? <div className="library-token-reveal"><code>{token}</code><button type="button" onClick={() => void copyToken()} aria-label="复制知识库发布令牌"><Copy size={14} /></button></div> : null}
          <button type="button" className="library-inline-button" onClick={() => void generateToken()} disabled={tokenLoading}>{tokenLoading ? '生成中…' : tokenStatus?.active ? '轮换令牌' : '生成令牌'}</button>
        </div>
      </section>

      {editorKind && <LibraryEditor kind={editorKind} saving={saving} error={editorError} onCancel={() => setEditorKind(null)} onSave={saveNew} />}

      <div className="library-list-meta"><span>{loading ? '正在加载…' : `显示 ${entries.length} 条，共 ${total} 条`}</span><span>默认按最近更新排序</span></div>
      {loading ? (
        <div className="library-state"><RefreshCw size={24} className="spin" /><span>正在加载知识库…</span></div>
      ) : entries.length ? (
        <div className="library-grid">
          {entries.map(entry => <LibraryCard key={entry.id} entry={entry} onOpen={() => navigate(`/library/${entry.id}`)} />)}
        </div>
      ) : (
        <div className="library-state"><BookOpen size={34} /><strong>还没有符合条件的内容</strong><span>可以先保存一段知识碎片，之后再整理成正式知识。</span></div>
      )}
    </div>
  );
}

function LibraryCard({ entry, onOpen }: { entry: LibraryEntry; onOpen: () => void }) {
  const displayTitle = entry.title || entry.summary || '未命名知识碎片';
  return (
    <article className={`library-card ${entry.kind}`}>
      <button type="button" className="library-card-open" onClick={onOpen} aria-label={`打开 ${displayTitle}`}>
        <div className="library-card-topline"><span className={`library-kind-badge ${entry.kind}`}>{kindLabels[entry.kind]}</span><span className="library-type-label">{typeLabels[entry.type]}</span></div>
        <h2>{displayTitle}</h2>
        <p>{entry.summary || '暂无摘要，打开正文查看。'}</p>
        <div className="library-card-tags">{entry.tags.slice(0, 5).map(tag => <span key={tag}>#{tag}</span>)}</div>
        <div className="library-card-footer"><span>{statusLabels[entry.status]}</span><span>{formatTime(entry.updatedAt)} <b aria-hidden="true">→</b></span></div>
      </button>
    </article>
  );
}

function LibraryDetailPage({ id }: { id: string }) {
  const { authHeaders } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<LibraryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/library/${encodeURIComponent(id)}`, { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '知识详情加载失败');
      setDetail(await response.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '知识详情加载失败');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, id]);

  useEffect(() => { void load(); }, [load]);

  const saveEdit = async (payload: Record<string, unknown>) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/library/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw await readError(response, '更新知识失败');
      setEditing(false);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '更新知识失败');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!detail || !window.confirm('归档后默认列表不再显示，但内容仍可通过“已归档”筛选恢复查看。是否继续？')) return;
    const response = await fetch(`/api/library/${encodeURIComponent(id)}/archive`, { method: 'POST', headers: authHeaders() });
    if (!response.ok) { setError((await readError(response, '归档失败')).message); return; }
    await load();
  };

  const remove = async () => {
    if (!detail || !window.confirm('永久删除后无法从知识库恢复，但导出的 Markdown 或备份仍可能保留。是否继续？')) return;
    const response = await fetch(`/api/library/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    if (!response.ok) { setError((await readError(response, '删除失败')).message); return; }
    navigate('/library');
  };

  const promote = async () => {
    if (!detail || detail.entry.kind !== 'fragment') return;
    const response = await fetch(`/api/library/${encodeURIComponent(id)}/promote`, { method: 'POST', headers: authHeaders() });
    if (!response.ok) { setError((await readError(response, '整理失败')).message); return; }
    const data = await response.json();
    navigate(`/library/${data.entry.id}`);
  };

  const exportMarkdown = async () => {
    const response = await fetch(`/api/library/${encodeURIComponent(id)}/export`, { headers: authHeaders() });
    if (!response.ok) { setError((await readError(response, '导出失败')).message); return; }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const filename = encoded ? decodeURIComponent(encoded) : `${detail?.entry.slug || id}.md`;
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const addComment = async () => {
    if (!comment.trim() || commentSaving) return;
    setCommentSaving(true);
    try {
      const response = await fetch(`/api/library/${encodeURIComponent(id)}/comments`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: comment }),
      });
      if (!response.ok) throw await readError(response, '添加评论失败');
      setComment('');
      await load();
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : '添加评论失败');
    } finally {
      setCommentSaving(false);
    }
  };

  const deleteComment = async (commentId: string) => {
    const response = await fetch(`/api/library/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE', headers: authHeaders() });
    if (!response.ok) setError((await readError(response, '删除评论失败')).message);
    else await load();
  };

  if (loading) return <div className="library-page"><div className="library-state"><RefreshCw size={24} className="spin" /><span>正在加载知识详情…</span></div></div>;
  if (error && !detail) return <div className="library-page"><div className="library-state" role="alert"><BookOpen size={30} /><strong>知识详情暂时无法加载</strong><span>{error}</span><button type="button" className="library-secondary-button" onClick={() => void load()}>重试</button></div></div>;
  if (!detail) return null;
  const entry = detail.entry;
  const title = entry.title || entry.summary || '未命名知识碎片';

  return (
    <div className="library-page library-detail-page">
      <div className="library-detail-toolbar">
        <button type="button" className="library-back-button" onClick={() => navigate('/library')}><ArrowLeft size={15} />返回知识库</button>
        <div className="library-header-actions">
          {entry.kind === 'fragment' && <button type="button" className="library-secondary-button" onClick={() => void promote()}><FileText size={14} />整理为正式知识</button>}
          <button type="button" className="library-secondary-button" onClick={() => void exportMarkdown()}><Download size={14} />导出 Markdown</button>
          <button type="button" className="library-secondary-button" onClick={() => setEditing(true)}><FileText size={14} />编辑</button>
          {entry.status !== 'archived' && <button type="button" className="library-danger-button" onClick={() => void archive()}><Archive size={14} />归档</button>}
          {entry.kind === 'fragment' && <button type="button" className="library-danger-button" onClick={() => void remove()}><Trash2 size={14} />删除碎片</button>}
        </div>
      </div>
      {error && <div className="library-notice error" role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></div>}

      {editing ? (
        <LibraryEditor initial={entry} kind={entry.kind} saving={saving} error={error} onCancel={() => setEditing(false)} onSave={saveEdit} />
      ) : (
        <>
          <header className="library-detail-head">
            <div className="library-card-topline"><span className={`library-kind-badge ${entry.kind}`}>{kindLabels[entry.kind]}</span><span className="library-type-label">{typeLabels[entry.type]}</span><span className="library-status-label">{statusLabels[entry.status]}</span></div>
            <h1>{title}</h1>
            <p>{entry.summary}</p>
            <div className="library-detail-meta"><span>更新于 {formatTime(entry.updatedAt)}</span><span>来源：{entry.sourceType}</span>{entry.tags.map(tag => <span className="library-tag" key={tag}>#{tag}</span>)}</div>
          </header>
          <div className="library-detail-layout">
            <article className="library-document">
              <div className="chat-markdown library-markdown" dangerouslySetInnerHTML={{ __html: entry.html || '' }} />
            </article>
            <aside className="library-detail-aside">
              <section className="library-aside-card"><strong>内容信息</strong><dl><dt>内容 ID</dt><dd>{entry.id}</dd><dt>哈希</dt><dd>{entry.contentHash.slice(0, 16)}…</dd><dt>创建</dt><dd>{formatTime(entry.createdAt)}</dd><dt>版本</dt><dd>{detail.versions.length || '—'}</dd></dl></section>
              <section className="library-aside-card"><strong>关联预留</strong><p>{detail.relations.calendarEvents.length ? '已有日程关联。' : '当前还没有关联日程。Calendar 联动接口已预留，留待下一阶段接入。'}</p></section>
              <section className="library-aside-card"><strong>来源</strong><p>{entry.sourceRef || '手工创建'}</p>{entry.sourceUrl && <a href={entry.sourceUrl} target="_blank" rel="noreferrer">打开来源</a>}</section>
            </aside>
          </div>
          <section className="library-comments">
            <div className="library-section-heading"><div><span className="library-eyebrow">REFLECTIONS</span><h2>评论与补充</h2></div><span>{detail.comments.length} 条</span></div>
            <div className="library-comment-compose"><textarea value={comment} onChange={event => setComment(event.target.value)} rows={3} placeholder="记录一个补充、反例或下一步验证点" /><button type="button" className="library-primary-button" onClick={() => void addComment()} disabled={commentSaving || !comment.trim()}><Send size={14} />{commentSaving ? '保存中…' : '添加评论'}</button></div>
            {detail.comments.length ? <div className="library-comment-list">{detail.comments.map(item => <div className="library-comment" key={item.id}><p>{item.content}</p><footer><span>{formatTime(item.createdAt)}</span><button type="button" onClick={() => void deleteComment(item.id)} aria-label="删除评论"><Trash2 size={13} /></button></footer></div>)}</div> : <div className="library-comment-empty">还没有评论或补充。</div>}
          </section>
        </>
      )}
    </div>
  );
}

export function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <LibraryDetailPage id={id} /> : <LibraryHomePage />;
}
