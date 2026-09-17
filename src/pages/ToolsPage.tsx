import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface PublicTool {
  slug: string;
  title: string;
  summary: string;
  path: string;
  kind: 'mounted';
}

function isPublicTool(value: unknown): value is PublicTool {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.slug === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.summary === 'string'
    && typeof candidate.path === 'string'
    && candidate.kind === 'mounted';
}

function toolMark(title: string): string {
  const text = title.trim();
  return text.length > 1 ? text.slice(0, 2) : text || 'T';
}

export function ToolsPage() {
  const navigate = useNavigate();
  const { authHeaders } = useAuth();
  const [tools, setTools] = useState<PublicTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const loadTools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/tools', {
        headers: authHeaders(),
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => null) as { tools?: unknown; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || '工具清单暂时不可用，请稍后再试');
      if (!Array.isArray(data?.tools)) throw new Error('工具清单格式无效，请稍后再试');
      setTools(data.tools.filter(isPublicTool));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '工具清单暂时不可用，请稍后再试');
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void loadTools(); }, [loadTools, reloadKey]);

  return (
    <section className="tools-page" aria-labelledby="tools-page-title">
      <div className="tools-page-inner">
        <header className="tools-page-header">
          <div className="tools-page-heading">
            <div className="tools-eyebrow"><span>Tools</span><span>挂载应用</span></div>
            <h1 id="tools-page-title">Tools</h1>
            <p>个人挂载应用</p>
          </div>
          <button type="button" className="tools-back-link" onClick={() => navigate('/today')}>
            <ArrowLeft size={16} aria-hidden="true" />
            返回主站
          </button>
        </header>

        <div className="tools-notice" role="note">
          <span className="tools-notice-mark" aria-hidden="true">·</span>
          <div><strong>挂载应用 · 非主站核心功能</strong><p>这里集中放置个人挂载的网页应用，选择应用后会在当前页面打开真实工具链接。</p></div>
        </div>

        {loading ? (
          <div className="tools-grid" aria-label="正在加载工具" aria-busy="true">
            {[1, 2, 3].map(item => <div className="tools-card tools-card-skeleton" key={item} />)}
          </div>
        ) : error ? (
          <div className="tools-state" role="alert">
            <strong>工具暂时无法加载</strong>
            <p>{error}</p>
            <div className="tools-state-actions">
              <button type="button" className="tools-primary-action" onClick={() => setReloadKey(value => value + 1)}>
                <RefreshCw size={15} aria-hidden="true" />重试
              </button>
              <a href="/login" className="tools-secondary-action">重新登录</a>
            </div>
          </div>
        ) : tools.length === 0 ? (
          <div className="tools-state" role="status">
            <strong>还没有可用的挂载应用</strong>
            <p>以后新增并启用 HTML 应用后，它会自动出现在这里。</p>
          </div>
        ) : (
          <div className="tools-grid">
            {tools.map(tool => {
              const url = new URL(tool.path, window.location.origin).toString();
              return (
                <article className="tools-card" key={tool.slug} data-tool-slug={tool.slug}>
                  <a className="tools-card-link" href={tool.path} aria-label={`打开 ${tool.title}`}>
                    <div className="tools-card-topline">
                      <span className="tools-card-mark" aria-hidden="true">{toolMark(tool.title)}</span>
                      <span className="tools-card-kind">挂载应用</span>
                    </div>
                    <h2>{tool.title}</h2>
                    <p>{tool.summary}</p>
                  </a>
                  <div className="tools-card-footer">
                    <span className="tools-card-url" title={url}>{url}</span>
                    <a className="tools-open-action" href={tool.path}>
                      打开应用
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
