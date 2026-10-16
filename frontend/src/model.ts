import dagre from '@dagrejs/dagre';
import type { Graph, GraphGroup, GraphNode, NodeKind } from './types';
import { layoutGroups } from './layout';
import { buildView, upgradeGraph } from './views';

export const cloneGraph = (graph: Graph): Graph => JSON.parse(JSON.stringify(graph));
export const sameGraph = (a: Graph, b: Graph): boolean => JSON.stringify(a) === JSON.stringify(b);
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
export const blankGraph = (title = '未命名流程'): Graph => ({ schemaVersion: 1, title, description: '', constraints: '', nodes: [], edges: [] });
export function createNode(kind: NodeKind, position: { x: number; y: number }): GraphNode {
  const labels = { start: '流程开始', step: '新的处理步骤', decision: '是否满足条件？', end: '流程结束' };
  return { id: newId('node'), type: kind, position, data: { label: labels[kind], notes: '', executor: 'program', expanded: false } };
}
function validLoop(graph: Graph, group: GraphGroup): boolean {
  if (!group.order.length) return false;
  const sets = group.order.map(id => new Set(graph.groups?.find(c => c.id === id && c.parentId === group.id)?.nodeIds
    || (group.nodeIds.includes(id) ? [id] : [])));
  if (sets.some((items,i) => !items.size || sets.slice(i+1).some(other => [...items].some(id => other.has(id))))) return false;
  if (!sets.every((src,i) => graph.edges.some(e => src.has(e.source) && sets[(i+1)%sets.length].has(e.target)))) return false;
  const adjacency = new Map(group.nodeIds.map(id => [id, [] as string[]]));
  graph.edges.forEach(e => { if (adjacency.has(e.source) && adjacency.has(e.target)) adjacency.get(e.source)!.push(e.target); });
  const reach = (start: string) => {
    const seen = new Set<string>(), pending = [...adjacency.get(start)!];
    while (pending.length) {
      const id = pending.pop()!;
      if (!seen.has(id)) { seen.add(id); pending.push(...adjacency.get(id)!); }
    }
    return seen;
  };
  const paths = new Map(group.nodeIds.map(id => [id,reach(id)]));
  return group.nodeIds.some(id => paths.get(id)!.has(id)
    && sets.every(items => [...items].some(member => paths.get(id)!.has(member) && paths.get(member)?.has(id))));
}

function repairGroups(graph: Graph, previous: GraphGroup[] = graph.groups || []): Graph {
  if (!graph.groups) return graph;
  const retained = graph.groups.filter(g => g.nodeIds.length);
  const groups = retained.map(g => {
    let parentId = g.parentId;
    const seen = new Set<string>();
    while (parentId && !retained.some(p => p.id === parentId)) {
      if (seen.has(parentId)) { parentId = null; break; }
      seen.add(parentId); parentId = previous.find(p => p.id === parentId)?.parentId || null;
    }
    return { ...g, parentId };
  });
  const repaired = groups.map(g => ({ ...g, order: g.order.filter(id => g.nodeIds.includes(id)
    || groups.some(child => child.id === id && child.parentId === g.id)) }));
  const result = { ...graph, groups: repaired };
  result.groups = repaired.map(g => g.kind === 'loop' && !validLoop(result,g) ? { ...g, kind: 'subflow' as const, order: [] } : g);
  return result;
}

export function removeNodes(graph: Graph, ids: string[]): Graph {
  const removed = new Set(ids);
  const result = { ...graph, nodes: graph.nodes.filter(n => !removed.has(n.id)), edges: graph.edges.filter(e => !removed.has(e.source) && !removed.has(e.target)) };
  if (graph.groups) result.groups = graph.groups.filter(g => !removed.has(g.id))
    .map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => !removed.has(id)) }));
  return repairGroups(result,graph.groups);
}

export function removeEdges(graph: Graph, ids: string[]): Graph {
  return repairGroups({ ...graph, edges: graph.edges.filter(e => !ids.includes(e.id)) });
}

export function reconnectGraphEdge(graph: Graph, id: string, endpoint: 'source' | 'target', nodeId: string,
  anchor?: { x: number; y: number }): Graph {
  if (!graph.nodes.some(n => n.id === nodeId) || !graph.edges.some(e => e.id === id)) return graph;
  const next = anchor ? upgradeGraph(graph) : graph;
  const anchorKey = endpoint === 'source' ? 'sourceAnchor' : 'targetAnchor';
  return repairGroups({ ...next, edges: next.edges.map(edge => {
    if (edge.id !== id) return edge;
    const changed = { ...edge, [endpoint]: nodeId };
    if (anchor) changed[anchorKey] = anchor;
    else delete changed[anchorKey];
    return changed;
  }) });
}

export function ungroupNode(graph: Graph, id: string, groupId?: string): Graph {
  if (!graph.groups || (groupId && !graph.groups.some(g => g.id === groupId))) return graph;
  const affected = (group: GraphGroup) => {
    if (!groupId) return true;
    let current: GraphGroup | undefined = group;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (current.id === groupId) return true;
      seen.add(current.id); current = graph.groups!.find(g => g.id === current!.parentId);
    }
    return false;
  };
  return repairGroups({ ...graph, groups: graph.groups.map(g => affected(g)
    ? { ...g, nodeIds: g.nodeIds.filter(member => member !== id) } : g) },graph.groups);
}
export function layoutGraph(graph: Graph, measurements: Record<string, { width: number; height: number }> = {}): Graph {
  if (!graph.nodes.length) return graph;
  if (graph.schemaVersion === 2) return layoutGroups(graph);
  const layout = new dagre.graphlib.Graph({ multigraph: true });
  layout.setGraph({ rankdir: 'TB', nodesep: 90, ranksep: 92, marginx: 60, marginy: 40 });
  layout.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach(n => layout.setNode(n.id, {
    width: measurements[n.id]?.width || 248,
    height: measurements[n.id]?.height || (n.type === 'decision' ? 144 : 98),
  }));
  graph.edges.forEach(e => layout.setEdge(e.source, e.target, {}, e.id));
  dagre.layout(layout);
  return {
    ...graph,
    nodes: graph.nodes.map(node => {
      const n = layout.node(node.id);
      return { ...node, position: { x: Math.round(n.x - n.width / 2), y: Math.round(n.y - n.height / 2) } };
    }),
  };
}
export function approvalIssues(graph: Graph): string[] {
  const issues: string[] = [];
  if (!graph.title.trim()) issues.push('给流程起一个名字。');
  if (!graph.nodes.length) issues.push('至少添加一个流程节点。');
  for (const n of graph.nodes) {
    if (!n.data.label.trim()) issues.push('有节点还没有填写标题。');
    if (n.type === 'decision') {
      const outgoing = graph.edges.filter(e => e.source === n.id);
      if (outgoing.length < 2) issues.push(`「${n.data.label}」需要至少两个分支。`);
      else if (outgoing.some(e => !e.label?.trim())) issues.push(`请标明「${n.data.label}」每条分支的条件。`);
    }
  }
  return issues;
}
export function graphWarnings(graph: Graph): string[] {
  const warnings: string[] = [];
  if (buildView(graph).nodes.length > 9) warnings.push('主线超过 9 个节点。可以考虑把次要细节放入说明，但不要省略必要分支。');
  if (graph.nodes.length > 1 && graph.nodes.some(n => !graph.edges.some(e => e.source === n.id || e.target === n.id))) warnings.push('有尚未连接的节点，确认前请检查是否遗漏连线。');
  return warnings;
}
