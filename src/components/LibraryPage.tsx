import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Download, Link2, RefreshCw, Search, Send, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

type LibraryKind = 'fragment' | 'article';
type LibraryType = 'knowledge' | 'insight' | 'framework' | 'experience' | 'tutorial' | 'reference';
type LibraryStatus = 'draft' | 'active' | 'archived';
type RelationStatus = 'confirmed' | 'suggested' | 'unresolved';

interface LibraryRelation {
  sourceId: string;
  targetSourceId: string;
  type: string;
  label: string;
  status: RelationStatus;
}

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
  relations: LibraryRelation[];
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
  relations: LibraryRelation[];
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
  relations: { items: LibraryRelation[]; calendarEvents: string[]; libraryEntries: string[] };
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
const relationStatusLabels: Record<RelationStatus, string> = { confirmed: '已确认', suggested: '待确认', unresolved: '未解析' };

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

async function downloadResponse(response: Response, fallbackName: string): Promise<void> {
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const filename = encoded ? decodeURIComponent(encoded) : fallbackName;
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to a temporary textarea when clipboard permission is unavailable.
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { copied = false; }
  textarea.remove();
  return copied;
}

function relationItems(detail: LibraryDetail): LibraryRelation[] {
  return detail.relations?.items || detail.entry.relations || [];
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

  useEffect(() => { void load(); }, [load]);

  const downloadFullExport = async () => {
    try {
      const response = await fetch('/api/library/export', { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '全库导出失败');
      await downloadResponse(response, 'library-export.json');
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : '全库导出失败');
    }
  };

  return (
    <div className="library-page">
      <header className="library-header">
        <div>
          <span className="library-eyebrow">READ-ONLY LIBRARY</span>
          <h1>知识库</h1>
          <p>内容在本地知识库 V2 加工后发布；这里负责阅读、评论、关联查看和导出。</p>
        </div>
        <div className="library-header-actions">
          <button type="button" className="library-secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : undefined} />刷新</button>
          <button type="button" className="library-primary-button" onClick={() => void downloadFullExport()}><Download size={14} />导出全库</button>
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

      <div className="library-list-meta"><span>{loading ? '正在加载…' : `显示 ${entries.length} 条，共 ${total} 条`}</span><span>默认按最近更新排序</span></div>
      {loading ? (
        <div className="library-state"><RefreshCw size={24} className="spin" /><span>正在加载知识库…</span></div>
      ) : entries.length ? (
        <div className="library-grid">
          {entries.map(entry => <LibraryCard key={entry.id} entry={entry} onOpen={() => navigate(`/library/${entry.id}`)} />)}
        </div>
      ) : (
        <div className="library-state"><BookOpen size={34} /><strong>还没有符合条件的内容</strong><span>请在知识库V2项目中处理材料后，通过本地发布脚本上传。</span></div>
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
  const [comment, setComment] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const markdownRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const root = markdownRef.current;
    if (!root) return;
    const buttons: HTMLButtonElement[] = [];
    root.querySelectorAll('pre').forEach(pre => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-code-copy';
      button.textContent = '复制';
      button.setAttribute('aria-label', '复制代码');
      button.addEventListener('click', async () => {
        const code = pre.querySelector('code')?.textContent || pre.textContent || '';
        const copied = await copyText(code);
        button.textContent = copied ? '已复制' : '复制失败';
        window.setTimeout(() => { button.textContent = '复制'; }, 1500);
      });
      pre.appendChild(button);
      buttons.push(button);
    });
    return () => { buttons.forEach(button => button.remove()); };
  }, [detail?.entry.html]);

  const exportMarkdown = async () => {
    try {
      const response = await fetch(`/api/library/${encodeURIComponent(id)}/export`, { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '导出失败');
      await downloadResponse(response, `${detail?.entry.slug || id}.md`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '导出失败');
    }
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
  const relations = relationItems(detail);

  return (
    <div className="library-page library-detail-page">
      <div className="library-detail-toolbar">
        <button type="button" className="library-back-button" onClick={() => navigate('/library')}><ArrowLeft size={15} />返回知识库</button>
        <div className="library-header-actions">
          <button type="button" className="library-secondary-button" onClick={() => void exportMarkdown()}><Download size={14} />导出 Markdown</button>
        </div>
      </div>
      {error && <div className="library-notice error" role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></div>}

      <header className="library-detail-head">
        <div className="library-card-topline"><span className={`library-kind-badge ${entry.kind}`}>{kindLabels[entry.kind]}</span><span className="library-type-label">{typeLabels[entry.type]}</span><span className="library-status-label">{statusLabels[entry.status]}</span></div>
        <h1>{title}</h1>
        <p>{entry.summary}</p>
        <div className="library-detail-meta"><span>更新于 {formatTime(entry.updatedAt)}</span><span>来源：{entry.sourceType}</span>{entry.tags.map(tag => <span className="library-tag" key={tag}>#{tag}</span>)}</div>
      </header>
      <div className="library-detail-layout">
        <article className="library-document">
          <div ref={markdownRef} className="chat-markdown library-markdown" dangerouslySetInnerHTML={{ __html: entry.html || '' }} />
        </article>
        <aside className="library-detail-aside">
          <section className="library-aside-card"><strong>内容信息</strong><dl><dt>内容 ID</dt><dd>{entry.id}</dd><dt>sourceId</dt><dd>{entry.sourceId || '—'}</dd><dt>哈希</dt><dd>{entry.contentHash.slice(0, 16)}…</dd><dt>创建</dt><dd>{formatTime(entry.createdAt)}</dd><dt>版本</dt><dd>{detail.versions.length || '—'}</dd></dl></section>
          <section className="library-aside-card"><strong><Link2 size={14} />关联</strong>{relations.length ? <div className="library-relation-list">{relations.map((relation, index) => <div className="library-relation" key={`${relation.targetSourceId}-${index}`}><span className={`library-relation-status ${relation.status}`}>{relationStatusLabels[relation.status]}</span><span>{relation.label}</span><code>{relation.targetSourceId}</code></div>)}</div> : <p>当前没有本地关联。未解析目标不会被伪装成可用链接。</p>}</section>
          <section className="library-aside-card"><strong>来源</strong><p>{entry.sourceRef || '本地知识库 V2 发布'}</p>{entry.sourceUrl && <a href={entry.sourceUrl} target="_blank" rel="noreferrer">打开来源</a>}</section>
        </aside>
      </div>

      <section className="library-versions">
        <div className="library-section-heading"><div><span className="library-eyebrow">VERSIONS</span><h2>版本记录</h2></div><span>{detail.versions.length} 个版本</span></div>
        {detail.versions.length ? <div className="library-version-list">{detail.versions.map(version => <details key={version.id} className="library-version"><summary><span>{formatTime(version.createdAt)}</span><code>{version.contentHash.slice(0, 16)}…</code></summary><pre>{version.content}</pre></details>)}</div> : <div className="library-comment-empty">暂无历史版本。</div>}
      </section>

      <section className="library-comments">
        <div className="library-section-heading"><div><span className="library-eyebrow">REFLECTIONS</span><h2>评论与补充</h2></div><span>{detail.comments.length} 条</span></div>
        <div className="library-comment-compose"><textarea value={comment} onChange={event => setComment(event.target.value)} rows={3} placeholder="记录一个补充、反例或下一步验证点" /><button type="button" className="library-primary-button" onClick={() => void addComment()} disabled={commentSaving || !comment.trim()}><Send size={14} />{commentSaving ? '保存中…' : '添加评论'}</button></div>
        {detail.comments.length ? <div className="library-comment-list">{detail.comments.map(item => <div className="library-comment" key={item.id}><p>{item.content}</p><footer><span>{formatTime(item.createdAt)}</span><button type="button" onClick={() => void deleteComment(item.id)} aria-label="删除评论"><Trash2 size={13} /></button></footer></div>)}</div> : <div className="library-comment-empty">还没有评论或补充。</div>}
      </section>
    </div>
  );
}

export function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <LibraryDetailPage id={id} /> : <LibraryHomePage />;
}
