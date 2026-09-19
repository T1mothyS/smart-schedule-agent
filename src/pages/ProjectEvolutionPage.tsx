import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, GitCommitHorizontal, Layers, TrendingUp } from 'lucide-react';
import { APP_CONFIG } from '../config';
import { getStoredAuthHeaders } from '../hooks/useAuth';
import { architectureChanges, type EvolutionData, type EvolutionMilestone, type EvolutionSnapshot } from '../types/project-evolution';
import '../styles/project-evolution.css';

const day = (date: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
const changes: Record<string, string> = { added: '新增', changed: '变化', removed: '移除', unchanged: '已有' };
const groups = { client: '客户端', server: '服务端', data: '数据', external: '外部集成' };
function edgePath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const right = b.x >= a.x;
  const start = a.x + (right ? 200 : 0), end = b.x + (right ? 0 : 200);
  if (a.x === b.x) return `M${start},${a.y + 33} H${start + 30} V${b.y + 33} H${b.x + 200}`;
  const lead = start + (right ? 20 : -20), tail = end + (right ? -20 : 20);
  return `M${start},${a.y + 33} H${lead} V${a.y + 80} H${tail} V${b.y + 33} H${end}`;
}

export function ProjectEvolutionPage() {
  const [data, setData] = useState<EvolutionData | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [params, setParams] = useSearchParams();
  const [expandedDays, setExpandedDays] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const mobileTrack = useRef<HTMLOListElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setData(null);
    fetch('/api/project-evolution', { headers: getStoredAuthHeaders(), signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录后查看。' : '成长记录暂时无法加载，请重试。');
      const value = await response.json() as EvolutionData;
      if (value.schemaVersion !== 1 || !Array.isArray(value.milestones) || !Array.isArray(value.facts) || !Array.isArray(value.snapshots)) throw new Error('成长记录格式无效，请重试。');
      setData(value);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [attempt]);
  const selected = data?.milestones.find(m => m.id === params.get('milestone')) ?? data?.milestones.at(-1);
  const invalid = !!data && ((params.has('milestone') && !data.milestones.some(m => m.id === params.get('milestone'))) || (params.has('view') && !['growth', 'architecture'].includes(params.get('view')!)));
  const view = !invalid && params.get('view') === 'architecture' ? 'architecture' : 'growth';
  const milestone = invalid ? data?.milestones.at(-1) : selected;
  const select = (id: string, nextView = view) => { setCopyStatus(''); setParams({ view: nextView, milestone: id }); };
  const fact = data?.facts.find(f => f.id === milestone?.id);
  const days = useMemo(() => {
    const result = new Map<string, EvolutionMilestone[]>();
    data?.milestones.forEach(m => { const f = data.facts.find(f => f.id === m.id); if (f) { const key = day(f.date); result.set(key, [...(result.get(key) ?? []), m]); } });
    return [...result];
  }, [data]);
  const snapshot = data?.snapshots.find(s => s.id === milestone?.snapshot);
  const snapshotIndex = data?.snapshots.findIndex(s => s.id === snapshot?.id) ?? 0;
  const prior = data?.snapshots[snapshotIndex - 1];
  useEffect(() => {
    if (!fact) return;
    setExpandedDays(days => days.includes(day(fact.date)) ? days : [...days, day(fact.date)]);
  }, [fact?.id]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const container = track.current;
      const selected = container?.querySelector<HTMLElement>('.is-selected');
      if (container && selected) container.scrollLeft += selected.getBoundingClientRect().left - container.getBoundingClientRect().left - container.clientWidth / 2 + selected.clientWidth / 2;
      const mobile = mobileTrack.current, item = mobile?.querySelector<HTMLElement>('[aria-pressed=true]');
      if (mobile && item) mobile.scrollTop += item.getBoundingClientRect().top - mobile.getBoundingClientRect().top - mobile.clientHeight / 2 + item.clientHeight / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [milestone?.id, view]);

  return <main className="evolution-page">
    <header className="evolution-header"><span className="evolution-kicker">AI CALENDAR / PROJECT EVOLUTION</span><Link to="/today"><ArrowLeft size={15} /> 返回应用</Link></header>
    <section className="evolution-hero">
      <div><p className="evolution-eyebrow">一个项目，持续生长</p><h1 ref={heading} tabIndex={-1}>从一张日历，<br />到个人信息系统。</h1><p className="evolution-intro">回看每一次能力的增加，也看清它们如何连接在一起。</p></div>
      <div className="evolution-current"><span>当前应用版本</span><strong>V{APP_CONFIG.version}</strong><p>历史收录与应用版本独立更新</p>{data && <small>收录截止提交 <code>{data.baseline.slice(0, 7)}</code><br />最早可追溯记录 {data.facts[0] ? day(data.facts[0].date) : '—'}</small>}</div>
    </section>
    {error ? <section className="evolution-state" role="alert"><h2>暂时没有读到成长记录</h2><p>{error}</p><button onClick={() => setAttempt(a => a + 1)}>重新加载</button><Link to={`/login?next=${encodeURIComponent('/project?' + params.toString())}`}>重新登录</Link></section> : !data ? <div className="evolution-state" role="status" aria-busy="true">正在读取项目历史…</div> : !milestone || !fact || !snapshot ? <div className="evolution-state" role="status">还没有可展示的里程碑。</div> : <>
      <div className="evolution-stats"><div><strong>{data.milestones.length}</strong><span>关键里程碑</span></div><div><strong>{new Set(data.milestones.flatMap(m => m.featureAreas)).size}</strong><span>能力领域</span></div><div><strong>{data.snapshots.length}</strong><span>架构快照</span></div><p>代码记录证明能力的演进。<br />生产部署与设备验收，需要各自的证据。</p></div>
      <nav className="evolution-stages" aria-label="成长阶段">{data.stages.map((stage, i) => <button key={stage} aria-pressed={milestone.stage === i} onClick={() => { const target = data.milestones.find(m => m.stage === i); if (target) select(target.id); }}><span>0{i + 1}</span>{stage}<ArrowUpRight size={14} /></button>)}</nav>
      <div className="evolution-view-switch" aria-label="成长视图"><button aria-pressed={view === 'growth'} onClick={() => select(milestone.id, 'growth')}><TrendingUp size={17} /> 成长历程</button><button aria-pressed={view === 'architecture'} onClick={() => select(milestone.id, 'architecture')}><Layers size={17} /> 架构演化</button><span>选择一段历史，查看它留下的改变</span></div>
      {invalid && <p role="status" className="evolution-notice">链接中的选择无效，已显示最新收录的成长历程。<button onClick={() => select(milestone.id, 'growth')}>重置链接</button></p>}
      <div className="evolution-selection"><label htmlFor="evolution-milestone">当前里程碑</label><select id="evolution-milestone" value={milestone.id} onChange={e => select(e.target.value)}>{data.milestones.map(m => <option value={m.id} key={m.id}>{day(data.facts.find(f => f.id === m.id)!.date)} · {m.title}</option>)}</select></div>
      {view === 'growth' ? <>
        <section className="evolution-timeline" aria-label="日期、版本和提交时间线">
          <div className="evolution-track-labels"><span>日期</span><span>版本</span><span>提交</span></div>
          <div className="evolution-track-scroll" ref={track} tabIndex={0} aria-label="按日期顺序排列，可横向滚动">{days.map(([date, entries]) => {
            const expanded = entries.length === 1 || expandedDays.includes(date);
            return <div className="evolution-day" key={date}>
              {entries.length > 1 && <button className="evolution-day-toggle" onClick={() => setExpandedDays(v => v.includes(date) ? v.filter(d => d !== date) : [...v, date])} aria-expanded={expanded}>{date} · {entries.length} 项</button>}
              <div className="evolution-day-items">{(expanded ? entries : [entries.find(m => m.id === milestone.id) ?? entries[entries.length - 1]]).map(m => { const f = data.facts.find(f => f.id === m.id)!; return <div className={`evolution-stop ${m.id === milestone.id ? 'is-selected' : ''}`} key={m.id}>{[date, f.version ? `V${f.version}` : '版本未记录', f.commit.slice(0, 7)].map((label, i) => <button key={i} aria-pressed={m.id === milestone.id} onClick={() => select(m.id)} aria-label={`${['日期', '版本', '提交'][i]} ${label}：${m.title}`}><i aria-hidden="true" />{label}</button>)}<p>{m.title}</p></div>; })}</div>
            </div>;
          })}</div>
        </section>
        <ol className="evolution-mobile-timeline" ref={mobileTrack} aria-label="成长时间线">{data.milestones.map(m => { const f = data.facts.find(f => f.id === m.id)!; return <li key={m.id}><button aria-pressed={milestone.id === m.id} onClick={() => select(m.id)}><span>{day(f.date)} · {f.version ? `V${f.version}` : '版本未记录'}</span><strong>{m.title}</strong><code>{f.commit.slice(0, 7)}</code></button></li>; })}</ol>
        <article className="evolution-detail" aria-live="polite"><div className="evolution-detail-heading"><span className="evolution-eyebrow">{data.stages[milestone.stage]}</span><span>{day(fact.date)} · V{fact.version ?? '—'}</span></div><h2>{milestone.title}</h2><p className="evolution-summary">{milestone.summary}</p><button className="evolution-text-link" onClick={() => select(milestone.id, 'architecture')}>查看这一刻的系统结构 <ArrowUpRight size={16} /></button>
          <details><summary><GitCommitHorizontal size={17} /> 工程细节与证据</summary><p>{milestone.engineering}</p><dl><dt>实现提交</dt><dd><code>{fact.commit}</code> <button onClick={async () => { try { await navigator.clipboard.writeText(fact.commit); setCopyStatus('已复制提交哈希'); } catch { setCopyStatus('复制失败，请选择上方哈希手动复制'); } }}>复制</button><span role="status">{copyStatus}</span></dd><dt>版本依据</dt><dd>该提交的 package.json：{fact.version ?? '未记录'}；标签：{fact.tags.join('、') || '未记录'}。不据此推断发行或部署。</dd><dt>源码依据</dt><dd>{milestone.evidencePaths.join('、')}</dd><dt>验证记录</dt><dd>{milestone.tests ? `本地测试 ${milestone.tests.count} 项；${milestone.tests.evidence}` : '本地测试数量未记录'}；生产验证：本页未记录。</dd><dt>能力领域</dt><dd>{milestone.featureAreas.join(' · ')}</dd></dl>{fact.warnings.map(w => <p className="evolution-notice" key={w}>{w}</p>)}<p className="evolution-muted">历史版本保留当时原值，早期 1.0.0 与后续 0.x 不构成连续递增序列。</p></details>
        </article>
        <Metrics data={data} selectedId={milestone.id} />
      </> : <Architecture key={snapshot.id} data={data} current={snapshot} previous={prior} />}
      <footer className="evolution-footer">历史基于已收录提交整理 · 日期使用香港时区 · 页面不读取个人日程、邮件或知识内容</footer>
    </>}
  </main>;
}

function Metrics({ data, selectedId }: { data: EvolutionData; selectedId: string }) {
  const series = [
    { title: '源码非空行', values: data.facts.map(f => f.sourceLoc) },
    { title: 'Git 跟踪文件', values: data.facts.map(f => f.trackedFiles) },
    { title: '能力领域', values: data.milestones.map(m => m.featureAreas.length) },
    { title: '有记录的本地测试', values: data.milestones.map(m => m.tests?.count ?? null) },
  ];
  const selected = data.milestones.findIndex(m => m.id === selectedId);
  return <section className="evolution-metrics"><h2>成长的刻度</h2><p className="evolution-muted">按里程碑顺序展示；规模是记录，不代表质量。缺失测试数据不补零。</p><div className="evolution-chart-grid">{series.map(series => {
    const max = Math.max(1, ...series.values.filter((n): n is number => n !== null));
    const point = (n: number, i: number) => [10 + i * 260 / Math.max(1, series.values.length - 1), 85 - n / max * 65];
    return <figure key={series.title}><figcaption>{series.title}<strong>{series.values[selected]?.toLocaleString() ?? '—'}</strong></figcaption><svg viewBox="0 0 280 100" role="img" aria-label={`${series.title}趋势；详细数值见下方数据表`}><path d="M10 85 H270" className="chart-axis" />{series.values.map((n, i) => { if (n === null) return null; const [x, y] = point(n, i); const before = series.values[i - 1]; const previous = before != null ? point(before, i - 1) : null; return <g key={i}>{previous && <line x1={previous[0]} y1={previous[1]} x2={x} y2={y} className="chart-line" />}<circle cx={x} cy={y} r={i === selected ? 4 : 2.5} className="chart-dot"><title>{data.milestones[i].title}：{n}</title></circle></g>; })}</svg></figure>;
  })}</div><details><summary>查看数据表与统计口径</summary><p>源码统计 src、server、electron、scripts 内支持扩展名的非空行（含注释和测试），排除依赖、构建、运行数据、压缩文件及本功能自身。文件数为完整 Git 文件树；规则版本：{data.metricRules}。</p><div className="evolution-table-scroll"><table><thead><tr><th>里程碑</th>{series.map(s => <th key={s.title}>{s.title}</th>)}</tr></thead><tbody>{data.milestones.map((m, i) => <tr key={m.id}><th scope="row">{m.title}</th>{series.map(s => <td key={s.title}>{s.values[i]?.toLocaleString() ?? '—'}</td>)}</tr>)}</tbody></table></div></details></section>;
}

function Architecture({ data, current, previous }: { data: EvolutionData; current: EvolutionSnapshot; previous?: EvolutionSnapshot }) {
  const diff = architectureChanges(previous, current);
  const [selectedNode, setSelectedNode] = useState(diff.nodes[0]?.id);
  const [zoom, setZoom] = useState(1);
  const [showMap, setShowMap] = useState(false);
  const node = diff.nodes.find(n => n.id === selectedNode);
  const origin = data.milestones.find(m => m.id === current.milestone)!;
  const first = node && data.snapshots.find(s => s.nodes.some(n => n.id === node.id));
  const firstMilestone = data.milestones.find(m => m.id === first?.milestone);
  const height = Math.max(240, ...diff.nodes.map(n => n.y + 100));
  return <section className="evolution-architecture"><div className="evolution-detail-heading"><div><h2>这一刻，系统怎样连接</h2><p>快照来源：{origin.title}<br />{previous ? `对比：${data.milestones.find(m => m.id === previous.milestone)?.title}` : '第一个可追溯快照；新增表示此时已可证实存在。'}</p></div><div className="evolution-legend">{Object.entries(changes).map(([key, label]) => <span className={`change-${key}`} key={key}>{label} {diff.nodes.filter(n => n.change === key).length}</span>)}</div></div>
    <button className="evolution-map-toggle" onClick={() => setShowMap(v => !v)} aria-expanded={showMap}>{showMap ? '收起完整图' : '展开完整图'}</button>
    <div className={`evolution-map-area ${showMap ? 'is-open' : ''}`}><div className="evolution-map-controls"><button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} disabled={zoom <= 0.5} aria-label="缩小架构图">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(z => Math.min(1.5, z + 0.25))} disabled={zoom >= 1.5} aria-label="放大架构图">＋</button><button onClick={() => setZoom(1)}>复位</button></div>
      <div className="evolution-map-scroll" tabIndex={0} aria-label="架构图，可在容器内滚动"><div style={{ width: 1110 * zoom, height: height * zoom }}><div className="evolution-map" style={{ width: 1110, height, transform: `scale(${zoom})` }}>{Object.entries(groups).map(([key, label], i) => <span className="evolution-map-group" style={{ left: [25, 300, 580, 860][i] }} key={key}>{label}</span>)}<svg width="1110" height={height} aria-hidden="true">{diff.edges.map(e => { const a = diff.nodes.find(n => n.id === e.source)!, b = diff.nodes.find(n => n.id === e.target)!; return <g key={e.id}><path className={`architecture-edge change-${e.change}`} d={edgePath(a, b)} /><title>{a.label} → {b.label}：{changes[e.change]}</title></g>; })}</svg>{diff.nodes.map(n => <button key={n.id} style={{ left: n.x, top: n.y }} className={`evolution-node change-${n.change}`} aria-pressed={n.id === selectedNode} onClick={() => setSelectedNode(n.id)}><strong>{n.label}</strong><span>{changes[n.change]}</span></button>)}</div></div></div>
    </div>
    <div className="evolution-architecture-bottom"><nav className="evolution-node-list" aria-label="架构模块">{Object.entries(groups).map(([group, label]) => <div key={group}><h3>{label}</h3>{diff.nodes.filter(n => n.group === group).map(n => <button key={n.id} onClick={() => setSelectedNode(n.id)} aria-pressed={selectedNode === n.id}>{n.label}<span className={`change-${n.change}`}>{changes[n.change]}</span></button>)}</div>)}</nav>{node && <article className="evolution-node-detail" aria-live="polite"><span className="evolution-eyebrow">{groups[node.group]} · {changes[node.change]}</span><h3>{node.label}</h3><p>{node.description}</p><p><strong>最早可证实：</strong>{firstMilestone?.title ?? '未记录'}</p><p><strong>连接模块：</strong>{diff.edges.filter(e => e.source === node.id || e.target === node.id).map(e => diff.nodes.find(n => n.id === (e.source === node.id ? e.target : e.source))?.label).join('、') || '无'}</p><p className="evolution-muted">结构图表示职责与集成关系，不代表所有外部服务已部署或设备已验收。</p></article>}</div>
  </section>;
}
