import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, FileText, Mail, RefreshCw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

type EmailStatus = 'DISABLED' | 'QUEUED' | 'SENT' | 'FAILED';

interface DailyReportSummary {
  id: string;
  date: string;
  excerpt: string;
  contentHash: string;
  publishedAt: string;
  updatedAt: string;
  emailStatus: EmailStatus;
  emailNotificationId: string | null;
}

interface DailyReport extends DailyReportSummary {
  markdown: string;
  html: string;
}

const emailStatusLabel: Record<EmailStatus, string> = {
  DISABLED: '邮件未启用',
  QUEUED: '邮件排队中',
  SENT: '邮件已发送',
  FAILED: '邮件发送失败',
};

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
  const { date } = useParams<{ date: string }>();
  const [reports, setReports] = useState<DailyReportSummary[]>([]);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (date) setReport(null);
    else setReports([]);
    try {
      const endpoint = date ? `/api/daily-reports/${encodeURIComponent(date)}` : '/api/daily-reports';
      const response = await fetch(endpoint, { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '日报加载失败');
      const result = await response.json();
      if (date) {
        setReport(result.report || null);
      } else {
        setReports(result.reports || []);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '日报加载失败');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, date]);

  useEffect(() => { void load(); }, [load]);

  const retryEmail = async () => {
    if (!report?.emailNotificationId || retrying) return;
    if (!window.confirm('这会重新发送该日期的日报邮件，是否继续？')) return;
    setRetrying(true);
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(report.emailNotificationId)}/retry`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!response.ok) throw await readError(response, '日报邮件重试失败');
      await load();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : '日报邮件重试失败');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="daily-reports-page">
      <header className="daily-reports-header">
        <div>
          <div className="daily-reports-eyebrow">PRIVATE INTELLIGENCE</div>
          <h1>{date ? '日报详情' : '日报'}</h1>
          <p>{date ? '只对当前账号可见的个人情报日报。' : '按日期保存的个人情报日报，网页与邮件使用同一份安全渲染。'}</p>
        </div>
        <button type="button" className="daily-report-toolbar-button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : undefined} />
          刷新
        </button>
      </header>

      {error && (
        <div className="daily-report-notice error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>重试</button>
        </div>
      )}

      {loading ? (
        <div className="daily-report-state"><RefreshCw size={22} className="spin" /><span>正在加载日报…</span></div>
      ) : error ? (
        <div className="daily-report-state">
          <FileText size={30} />
          <strong>日报暂时无法加载</strong>
          <span>请使用上方“重试”重新读取。</span>
        </div>
      ) : date ? (
        <section className="daily-report-detail-shell">
          <button type="button" className="daily-report-back" onClick={() => navigate('/reports')}>
            <ArrowLeft size={16} /> 返回日报列表
          </button>
          {report ? (
            <article className="daily-report-detail-card">
              <header className="daily-report-detail-header">
                <div>
                  <div className="daily-report-date">{formatReportDate(report.date)}</div>
                  <div className="daily-report-meta">发布于 {formatUpdatedAt(report.publishedAt)} · 更新于 {formatUpdatedAt(report.updatedAt)}</div>
                </div>
                <div className={`daily-report-email-status ${report.emailStatus.toLowerCase()}`}>
                  <Mail size={14} /> {emailStatusLabel[report.emailStatus]}
                </div>
              </header>
              <div className="daily-report-detail-actions">
                {report.emailStatus === 'FAILED' && report.emailNotificationId && (
                  <button type="button" className="daily-report-retry-button" onClick={() => void retryEmail()} disabled={retrying}>
                    <RefreshCw size={14} className={retrying ? 'spin' : undefined} />
                    {retrying ? '重新排队中…' : '确认后重试邮件'}
                  </button>
                )}
                {report.emailStatus === 'DISABLED' && <span>发布时未开启日报邮件；之后开启不会补发旧日报。</span>}
                {report.emailStatus === 'QUEUED' && <span>邮件已进入队列，发送结果会在下次刷新后显示。</span>}
              </div>
              <div className="daily-report-markdown" dangerouslySetInnerHTML={{ __html: report.html }} />
            </article>
          ) : (
            <div className="daily-report-state"><FileText size={30} /><strong>找不到这一天的日报</strong><span>请返回列表选择已有日期。</span></div>
          )}
        </section>
      ) : reports.length > 0 ? (
        <div className="daily-reports-grid">
          {reports.map(item => (
            <button type="button" className="daily-report-card" key={item.id} onClick={() => navigate(`/reports/${item.date}`)}>
              <div className="daily-report-card-topline">
                <span className="daily-report-card-date">{formatReportDate(item.date)}</span>
                <span className={`daily-report-email-status ${item.emailStatus.toLowerCase()}`}>
                  <Mail size={13} /> {emailStatusLabel[item.emailStatus]}
                </span>
              </div>
              <p>{item.excerpt || '这份日报没有可显示的摘要。'}</p>
              <span className="daily-report-card-meta">更新于 {formatUpdatedAt(item.updatedAt)} <span aria-hidden="true">→</span></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="daily-report-state">
          <FileText size={34} />
          <strong>还没有日报</strong>
          <span>日报项目发布后，会按日期显示在这里。</span>
        </div>
      )}
    </div>
  );
}
