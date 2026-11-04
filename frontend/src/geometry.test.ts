import { describe, expect, it } from 'vitest';
import type { Graph, GraphGroup } from './types';
import { buildView, moveItem, NODE_HEIGHT, NODE_WIDTH } from './views';
import { createRootScene, createScene } from './geometry';
import { projectAnchor } from './anchors';
import sample from '../../examples/sample-flow.json';

function tangentGraph(): Graph {
  const height = 220 * Math.sqrt(3) / 2;
  const centres = { shared: [220, 0], a: [-110, height], b: [-110, -height], c: [550, -height], d: [550, height] };
  const group = (id: string, order: string[], parentId: string | null, x: number): GraphGroup => ({
    id, kind: 'loop', label: id, summary: '', parentId, nodeIds: order, order,
    position: { x: 0, y: 0 }, circle: { x, y: 0, radius: 220 },
  });
  const outer = group('outer', ['shared', 'a', 'b'], null, 0);
  outer.nodeIds = Object.keys(centres);
  return {
    schemaVersion: 2, title: 'Shared loops', description: '', constraints: '',
    nodes: Object.entries(centres).map(([id, [x, y]]) => ({ id, type: 'step',
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      data: { label: id, notes: '', expanded: false, executor: 'program', role: 'main' } })),
    edges: [['shared', 'a'], ['a', 'b'], ['b', 'shared'], ['shared', 'c'], ['c', 'd'], ['d', 'shared']]
      .map(([source, target]) => ({ id: `${source}-${target}`, source, target, role: 'main' })),
    groups: [outer, group('inner', ['shared', 'c', 'd'], 'outer', 440)],
  };
}

describe('circle and outline geometry', () => {
  it('draws both tangent loops with one shared card and exact outline intersections', () => {
    const graph = tangentGraph(), before = JSON.stringify(graph), scene = createScene(buildView(graph));
    expect(scene.view.nodes).toHaveLength(5);
    expect(scene.loops).toHaveLength(2);
    for (const edge of scene.edges) {
      expect(edge.isLoop).toBe(true);
      expect(edge.path).toContain(' A');
      for (const end of ['source', 'target'] as const) {
        const rect = scene.rects[edge.edge[end]], p = edge[end];
        const projected = projectAnchor(rect, { x: (p.x - rect.x) / rect.width, y: (p.y - rect.y) / rect.height });
        expect(p.x).toBeCloseTo(projected.x, 5);
        expect(p.y).toBeCloseTo(projected.y, 5);
      }
    }
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('keeps circles and unrelated edges fixed when a shared card is dragged', () => {
    const graph = tangentGraph(), initial = createScene(buildView(graph));
    const changed = moveItem(graph, 'shared', { x: 170, y: 40 }), moved = createScene(buildView(changed));
    expect(moved.loops).toEqual(initial.loops);
    graph.nodes.filter(n => n.id !== 'shared').forEach(n => expect(changed.nodes.find(m => m.id === n.id)).toEqual(n));
    initial.edges.forEach(edge => {
      const after = moved.edges.find(e => e.edge.id === edge.edge.id)!;
      if (edge.edge.source === 'shared' || edge.edge.target === 'shared') expect(after.path).toContain(' C');
      else expect(after.path).toBe(edge.path);
    });
  });

  it('honors saved outline anchors and uses them after moving a card', () => {
    const graph = tangentGraph();
    graph.edges[0].sourceAnchor = { x: 1, y: .37 };
    graph.edges[0].targetAnchor = { x: .22, y: 0 };
    for (const input of [graph, moveItem(graph, 'shared', { x: 200, y: 100 })]) {
      const scene = createScene(buildView(input)), edge = scene.edges[0];
      expect(edge.source).toEqual(projectAnchor(scene.rects.shared, graph.edges[0].sourceAnchor));
      expect(edge.target).toEqual(projectAnchor(scene.rects.a, graph.edges[0].targetAnchor));
      expect(edge.path).not.toMatch(/NaN|Infinity/);
    }
  });

  it('resolves expanded child slots to their real entry and exit without changing the route', () => {
    const graph = tangentGraph();
    graph.groups![0].order = ['a', 'inner', 'b'];
    graph.edges = [
      { id: 'enter', source: 'a', target: 'shared' },
      { id: 'leave', source: 'd', target: 'b' },
      { id: 'close', source: 'b', target: 'a' },
      ...graph.edges.slice(3),
    ];
    const scene = createScene(buildView(graph));
    expect(scene.rects.inner).toBeUndefined();
    expect(scene.edges.find(e => e.edge.id === 'leave')).toMatchObject({ isLoop: true, edge: { source: 'd', target: 'b' } });
    expect(scene.edges.find(e => e.edge.id === 'leave')!.path).toContain(' C');
    expect(scene.edges.every(e => !/NaN|Infinity/.test(e.path))).toBe(true);
  });

  it('infers old circles without writing fields and ignores group declaration order', () => {
    const graph = tangentGraph();
    graph.groups!.forEach(g => delete g.circle);
    const before = JSON.stringify(graph), scene = createScene(buildView(graph));
    expect(scene.loops.find(l => l.id === 'outer')!.center.x).toBeCloseTo(0);
    expect(scene.loops.find(l => l.id === 'inner')!.center.x).toBeCloseTo(440);
    const reversed = createScene(buildView({ ...graph, groups: [...graph.groups!].reverse() }));
    expect(reversed.edges).toEqual(scene.edges);
    expect(JSON.stringify(graph)).toBe(before);
  });
});

describe('detour endpoints', () => {
  it('enters a card from the side it arrives on instead of running along its edge', () => {
    const scene = createRootScene(sample as unknown as Graph, true);
    const geometry = scene.edges.find(item => item.edge.id === 'reject-to-finish')!;
    const card = scene.rects['finish-attempt'];
    expect(geometry.target).toEqual({ x: card.x + card.width, y: card.y + card.height / 2 });
    const beforeLast = geometry.points[geometry.points.length - 2];
    expect(beforeLast.y).toBe(geometry.target.y);
    expect(beforeLast.x).toBeGreaterThan(geometry.target.x);
  });
});
