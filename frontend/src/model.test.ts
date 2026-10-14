import { describe, expect, it } from 'vitest';
import { approvalIssues, blankGraph, cloneGraph, createNode, graphWarnings, layoutGraph, removeNodes, sameGraph } from './model';
import type { Graph } from './types';

function fixture(): Graph {
  const graph = blankGraph('消息校验');
  graph.nodes = [createNode('start', { x: 10, y: 30 }), createNode('decision', { x: -200, y: 90 }), createNode('end', { x: 40, y: 200 })];
  graph.nodes.forEach((n, i) => { n.id = `n${i}`; });
  graph.edges = [
    { id: 'e1', source: 'n0', target: 'n1' },
    { id: 'e2', source: 'n1', target: 'n2', label: '通过' },
    { id: 'e3', source: 'n1', target: 'n0', label: '不通过，重新输入' },
  ];
  return graph;
}
describe('graph semantics', () => {
  it('does not allow approving an empty graph', () => expect(approvalIssues(blankGraph())).toContain('至少添加一个流程节点。'));
  it('accepts a labeled retry cycle', () => expect(approvalIssues(fixture())).toEqual([]));
  it('requires each decision branch to be named', () => {
    const graph = fixture(); graph.edges[2].label = '';
    expect(approvalIssues(graph).join('')).toContain('每条分支的条件');
  });
  it('requires at least two outgoing decision branches', () => {
    const graph = fixture(); graph.edges.pop();
    expect(approvalIssues(graph).join('')).toContain('至少两个分支');
  });
  it('removes incident edges without changing input', () => {
    const graph = fixture(); const updated = removeNodes(graph, ['n1']);
    expect(updated.nodes).toHaveLength(2); expect(updated.edges).toHaveLength(0); expect(graph.nodes).toHaveLength(3);
  });
  it('deep-clones notes and positions for immutable handoff capture', () => {
    const graph = fixture(); const snapshot = cloneGraph(graph);
    snapshot.nodes[0].data.notes = 'field table'; snapshot.nodes[0].position.x = 500;
    expect(graph.nodes[0].data.notes).toBe(''); expect(graph.nodes[0].position.x).toBe(10);
    expect(sameGraph(snapshot, graph)).toBe(false);
  });
  it('lays out cycles without losing IDs, metadata or edge conditions', () => {
    const graph = fixture(); graph.nodes[0].data.notes = '|字段|含义|';
    const laid = layoutGraph(graph);
    expect(laid.nodes.map(n => n.id)).toEqual(['n0', 'n1', 'n2']);
    expect(laid.edges).toEqual(graph.edges); expect(laid.nodes[0].data.notes).toBe('|字段|含义|');
    laid.nodes.forEach(n => { expect(Number.isFinite(n.position.x)).toBe(true); expect(Number.isFinite(n.position.y)).toBe(true); });
    expect(graph.nodes[0].position.x).toBe(10);
  });
  it('returns empty graphs untouched', () => { const graph = blankGraph(); expect(layoutGraph(graph)).toBe(graph); });
  it('warns about disconnected nodes without forbidding the draft', () => {
    const graph = fixture(); graph.edges = [];
    expect(graphWarnings(graph).join('')).toContain('尚未连接');
  });
});
