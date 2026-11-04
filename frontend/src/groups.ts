import { newId, createNode, removeNodes, repairGroups, ungroupNode } from './model';
import { directItems, groupsOf, moveItem, upgradeGraph, NODE_HEIGHT, NODE_WIDTH, type ViewNode } from './views';
import type { Graph, GraphEdge, GraphGroup } from './types';

const LEVEL_GAP = 216;
const groupById = (graph: Graph, id: string | null | undefined) => groupsOf(graph).find(g => g.id === id);
const withMembers = (group: GraphGroup, ids: string[]) => ({ ...group, nodeIds: [...new Set([...group.nodeIds, ...ids])] });
const readingOrder = <T extends { position: { x: number; y: number } }>(items: T[]) =>
  [...items].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

/** Root-first ancestors of a group, ending with the group itself. */
export function groupPath(graph: Graph, id: string | null): GraphGroup[] {
  const path: GraphGroup[] = [], seen = new Set<string>();
  let current = groupById(graph, id);
  while (current && !seen.has(current.id)) { seen.add(current.id); path.unshift(current); current = groupById(graph, current.parentId); }
  return path;
}

function ancestorsAndSelf(graph: Graph, id: string | null) { return new Set(groupPath(graph, id).map(g => g.id)); }

/** Which canvas level shows this item. Loops render inline with their parent level, so they are not levels. */
export function levelOf(graph: Graph, id: string): string | null {
  const group = groupById(graph, id);
  if (group) {
    let level = group.parentId;
    while (level && groupById(graph, level)?.kind === 'loop') level = groupById(graph, level)?.parentId || null;
    return level;
  }
  let level: string | null = null, current: string | null = null;
  for (let depth = 0; depth < 64; depth++) {
    const items = directItems(graph, current);
    if (items.some(item => item.id === id && !item.groupId)) return level;
    const next = items.find(item => item.groupId && groupById(graph, item.groupId)?.nodeIds.includes(id))?.groupId;
    if (!next) return level;
    current = next;
    if (groupById(graph, next)?.kind !== 'loop') level = next;
  }
  return level;
}

export const groupOutline = (graph: Graph, id: string | null): ViewNode[] => readingOrder(directItems(graph, id));

export interface GroupLink { edge: GraphEdge; nodeId: string; label: string }
/** Real connections crossing the group boundary, named by the step on the far side. */
export function groupLinks(graph: Graph, id: string): { incoming: GroupLink[]; outgoing: GroupLink[] } {
  const members = new Set(groupById(graph, id)?.nodeIds || []);
  const link = (edge: GraphEdge, nodeId: string): GroupLink => ({ edge, nodeId, label: graph.nodes.find(n => n.id === nodeId)?.data.label || '未命名节点' });
  return {
    incoming: graph.edges.filter(e => members.has(e.target) && !members.has(e.source)).map(e => link(e, e.source)),
    outgoing: graph.edges.filter(e => members.has(e.source) && !members.has(e.target)).map(e => link(e, e.target)),
  };
}

/** A connection drawn to a summary card lands on the first step inside; one drawn from it leaves the last. */
export function groupEndpoint(graph: Graph, id: string, end: 'entry' | 'exit'): string | undefined {
  const members = groupById(graph, id)?.nodeIds || [];
  const inside = readingOrder(graph.nodes.filter(n => members.includes(n.id)));
  const open = inside.filter(n => !graph.edges.some(e => e.source !== e.target && members.includes(e.source) && members.includes(e.target)
    && (end === 'entry' ? e.target : e.source) === n.id));
  const pool = open.length ? open : inside;
  return (end === 'entry' ? pool[0] : pool[pool.length - 1])?.id;
}

/** The reason a selection cannot be grouped, or null when it can. Loop slots are part of the loop's closed route. */
export function groupingBlock(graph: Graph, ids: string[]): string | null {
  if (!ids.length) return '先选择要组合的节点。';
  const slot = groupsOf(graph).find(g => g.kind === 'loop' && g.order.some(id => ids.includes(id)));
  return slot ? `「${slot.label}」环上的步骤不能组合，否则这个循环就不再闭合。` : null;
}

export function memberIds(graph: Graph, ids: string[]): string[] {
  return [...new Set(ids.flatMap(id => groupById(graph, id)?.nodeIds || (graph.nodes.some(n => n.id === id) ? [id] : [])))];
}

function createParent(graph: Graph, ids: string[], levelId: string | null): string | null {
  const members = memberIds(graph, ids);
  const inline = groupsOf(graph).filter(g => g.kind === 'loop' && members.every(id => g.nodeIds.includes(id)) && !ids.includes(g.id));
  const level = ancestorsAndSelf(graph, levelId);
  const deepest = inline.filter(g => groupPath(graph, g.id).some(a => a.id === levelId) || !levelId)
    .sort((a, b) => groupPath(graph, b.id).length - groupPath(graph, a.id).length)[0];
  return deepest && !level.has(deepest.id) ? deepest.id : levelId;
}

export function createGroup(graph: Graph, ids: string[], levelId: string | null, label = '新的子流程'): { graph: Graph; groupId: string } | null {
  const members = memberIds(graph, ids);
  if (!members.length || groupingBlock(graph, ids)) return null;
  const next = upgradeGraph(graph), groups = groupsOf(next);
  const positions = ids.map(id => groupById(next, id)?.position || next.nodes.find(n => n.id === id)?.position).filter((p): p is { x: number; y: number } => !!p);
  const groupId = newId('group');
  const group: GraphGroup = { id: groupId, kind: 'subflow', label, summary: '', parentId: createParent(next, ids, levelId), nodeIds: members, order: [],
    position: { x: Math.round(positions.reduce((sum, p) => sum + p.x, 0) / positions.length), y: Math.min(...positions.map(p => p.y)) } };
  return { groupId, graph: repairGroups({ ...next, groups: [...groups.map(g => ids.includes(g.id) ? { ...g, parentId: groupId } : g), group] }) };
}

/** Adds a node at a canvas level. Every enclosing group must keep containing its descendants. */
export function addNodeAtLevel(graph: Graph, node: Graph['nodes'][number], levelId: string | null): Graph {
  const chain = ancestorsAndSelf(graph, levelId);
  const next = levelId ? upgradeGraph(graph) : graph;
  return { ...next, nodes: [...next.nodes, node], ...(levelId ? { groups: groupsOf(next).map(g => chain.has(g.id) ? withMembers(g, [node.id]) : g) } : {}) };
}

/** Top-down authoring: a group needs a real member, so a new subflow starts with one step inside. */
export function createEmptySubflow(graph: Graph, position: { x: number; y: number }, levelId: string | null) {
  const node = createNode('step', position);
  return createGroup(addNodeAtLevel(upgradeGraph(graph), node, levelId), [node.id], levelId);
}

const translateItems = (graph: Graph, ids: string[], origin: { x: number; y: number }): Graph => {
  const at = (id: string) => groupById(graph, id)?.position || graph.nodes.find(n => n.id === id)?.position;
  const positions = ids.map(at).filter((p): p is { x: number; y: number } => !!p);
  if (!positions.length) return graph;
  const left = Math.min(...positions.map(p => p.x)), top = Math.min(...positions.map(p => p.y));
  return ids.reduce((current, id) => {
    const p = at(id);
    return p ? moveItem(current, id, { x: origin.x + p.x - left, y: origin.y + p.y - top }) : current;
  }, graph);
};

const itemBounds = (items: ViewNode[]) => items.length ? {
  left: Math.min(...items.map(i => i.position.x)), top: Math.min(...items.map(i => i.position.y)),
  right: Math.max(...items.map(i => i.position.x)) + NODE_WIDTH, bottom: Math.max(...items.map(i => i.position.y)) + NODE_HEIGHT,
} : null;

export function moveIntoGroup(graph: Graph, ids: string[], targetId: string): Graph {
  const moving = ids.filter(id => id !== targetId && !groupPath(graph, targetId).some(g => g.id === id));
  const members = memberIds(graph, moving), chain = ancestorsAndSelf(graph, targetId);
  if (!members.length || !chain.size) return graph;
  const bounds = itemBounds(directItems(graph, targetId));
  const placed = translateItems(graph, moving, bounds ? { x: bounds.left, y: bounds.bottom + LEVEL_GAP - NODE_HEIGHT } : groupById(graph, targetId)!.position);
  return repairGroups({ ...placed, groups: groupsOf(placed).map(g => {
    const joined = chain.has(g.id) ? withMembers(g, members) : g;
    return moving.includes(g.id) ? { ...joined, parentId: targetId } : joined;
  }) }, groupsOf(graph));
}

export function moveToParentLevel(graph: Graph, ids: string[], levelId: string): Graph {
  const level = groupById(graph, levelId);
  if (!level) return graph;
  const placed = translateItems(graph, ids, { x: level.position.x + NODE_WIDTH + 72, y: level.position.y });
  const moved = ids.reduce((current, id) => {
    const child = groupById(current, id);
    if (!child) return ungroupNode(current, id, levelId);
    return { ...current, groups: groupsOf(current).map(g => g.id === id ? { ...g, parentId: level.parentId }
      : g.id === levelId ? { ...g, nodeIds: g.nodeIds.filter(member => !child.nodeIds.includes(member)), order: g.order.filter(slot => slot !== id) } : g) };
  }, placed);
  return repairGroups(moved, groupsOf(graph));
}

/** Removes the summary only. Inner items expand where the card stood and lower siblings make room. */
export function dissolveGroup(graph: Graph, id: string): Graph {
  const group = groupById(graph, id);
  if (!group) return graph;
  const inner = directItems(graph, id), bounds = itemBounds(inner);
  if (!bounds) return removeNodes(graph, [id]);
  const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
  const pushed = directItems(graph, group.parentId).filter(item => item.id !== id && item.position.y > group.position.y)
    .reduce((current, item) => moveItem(current, item.id, { x: item.position.x, y: item.position.y + Math.max(0, height - NODE_HEIGHT) }), graph);
  const expanded = translateItems(pushed, inner.map(i => i.id), { x: Math.round(group.position.x + (NODE_WIDTH - width) / 2), y: group.position.y });
  return removeNodes(expanded, [id]);
}
