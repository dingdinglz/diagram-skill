import { describe, expect, it } from 'vitest';
import raw from '../../examples/tangent-loops.json';
import oldRaw from '../../examples/loop-flow.json';
import { circleForGroup, loopSlotNodeId } from './circles';
import { layoutGroups } from './layout';
import { buildView, moveItem, NODE_HEIGHT, NODE_WIDTH } from './views';
import type { Graph, GraphGroup } from './types';

const fixture = () => structuredClone(raw) as Graph;
const centre = (graph: Graph, id: string) => {
  const node = graph.nodes.find(n => n.id === id)!;
  return { x: node.position.x + NODE_WIDTH / 2, y: node.position.y + NODE_HEIGHT / 2 };
};
const onCircle = (graph: Graph, group: GraphGroup, id: string) => {
  const point = centre(graph, id), circle = group.circle!;
  expect(Math.hypot(point.x - circle.x, point.y - circle.y)).toBeCloseTo(circle.radius, 6);
};

describe('stored and inferred circle geometry', () => {
  it('fits unequally spaced legacy cards without using their mean as the centre', () => {
    const group = fixture().groups![0]; delete group.circle;
    const angles = [0, .4, 2.1];
    const points = Object.fromEntries(group.order.map((id, index) => [id, { x: 500 + 300 * Math.cos(angles[index]), y: 400 + 300 * Math.sin(angles[index]) }]));
    const circle = circleForGroup(group, id => points[id]);
    expect(circle.x).toBeCloseTo(500, 6); expect(circle.y).toBeCloseTo(400, 6); expect(circle.radius).toBeCloseTo(300, 6);
  });

  it('uses a persisted circle after a card moves, without changing the graph', () => {
    const graph = fixture(), moved = moveItem(graph, 'shared', { x: 50, y: 80 }), before = JSON.stringify(moved);
    const circle = circleForGroup(moved.groups![0], id => centre(moved, id));
    expect(circle).toEqual(graph.groups![0].circle);
    expect(JSON.stringify(moved)).toBe(before);
  });

  it('keeps sparse and collinear legacy orders finite', () => {
    const group = fixture().groups![0]; delete group.circle;
    for (const order of [[], ['a'], ['a', 'b'], ['a', 'b', 'c']]) {
      const circle = circleForGroup({ ...group, order }, id => ({ x: 'abc'.indexOf(id) * 200, y: 50 }));
      expect(Number.isFinite(circle.x) && Number.isFinite(circle.y) && Number.isFinite(circle.radius)).toBe(true);
      expect(circle.radius).toBeGreaterThan(0);
    }
  });
});

describe('explicit layout of visible loops', () => {
  it('places the real shared card at external tangency for nested and peer loops', () => {
    for (const nested of [true, false]) {
      const graph = fixture();
      if (!nested) { graph.groups![1].parentId = null; graph.groups![0].nodeIds = ['choose', 'shared', 'finish']; }
      const before = JSON.stringify(graph), laid = layoutGroups(graph), [parent, child] = laid.groups!;
      const a = parent.circle!, b = child.circle!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(a.radius + b.radius, 6);
      parent.order.forEach(id => onCircle(laid, parent, id)); child.order.forEach(id => onCircle(laid, child, id));
      expect(buildView(laid).nodes.filter(n => n.id === 'shared')).toHaveLength(1);
      expect(laid.edges).toEqual(graph.edges);
      expect(laid.nodes.map(n => n.data)).toEqual(graph.nodes.map(n => n.data));
      expect(JSON.stringify(graph)).toBe(before);
    }
  });

  it('uses the real entry of an old child-group slot and retains its distinct exit', () => {
    const graph = fixture();
    graph.groups![0].order = ['choose', 'retry-loop', 'finish'];
    graph.edges = graph.edges.filter(edge => edge.id !== 'accepted');
    graph.edges.push({ id: 'completed', source: 'check', target: 'finish', label: '完成', role: 'main' });
    expect(loopSlotNodeId(graph.groups!, graph.edges, graph.groups![0], 'retry-loop')).toBe('shared');
    const laid = layoutGroups(graph), [parent, child] = laid.groups!;
    onCircle(laid, parent, 'shared'); onCircle(laid, child, 'shared');
    expect(laid.edges.find(edge => edge.id === 'completed')).toEqual(graph.edges.find(edge => edge.id === 'completed'));
    expect(laid.edges.some(edge => edge.source === 'shared' && edge.target === 'finish')).toBe(false);
  });

  it('keeps an ordinary subflow as a circular card and lays out its details', () => {
    const graph = structuredClone(oldRaw) as Graph, laid = layoutGroups(graph), group = laid.groups![0], work = laid.groups![1];
    const p = { x: work.position.x + NODE_WIDTH / 2, y: work.position.y + NODE_HEIGHT / 2 };
    expect(Math.hypot(p.x - group.circle!.x, p.y - group.circle!.y)).toBeCloseTo(group.circle!.radius, 6);
    expect(laid.nodes.find(n => n.id === 'generate')!.position).not.toEqual(laid.nodes.find(n => n.id === 'send')!.position);
    expect(laid.edges).toEqual(graph.edges);
  });

  it('keeps complex overlaps deterministic without duplicating cards or changing behavior', () => {
    const graph = fixture();
    graph.groups![1].parentId = null;
    graph.groups![0].nodeIds = ['choose', 'shared', 'finish'];
    graph.groups!.push({ ...graph.groups![1], id: 'another-loop', parentId: null, nodeIds: ['shared', 'choose', 'check'], order: ['shared', 'choose', 'check'] });
    const first = layoutGroups(graph), second = layoutGroups(graph);
    expect(second).toEqual(first);
    expect(new Set(first.nodes.map(n => n.id)).size).toBe(graph.nodes.length);
    expect(first.edges).toEqual(graph.edges);
    first.nodes.forEach(n => expect(Number.isFinite(n.position.x) && Number.isFinite(n.position.y)).toBe(true));
    first.groups!.forEach(g => expect(g.circle && g.circle.radius > 0).toBeTruthy());
  });
});
