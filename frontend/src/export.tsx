import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { toPng } from 'html-to-image';
import { getSmoothStepPath, Position } from '@xyflow/react';
import type { Graph, GraphNode } from './types';
import { NodeBody } from './FlowNode';
import { Markdown } from './Markdown';

interface Rect { x: number; y: number; width: number; height: number }
function endpoint(rect: Rect, handle: string | null | undefined, source: boolean) {
  if (handle?.startsWith('left')) return { x: rect.x, y: rect.y + rect.height * (source ? .7 : .35), position: Position.Left };
  if (handle?.startsWith('right')) return { x: rect.x + rect.width, y: rect.y + rect.height * (source ? .7 : .35), position: Position.Right };
  return source ? { x: rect.x + rect.width / 2, y: rect.y + rect.height, position: Position.Bottom }
    : { x: rect.x + rect.width / 2, y: rect.y, position: Position.Top };
}
function ExportDocument({ graph, onReady }: { graph: Graph; onReady: (element: HTMLElement) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }> | null>(null);
  const nodes = graph.nodes.map(n => ({ ...n, data: { ...n.data, expanded: false } }));
  useLayoutEffect(() => {
    if (!root.current) return;
    const result: Record<string, { width: number; height: number }> = {};
    root.current.querySelectorAll<HTMLElement>('[data-export-node]').forEach(element => {
      result[element.dataset.exportNode!] = { width: element.offsetWidth, height: element.offsetHeight };
    });
    setMeasurements(result);
  }, []);
  useLayoutEffect(() => {
    if (measurements && root.current) onReady(root.current);
  }, [measurements, onReady]);
  const minX = nodes.length ? Math.min(...nodes.map(n => n.position.x)) : 0;
  const minY = nodes.length ? Math.min(...nodes.map(n => n.position.y)) : 0;
  const rects: Record<string, Rect> = {};
  nodes.forEach(n => { rects[n.id] = { x: n.position.x - minX + 80, y: n.position.y - minY + 60, width: measurements?.[n.id]?.width || 248, height: measurements?.[n.id]?.height || 120 }; });
  const nodeRight = Math.max(300, ...Object.values(rects).map(r => r.x + r.width));
  const backEdges = graph.edges.filter(e => rects[e.target] && rects[e.source] && rects[e.target].y <= rects[e.source].y);
  const width = nodeRight + (backEdges.length ? 220 + backEdges.length * 22 : 100);
  const height = Math.max(150, ...Object.values(rects).map(r => r.y + r.height)) + 80;
  const sheetWidth = Math.max(980, Math.min(2400, width + 96));
  const scale = Math.min(1, (sheetWidth - 96) / width);
  const notes = nodes.filter(n => n.data.notes.trim());
  const longConditions = graph.edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => Array.from(edge.label || '').length > 28);
  return <div ref={root} className="export-sheet" data-graph-scale={scale} style={{ width: sheetWidth }}>
    <header className="export-heading"><div className="export-brand">FLOWPLAN <span>/ VISUAL PLAN</span></div><div className="export-meta">{nodes.length} 个节点 · {graph.edges.length} 条连线 · 完整说明</div></header>
    <h1>{graph.title || '未命名流程'}</h1>
    {!!graph.description && <div className="export-description"><Markdown text={graph.description} /></div>}
    <div className="export-graph-outer" style={{ height: height * scale }}>
      <div className="export-graph" style={{ width, height, transform: `translateX(${(sheetWidth - 96 - width * scale) / 2}px) scale(${scale})`, transformOrigin: 'top left' }}>
        <svg className="export-connections" width={width} height={height}>
          <defs><marker id="export-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#75827a" /></marker><marker id="export-arrow-llm" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#6183a0" /></marker></defs>
          {graph.edges.map((edge, edgeIndex) => {
            const source = rects[edge.source], target = rects[edge.target];
            if (!source || !target) return null;
            const s = endpoint(source, edge.sourceHandle, true), t = endpoint(target, edge.targetHandle, false);
            let [path, labelX, labelY] = getSmoothStepPath({ sourceX: s.x, sourceY: s.y, sourcePosition: s.position, targetX: t.x, targetY: t.y, targetPosition: t.position, borderRadius: 12, offset: 26 });
            const backIndex = backEdges.findIndex(e => e.id === edge.id);
            if (backIndex >= 0) {
              const gutter = nodeRight + 44 + backIndex * 22;
              path = `M${s.x},${s.y} L${s.x},${s.y + 24} L${gutter},${s.y + 24} L${gutter},${t.y - 24} L${t.x},${t.y - 24} L${t.x},${t.y}`;
              labelX = gutter + 60; labelY = (s.y + t.y) / 2;
            }
            const llm = nodes.find(n => n.id === edge.source)?.data.executor === 'llm';
            const labelCharacters = Array.from(edge.label || '');
            const visibleLabel = labelCharacters.length > 28 ? `${labelCharacters.slice(0, 20).join('')}… [E${edgeIndex + 1}]` : edge.label;
            return <g key={edge.id}><path d={path} fill="none" stroke={llm ? '#6183a0' : '#75827a'} strokeWidth={1.7} markerEnd={`url(#export-arrow${llm ? '-llm' : ''})`} />
              {!!edge.label && <foreignObject x={labelX - 85} y={labelY - 22} width="170" height="80"><div className="export-edge-label">{visibleLabel}</div></foreignObject>}
            </g>;
          })}
        </svg>
        {nodes.map(node => <div key={node.id} data-export-node={node.id} className={`flow-node kind-${node.type} executor-${node.data.executor} export-node`} style={{ left: rects[node.id].x, top: rects[node.id].y }}><NodeBody node={node as GraphNode} forceCollapsed /></div>)}
      </div>
    </div>
    {!!longConditions.length && <section className="export-constraints"><h2>完整连线条件 <span>图中长标签以 E 编号对应，下列内容未缩略</span></h2><div className="markdown"><table><thead><tr><th>连线</th><th>完整条件</th></tr></thead><tbody>{longConditions.map(({ edge, index }) => <tr key={edge.id}><td>E{index + 1} · {nodes.find(n => n.id === edge.source)?.data.label} → {nodes.find(n => n.id === edge.target)?.data.label}</td><td style={{ whiteSpace: 'pre-wrap' }}>{edge.label}</td></tr>)}</tbody></table></div></section>}
    {!!notes.length && <section className="export-details"><h2>节点说明 <span>所有说明均展开，不受画板折叠状态影响</span></h2><div className="export-note-grid">{notes.map((n, i) => <article className="export-note" key={n.id}><header><span className="note-number">{String(i + 1).padStart(2, '0')}</span><h3>{n.data.label}</h3></header><div className="export-node-id">{n.id}</div><Markdown text={n.data.notes} /></article>)}</div></section>}
    {!!graph.constraints.trim() && <section className="export-constraints"><h2>约束与验收条件</h2><Markdown text={graph.constraints} /></section>}
    <footer className="export-footer"><span>图先行，再实现。</span><span>图数据与文字说明共同组成需求；PNG 是同一版本的可视视图。</span></footer>
  </div>;
}

export async function renderGraphPng(graph: Graph): Promise<string> {
  const mount = document.createElement('div');
  mount.className = 'export-mount';
  document.body.appendChild(mount);
  const reactRoot = createRoot(mount);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const element = await new Promise<HTMLElement>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('导出视图准备超时，请重试。')), 12000);
      reactRoot.render(<ExportDocument graph={graph} onReady={resolve} />);
    });
    clearTimeout(timer);
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (Number(element.dataset.graphScale) < 0.55) throw new Error('节点分布过宽，缩放后将无法阅读。请使用“整理布局”或缩短节点间距，再导出。');
    const width = element.scrollWidth, height = element.scrollHeight;
    // Match the stdlib backend's 8192px / 16 Mi-pixel / 5 MiB PNG limits.
    const ratio = Math.min(1.5, 8192 / width, 8192 / height, Math.sqrt((16 * 1024 * 1024) / (width * height)));
    if (ratio < 0.75 || width > 10000 || height > 18000) throw new Error('图或说明过大，无法生成清晰完整的 PNG。请先整理布局或精简说明，再提交；草稿已保留。');
    const png = await toPng(element, { backgroundColor: '#fbfaf7', pixelRatio: ratio, width, height, skipFonts: true, cacheBust: false });
    if (!png.startsWith('data:image/png;base64,') || png.length < 100) throw new Error('PNG 渲染失败，未提交任何批准。');
    if ((png.length - 22) * .75 > 5 * 1024 * 1024) throw new Error('PNG 超过 5 MiB 上限，请精简说明或拆分本次规划。草稿已保留，未提交批准。');
    return png;
  } finally {
    clearTimeout(timer);
    reactRoot.unmount(); mount.remove();
  }
}
