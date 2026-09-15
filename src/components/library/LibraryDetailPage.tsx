import { ArrowLeft, BookOpen, Download, Link2, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { buildLibraryToc, copyText, downloadResponse, formatTime, kindLabels, LibraryDetail, LibraryTocItem, readError, relationItems, relationStatusLabels, richContentSource, showRichContentError, statusLabels, typeLabels } from './library-shared';

let libraryMermaidRenderId = 0;

export function LibraryDetailPage({ id }: { id: string }) {
  const { authHeaders } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<LibraryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const [tocItems, setTocItems] = useState<LibraryTocItem[]>([]);
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  const detailPageRef = useRef<HTMLDivElement | null>(null);
  const markdownRef = useRef<HTMLDivElement | null>(null);
  const tocRef = useRef<HTMLElement | null>(null);
  const entryTitle = detail?.entry.title || detail?.entry.summary || '';

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
    let cancelled = false;
    let renderGeneration = 0;

    const isCurrent = (generation: number): boolean => !cancelled && generation === renderGeneration;

    const renderRichContent = async () => {
      const generation = ++renderGeneration;
      const mathHosts = Array.from(root.querySelectorAll<HTMLElement>('[data-library-math]'));
      let katex: typeof import('katex').default | undefined;
      if (mathHosts.length) {
        try {
          katex = (await import('./katex-renderer')).default;
        } catch {
          if (!isCurrent(generation)) return;
          mathHosts.forEach(host => {
            const sourceElement = richContentSource(host);
            if (sourceElement) showRichContentError(host, sourceElement, '公式组件加载失败，已保留原始公式源码。', 'library-math-error');
          });
        }
      }
      if (!isCurrent(generation)) return;
      for (const host of katex ? mathHosts : []) {
        if (!isCurrent(generation)) return;
        const sourceElement = richContentSource(host);
        if (!sourceElement) continue;
        const source = sourceElement.textContent || '';
        const displayMode = host.dataset.libraryMath === 'display';
        try {
          const rendered = document.createElement(displayMode ? 'div' : 'span');
          rendered.className = 'library-rich-content-rendered';
          rendered.innerHTML = katex!.renderToString(source, {
            displayMode,
            throwOnError: false,
            trust: false,
            strict: 'ignore',
          });
          sourceElement.hidden = true;
          host.classList.remove('library-rich-content-error');
          host.replaceChildren(rendered, sourceElement);
        } catch {
          if (isCurrent(generation)) showRichContentError(host, sourceElement, '公式暂时无法渲染，已保留原始公式源码。', 'library-math-error');
        }
      }

      const mermaidHosts = Array.from(root.querySelectorAll<HTMLElement>('[data-library-mermaid]'));
      if (!mermaidHosts.length) return;

      let mermaid: typeof import('mermaid').default;
      try {
        mermaid = (await import('mermaid')).default;
      } catch {
        if (!isCurrent(generation)) return;
        mermaidHosts.forEach(host => {
          const sourceElement = richContentSource(host);
          if (sourceElement) showRichContentError(host, sourceElement, '流程图组件加载失败，已保留原始 Mermaid 源码。', 'library-mermaid-error');
        });
        return;
      }
      if (!isCurrent(generation)) return;

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
        flowchart: { htmlLabels: true, useMaxWidth: true },
      });

      for (const host of mermaidHosts) {
        if (!isCurrent(generation)) return;
        const sourceElement = richContentSource(host);
        if (!sourceElement) continue;
        const source = sourceElement.textContent || '';
        try {
          const result = await mermaid.render(`library-mermaid-${++libraryMermaidRenderId}`, source.replace(/\\n/g, '<br/>'));
          if (!isCurrent(generation)) return;
          const rendered = document.createElement('div');
          rendered.className = 'library-mermaid-rendered';
          rendered.setAttribute('role', 'img');
          rendered.setAttribute('aria-label', 'Mermaid 流程图');
          rendered.innerHTML = result.svg;
          sourceElement.hidden = true;
          host.classList.remove('library-rich-content-error');
          host.replaceChildren(rendered, sourceElement);
        } catch {
          if (isCurrent(generation)) showRichContentError(host, sourceElement, '流程图暂时无法渲染，已保留原始 Mermaid 源码。', 'library-mermaid-error');
        }
      }
    };

    void renderRichContent();
    const themeObserver = new MutationObserver(() => { void renderRichContent(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      cancelled = true;
      themeObserver.disconnect();
    };
  }, [detail?.entry.html]);

  useEffect(() => {
    const root = markdownRef.current;
    if (!root || !detail) return;
    const nextItems = buildLibraryToc(root, entryTitle);
    setTocItems(nextItems);
    setActiveTocId(nextItems[0]?.id || null);
  }, [detail, entryTitle]);

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

  useEffect(() => {
    const scrollRoot = detailPageRef.current;
    if (!scrollRoot || !tocItems.length) return;

    const updateActiveHeading = () => {
      const rootRect = scrollRoot.getBoundingClientRect();
      const compactOffset = scrollRoot.clientWidth <= 1100 ? 88 : 24;
      const threshold = rootRect.top + compactOffset;
      let currentId = tocItems[0].id;
      for (const item of tocItems) {
        const heading = document.getElementById(item.id);
        if (!heading) continue;
        if (heading.getBoundingClientRect().top <= threshold) currentId = item.id;
        else break;
      }
      setActiveTocId(current => current === currentId ? current : currentId);
    };

    scrollRoot.addEventListener('scroll', updateActiveHeading, { passive: true });
    window.addEventListener('resize', updateActiveHeading);
    updateActiveHeading();
    return () => {
      scrollRoot.removeEventListener('scroll', updateActiveHeading);
      window.removeEventListener('resize', updateActiveHeading);
    };
  }, [tocItems]);

  useEffect(() => {
    if (!activeTocId) return;
    const target = Array.from(tocRef.current?.querySelectorAll<HTMLElement>('[data-toc-id]') || [])
      .find(item => item.dataset.tocId === activeTocId);
    target?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [activeTocId]);

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

  const scrollToHeading = (item: LibraryTocItem) => {
    const scrollRoot = detailPageRef.current;
    const heading = document.getElementById(item.id);
    if (!scrollRoot || !heading) return;
    const rootRect = scrollRoot.getBoundingClientRect();
    const tocHeight = scrollRoot.clientWidth <= 1100 ? (tocRef.current?.getBoundingClientRect().height || 52) + 12 : 24;
    const top = scrollRoot.scrollTop + heading.getBoundingClientRect().top - rootRect.top - tocHeight;
    scrollRoot.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    setActiveTocId(item.id);
  };

  if (loading) return <div className="library-page"><div className="library-state"><RefreshCw size={24} className="spin" /><span>正在加载知识详情…</span></div></div>;
  if (error && !detail) return <div className="library-page"><div className="library-state" role="alert"><BookOpen size={30} /><strong>知识详情暂时无法加载</strong><span>{error}</span><button type="button" className="library-secondary-button" onClick={() => void load()}>重试</button></div></div>;
  if (!detail) return null;
  const entry = detail.entry;
  const title = entry.title || entry.summary || '未命名知识碎片';
  const relations = relationItems(detail);

  return (
    <div ref={detailPageRef} className="library-page library-detail-page">
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
        {tocItems.length > 0 && (
          <nav ref={tocRef} className="library-toc" aria-label="文章章节导航">
            <div className="library-toc-heading"><span className="library-eyebrow">CONTENTS</span><strong>章节导航</strong></div>
            <div className="library-toc-list">
              {tocItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  data-toc-id={item.id}
                  className={`library-toc-item${item.level === tocItems[0].level ? ' is-major' : ' is-sub'}${activeTocId === item.id ? ' active' : ''}`}
                  aria-current={activeTocId === item.id ? 'location' : undefined}
                  onClick={() => scrollToHeading(item)}
                >
                  {item.title}
                </button>
              ))}
            </div>
          </nav>
        )}
        <article className="library-document">
          <div ref={markdownRef} className="chat-markdown library-markdown" dangerouslySetInnerHTML={{ __html: entry.html || '' }} />
        </article>
        <aside className="library-detail-aside">
          <section className="library-aside-card"><strong>内容信息</strong><dl><dt>内容 ID</dt><dd>{entry.id}</dd><dt>sourceId</dt><dd>{entry.sourceId || '—'}</dd><dt>哈希</dt><dd>{entry.contentHash.slice(0, 16)}…</dd><dt>创建</dt><dd>{formatTime(entry.createdAt)}</dd><dt>版本</dt><dd>{detail.versions.length || '—'}</dd></dl></section>
          <section className="library-aside-card"><strong><Link2 size={14} />关联</strong><p className="library-relation-help">关联由知识库 V2 的 <code>relations.json</code> 维护。已确认可直接查看目标，待确认仅供复核，未解析不会伪装成链接。</p>{relations.length ? <div className="library-relation-list">{relations.map((relation, index) => <div className="library-relation" key={`${relation.targetSourceId}-${index}`}><span className={`library-relation-status ${relation.status}`}>{relationStatusLabels[relation.status]}</span><span>{relation.label}</span>{relation.targetEntryId ? <a className="library-relation-target" href={`/library/${encodeURIComponent(relation.targetEntryId)}`}>{relation.targetTitle || relation.targetSourceId}</a> : <span className="library-relation-unresolved">{relation.targetStatus === 'archived' ? '目标已归档' : '目标尚未解析'}</span>}<code>{relation.targetSourceId}</code></div>)}</div> : <p>当前没有本地关联。</p>}</section>
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
