import { useLayoutEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { toPng } from 'html-to-image';
import type { Graph } from './types';
import { EXECUTOR_LABELS } from './types';
import { Markdown } from './Markdown';
import { exportViews } from './views';
import { createScene } from './geometry';
import { SceneDiagram } from './SceneDiagram';

function ExportDocument({ graph, onReady }: { graph: Graph; onReady: (element: HTMLElement) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const scenes = useMemo(() => exportViews(graph).map(view => createScene(view)), [graph]);
  const longDocument = graph.nodes.length > 12 || graph.nodes.reduce((sum,n)=>sum+n.data.notes.length,0) > 12000;
  const sheetWidth = Math.max(longDocument ? 2240 : 1280, Math.min(2400, Math.max(...scenes.map(s => s.bounds.width)) + 96));
  const columns = sheetWidth >= 2000 ? 2 : 1;
  const columnWidth = (sheetWidth - 96 - (columns-1)*32) / columns;
  const spans = scenes.map((s,i)=>i===0 || s.bounds.width*0.7 > columnWidth ? columns : 1);
  const scales = scenes.map((s,i) => Math.min(1, (spans[i]===columns ? sheetWidth-96 : columnWidth) / s.bounds.width));
  useLayoutEffect(() => { if (root.current) onReady(root.current); }, [onReady]);
  return <div ref={root} className="export-sheet" data-graph-scale={Math.min(...scales)} style={{width:sheetWidth}}>
    <header className="export-heading"><div className="export-brand">FLOWPLAN</div><div className="export-meta">{graph.nodes.length} 个节点 · {graph.edges.length} 条连线 · 完整说明</div></header>
    <h1>{graph.title || '未命名流程'}</h1>
    {!!graph.description && <div className="export-description"><Markdown text={graph.description}/></div>}
    <div className="export-view-grid" style={{gridTemplateColumns:`repeat(${columns},minmax(0,1fr))`}}>{scenes.map((scene,index)=><section key={scene.view.id} className="export-view" data-export-view={scene.view.id} style={{gridColumn:`span ${spans[index]}`}}>
      <h2>{index===0?'主流程':scene.view.title}</h2>{scene.view.summary&&<Markdown text={scene.view.summary}/>}
      <div className="export-graph-outer" style={{height:scene.bounds.height*scales[index],width:scene.bounds.width*scales[index],marginLeft:'auto',marginRight:'auto'}}><div style={{transform:`scale(${scales[index]})`,transformOrigin:'top left'}}><SceneDiagram scene={scene}/></div></div>
    </section>)}</div>
    <section className="export-details"><h2>节点说明</h2><div className="export-note-grid" style={{columnCount:sheetWidth>=2000 ? 3 : 2}}>{graph.nodes.map((n,i)=><article className="export-note" key={n.id} data-export-note={n.id}>
      <header><span className="note-number">{String(i+1).padStart(2,'0')}</span><h3>{n.data.label}</h3></header>
      <div className="export-node-id">{n.id} · {EXECUTOR_LABELS[n.data.executor]}</div>
      {n.data.summary&&<p className="export-summary">{n.data.summary}</p>}<Markdown text={n.data.notes}/>
    </article>)}</div></section>
    <section className="export-constraints"><h2>全部连线与条件</h2><div className="markdown"><table><thead><tr><th>连线</th><th>起点 → 终点</th><th>条件 / 说明</th></tr></thead><tbody>{graph.edges.map(e=><tr key={e.id} data-export-edge={e.id}><td>{e.id}</td><td>{graph.nodes.find(n=>n.id===e.source)?.data.label} → {graph.nodes.find(n=>n.id===e.target)?.data.label}</td><td style={{whiteSpace:'pre-wrap'}}>{e.label||'继续'}</td></tr>)}</tbody></table></div></section>
    {!!graph.constraints.trim()&&<section className="export-constraints"><h2>约束与验收条件</h2><Markdown text={graph.constraints}/></section>}
    <footer className="export-footer"><span>Flowplan</span><span>主图、分支和说明对应同一份图数据。</span></footer>
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
