import { describe, expect, it } from 'vitest';
import raw from '../../examples/loop-flow.json';
import { buildView, exportViews, moveItem } from './views';
import { createScene, createRootScene } from './geometry';
import { layoutGraph, removeNodes, removeEdges, ungroupNode, reconnectGraphEdge } from './model';
import type { Graph } from './types';
const fixture = (): Graph => structuredClone(raw) as Graph;
const peers = (): Graph => {
  const ids = ['shared','left-a','left-b','right-a','right-b'];
  const orders = [ids.slice(0,3), [ids[0],...ids.slice(3)]];
  return {schemaVersion:2,title:'Shared loop steps',description:'',constraints:'',
    nodes:ids.map((id,i)=>({id,type:'step',position:{x:i*300,y:0},data:{label:id,summary:'',notes:'',executor:'program',expanded:false,role:'main'}})),
    edges:orders.flatMap(order=>order.map((source,i)=>({id:`${source}-${order[(i+1)%order.length]}`,source,target:order[(i+1)%order.length],role:'main'}))),
    groups:orders.map((order,i)=>({id:i?'right':'left',label:i?'Right':'Left',summary:'',kind:'loop',parentId:null,
      nodeIds:[...order],order:[...order],position:{x:i*600,y:0},circle:{x:i*600+300,y:300,radius:300}}))};
};

describe('hierarchical reading views', () => {
  it('keeps the main cycle and replaces the subflow with a reference, without changing data', () => {
    const graph=fixture(), before=JSON.stringify(graph),view=buildView(graph);
    expect(view.nodes.map(n=>n.id).sort()).toEqual(['receive','choose','work','check','finish'].sort());
    expect(view.loops.map(g=>g.id)).toEqual(['request-loop']);
    expect(view.branches.work.map(b=>b.edgeId).sort()).toEqual(['failure','disconnect'].sort());
    expect(view.edges.find(e=>e.id==='pick')?.target).toBe('work');
    expect(JSON.stringify(graph)).toBe(before);
  });
  it('shows branch conditions and references to the original main node', () => {
    const view=buildView(fixture(),{branchEdgeId:'failure'});
    expect(view.nodes.find(n=>n.id==='failed')).toBeTruthy();
    expect(view.nodes.some(n=>n.reference&&n.members.includes('generate'))).toBe(true);
    expect(view.edges.find(e=>e.id==='failure')?.label).toBe('执行失败');
  });
  it('includes all original nodes and edges in the complete export', () => {
    const graph=fixture(), views=exportViews(graph);
    const nodes=new Set(views.flatMap(v=>v.nodes.filter(n=>!n.groupId).flatMap(n=>n.members)));
    const edges=new Set(views.flatMap(v=>v.edges.map(e=>e.id)));
    graph.nodes.forEach(n=>expect(nodes.has(n.id)).toBe(true));
    graph.edges.forEach(e=>expect(edges.has(e.id)).toBe(true));
  });
  it('arranges actual cycle items on a circle and keeps nested data intact', () => {
    const graph=fixture(), laid=layoutGraph(graph), scene=createScene(buildView(laid));
    const loop=scene.loops[0];
    for(const id of ['choose','work','check']) {
      const r=scene.rects[id];
      expect(Math.hypot(r.x+r.width/2-loop.center.x,r.y+r.height/2-loop.center.y)).toBeCloseTo(loop.radius,0);
    }
    expect(scene.edges.find(e=>e.edge.id==='again')?.path).toContain(' A');
    expect(laid.edges).toEqual(graph.edges);
    expect(laid.nodes.map(n=>n.data)).toEqual(graph.nodes.map(n=>n.data));
  });
  it('reading and branch toggling never changes the geometry of surviving nodes', () => {
    const graph=layoutGraph(fixture()), before=JSON.stringify(graph), main=createRootScene(graph);
    buildView(graph,{groupId:'work'});buildView(graph,{branchEdgeId:'failure'});
    const full=createRootScene(graph,true);
    main.view.nodes.forEach(n=>expect(full.rects[n.id]).toEqual(main.rects[n.id]));
    main.edges.forEach(e=>expect(full.edges.find(f=>f.edge.id===e.edge.id)?.path).toEqual(e.path));
    expect(JSON.stringify(graph)).toBe(before);
  });
  it('moving a subflow preserves its internal offsets without moving its parent', () => {
    const graph=fixture(), group=graph.groups![1];
    const changed=moveItem(graph,'work',{x:group.position.x+40,y:group.position.y+80});
    for(const id of group.nodeIds) {
      const a=graph.nodes.find(n=>n.id===id)!,b=changed.nodes.find(n=>n.id===id)!;
      expect(b.position).toEqual({x:a.position.x+40,y:a.position.y+80});
    }
    expect(changed.groups![0].position).toEqual(graph.groups![0].position);
  });
  it('deleting a cycle member retains other data without asserting a broken cycle', () => {
    const graph=removeNodes(fixture(),['check']);
    expect(graph.groups![0].kind).toBe('subflow');
    expect(graph.groups![0].nodeIds).not.toContain('check');
  });
  it('routes a connection around an unrelated card', () => {
    const graph=fixture();graph.groups=[];graph.nodes=graph.nodes.slice(0,3);
    graph.nodes.forEach((n,i)=>{n.position={x:i*300,y:0};n.data.role='main';});
    graph.edges=[{id:'skip',source:graph.nodes[0].id,target:graph.nodes[2].id}];
    const geometry=createScene(buildView(graph)).edges[0];
    expect(geometry.points.some(p=>p.y<0||p.y>116)).toBe(true);
    expect(geometry.path).toContain('Q');
  });
  it('removes a broken loop assertion when a return edge is deleted', () => {
    const graph=removeEdges(fixture(),['again']);
    expect(graph.groups![0].kind).toBe('subflow');
    expect(graph.nodes).toEqual(fixture().nodes);
  });
  it('ungroups a node without deleting the node or any behavior', () => {
    const graph=fixture(), changed=ungroupNode(graph,'check');
    expect(changed.nodes).toEqual(graph.nodes);
    expect(changed.edges).toEqual(graph.edges);
    expect(changed.groups!.every(g=>!g.nodeIds.includes('check'))).toBe(true);
  });
});

describe('shared membership and inline loops', () => {
  it('shows each real shared step once in peer and nested loops', () => {
    for (const nested of [false,true]) {
      const graph=peers();
      if(nested) {graph.groups![0].nodeIds=graph.nodes.map(n=>n.id);graph.groups![1].parentId='left';}
      const before=JSON.stringify(graph), view=buildView(graph);
      expect(view.nodes.map(n=>n.id).sort()).toEqual(graph.nodes.map(n=>n.id).sort());
      expect(view.loops.map(g=>g.id)).toEqual(['left','right']);
      expect(view.groups).toEqual(graph.groups);
      expect(view.edges).toEqual(graph.edges);
      expect(JSON.stringify(graph)).toBe(before);
    }
  });
  it('promotes shared nodes across collapsed groups without array-order ownership', () => {
    for (const kinds of [['loop','subflow'],['subflow','subflow'],['subflow','branch']] as const) {
      const graph=peers();graph.groups!.forEach((g,i)=>{g.kind=kinds[i];if(g.kind!=='loop')g.order=[];});
      const views=[buildView(graph),buildView({...graph,groups:[...graph.groups!].reverse()})];
      for(const view of views) {
        expect(view.nodes.filter(n=>n.id==='shared')).toHaveLength(1);
        expect(new Set(view.nodes.map(n=>n.id)).size).toBe(view.nodes.length);
        expect(view.nodes.filter(n=>n.groupId).every(n=>!n.members.includes('shared'))).toBe(true);
        expect(view.edges.find(e=>e.id==='shared-left-a')?.source).toBe('shared');
        expect(view.edges.find(e=>e.id==='left-b-shared')?.target).toBe('shared');
      }
      expect(views[1].edges).toEqual(views[0].edges);
    }
  });
  it('keeps canonical and projected endpoints stable when showing a shared branch', () => {
    const graph=peers();graph.groups![0].kind='subflow';graph.groups![0].order=[];
    graph.groups![1].kind='branch';graph.groups![1].order=[];
    const main=buildView(graph), full=buildView(graph,{},true);
    expect(main.nodes.some(n=>n.id==='shared')).toBe(true);
    expect(main.nodes.some(n=>n.id==='right')).toBe(false);
    expect(full.nodes.some(n=>n.id==='right')).toBe(true);
    for(const node of main.nodes) expect(full.nodes.find(n=>n.id===node.id)).toEqual(node);
    for(const edge of main.edges) expect(full.edges.find(e=>e.id===edge.id)).toEqual(edge);
  });
  it('exposes explicitly ordered child members and leaves other subflow content collapsed', () => {
    const graph=fixture();graph.groups![0].order=['choose','generate','send','check'];
    const view=buildView(graph);
    expect(view.nodes.filter(n=>n.id==='generate'||n.id==='send')).toHaveLength(2);
    expect(view.edges.find(e=>e.id==='pick')?.target).toBe('generate');
    expect(view.edges.find(e=>e.id==='sent')?.source).toBe('send');
  });
  it('keeps card anchors only when projected endpoints are their canonical cards', () => {
    const graph=fixture(), pick=graph.edges.find(e=>e.id==='pick')!, failure=graph.edges.find(e=>e.id==='failure')!;
    pick.sourceAnchor={x:.2,y:1};pick.targetAnchor={x:.8,y:0};
    failure.sourceAnchor={x:1,y:.2};failure.targetAnchor={x:0,y:.8};
    const root=buildView(graph), branch=buildView(graph,{branchEdgeId:'failure'});
    expect(root.edges.find(e=>e.id==='pick')?.sourceAnchor).toEqual(pick.sourceAnchor);
    expect(root.edges.find(e=>e.id==='pick')).not.toHaveProperty('targetAnchor');
    expect(branch.edges.find(e=>e.id==='failure')).not.toHaveProperty('sourceAnchor');
    expect(branch.edges.find(e=>e.id==='failure')?.targetAnchor).toEqual(failure.targetAnchor);
    expect(pick.targetAnchor).toEqual({x:.8,y:0});
  });
  it('allocates boundary references without colliding with canonical IDs', () => {
    const graph=fixture();graph.nodes.find(n=>n.id==='failed')!.id='reference:in:generate';
    graph.edges.find(e=>e.id==='failure')!.target='reference:in:generate';
    const view=buildView(graph,{branchEdgeId:'failure'});
    expect(new Set(view.nodes.map(n=>n.id)).size).toBe(view.nodes.length);
    const edge=view.edges.find(e=>e.id==='failure')!;
    expect(edge.source).not.toBe(edge.target);
    expect(view.nodes.find(n=>n.id===edge.source)?.members).toEqual(['generate']);
    expect(view.nodes.find(n=>n.id===edge.target)?.reference).not.toBe(true);
  });
  it('exports all real relations with inline nested loops and unique IDs in every scene', () => {
    const graph=peers();graph.groups![0].nodeIds=graph.nodes.map(n=>n.id);graph.groups![1].parentId='left';
    const views=exportViews(graph);
    expect(views).toHaveLength(1);
    expect(views[0].edges.map(e=>e.id)).toEqual(graph.edges.map(e=>e.id));
    for(const view of views) expect(new Set(view.nodes.map(n=>n.id)).size).toBe(view.nodes.length);
  });
});

describe('membership edits', () => {
  it('removes only the requested membership and retains all behavior', () => {
    const graph=peers(), changed=ungroupNode(graph,'shared','right');
    expect(changed.nodes).toEqual(graph.nodes);expect(changed.edges).toEqual(graph.edges);
    expect(changed.groups!.find(g=>g.id==='left')).toEqual(graph.groups![0]);
    expect(changed.groups!.find(g=>g.id==='right')?.nodeIds).not.toContain('shared');
    expect(changed.groups!.find(g=>g.id==='right')?.kind).toBe('subflow');
  });
  it('removes parent membership from descendants while preserving peers', () => {
    const graph=peers();graph.groups!.push({id:'child',kind:'subflow',label:'Child',summary:'',parentId:'left',nodeIds:['shared'],order:[],position:{x:0,y:0}});
    const changed=ungroupNode(graph,'shared','left');
    expect(changed.groups!.some(g=>g.id==='child')).toBe(false);
    expect(changed.groups!.find(g=>g.id==='right')?.nodeIds).toContain('shared');
    expect(changed.nodes).toEqual(graph.nodes);expect(changed.edges).toEqual(graph.edges);
  });
  it('removes a shared node globally and repairs every affected loop', () => {
    const graph=peers(), changed=removeNodes(graph,['shared']);
    expect(changed.nodes.some(n=>n.id==='shared')).toBe(false);
    expect(changed.edges.some(e=>e.source==='shared'||e.target==='shared')).toBe(false);
    expect(changed.groups!.every(g=>g.kind==='subflow'&&!g.nodeIds.includes('shared')&&!g.order.length)).toBe(true);
  });
  it('retains a parent route when deleting a logical member outside that route', () => {
    const graph=peers();graph.groups![0].nodeIds=graph.nodes.map(n=>n.id);graph.groups![1].parentId='left';
    const changed=removeNodes(graph,['right-a']);
    expect(changed.groups![0].kind).toBe('loop');
    expect(changed.groups![0].order).toEqual(graph.groups![0].order);
    expect(changed.groups![1].kind).toBe('subflow');
  });
  it('deletes group metadata and reparents children without deleting behavior', () => {
    const graph=peers();graph.groups![0].nodeIds=graph.nodes.map(n=>n.id);
    graph.groups![1].parentId='middle';
    graph.groups!.push({id:'middle',kind:'subflow',label:'Middle',summary:'',parentId:'left',nodeIds:[...graph.groups![1].nodeIds],order:[],position:{x:0,y:0}});
    const changed=removeNodes(graph,['middle']);
    expect(changed.nodes).toEqual(graph.nodes);expect(changed.edges).toEqual(graph.edges);
    expect(changed.groups!.find(g=>g.id==='right')?.parentId).toBe('left');
  });
  it('rechecks child-slot paths when an internal edge is removed', () => {
    const graph=fixture(), changed=removeEdges(graph,['generated']);
    expect(changed.groups![0].kind).toBe('subflow');
    expect(changed.groups![0].order).toEqual([]);
  });
  it('repairs loop claims after reconnecting while retaining edge identity and the other anchor', () => {
    const graph=peers(), edge=graph.edges[0];
    edge.label='Keep this condition';edge.sourceAnchor={x:.3,y:1};edge.targetAnchor={x:.8,y:0};
    const changed=reconnectGraphEdge(graph,edge.id,'target','right-a',{x:0,y:.25});
    expect(changed.edges[0]).toEqual({...edge,target:'right-a',targetAnchor:{x:0,y:.25}});
    expect(changed.groups!.find(g=>g.id==='left')?.kind).toBe('subflow');
    expect(changed.groups!.find(g=>g.id==='right')?.kind).toBe('loop');
    expect(graph.edges[0].target).toBe('left-a');
  });
  it('moves a shared card alone and translates group circle metadata once', () => {
    const graph=peers();graph.groups![0].nodeIds=graph.nodes.map(n=>n.id);graph.groups![1].parentId='left';
    const changed=moveItem(graph,'shared',{x:20,y:80});
    expect(changed.nodes.find(n=>n.id==='shared')?.position).toEqual({x:20,y:80});
    expect(changed.nodes.filter(n=>n.id!=='shared')).toEqual(graph.nodes.filter(n=>n.id!=='shared'));
    expect(changed.groups).toEqual(graph.groups);
    const moved=moveItem(graph,'left',{x:40,y:80});
    for(const node of graph.nodes) expect(moved.nodes.find(n=>n.id===node.id)?.position).toEqual({x:node.position.x+40,y:node.position.y+80});
    graph.groups!.forEach((g,i)=>expect(moved.groups![i].circle).toEqual({...g.circle!,x:g.circle!.x+40,y:g.circle!.y+80}));
  });
});
