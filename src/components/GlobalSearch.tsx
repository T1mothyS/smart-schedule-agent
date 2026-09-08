import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CalendarDays, FileText, Loader2, Search, StickyNote, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

type SearchResultType = 'schedule' | 'note' | 'report' | 'library';

interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  snippet: string;
  date?: string;
  target: { path: string };
  metadata?: Record<string, unknown>;
}

interface SearchResponse {
  results: SearchResult[];
  counts: Record<SearchResultType, number>;
}

const TYPE_LABELS: Record<SearchResultType, string> = {
  schedule: '日程',
  note: '记事',
  report: '日报',
  library: '知识库',
};

const TYPE_ICONS: Record<SearchResultType, typeof CalendarDays> = {
  schedule: CalendarDays,
  note: StickyNote,
  report: FileText,
  library: BookOpen,
};

const TYPE_ORDER: SearchResultType[] = ['schedule', 'note', 'report', 'library'];

export function GlobalSearch() {
  const navigate = useNavigate();
  const { authHeaders } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [open]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const value = query.trim();
    if (!value) {
      setResponse(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: value, scope: 'all', limit: '40' });
        const result = await fetch(`/api/search?${params.toString()}`, { headers: authHeaders() });
        if (!result.ok) throw new Error('搜索暂时不可用');
        const payload = await result.json() as SearchResponse;
        if (!cancelled) setResponse(payload);
      } catch (loadError) {
        if (!cancelled) {
          setResponse(null);
          setError(loadError instanceof Error ? loadError.message : '搜索暂时不可用');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authHeaders, open, query]);

  const grouped = useMemo(() => {
    const groups = new Map<SearchResultType, SearchResult[]>();
    for (const result of response?.results || []) {
      const current = groups.get(result.type) || [];
      current.push(result);
      groups.set(result.type, current);
    }
    return groups;
  }, [response]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setResponse(null);
    setError(null);
  };

  const openResult = (result: SearchResult) => {
    close();
    navigate(result.target.path);
  };

  return (
    <>
      <button
        type="button"
        className="global-search-trigger"
        onClick={() => setOpen(true)}
        aria-label="打开全局搜索"
        aria-haspopup="dialog"
      >
        <Search size={16} aria-hidden="true" />
        <span>搜索</span>
        <kbd>Ctrl K</kbd>
      </button>

      {open && (
        <div className="global-search-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
          <section className="global-search-dialog" role="dialog" aria-modal="true" aria-labelledby="global-search-title">
            <div className="global-search-head">
              <div className="global-search-input-wrap">
                <Search size={18} aria-hidden="true" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="搜索日程、记事、日报或知识库"
                  aria-label="搜索日程、记事、日报或知识库"
                />
                {loading && <Loader2 size={16} className="spin" aria-label="搜索中" />}
              </div>
              <button type="button" className="global-search-close" onClick={close} aria-label="关闭搜索"><X size={18} /></button>
            </div>
            <div className="global-search-body">
              <h2 id="global-search-title">统一搜索</h2>
              {!query.trim() && <p className="global-search-hint">输入关键词，搜索你的日程、记事、日报和知识库。</p>}
              {error && <p className="global-search-state error" role="alert">{error}</p>}
              {!error && query.trim() && !loading && response && response.results.length === 0 && (
                <p className="global-search-state">没有找到匹配内容。</p>
              )}
              <div className="global-search-results">
                {TYPE_ORDER.map(type => {
                  const items = grouped.get(type) || [];
                  if (!items.length) return null;
                  const Icon = TYPE_ICONS[type];
                  return (
                    <section key={type} className="global-search-group" aria-labelledby={`global-search-group-${type}`}>
                      <div className="global-search-group-title" id={`global-search-group-${type}`}>
                        <span><Icon size={14} />{TYPE_LABELS[type]}</span>
                        <em>{response?.counts?.[type] || items.length}</em>
                      </div>
                      <div className="global-search-result-list">
                        {items.map(item => (
                          <button key={`${item.type}-${item.id}`} type="button" className="global-search-result" onClick={() => openResult(item)}>
                            <span className="global-search-result-main">
                              <strong>{item.title}</strong>
                              <span>{item.snippet || '打开查看详情'}</span>
                            </span>
                            <span className="global-search-result-meta">
                              {item.date && <small>{item.type === 'schedule' ? item.date : item.date.slice(0, 10)}</small>}
                              <ArrowRight size={15} aria-hidden="true" />
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
