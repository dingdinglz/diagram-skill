import { describe, expect, it } from 'vitest';
import { connectingEdge, createLoop, freeSpot, groupLoopRoute, insertOnEdge, loopRoute, loopToSubflow, resizeLoop, reverseEdge, setGroupKind, setRoles, subflowToLoop } from './authoring';
import { createGroup } from './groups';
import { createNode, validLoop } from './model';
import { buildView, groupsOf } from './views';
import type { Graph } from './types';

const chain = (closed = false): Graph => {
  const ids = ['a', 'b', 'c'];
  return { schemaVersion: 2, title: 't', description: '', constraints: '', groups: [],
    nodes: [...ids, 'z'].map((id, i) => ({ ...createNode('step', { x: 0, y: i * 216 }), id })),
    edges: [{ id: 'ab', source: 'a', target: 'b' }, { id: 'bc', source: 'b', target: 'c' }, { id: 'cz', source: 'c', target: 'z' }, ...(closed ? [{ id: 'ca', source: 'c', target: 'a' }] : [])] };
};

describe('direct authoring', () => {
  it('finds a free column instead of covering a card', () => {
    expect(freeSpot([{ position: { x: 0, y: 0 } }], { x: 0, y: 0 }).x).toBe(290);
    expect(freeSpot([{ position: { x: 0, y: 0 } }], { x: 0, y: 400 })).toEqual({ x: 0, y: 400 });
  });
  it('inserts on a connection, keeps its condition and makes room', () => {
    const graph = chain(); graph.edges[0].label = '通过';
    const node = { ...createNode('step', { x: 0, y: 0 }), id: 'n' };
    const next = insertOnEdge(graph, 'ab', node, null, graph.nodes[0].position, graph.nodes[1].position);
    expect(next.edges.find(e => e.id === 'ab')).toMatchObject({ source: 'a', target: 'n', label: '通过' });
    expect(next.edges.find(e => e.source === 'n')).toMatchObject({ target: 'b', label: '' });
    expect(next.nodes.find(n => n.id === 'n')!.position.y).toBe(216);
    expect(next.nodes.find(n => n.id === 'b')!.position.y).toBe(432);
  });
  it('keeps a loop valid when inserting on its route', () => {
    const made = createLoop(chain(true), ['a', 'b', 'c'], null)!;
    const node = { ...createNode('step', { x: 0, y: 0 }), id: 'n' };
    const next = insertOnEdge(made.graph, 'ab', node, null, { x: 0, y: 0 }, { x: 500, y: 500 });
    const loop = groupsOf(next).find(g => g.id === made.groupId)!;
    expect(loop.kind).toBe('loop');
    expect(loop.order).toEqual(['a', 'n', 'b', 'c']);
  });
  it('reverses a connection with its anchors', () => {
    const graph = chain(); graph.edges[0].sourceAnchor = { x: 1, y: 0 };
    const edge = reverseEdge(graph, 'ab').edges[0];
    expect(edge).toMatchObject({ source: 'b', target: 'a', targetAnchor: { x: 1, y: 0 } });
    expect(edge.sourceAnchor).toBeUndefined();
  });
  it('classifies cards and only the connections between them', () => {
    const next = setRoles(chain(), ['a', 'b'], 'exception');
    expect(next.nodes.find(n => n.id === 'b')!.data.role).toBe('exception');
    expect(next.edges.find(e => e.id === 'ab')!.role).toBe('exception');
    expect(next.edges.find(e => e.id === 'bc')!.role).not.toBe('exception');
  });
  it('tells a ring from a chain from unrelated cards', () => {
    expect(loopRoute(chain(true), ['a', 'b', 'c'])).toEqual({ order: ['a', 'b', 'c'] });
    expect(loopRoute(chain(), ['a', 'b', 'c'])).toEqual({ order: ['a', 'b', 'c'], closing: { source: 'c', target: 'a' } });
    expect(loopRoute(chain(), ['a', 'c'])).toBeNull();
  });
  it('creates a valid loop that keeps cards on the circle and clear of neighbours', () => {
    const made = createLoop(chain(true), ['a', 'b', 'c'], null)!;
    const loop = groupsOf(made.graph).find(g => g.id === made.groupId)!;
    expect(validLoop(made.graph, loop)).toBe(true);
    expect(buildView(made.graph).loops.map(g => g.id)).toEqual([made.groupId]);
    const card = made.graph.nodes.find(n => n.id === 'a')!.position;
    expect(Math.hypot(card.x + 124 - loop.circle!.x, card.y + 58 - loop.circle!.y)).toBeCloseTo(loop.circle!.radius, 0);
    expect(made.graph.nodes.find(n => n.id === 'z')!.position.y).toBeGreaterThan(loop.circle!.y + loop.circle!.radius);
  });
  it('adds a named closing edge only for a chain', () => {
    const made = createLoop(chain(), ['a', 'b', 'c'], null)!;
    expect(made.graph.edges.filter(e => e.source === 'c' && e.target === 'a')).toHaveLength(1);
    expect(createLoop(chain(), ['a', 'c'], null)).toBeNull();
  });
  it('converts a subflow to a loop and back without changing steps', () => {
    const made = createGroup(chain(true), ['a', 'b', 'c'], null)!;
    expect(groupLoopRoute(made.graph, made.groupId)?.closing).toBeUndefined();
    const loop = subflowToLoop(made.graph, made.groupId);
    expect(groupsOf(loop)[0].kind).toBe('loop');
    const back = loopToSubflow(loop, made.groupId), group = groupsOf(back)[0];
    expect(group).toMatchObject({ kind: 'subflow', order: [] });
    expect(group.circle).toBeUndefined();
    expect(back.edges).toEqual(loop.edges);
  });
  it('resizes a ring around its centre', () => {
    const made = createLoop(chain(true), ['a', 'b', 'c'], null)!, before = groupsOf(made.graph)[0].circle!;
    const next = resizeLoop(made.graph, made.groupId, before.radius + 100), loop = groupsOf(next)[0];
    expect(loop.circle).toEqual({ x: before.x, y: before.y, radius: before.radius + 100 });
    const card = next.nodes.find(n => n.id === 'a')!.position;
    expect(Math.hypot(card.x + 124 - before.x, card.y + 58 - before.y)).toBeCloseTo(before.radius + 100, 0);
    expect(validLoop(next, loop)).toBe(true);
  });
  it('hides a branch group from the main view', () => {
    const made = createGroup(chain(), ['b'], null)!;
    expect(buildView(made.graph).nodes.some(n => n.id === made.groupId)).toBe(true);
    const branch = setGroupKind(made.graph, made.groupId, 'branch');
    expect(buildView(branch).nodes.some(n => n.id === made.groupId)).toBe(false);
  });
  it('omits a role on a v1 connection', () => {
    expect(connectingEdge({ ...chain(), schemaVersion: 1 }, 'a', 'b').role).toBeUndefined();
  });
});
