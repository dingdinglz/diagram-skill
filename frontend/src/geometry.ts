import type { GraphView, ViewNode } from './views';
import { buildView, NODE_HEIGHT, NODE_WIDTH } from './views';
import type { Graph, GraphEdge, GraphGroup } from './types';
import { boundaryToward, containsRounded, projectAnchor, CARD_RADIUS } from './anchors';
import { circleForGroup, loopSlotNodeId } from './circles';

export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export interface EdgeGeometry { edge: GraphEdge; path: string; label: Point; source: Point; target: Point; points: Point[]; isLoop: boolean }
export interface LoopGeometry { id: string; label: string; center: Point; radius: number }
export interface Scene { view: GraphView; rects: Record<string, Rect>; edges: EdgeGeometry[]; loops: LoopGeometry[]; bounds: Rect }
const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const point = (p: Point) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const boundary = boundaryToward;
function normal(r: Rect, p: Point): Point {
  const radius = Math.min(CARD_RADIUS, r.width / 2, r.height / 2);
  const inner = { x: Math.max(r.x + radius, Math.min(r.x + r.width - radius, p.x)),
    y: Math.max(r.y + radius, Math.min(r.y + r.height - radius, p.y)) };
  const length = distance(p, inner) || 1;
  return { x: (p.x - inner.x) / length, y: (p.y - inner.y) / length };
}
const offset = (p: Point, direction: Point, length: number): Point => ({ x: p.x + direction.x * length, y: p.y + direction.y * length });

// A child slot owns its real members, even when its loop is expanded in this view.
function followsLoop(group: GraphGroup, edge: GraphEdge, view: GraphView): boolean {
  const contains = (slot: string, id: string) => {
    if (slot === id) return true;
    const members = (view.groups || view.loops).find(g => g.id === slot)?.nodeIds || [slot];
    const node = view.nodes.find(n => n.id === id);
    return !!node?.members.some(member => members.includes(member));
  };
  return group.order.some((slot, i) => contains(slot, edge.source) && contains(group.order[(i + 1) % group.order.length], edge.target));
}

// Locate an exact circle/rounded-card intersection. Fixed angle increments leave
// visible gaps at high zoom and can put arrowheads inside a corner.
function exitAngle(rect: Rect, polar: (angle: number) => Point, start: number, limit: number): number | undefined {
  if (!containsRounded(rect, polar(start))) return undefined;
  const direction = Math.sign(limit - start), step = Math.min(.025, Math.abs(limit - start) / 64);
  if (!step) return undefined;
  let inside = start;
  for (let i = 1; i <= Math.ceil(Math.abs(limit - start) / step); i++) {
    let outside = start + direction * Math.min(i * step, Math.abs(limit - start));
    if (containsRounded(rect, polar(outside))) { inside = outside; continue; }
    for (let j = 0; j < 28; j++) {
      const mid = (inside + outside) / 2;
      if (containsRounded(rect, polar(mid))) inside = mid; else outside = mid;
    }
    return (inside + outside) / 2;
  }
  return undefined;
}
function clearSegment(a: Point, b: Point, obstacles: Rect[]): boolean {
  return !obstacles.some(r => {
    // Liang–Barsky clipping against a slightly padded obstacle.
    let low = 0, high = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const [p, q] of [[-dx, a.x-r.x+10], [dx, r.x+r.width+10-a.x], [-dy, a.y-r.y+10], [dy, r.y+r.height+10-a.y]]) {
      if (p === 0) { if (q < 0) return false; }
      else if (p < 0) low = Math.max(low, q / p);
      else high = Math.min(high, q / p);
    }
    return low <= high;
  });
}
function roundedPath(points: Point[]): string {
  let path = `M${point(points[0])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const radius = Math.min(16, distance(a,b)/2, distance(b,c)/2);
    const before = { x: b.x + (a.x-b.x)*radius/distance(a,b), y: b.y+(a.y-b.y)*radius/distance(a,b) };
    const after = { x: b.x + (c.x-b.x)*radius/distance(b,c), y: b.y+(c.y-b.y)*radius/distance(b,c) };
    path += ` L${point(before)} Q${point(b)} ${point(after)}`;
  }
  return path + ` L${point(points[points.length-1])}`;
}
function route(a: Point, b: Point, obstacles: Rect[]): Point[] {
  if (clearSegment(a,b,obstacles)) return [a,b];
  // Orthogonal visibility grid, searched lazily. Turns carry a cost so a detour
  // uses as few corners as possible. Only used when the direct connection is blocked.
  const xs = [...new Set([a.x,b.x,...obstacles.flatMap(r=>[r.x-26,r.x+r.width+26])])].sort((x,y)=>x-y);
  const ys = [...new Set([a.y,b.y,...obstacles.flatMap(r=>[r.y-26,r.y+r.height+26])])].sort((x,y)=>x-y);
  type State = { x:number; y:number; dir:number; cost:number; score:number; key:string; parent?:State };
  const start: State = { x:xs.indexOf(a.x), y:ys.indexOf(a.y), dir:-1,cost:0,score:0,key:'start' };
  const open=[start], costs=new Map<string,number>();
  let goal:State|undefined;
  for(let count=0;open.length && count<16000;count++) {
    open.sort((a,b)=>b.score-a.score);
    const current=open.pop()!, p={x:xs[current.x],y:ys[current.y]};
    if(p.x===b.x && p.y===b.y) {goal=current;break;}
    for(const [dx,dy,dir] of [[1,0,0],[-1,0,0],[0,1,1],[0,-1,1]]) {
      const x=current.x+dx,y=current.y+dy;
      if(x<0||y<0||x>=xs.length||y>=ys.length)continue;
      const q={x:xs[x],y:ys[y]};
      if(!clearSegment(p,q,obstacles))continue;
      const cost=current.cost+distance(p,q)+(current.dir>=0&&current.dir!==dir?50:0), key=`${x}:${y}:${dir}`;
      if(cost>=(costs.get(key)??Infinity))continue;
      costs.set(key,cost);open.push({x,y,dir,cost,key,score:cost+Math.abs(q.x-b.x)+Math.abs(q.y-b.y),parent:current});
    }
  }
  if(!goal) return [a,b]; // Overlapping manually placed nodes cannot always be routed.
  const reversed:Point[]=[];
  for(let n:State|undefined=goal;n;n=n.parent)reversed.push({x:xs[n.x],y:ys[n.y]});
  const path=reversed.reverse();
  return path.filter((p,i)=>i===0||i===path.length-1||!((path[i-1].x===p.x&&path[i+1].x===p.x)||(path[i-1].y===p.y&&path[i+1].y===p.y)));
}

export function createScene(view: GraphView, measurements: Record<string,{width:number;height:number}> = {}): Scene {
  const groups = view.groups || view.loops;
  const rects:Record<string,Rect>={};
  view.nodes.forEach(n=>rects[n.id]={...n.position,width:measurements[n.id]?.width||NODE_WIDTH,height:measurements[n.id]?.height||NODE_HEIGHT});
  const loops:LoopGeometry[]=view.loops.map(g=>{
    const circle = circleForGroup(g, id => {
      const representative = rects[id] ? id : loopSlotNodeId(groups, view.edges, g, id);
      return representative && rects[representative] ? center(rects[representative]) : undefined;
    });
    return {id:g.id,label:g.label,center:{x:circle.x,y:circle.y},radius:circle.radius};
  });
  const depth = (g: GraphGroup) => {
    let current: GraphGroup | undefined = g, value = 0;
    while (current?.parentId && value < 32) { value++; current = groups.find(p => p.id === current!.parentId); }
    return value;
  };
  // When a real edge belongs to more than one cycle, its innermost loop supplies
  // the curve. IDs break ties so reordering groups cannot change the drawing.
  const loopOrder = view.loops.map((g,i)=>({g,i})).sort((a,b)=>depth(b.g)-depth(a.g)
    || loops[a.i].radius-loops[b.i].radius || a.g.id.localeCompare(b.g.id));
  const edges=view.edges.map((original):EdgeGeometry=>{
    const sameEndpoints=view.edges.filter(e=>e.source===original.source&&e.target===original.target);
    const first=sameEndpoints[0].id===original.id;
    const edge={...original,label:first?[...new Set(sameEndpoints.map(e=>e.label).filter(Boolean))].join(' / '):''};
    const a=rects[edge.source], b=rects[edge.target], ac=center(a),bc=center(b);
    const sourceAnchor=edge.sourceAnchor?projectAnchor(a,edge.sourceAnchor):undefined;
    const targetAnchor=edge.targetAnchor?projectAnchor(b,edge.targetAnchor):undefined;
    let source=sourceAnchor||boundary(a,bc),target=targetAnchor||boundary(b,ac),path:string,points:Point[],label:Point={x:(ac.x+bc.x)/2,y:(ac.y+bc.y)/2};
    const loopIndex=loopOrder.find(({g})=>followsLoop(g,edge,view))?.i ?? -1;
    if(edge.source===edge.target) {
      source=sourceAnchor||{x:a.x+a.width,y:a.y+a.height*.3};target=targetAnchor||{x:a.x+a.width,y:a.y+a.height*.75};
      points=[source,sourceAnchor?offset(source,normal(a,source),150):{x:source.x+95,y:source.y-85},
        targetAnchor?offset(target,normal(b,target),150):{x:target.x+95,y:target.y+85},target];
      path=`M${point(source)} C${point(points[1])} ${point(points[2])} ${point(target)}`;
      label={x:source.x+88,y:a.y+a.height/2};
    } else if(loopIndex>=0) {
      const loop=loops[loopIndex],c=loop.center;
      const sourceAngle=Math.atan2(ac.y-c.y,ac.x-c.x);
      let targetAngle=Math.atan2(bc.y-c.y,bc.x-c.x);
      while(targetAngle<=sourceAngle)targetAngle+=2*Math.PI;
      const polar=(angle:number)=>({x:c.x+loop.radius*Math.cos(angle),y:c.y+loop.radius*Math.sin(angle)});
      const start=exitAngle(a,polar,sourceAngle,targetAngle),end=exitAngle(b,polar,targetAngle,sourceAngle);
      const onCircle=Math.abs(distance(ac,c)-loop.radius)<1&&Math.abs(distance(bc,c)-loop.radius)<1;
      if(onCircle && start!==undefined && end!==undefined && start<end && !sourceAnchor && !targetAnchor) {
        source=polar(start);target=polar(end);
        path=`M${point(source)} A${loop.radius},${loop.radius} 0 ${end-start>Math.PI?1:0} 1 ${point(target)}`;
        points=Array.from({length:41},(_,i)=>polar(start+(end-start)*i/40));label=polar((start+end)/2);
        const angle=(start+end)/2;label={x:label.x+22*Math.cos(angle),y:label.y+22*Math.sin(angle)};
      } else {
        // A manually moved member keeps its position; a tangent curve follows it.
        const sa=sourceAngle,ta=targetAngle;
        source=sourceAnchor||boundary(a,{x:ac.x-Math.sin(sa)*100,y:ac.y+Math.cos(sa)*100});
        target=targetAnchor||boundary(b,{x:bc.x+Math.sin(ta)*100,y:bc.y-Math.cos(ta)*100});
        const k=Math.max(80,distance(source,target)*.5);
        points=[source,offset(source,sourceAnchor?normal(a,source):{x:-Math.sin(sa),y:Math.cos(sa)},k),
          offset(target,targetAnchor?normal(b,target):{x:Math.sin(ta),y:-Math.cos(ta)},k),target];
        path=`M${point(source)} C${point(points[1])} ${point(points[2])} ${point(target)}`;
        label={x:(points[1].x+points[2].x)/2,y:(points[1].y+points[2].y)/2};
      }
    } else {
      const obstacles=Object.entries(rects).filter(([id])=>id!==edge.source&&id!==edge.target).map(([,r])=>r);
      const leaving=loopOrder.find(({g})=>g.nodeIds.includes(edge.source)&&!g.nodeIds.includes(edge.target))?.i ?? -1;
      if(leaving>=0) {
        const l=loops[leaving];
        source=sourceAnchor||boundary(a,{x:ac.x+(ac.x-l.center.x),y:ac.y+(ac.y-l.center.y)});
        // Leave the loop outward instead of cutting back through its centre.
        obstacles.push({x:l.center.x-l.radius*.62,y:l.center.y-l.radius*.62,width:l.radius*1.24,height:l.radius*1.24});
      }
      if(sourceAnchor||targetAnchor) {
        const start=offset(source,normal(a,source),28),end=offset(target,normal(b,target),28);
        points=[source,...route(start,end,[...obstacles,a,b]),target];
      } else points=route(source,target,obstacles);
      path=roundedPath(points);
      // Label the longest segment; ties use the earlier segment deterministically.
      let best=0;for(let i=1;i<points.length;i++)if(distance(points[i-1],points[i])>best){best=distance(points[i-1],points[i]);label={x:(points[i-1].x+points[i].x)/2,y:(points[i-1].y+points[i].y)/2};}
      label ||= {x:(source.x+target.x)/2,y:(source.y+target.y)/2};
    }
    return {edge,path,label,source,target,points,isLoop:loopIndex>=0||edge.source===edge.target};
  });
  const pts=[...Object.values(rects).flatMap(r=>[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y+r.height}]),...edges.flatMap(e=>[...e.points,{x:e.label.x-90,y:e.label.y-28},{x:e.label.x+90,y:e.label.y+28}]),...loops.flatMap(l=>[{x:l.center.x-l.radius-60,y:l.center.y-l.radius-60},{x:l.center.x+l.radius+60,y:l.center.y+l.radius+60}])];
  const minX=(pts.length?Math.min(...pts.map(p=>p.x)):0)-40,minY=(pts.length?Math.min(...pts.map(p=>p.y)):0)-40;
  const bounds={x:minX,y:minY,width:(pts.length?Math.max(...pts.map(p=>p.x)):260)-minX+40,height:(pts.length?Math.max(...pts.map(p=>p.y)):130)-minY+40};
  return {view,rects,edges,loops,bounds};
}

export function createRootScene(graph:Graph,showBranches=false,measurements:Record<string,{width:number;height:number}>={}):Scene {
  const primary=createScene(buildView(graph),measurements);
  if(!showBranches)return primary;
  const expanded=createScene(buildView(graph,{},true),measurements);
  const retained=new Map(primary.edges.map(e=>[e.edge.id,e]));
  return {...expanded,edges:expanded.edges.map(e=>retained.get(e.edge.id)||e)};
}

export function nodePorts(node:ViewNode,scene:Scene) {
  return scene.edges.flatMap(e=>[
    ...(e.edge.source===node.id?[{id:`out:${e.edge.id}`,type:'source' as const,point:e.source}]:[]),
    ...(e.edge.target===node.id?[{id:`in:${e.edge.id}`,type:'target' as const,point:e.target}]:[]),
  ]).map(p=>({...p,x:p.point.x-node.position.x,y:p.point.y-node.position.y}));
}
