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
  const [reports, setReports] = useState<DailyReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReports([]);
    try {
      const response = await fetch('/api/daily-reports', { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '日报加载失败');
      const result = await response.json();
      setReports(result.reports || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '日报加载失败');
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

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
          <p>按日期保存的个人情报日报，网页与邮件使用同一份安全渲染。</p>
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
      ) : error && reports.length === 0 ? (
        <div className="daily-report-state">
          <FileText size={30} />
          <strong>日报暂时无法加载</strong>
          <span>请使用上方“重试”重新读取。</span>
        </div>
      ) : reports.length > 0 ? (
        <div className="daily-reports-grid">
          {reports.map(item => (
            <article className="daily-report-card" key={item.id}>
              <button
                type="button"
                className="daily-report-card-open"
                onClick={() => navigate(`/reports/${item.date}`)}
                aria-label={`打开 ${formatReportDate(item.date)} 日报`}
              >
                <div className="daily-report-card-topline">
                  <span className="daily-report-card-date">{formatReportDate(item.date)}</span>
                  <span className={`daily-report-email-status ${item.emailStatus.toLowerCase()}`}>
                    <Mail size={13} /> {emailStatusLabel[item.emailStatus]}
                  </span>
                </div>
                <p>{item.excerpt || '这份日报没有可显示的摘要。'}</p>
                <span className="daily-report-card-meta">更新于 {formatUpdatedAt(item.updatedAt)} <span aria-hidden="true">→</span></span>
              </button>
              {item.emailStatus === 'FAILED' && item.emailNotificationId && (
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
              )}
            </article>
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

export function DailyReportReaderPage() {
  const { authHeaders } = useAuth();
  const navigate = useNavigate();
  const { date } = useParams<{ date: string }>();
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      if (!date) throw new Error('日报日期无效');
      const response = await fetch(`/api/daily-reports/${encodeURIComponent(date)}`, { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '日报加载失败');
      const result = await response.json();
      setReport(result.report || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '日报加载失败');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, date]);

  useEffect(() => { void load(); }, [load]);

  const isNewsletter = report?.html.includes('daily-newsletter') === true;

  const sendEmail = async () => {
    if (!date || !report || sendingEmail) return;
    if (!window.confirm(`将把 ${formatReportDate(date)} 的当前日报重新发送到已配置的收件邮箱，是否继续？`)) return;
    setSendingEmail(true);
    setError(null);
    try {
      const response = await fetch(`/api/daily-reports/${encodeURIComponent(date)}/send`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!response.ok) throw await readError(response, '日报邮件发送失败');
      await load();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '日报邮件发送失败');
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <main className="daily-report-reader-page">
      <div className="daily-report-reader-toolbar">
        <div className="daily-report-reader-toolbar-row">
          <button type="button" className="daily-report-back" onClick={() => navigate('/reports')} aria-label="返回日报列表">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>返回日报</span>
          </button>
          {report && (
            <div className="daily-report-reader-toolbar-actions">
              <span className={`daily-report-email-status ${report.emailStatus.toLowerCase()}`}>
                <Mail size={13} /> {emailStatusLabel[report.emailStatus]}
              </span>
              <button
                type="button"
                className="daily-report-send-button"
                onClick={() => void sendEmail()}
                disabled={sendingEmail}
                aria-label={`手动发送 ${formatReportDate(report.date)} 日报邮件`}
              >
                <Mail size={14} />
                {sendingEmail ? '正在排队…' : report.emailStatus === 'SENT' ? '重新发送邮件' : '发送日报邮件'}
              </button>
            </div>
          )}
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
