import dagre from '@dagrejs/dagre';
import type { Graph, GraphNode, NodeKind } from './types';

export const cloneGraph = (graph: Graph): Graph => JSON.parse(JSON.stringify(graph));
export const sameGraph = (a: Graph, b: Graph): boolean => JSON.stringify(a) === JSON.stringify(b);
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
export const blankGraph = (title = '未命名流程'): Graph => ({ schemaVersion: 1, title, description: '', constraints: '', nodes: [], edges: [] });
export const nodeWidth = (node: GraphNode) => node.data.expanded && node.data.notes ? 360 : 248;
export function createNode(kind: NodeKind, position: { x: number; y: number }): GraphNode {
  const labels = { start: '流程开始', step: '新的处理步骤', decision: '是否满足条件？', end: '流程结束' };
  return { id: newId('node'), type: kind, position, data: { label: labels[kind], notes: '', executor: 'program', expanded: false } };
}
export function removeNodes(graph: Graph, ids: string[]): Graph {
  const removed = new Set(ids);
  return { ...graph, nodes: graph.nodes.filter(n => !removed.has(n.id)), edges: graph.edges.filter(e => !removed.has(e.source) && !removed.has(e.target)) };
}
export function layoutGraph(graph: Graph, measurements: Record<string, { width: number; height: number }> = {}): Graph {
  if (!graph.nodes.length) return graph;
  const layout = new dagre.graphlib.Graph({ multigraph: true });
  layout.setGraph({ rankdir: 'TB', nodesep: 90, ranksep: 92, marginx: 60, marginy: 40 });
  layout.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach(n => layout.setNode(n.id, {
    width: measurements[n.id]?.width || nodeWidth(n),
    height: measurements[n.id]?.height || (n.type === 'decision' ? 144 : 98) + (n.data.expanded ? Math.min(700, n.data.notes.length * 0.65) : 0),
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
  if (graph.nodes.length > 9) warnings.push('主线超过 9 个节点。可以考虑把次要细节放入说明，但不要省略必要分支。');
  if (graph.nodes.length > 1 && graph.nodes.some(n => !graph.edges.some(e => e.source === n.id || e.target === n.id))) warnings.push('有尚未连接的节点，确认前请检查是否遗漏连线。');
  return warnings;
}
