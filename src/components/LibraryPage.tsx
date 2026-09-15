import { BookOpen, Download, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { lazy, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { FeatureBoundary } from './FeatureBoundary';
import { DEFAULT_LIBRARY_SORT, downloadResponse, formatTime, isLibrarySort, kindLabels, LibraryEntry, LibraryKind, LibrarySort, LibraryType, readError, sortLabels, statusLabels, typeLabels } from './library/library-shared';
import './library/library.css';

const LibraryDetailPage = lazy(() => import('./library/LibraryDetailPage').then(module => ({ default: module.LibraryDetailPage })));

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
  const [sort, setSort] = useState<LibrarySort>(DEFAULT_LIBRARY_SORT);
  const [sortPreferenceReady, setSortPreferenceReady] = useState(false);
  const [sortSaving, setSortSaving] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPreference = useCallback(async () => {
    setSortPreferenceReady(false);
    setPreferenceError(null);
    try {
      const response = await fetch('/api/library/preferences', { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '排序偏好加载失败');
      const data = await response.json();
      const nextSort = data?.preference?.sort;
      if (!isLibrarySort(nextSort)) throw new Error('服务返回的排序偏好无效');
      setSort(nextSort);
    } catch (preferenceLoadError) {
      setSort(DEFAULT_LIBRARY_SORT);
      const message = preferenceLoadError instanceof Error ? preferenceLoadError.message : '排序偏好加载失败';
      setPreferenceError(`排序偏好加载失败，已使用默认排序：${message}`);
    } finally {
      setSortPreferenceReady(true);
    }
  }, [authHeaders]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, kind, type, sort, pageSize: '100' });
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
  }, [authHeaders, kind, query, sort, status, type]);

  useEffect(() => { void loadPreference(); }, [loadPreference]);
  useEffect(() => { if (sortPreferenceReady) void load(); }, [load, sortPreferenceReady]);

  const saveSortPreference = async (nextSort: LibrarySort) => {
    if (!sortPreferenceReady || sortSaving || nextSort === sort) return;
    setSortSaving(true);
    setPreferenceError(null);
    try {
      const response = await fetch('/api/library/preferences', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort: nextSort }),
      });
      if (!response.ok) throw await readError(response, '排序偏好保存失败');
      const data = await response.json();
      const savedSort = data?.preference?.sort;
      if (!isLibrarySort(savedSort)) throw new Error('服务返回的排序偏好无效');
      setSort(savedSort);
    } catch (preferenceSaveError) {
      const message = preferenceSaveError instanceof Error ? preferenceSaveError.message : '排序偏好保存失败';
      setPreferenceError(`排序偏好保存失败，当前仍按${sortLabels[sort]}显示：${message}`);
    } finally {
      setSortSaving(false);
    }
  };

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

      {preferenceError && <div className="library-notice error" role="alert">{preferenceError}<button type="button" onClick={() => void loadPreference()}>重试排序偏好</button></div>}
      {error && <div className="library-notice error" role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></div>}

      <section className="library-toolbar" aria-label="知识库筛选">
        <form className="library-search" onSubmit={event => { event.preventDefault(); setQuery(searchText); }}>
          <Search size={16} aria-hidden="true" />
          <input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="搜索标题、摘要、正文或标签" aria-label="搜索知识库" />
          <button type="submit">搜索</button>
        </form>
        <div className="library-filters">
          <select value={type} onChange={event => setType(event.target.value as typeof type)} aria-label="筛选内容类型">
            <option value="all">全部类型</option>{(Object.keys(typeLabels) as LibraryType[]).map(option => <option key={option} value={option}>{typeLabels[option]}</option>)}
          </select>
          <details className="library-filter-more">
            <summary><SlidersHorizontal size={14} aria-hidden="true" />更多筛选{(kind !== 'all' || status !== 'active') && <span className="library-filter-active-dot" aria-label="已有更多筛选条件" />}</summary>
            <div className="library-filter-more-panel">
              <label>形态<select value={kind} onChange={event => setKind(event.target.value as typeof kind)} aria-label="筛选内容形态">
                <option value="all">全部形态</option><option value="article">正式知识</option><option value="fragment">知识碎片</option>
              </select></label>
              <label>有效性<select value={status} onChange={event => setStatus(event.target.value as typeof status)} aria-label="筛选内容状态">
                <option value="active">有效内容</option><option value="draft">草稿</option><option value="archived">已归档</option><option value="all">全部状态</option>
              </select></label>
            </div>
          </details>
          <select className="library-sort-select" value={sort} onChange={event => void saveSortPreference(event.target.value as LibrarySort)} disabled={!sortPreferenceReady || sortSaving} aria-busy={sortSaving} aria-label="知识库排序">
            {(Object.keys(sortLabels) as LibrarySort[]).map(option => <option key={option} value={option}>{sortLabels[option]}</option>)}
          </select>
        </div>
      </section>

      <div className="library-list-meta"><span>{loading ? '正在加载…' : `显示 ${entries.length} 条，共 ${total} 条`}</span><span>当前按{sortLabels[sort]}</span></div>
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
export function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <FeatureBoundary key={id}><LibraryDetailPage id={id} /></FeatureBoundary> : <LibraryHomePage />;
}
