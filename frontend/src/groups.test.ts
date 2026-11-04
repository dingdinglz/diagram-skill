import { describe, expect, it } from 'vitest';
import { addNodeAtLevel, createEmptySubflow, createGroup, dissolveGroup, groupEndpoint, groupingBlock, groupLinks, groupPath, levelOf, moveIntoGroup, moveToParentLevel } from './groups';
import { createNode } from './model';
import { buildView, groupsOf } from './views';
import type { Graph } from './types';

// 履约发货 → 拣货打包 → 复核商品, plus a sibling at each level.
const nested = (): Graph => {
  const ids = ['receive', 'allocate', 'pick', 'scan', 'match', 'box', 'book', 'handover'];
  const group = (id: string, parentId: string | null, nodeIds: string[], x: number) => ({ id, parentId, nodeIds, kind: 'subflow' as const, label: id, summary: '', order: [], position: { x, y: 0 } });
  return { schemaVersion: 2, title: 't', description: '', constraints: '',
    nodes: ids.map((id, i) => ({ ...createNode('step', { x: 0, y: i * 216 }), id })),
    edges: ids.slice(1).map((id, i) => ({ id: `e${i}`, source: ids[i], target: id })),
    groups: [group('fulfill', null, ids.slice(1), 0), group('pack', 'fulfill', ['pick', 'scan', 'match', 'box'], 500), group('inspect', 'pack', ['scan', 'match'], 1000), group('ship', 'fulfill', ['book', 'handover'], 1500)] };
};
const flat = (): Graph => ({ schemaVersion: 1, title: 't', description: '', constraints: '', edges: [
  { id: 'ab', source: 'a', target: 'b' }, { id: 'bc', source: 'b', target: 'c' }, { id: 'cd', source: 'c', target: 'd' },
], nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({ ...createNode('step', { x: 0, y: i * 200 }), id })) });
/** The backend rule: every child stays inside its parent. */
const contained = (graph: Graph) => groupsOf(graph).every(g => {
  const parent = groupsOf(graph).find(p => p.id === g.parentId);
  return !g.parentId || (!!parent && g.nodeIds.every(id => parent.nodeIds.includes(id)));
});

describe('manual nesting', () => {
  it('groups a selection at the root, upgrades the schema and collapses it to one card', () => {
    const created = createGroup(flat(), ['b', 'c'], null)!;
    expect(created.graph.schemaVersion).toBe(2);
    const view = buildView(created.graph);
    expect(view.nodes.map(n => n.id).sort()).toEqual(['a', 'd', created.groupId].sort());
    expect(view.edges.map(e => [e.source, e.target])).toEqual([['a', created.groupId], [created.groupId, 'd']]);
  });
  it('nests a new group inside the current level and adopts selected child groups', () => {
    const graph = nested();
    const created = createGroup(graph, ['pack', 'allocate'], 'fulfill')!;
    const group = groupsOf(created.graph).find(g => g.id === created.groupId)!;
    expect(group.parentId).toBe('fulfill');
    expect(groupsOf(created.graph).find(g => g.id === 'pack')?.parentId).toBe(created.groupId);
    expect(group.nodeIds).toEqual(expect.arrayContaining(['allocate', 'pick', 'scan', 'match', 'box']));
    expect(contained(created.graph)).toBe(true);
    expect(groupPath(created.graph, 'inspect').map(g => g.id)).toEqual(['fulfill', created.groupId, 'pack', 'inspect']);
  });
  it('adds a node to every enclosing group, keeping the hierarchy valid', () => {
    const graph = addNodeAtLevel(nested(), { ...createNode('step', { x: 0, y: 0 }), id: 'fresh' }, 'inspect');
    for (const id of ['inspect', 'pack', 'fulfill']) expect(groupsOf(graph).find(g => g.id === id)?.nodeIds).toContain('fresh');
    expect(groupsOf(graph).find(g => g.id === 'ship')?.nodeIds).not.toContain('fresh');
    expect(contained(graph)).toBe(true);
    expect(levelOf(graph, 'fresh')).toBe('inspect');
  });
  it('starts a top-down subflow with one real step so the backend accepts it', () => {
    const created = createEmptySubflow(flat(), { x: 400, y: 0 }, null)!;
    const group = groupsOf(created.graph).find(g => g.id === created.groupId)!;
    expect(group.nodeIds).toHaveLength(1);
    expect(created.graph.nodes).toHaveLength(5);
  });
  it('refuses to group loop slots because that would open the route', () => {
    const graph: Graph = { ...flat(), schemaVersion: 2, groups: [{ id: 'l', kind: 'loop', label: '重试', summary: '', parentId: null, nodeIds: ['a', 'b'], order: ['a', 'b'], position: { x: 0, y: 0 } }] };
    expect(groupingBlock(graph, ['a'])).toContain('重试');
    expect(createGroup(graph, ['a'], null)).toBeNull();
    expect(groupingBlock(graph, ['c'])).toBeNull();
  });
  it('moves items into and out of a group without touching connections', () => {
    const graph = nested(), edges = JSON.stringify(graph.edges);
    const joined = moveIntoGroup(graph, ['allocate'], 'pack');
    expect(groupsOf(joined).find(g => g.id === 'pack')?.nodeIds).toContain('allocate');
    expect(contained(joined)).toBe(true);
    expect(JSON.stringify(joined.edges)).toBe(edges);
    const back = moveToParentLevel(joined, ['allocate'], 'pack');
    expect(groupsOf(back).find(g => g.id === 'pack')?.nodeIds).not.toContain('allocate');
    expect(groupsOf(back).find(g => g.id === 'fulfill')?.nodeIds).toContain('allocate');
    const child = moveToParentLevel(graph, ['inspect'], 'pack');
    expect(groupsOf(child).find(g => g.id === 'inspect')?.parentId).toBe('fulfill');
    expect(contained(child)).toBe(true);
  });
  it('dissolves a group in place, keeps behavior and promotes children', () => {
    const graph = nested(), result = dissolveGroup(graph, 'pack');
    expect(groupsOf(result).some(g => g.id === 'pack')).toBe(false);
    expect(groupsOf(result).find(g => g.id === 'inspect')?.parentId).toBe('fulfill');
    expect(result.nodes).toHaveLength(graph.nodes.length);
    expect(result.edges).toEqual(graph.edges);
    const cards = buildView(result, { groupId: 'fulfill' }, true).nodes.filter(n => !n.reference);
    const overlap = cards.some((a, i) => cards.slice(i + 1).some(b => Math.abs(a.position.x - b.position.x) < 248 && Math.abs(a.position.y - b.position.y) < 116));
    expect(overlap).toBe(false);
  });
  it('resolves a summary card connection to real entry and exit steps', () => {
    const created = createGroup(flat(), ['b', 'c'], null)!;
    expect(groupEndpoint(created.graph, created.groupId, 'entry')).toBe('b');
    expect(groupEndpoint(created.graph, created.groupId, 'exit')).toBe('c');
    const links = groupLinks(created.graph, created.groupId);
    expect(links.incoming.map(l => l.nodeId)).toEqual(['a']);
    expect(links.outgoing.map(l => l.nodeId)).toEqual(['d']);
  });
  it('finds the level that shows an item', () => {
    const graph = nested();
    expect(levelOf(graph, 'receive')).toBeNull();
    expect(levelOf(graph, 'scan')).toBe('inspect');
    expect(levelOf(graph, 'box')).toBe('pack');
    expect(levelOf(graph, 'inspect')).toBe('pack');
  });
});
