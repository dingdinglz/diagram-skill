import type { Graph, GraphEdge, GraphGroup, GraphNode } from './types';

export type ViewScope = { groupId?: string; branchEdgeId?: string };
export interface ViewNode extends GraphNode { members: string[]; groupId?: string; reference?: boolean }
export interface BranchLink { edgeId: string; label: string; target: string; exception: boolean }
export interface GraphView {
  id: string; title: string; summary: string; nodes: ViewNode[]; edges: GraphEdge[];
  loops: GraphGroup[]; branches: Record<string, BranchLink[]>;
  groups?: GraphGroup[];
}

export const NODE_WIDTH = 248;
export const NODE_HEIGHT = 116;
export const groupsOf = (graph: Graph) => graph.schemaVersion === 2 ? graph.groups || [] : [];
export const groupNode = (g: GraphGroup): ViewNode => ({ id: g.id, type: 'step', position: g.position,
  data: { label: g.label, summary: g.summary, notes: '', executor: 'program', expanded: false }, groupId: g.id, members: g.nodeIds });
export const directItems = (graph: Graph, parentId: string | null): ViewNode[] => {
  const groups = groupsOf(graph), parent = groups.find(g => g.id === parentId);
  const children = groups.filter(g => g.parentId === parentId).sort((a,b) => a.id.localeCompare(b.id));
  const members = parent ? graph.nodes.filter(n => parent.nodeIds.includes(n.id)) : graph.nodes;
  const exposed = new Set(members.filter(n => children.filter(g => g.nodeIds.includes(n.id)).length !== 1
    || parent?.order.includes(n.id)).map(n => n.id));
  return [...members.filter(n => exposed.has(n.id)).map(n => ({ ...n, members: [n.id] })),
    ...children.map(g => ({ ...groupNode(g), members: g.nodeIds.filter(id => !exposed.has(id)) }))];
};

function isAncestor(groups: GraphGroup[], ancestor: string, descendant: string): boolean {
  const visited = new Set<string>();
  let current = groups.find(g => g.id === descendant)?.parentId;
  while (current && !visited.has(current)) {
    if (current === ancestor) return true;
    visited.add(current); current = groups.find(g => g.id === current)?.parentId;
  }
  return false;
}

function isSecondary(graph: Graph, id: string): boolean {
  if (graph.schemaVersion !== 2) return false;
  const node = graph.nodes.find(n => n.id === id);
  if (node?.data.role && node.data.role !== 'main') return true;
  const groups = groupsOf(graph), branches = groups.filter(g => g.kind === 'branch' && g.nodeIds.includes(id));
  return branches.length > 0 && !groups.some(g => g.kind !== 'branch' && g.nodeIds.includes(id)
    && branches.every(b => !isAncestor(groups, g.id, b.id) && !isAncestor(groups, b.id, g.id)));
}

const circularEdge = (groups: GraphGroup[], loop: GraphGroup, edge: GraphEdge): boolean => {
  const members = (id: string) => groups.find(g => g.id === id)?.nodeIds || [id];
  return loop.order.some((id,i) => members(id).includes(edge.source)
    && members(loop.order[(i+1)%loop.order.length]).includes(edge.target));
};

export function buildView(graph: Graph, scope: ViewScope = {}, showBranches = false): GraphView {
  const groups = groupsOf(graph), group = groups.find(g => g.id === scope.groupId);
  const entry = graph.edges.find(e => e.id === scope.branchEdgeId);
  const result: GraphView = { id: scope.groupId || scope.branchEdgeId || 'main', title: group?.label || (entry ? entry.label || '分支流程' : '主流程'),
    summary: group?.summary || '', nodes: [], edges: [], loops: [], branches: {}, groups };
  let members: Set<string> | null = group ? new Set(group.nodeIds) : null;
  if (entry) {
    members = new Set<string>();
    const todo = [entry.target];
    while (todo.length) {
      const id = todo.pop()!;
      if (members.has(id) || !isSecondary(graph, id)) continue;
      members.add(id);
      groups.filter(g => g.kind === 'branch' && g.nodeIds.includes(id))
        .forEach(branch => branch.nodeIds.forEach(n => { if (!members!.has(n)) todo.push(n); }));
      graph.edges.filter(e => e.source === id).forEach(e => todo.push(e.target));
    }
  }
  const candidates = new Map<string, ViewNode>();
  const add = (node: ViewNode) => { candidates.set(node.id, node); };
  if (entry) {
    graph.nodes.filter(n => members!.has(n.id)).forEach(n => add({ ...n, members: [n.id] }));
  } else {
    const visited = new Set<string>();
    const expand = (parentId: string | null) => {
      for (const item of directItems(graph, parentId)) {
        const child = groups.find(g => g.id === item.groupId);
        if (child?.kind === 'loop' && !visited.has(child.id)) {
          visited.add(child.id); result.loops.push(child); expand(child.id);
        } else if (!child || child.kind !== 'loop') add(item);
      }
    };
    if (group?.kind === 'loop') { visited.add(group.id); result.loops.push(group); }
    expand(group?.id || null);
  }
  // Resolve against all candidates before filtering branches. A branch toggle
  // must not transfer a surviving edge from a summary card to a real card.
  const proxies = [...candidates.values()].filter(n => n.groupId);
  for (const node of graph.nodes) {
    const owners = proxies.filter(n => n.members.includes(node.id));
    if (owners.some((a,i) => owners.slice(i+1).some(b => !isAncestor(groups,a.id,b.id) && !isAncestor(groups,b.id,a.id)))) {
      add({ ...node, members: [node.id] });
    }
  }
  const real = new Set([...candidates.values()].filter(n => !n.groupId).map(n => n.id));
  const owner = new Map<string, string>();
  for (const node of graph.nodes) {
    if (real.has(node.id)) owner.set(node.id,node.id);
    else {
      const owners = proxies.filter(n => n.members.includes(node.id));
      const deepest = owners.find(n => !owners.some(other => isAncestor(groups,n.id,other.id)));
      if (deepest) owner.set(node.id,deepest.id);
    }
  }
  result.nodes = [...candidates.values()].map(n => n.groupId ? { ...n, members: n.members.filter(id => owner.get(id) === n.id) } : n);
  if (!entry) {
    if (!group && !showBranches && graph.schemaVersion === 2) {
      result.nodes = result.nodes.filter(n => result.loops.some(g => g.order.includes(n.id)) || (!n.members.every(id => isSecondary(graph, id))
        && groups.find(g => g.id === n.groupId)?.kind !== 'branch'));
    }
  }
  const visible = new Set(result.nodes.map(n => n.id));
  for (const [id, representative] of owner) if (!visible.has(representative)) owner.delete(id);
  const referenceIds = new Map<string,string>();
  const reserved = new Set([...graph.nodes.map(n => n.id), ...groups.map(g => g.id)]);
  const reference = (id: string, direction: 'in' | 'out') => {
    const key = `${direction}:${id}`;
    if (referenceIds.has(key)) return referenceIds.get(key)!;
    let refId = `reference:${direction}:${id}`;
    while (reserved.has(refId)) refId = `reference:${refId}`;
    reserved.add(refId); referenceIds.set(key,refId);
    {
      const node = graph.nodes.find(n => n.id === id)!;
      const bounds = result.nodes.filter(n => !n.reference);
      const x = bounds.length ? (Math.min(...bounds.map(n => n.position.x)) + Math.max(...bounds.map(n => n.position.x))) / 2 : node.position.x;
      const y = bounds.length ? direction === 'in' ? Math.min(...bounds.map(n => n.position.y)) - 210 : Math.max(...bounds.map(n => n.position.y)) + 210 : direction === 'in' ? 0 : 220;
      const siblings = [...referenceIds.keys()].filter(key => key.startsWith(`${direction}:`)).length - 1;
      result.nodes.push({ ...node, id: refId, position: { x: x + siblings * 290, y }, members: [id], reference: true,
        data: { ...node.data, summary: direction === 'in' ? '来自此步骤' : '返回或到达此步骤' } });
    }
    return refId;
  };
  for (const edge of graph.edges) {
    let source = owner.get(edge.source), target = owner.get(edge.target);
    if (members) {
      if (!source && target) source = reference(edge.source, 'in');
      if (source && !target) target = reference(edge.target, 'out');
      if (entry?.id === edge.id && !source && !target) {
        source = reference(edge.source, 'in'); target = reference(edge.target, 'out');
      }
    }
    const onRing = result.loops.some(g => circularEdge(groups,g,edge));
    // Internal relations belong in the subflow, not in its external branch count.
    if (source && source === target && edge.source !== edge.target) continue;
    const omitted = !members && !showBranches && !onRing && graph.schemaVersion === 2 && edge.role && edge.role !== 'main';
    if (source && (!target || omitted)) {
      const links = result.branches[source] ||= [];
      links.push({ edgeId: edge.id, label: edge.label || graph.nodes.find(n => n.id === edge.target)?.data.label || '查看分支',
        target: edge.target, exception: edge.role === 'exception' || graph.nodes.find(n => n.id === edge.target)?.data.role === 'exception' });
    }
    if (source && target && !omitted && (source !== target || edge.source === edge.target)) {
      const projected = { ...edge, source, target };
      if (source !== edge.source) delete projected.sourceAnchor;
      if (target !== edge.target) delete projected.targetAnchor;
      result.edges.push(projected);
    }
  }
  return result;
}

export function exportViews(graph: Graph): GraphView[] {
  const views = [buildView(graph)];
  const inlineLoops = new Set(views[0].loops.map(g => g.id));
  groupsOf(graph).filter(g => !inlineLoops.has(g.id)).forEach(g => views.push(buildView(graph, { groupId: g.id }, true)));
  const covered = () => new Set(views.flatMap(v => v.edges.map(e => e.id)));
  for (const links of Object.values(views[0].branches)) for (const link of links) {
    if (!covered().has(link.edgeId)) views.push(buildView(graph, { branchEdgeId: link.edgeId }, true));
  }
  const nodeIds = new Set(views.flatMap(v => v.nodes.filter(n => !n.groupId).flatMap(n => n.members)));
  const edgeIds = covered();
  const missingEdges = graph.edges.filter(e => !edgeIds.has(e.id));
  const missingNodes = graph.nodes.filter(n => !nodeIds.has(n.id) || missingEdges.some(e => e.source === n.id || e.target === n.id));
  if (missingNodes.length) views.push({ id: 'remaining', title: '其他步骤与关系', summary: '',
    nodes: missingNodes.map(n => ({ ...n, members: [n.id] })), edges: missingEdges, loops: [], branches: {}, groups: groupsOf(graph) });
  return views;
}

export function moveItem(graph: Graph, id: string, position: { x: number; y: number }): Graph {
  const group = groupsOf(graph).find(g => g.id === id);
  if (!group) return { ...graph, nodes: graph.nodes.map(n => n.id === id ? { ...n, position } : n) };
  const dx = position.x - group.position.x, dy = position.y - group.position.y;
  const descends = (candidate: string): boolean => {
    let parent = groupsOf(graph).find(g => g.id === candidate)?.parentId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) { if (parent === id) return true; seen.add(parent); parent = groupsOf(graph).find(g => g.id === parent)?.parentId; }
    return false;
  };
  return { ...graph, nodes: graph.nodes.map(n => group.nodeIds.includes(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n),
    groups: groupsOf(graph).map(g => g.id === id || descends(g.id)
      ? { ...g, position: { x: g.position.x + dx, y: g.position.y + dy },
          ...(g.circle ? { circle: { ...g.circle, x: g.circle.x + dx, y: g.circle.y + dy } } : {}) } : g) };
}

export function upgradeGraph(graph: Graph): Graph {
  return { ...graph, schemaVersion: 2, groups: graph.groups || [], nodes: graph.nodes.map(n => ({ ...n, data: { ...n.data, summary: n.data.summary || '', role: n.data.role || 'main' } })),
    edges: graph.edges.map(e => ({ ...e, role: e.role || 'main' })) };
}
