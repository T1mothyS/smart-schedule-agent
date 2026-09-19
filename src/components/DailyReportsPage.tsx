import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, FileText, Mail, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';

type EmailStatus = 'DISABLED' | 'QUEUED' | 'SENT' | 'FAILED';
type DailyReportSource = 'local' | 'cloud';
type DeliveryStatus = 'RECEIVED' | 'CANDIDATE';

interface DailyReportSummary {
  mediaReceipt?: { imageCount: number; candidateImageCount: number; mediaFailureCount: number; noImageReason: string | null; consecutiveNoImageReports: number; warnings: string[] } | null;
  id: string;
  date: string;
  headline: string | null;
  heroImageUrl: string | null;
  excerpt: string;
  contentHash: string;
  publishedAt: string;
  updatedAt: string;
  source: DailyReportSource;
  deliveryStatus: DeliveryStatus;
  emailStatus: EmailStatus;
  emailNotificationId: string | null;
}

interface DailyReport extends DailyReportSummary {
  markdown: string;
  html: string;
}

const INITIAL_REPORT_LIMIT = 8;
const HISTORY_PAGE_SIZE = 7;

const emailStatusLabel: Record<EmailStatus, string> = {
  DISABLED: '邮件未启用',
  QUEUED: '邮件排队中',
  SENT: '邮件已发送',
  FAILED: '邮件发送失败',
};

const sourceLabel: Record<DailyReportSource, string> = {
  local: '本地',
  cloud: 'Cloud',
};

const deliveryStatusLabel: Record<DeliveryStatus, string> = {
  RECEIVED: '已接收',
  CANDIDATE: '候选',
};

function normalizeReportSummary(value: any): DailyReportSummary {
  return {
    ...value,
    source: value?.source === 'cloud' ? 'cloud' : 'local',
    deliveryStatus: value?.deliveryStatus === 'CANDIDATE' ? 'CANDIDATE' : 'RECEIVED',
  };
}

function formatReportDate(value: string): string {
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

async function readError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = await response.json();
    return new Error(data.error || fallback);
  } catch {
    return new Error(fallback);
  }
}

export function DailyReportsPage() {
  const { authHeaders } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reports, setReports] = useState<DailyReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const viewMode = searchParams.get('view') === 'candidates' ? 'candidates' : 'received';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/daily-reports?limit=${INITIAL_REPORT_LIMIT}&offset=0&view=${viewMode}`, { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '日报加载失败');
      const result = await response.json();
      setReports((result.reports || []).map(normalizeReportSummary));
      setHasMore(Boolean(result.hasMore));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '日报加载失败');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, viewMode]);

  const loadMore = async () => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(`/api/daily-reports?limit=${HISTORY_PAGE_SIZE}&offset=${reports.length}&view=${viewMode}`, { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '更多日报加载失败');
      const result = await response.json();
      setReports(current => [...current, ...(result.reports || []).map(normalizeReportSummary)]);
      setHasMore(Boolean(result.hasMore));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '更多日报加载失败');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.isComposing || event.defaultPrevented) return;
      const openDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
        .some(dialog => dialog.getClientRects().length > 0);
      if (openDialog) return;
      event.preventDefault();
      navigate('/today');
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [navigate]);

  const switchView = (next: 'received' | 'candidates') => {
    if (next === viewMode) return;
    setReports([]);
    setHasMore(false);
    setSearchParams(next === 'candidates' ? { view: next } : {});
  };

  const openReport = (item: DailyReportSummary) => {
    navigate(`/reports/${encodeURIComponent(item.date)}?source=${item.source}&view=${viewMode}`);
  };

  const retryEmail = async (item: DailyReportSummary) => {
    if (!item.emailNotificationId || retryingId) return;
    if (!window.confirm('这会重新发送该日期的日报邮件，是否继续？')) return;
    setRetryingId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(item.emailNotificationId)}/retry`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!response.ok) throw await readError(response, '日报邮件重试失败');
      await load();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : '日报邮件重试失败');
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="daily-reports-page">
      <header className="daily-reports-header">
        <div>
          <div className="daily-reports-eyebrow">PRIVATE INTELLIGENCE</div>
          <h1>日报</h1>
          <p>{viewMode === 'received' ? '正式接收的日报会进入网页和邮件；来源由设置控制。' : '候选日报已经写入生产服务器，但当前未进入正式网页和邮件。'}</p>
        </div>
        <div className="daily-report-toolbar-actions">
          <div className="daily-report-view-toggle" role="tablist" aria-label="日报查看范围">
            <button type="button" role="tab" aria-selected={viewMode === 'received'} className={viewMode === 'received' ? 'active' : undefined} onClick={() => switchView('received')}>正式日报</button>
            <button type="button" role="tab" aria-selected={viewMode === 'candidates'} className={viewMode === 'candidates' ? 'active' : undefined} onClick={() => switchView('candidates')}>候选对照</button>
          </div>
          <button type="button" className="daily-report-toolbar-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : undefined} />
            刷新
          </button>
        </div>
      </header>

      {error && (
        <div className="daily-report-notice error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>重试</button>
        </div>
      )}

      {loading ? (
        <div className="daily-report-state"><RefreshCw size={22} className="spin" /><span>正在加载日报…</span></div>
      ) : error && reports.length === 0 ? (
        <div className="daily-report-state">
          <FileText size={30} />
          <strong>日报暂时无法加载</strong>
          <span>请使用上方“重试”重新读取。</span>
        </div>
      ) : reports.length > 0 ? (
        <div className="daily-reports-layout">
          {(() => {
            const [latest, ...history] = reports;
            const renderEmailRetry = (item: DailyReportSummary) => item.emailStatus === 'FAILED' && item.emailNotificationId ? (
              <div className="daily-report-card-footer">
                <span>邮件发送失败，可在此确认重试</span>
                <button
                  type="button"
                  className="daily-report-retry-button"
                  onClick={() => void retryEmail(item)}
                  disabled={retryingId === item.id}
                  aria-label={`重试 ${formatReportDate(item.date)} 日报邮件`}
                >
                  <RefreshCw size={14} className={retryingId === item.id ? 'spin' : undefined} />
                  {retryingId === item.id ? '重新排队中…' : '确认重试'}
                </button>
              </div>
            ) : null;
            return (
              <>
                <article className="daily-report-featured" key={latest.id}>
                  <button
                    type="button"
                    className="daily-report-featured-open"
                    onClick={() => openReport(latest)}
                    aria-label={`打开最新的 ${formatReportDate(latest.date)} 日报`}
                  >
                    {latest.heroImageUrl && <img className="daily-report-featured-hero" src={latest.heroImageUrl} alt="" aria-hidden="true" />}
                    <div className="daily-report-featured-body">
                      <div className="daily-report-featured-kicker">{viewMode === 'received' ? 'FRONT PAGE · 最新日报' : 'CANDIDATE DESK · 最新候选'}</div>
                      <div className="daily-report-card-topline">
                        <span className="daily-report-card-date">{formatReportDate(latest.date)}</span>
                        <span className="daily-report-source-meta">
                          <span className={`daily-report-source-badge ${latest.source}`}>{sourceLabel[latest.source]}</span>
                          <span className={`daily-report-delivery-status ${latest.deliveryStatus.toLowerCase()}`}>{deliveryStatusLabel[latest.deliveryStatus]}</span>
                          <span className={`daily-report-email-status ${latest.emailStatus.toLowerCase()}`}>
                            <Mail size={13} /> {emailStatusLabel[latest.emailStatus]}
                          </span>
                        </span>
                      </div>
                      {latest.headline && <h2 className="daily-report-featured-headline">{latest.headline}</h2>}
                      <p>{latest.excerpt || '这份日报没有可显示的摘要。'}</p>
                      <span className="daily-report-card-meta">更新于 {formatUpdatedAt(latest.updatedAt)} <span aria-hidden="true">→</span></span>
                    </div>
                  </button>
                  {renderEmailRetry(latest)}
                </article>

                {history.length > 0 && (
                  <section className="daily-report-history" aria-labelledby="daily-report-history-title">
                    <div className="daily-report-history-heading">
                      <div>
                        <div className="daily-reports-eyebrow">ARCHIVE</div>
                        <h2 id="daily-report-history-title">历史日报</h2>
                      </div>
                      <span>{history.length} 份已加载</span>
                    </div>
                    <div className="daily-reports-history-list">
                      {history.map(item => (
                        <article className="daily-report-card" key={item.id}>
                          <button
                            type="button"
                            className="daily-report-card-open"
                            onClick={() => openReport(item)}
                            aria-label={`打开 ${formatReportDate(item.date)} 日报`}
                          >
                            {item.heroImageUrl && <img className="daily-report-card-hero" src={item.heroImageUrl} alt="" aria-hidden="true" />}
                            <div className="daily-report-card-body">
                              <div className="daily-report-card-topline">
                                <span className="daily-report-card-date">{formatReportDate(item.date)}</span>
                                <span className="daily-report-source-meta">
                                  <span className={`daily-report-source-badge ${item.source}`}>{sourceLabel[item.source]}</span>
                                  <span className={`daily-report-delivery-status ${item.deliveryStatus.toLowerCase()}`}>{deliveryStatusLabel[item.deliveryStatus]}</span>
                                  <span className={`daily-report-email-status ${item.emailStatus.toLowerCase()}`}>
                                    <Mail size={13} /> {emailStatusLabel[item.emailStatus]}
                                  </span>
                                </span>
                              </div>
                              {item.headline && <h3 className="daily-report-card-headline">{item.headline}</h3>}
                              <p>{item.excerpt || '这份日报没有可显示的摘要。'}</p>
                              <span className="daily-report-card-meta">更新于 {formatUpdatedAt(item.updatedAt)} <span aria-hidden="true">→</span></span>
                            </div>
                          </button>
                          {renderEmailRetry(item)}
                        </article>
                      ))}
                    </div>
                  </section>
                )}
                {hasMore && (
                  <button type="button" className="daily-report-load-more" onClick={() => void loadMore()} disabled={loadingMore}>
                    <RefreshCw size={15} className={loadingMore ? 'spin' : undefined} />
                    {loadingMore ? '正在加载…' : `加载更多 ${HISTORY_PAGE_SIZE} 份日报`}
                  </button>
                )}
              </>
            );
          })()}
        </div>
      ) : (
        <div className="daily-report-state">
          <FileText size={34} />
          <strong>{viewMode === 'received' ? '还没有正式日报' : '还没有候选日报'}</strong>
          <span>{viewMode === 'received' ? '日报项目发布后，会按日期显示在这里。' : '未勾选来源的有效日报会保存在这里，供后续对照。'}</span>
        </div>
      )}
    </div>
  );
}

export function DailyReportReaderPage() {
  // This route bypasses AppContent; restore the saved theme on direct opens too.
  useTheme();
  const { authHeaders } = useAuth();
  const navigate = useNavigate();
  const { date } = useParams<{ date: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSource = searchParams.get('source') === 'cloud' || searchParams.get('source') === 'local'
    ? searchParams.get('source') as DailyReportSource
    : undefined;
  const requestedView = searchParams.get('view') === 'candidates' ? 'candidates' : 'received';
  const [report, setReport] = useState<DailyReport | null>(null);
  const [dateReports, setDateReports] = useState<DailyReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    setDateReports([]);
    try {
      if (!date) throw new Error('日报日期无效');
      const query = new URLSearchParams();
      if (requestedSource) query.set('source', requestedSource);
      query.set('view', requestedView);
      const sourceQuery = `?${query.toString()}`;
      const response = await fetch(`/api/daily-reports/${encodeURIComponent(date)}${sourceQuery}`, { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '日报加载失败');
      const result = await response.json();
      setReport(result.report ? normalizeReportSummary(result.report) as DailyReport : null);
      setDateReports((result.reports || []).map(normalizeReportSummary));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '日报加载失败');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, date, requestedSource, requestedView]);

  useEffect(() => { void load(); }, [load]);

  const returnToList = useCallback(() => {
    navigate(requestedView === 'candidates' ? '/reports?view=candidates' : '/reports');
  }, [navigate, requestedView]);

  const closeMoreMenu = useCallback(() => {
    setMoreMenuOpen(false);
    window.setTimeout(() => moreButtonRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (moreMenuRef.current?.contains(target) || moreButtonRef.current?.contains(target))) return;
      closeMoreMenu();
    };
    const handleMenuEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      closeMoreMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleMenuEscape, true);
    const firstAction = moreMenuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"], button:not(:disabled)');
    firstAction?.focus();
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleMenuEscape, true);
    };
  }, [closeMoreMenu, moreMenuOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      if (moreMenuOpen) closeMoreMenu();
      else returnToList();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closeMoreMenu, moreMenuOpen, returnToList]);

  useEffect(() => {
    if (!report) setMoreMenuOpen(false);
  }, [report]);

  const isNewsletter = report?.html.includes('daily-newsletter') === true;

  const chooseSource = (source: DailyReportSource) => {
    closeMoreMenu();
    setSearchParams({ source, view: requestedView });
  };

  const sendEmail = async () => {
    if (!date || !report || report.deliveryStatus !== 'RECEIVED' || sendingEmail) return;
    if (!window.confirm(`将把 ${formatReportDate(date)} 的当前日报重新发送到已配置的收件邮箱，是否继续？`)) return;
    setSendingEmail(true);
    setError(null);
    try {
      const response = await fetch(`/api/daily-reports/${encodeURIComponent(date)}/send`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, source: report.source }),
      });
      if (!response.ok) throw await readError(response, '日报邮件发送失败');
      await load();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '日报邮件发送失败');
    } finally {
      setSendingEmail(false);
    }
  };

  const availableSourceReports = dateReports.filter(item => item.deliveryStatus === (requestedView === 'candidates' ? 'CANDIDATE' : 'RECEIVED'));
  const sourceOptions = availableSourceReports.length ? availableSourceReports : report ? [report] : [];

  return (
    <main className="daily-report-reader-page">
      <div className="daily-report-reader-toolbar">
        <div className="daily-report-reader-toolbar-row">
          <button type="button" className="daily-report-back" onClick={returnToList} aria-label="返回日报列表">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>返回日报</span>
          </button>
          <div className="daily-report-more-wrap">
            <button
              ref={moreButtonRef}
              type="button"
              className="daily-report-more-button"
              onClick={() => setMoreMenuOpen(open => !open)}
              disabled={!report}
              aria-expanded={moreMenuOpen}
              aria-controls="daily-report-more-menu"
              aria-haspopup="menu"
            >
              <MoreHorizontal size={17} aria-hidden="true" />
              <span>更多</span>
            </button>
            {moreMenuOpen && report && (
              <div ref={moreMenuRef} id="daily-report-more-menu" className="daily-report-more-menu" role="menu" aria-label="日报更多操作">
                <div className="daily-report-menu-field">
                  <span className="daily-report-menu-label">来源</span>
                  <div className="daily-report-source-menu-list" aria-label="来源与接收状态">
                    {sourceOptions.length === 1 ? (
                      <div className="daily-report-source-menu-single" role="status">
                        <Check size={14} aria-hidden="true" />
                        <span>{sourceLabel[sourceOptions[0].source]} · {deliveryStatusLabel[sourceOptions[0].deliveryStatus]}</span>
                      </div>
                    ) : sourceOptions.map(item => (
                      <button
                        key={item.source}
                        type="button"
                        role="menuitemradio"
                        aria-checked={item.source === report.source}
                        className={`daily-report-source-menu-option${item.source === report.source ? ' active' : ''}`}
                        onClick={() => chooseSource(item.source)}
                      >
                        <span className="daily-report-source-menu-check" aria-hidden="true">{item.source === report.source && <Check size={14} />}</span>
                        <span>{sourceLabel[item.source]} · {deliveryStatusLabel[item.deliveryStatus]}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="daily-report-menu-status-row">
                  <span className="daily-report-menu-label">邮件状态</span>
                  <span className={`daily-report-email-status ${report.emailStatus.toLowerCase()}`}><Mail size={13} />{emailStatusLabel[report.emailStatus]}</span>
                </div>
                {report.deliveryStatus === 'RECEIVED' ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="daily-report-send-button daily-report-menu-send"
                    onClick={() => void sendEmail()}
                    disabled={sendingEmail}
                    aria-label={`手动发送 ${formatReportDate(report.date)} ${sourceLabel[report.source]}日报邮件`}
                  >
                    <Mail size={14} />
                    {sendingEmail ? '正在排队…' : report.emailStatus === 'SENT' ? '重新发送邮件' : '发送日报邮件'}
                  </button>
                ) : <span className="daily-report-candidate-note">已写入生产服务器，当前设置未接收</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="daily-report-reader-state"><RefreshCw size={22} className="spin" /><span>正在加载日报…</span></div>
      ) : error ? (
        <div className="daily-report-reader-state" role="alert">
          <FileText size={30} />
          <strong>日报暂时无法加载</strong>
          <span>{error}</span>
          <button type="button" className="daily-report-retry-button" onClick={() => void load()}>重试</button>
        </div>
      ) : report ? (
        <div className={`daily-report-reader-content ${isNewsletter ? 'is-newsletter' : 'is-legacy'}`}>
          {report.mediaReceipt?.warnings.includes('NO_IMAGES') && <div className="daily-report-notice media" role="status">
            本篇暂无配图。{report.mediaReceipt.mediaFailureCount > 0 ? '图片获取或校验未全部成功。' : report.mediaReceipt.noImageReason === 'no_reliable_source' ? '已检索，但没有找到可靠且相关的图片。' : report.mediaReceipt.noImageReason === 'search_unavailable' ? '本次图片检索不可用。' : '生成端尚未说明未配图的原因。'}
            {report.mediaReceipt.warnings.includes('REPEATED_NO_IMAGES') && `最近连续 ${report.mediaReceipt.consecutiveNoImageReports} 篇同来源日报无图，需要检查选图步骤。`}
            {report.mediaReceipt.warnings.includes('REPLACES_ILLUSTRATED_REPORT') && '同日上一版曾有配图，本版没有沿用旧图。'}
          </div>}
          {report.deliveryStatus === 'CANDIDATE' && <div className="daily-report-notice candidate" role="status">这份 {sourceLabel[report.source]} 日报已经正式写入生产服务器，但按当前设置暂不进入正式网页和邮件。勾选该来源并保存后，下一次正式发布起才会接收。</div>}
          <div className="daily-report-markdown daily-report-reader-markdown" dangerouslySetInnerHTML={{ __html: report.html }} />
        </div>
      ) : (
        <div className="daily-report-reader-state">
          <FileText size={30} />
          <strong>找不到这一天的日报</strong>
          <span>请返回列表选择已有日期。</span>
        </div>
      )}
    </main>
  );
}
