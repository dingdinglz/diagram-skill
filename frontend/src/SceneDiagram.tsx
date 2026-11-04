import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Maximize } from './icons';
import { createScene, type Scene } from './geometry';
import { buildView, type ViewNode, type ViewScope } from './views';
import type { Graph } from './types';
import { NodeBody } from './FlowNode';
import { edgeAppearance, EdgeArrow } from './edgeAppearance';

export function SceneDiagram({ scene, onNode }: { scene: Scene; onNode?: (node: ViewNode) => void }) {
  const marker = useId().replace(/:/g, '');
  const { bounds, rects, edges, loops, view } = scene;
  return <div className="scene-diagram" data-view-id={view.id} style={{ width: bounds.width, height: bounds.height }}>
    <div className="scene-content" style={{ transform: `translate(${-bounds.x}px, ${-bounds.y}px)` }}>
      {loops.map(loop => <div key={loop.id} className="loop-area scene-loop" style={{ left: loop.center.x-loop.radius-48, top: loop.center.y-loop.radius-48, width: 2*(loop.radius+48), height: 2*(loop.radius+48) }}><span className="loop-caption"><span>{loop.label}</span></span></div>)}
      <svg className="scene-connections" style={{ overflow: 'visible' }} width={bounds.width} height={bounds.height}>
        <defs>{edges.map((e,i)=><EdgeArrow key={e.edge.id} id={`${marker}-${i}`} appearance={edgeAppearance(e)} />)}</defs>
        {edges.map((e,i) => <g key={e.edge.id} data-scene-edge={e.edge.id}><path d={e.path} fill="none" style={edgeAppearance(e).style} markerEnd={`url(#${marker}-${i})`} />
          {!!e.edge.label && <foreignObject x={e.label.x-90} y={e.label.y-23} width={180} height={70}><div className="scene-edge-label" title={e.edge.label}>{e.edge.label.length > 36 ? e.edge.label.slice(0,32)+'…' : e.edge.label}</div></foreignObject>}
        </g>)}
      </svg>
      {view.nodes.map(n => <div key={n.id} className={`flow-node scene-node kind-${n.type} ${n.reference?'reference-node':''} ${n.groupId?'is-group':''}`} data-scene-node={n.id} style={{ left:rects[n.id].x,top:rects[n.id].y }}
        role={onNode?'button':undefined} tabIndex={onNode?0:undefined} onClick={()=>onNode?.(n)} onKeyDown={e=>{if(e.key==='Enter')onNode?.(n);}}>
        <NodeBody node={n} groupId={n.groupId} memberCount={view.groups?.find(g=>g.id===n.groupId)?.nodeIds.length} branchCount={view.branches[n.id]?.length || 0} exceptionsOnly={view.branches[n.id]?.every(b=>b.exception)} onBranches={onNode?()=>onNode(n):undefined} onGroup={onNode?()=>onNode(n):undefined} />
      </div>)}
    </div>
  </div>;
}

export function DetailDiagram({ graph, scope, onNode }: { graph: Graph; scope: ViewScope; onNode: (node: ViewNode)=>void }) {
  const scene=useMemo(()=>createScene(buildView(graph,scope,true)),[graph,scope]);
  const scroll=useRef<HTMLDivElement>(null);
  const [zoom,setZoom]=useState(.75);
  const fitWidth=()=>Math.min(1,Math.max(.15,((scroll.current?.clientWidth||280)-2)/scene.bounds.width));
  useLayoutEffect(()=>{setZoom(Math.min(.75,fitWidth()));},[]);
  return <div className="detail-diagram">
    <div className="detail-diagram-tools"><button className="icon-button" aria-label="缩小分支图" onClick={()=>setZoom(z=>Math.max(.15,z-.15))}><Minus size={14}/></button><span>{Math.round(zoom*100)}%</span><button className="icon-button" aria-label="放大分支图" onClick={()=>setZoom(z=>Math.min(1.5,z+.15))}><Plus size={14}/></button><button className="icon-button" aria-label="查看分支全貌" onClick={()=>setZoom(fitWidth())}><Maximize size={14}/></button></div>
    <div ref={scroll} className="detail-diagram-scroll nowheel nopan" onWheel={e=>e.stopPropagation()}><div style={{width:scene.bounds.width*zoom,height:scene.bounds.height*zoom}}><div style={{transform:`scale(${zoom})`,transformOrigin:'top left'}}><SceneDiagram scene={scene} onNode={onNode}/></div></div></div>
    <div className="detail-node-list">{scene.view.nodes.map(n=><button key={n.id} onClick={()=>onNode(n)}>{n.data.label}{n.groupId?' ›':n.reference?' ↗':''}</button>)}</div>
  </div>;
}
