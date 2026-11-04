import { addNodeAtLevel, memberIds } from './groups';
import { newId, repairGroups, validLoop } from './model';
import { circleForGroup, loopSlotNodeId, MIN_LOOP_RADIUS } from './circles';
import { directItems, groupsOf, moveItem, upgradeGraph, NODE_HEIGHT, NODE_WIDTH, type ViewNode } from './views';
import type { FlowRole, Graph, GraphEdge, GraphGroup, GraphNode } from './types';

type Point = { x: number; y: number };
export const STEP_GAP = 216;
const COLUMN_GAP = 290;
const groupById = (graph: Graph, id: string | null | undefined) => groupsOf(graph).find(g => g.id === id);
const at = (graph: Graph, id: string) => groupById(graph, id)?.position || graph.nodes.find(n => n.id === id)?.position;

/** The nearest column to the right that does not cover an existing card. */
export function freeSpot(items: { position: Point }[], wanted: Point): Point {
  const taken = (p: Point) => items.some(i => Math.abs(i.position.x - p.x) < NODE_WIDTH + 24 && Math.abs(i.position.y - p.y) < NODE_HEIGHT + 24);
  const spot = { ...wanted };
  while (taken(spot)) spot.x += COLUMN_GAP;
  return spot;
}

export const connectingEdge = (graph: Graph, source: string, target: string): GraphEdge => ({ id: newId('edge'), source, target, sourceHandle: 'bottom', targetHandle: 'top', label: '',
  ...(graph.schemaVersion === 2 ? { role: 'main' as const } : {}) });

/** Drops the new node into the middle of a connection; the original condition stays on the first half. */
export function insertOnEdge(graph: Graph, edgeId: string, node: GraphNode, levelId: string | null, source: Point, target: Point): Graph {
  const edge = graph.edges.find(e => e.id === edgeId);
  if (!edge) return graph;
  const descending = target.y - source.y, crowded = descending > 0 && descending < 2 * (NODE_HEIGHT + 40);
  // A vertical flow has no room between neighbours: the new card takes the target's row and lower cards move down.
  const mid = { x: Math.round((source.x + target.x) / 2), y: crowded ? target.y : Math.round((source.y + target.y) / 2) };
  const pushed = crowded
    ? directItems(graph, levelId).filter(item => item.position.y >= target.y).reduce((current, item) => moveItem(current, item.id, { x: item.position.x, y: item.position.y + STEP_GAP }), graph)
    : graph;
  const placed = addNodeAtLevel(pushed, { ...node, position: mid }, levelId);
  const { targetAnchor, ...first } = edge;
  const second: GraphEdge = { ...connectingEdge(placed, node.id, edge.target), ...(edge.role ? { role: edge.role } : {}), ...(targetAnchor ? { targetAnchor } : {}) };
  // Keep a loop closed by giving the new step a slot between the two it now joins.
  const groups = placed.groups?.map(g => {
    if (g.kind !== 'loop' || !g.nodeIds.includes(edge.source) || !g.nodeIds.includes(edge.target)) return g;
    const from = g.order.indexOf(edge.source), to = g.order.indexOf(edge.target);
    const adjacent = from >= 0 && to >= 0 && (from + 1) % g.order.length === to;
    return { ...g, nodeIds: [...new Set([...g.nodeIds, node.id])], order: adjacent ? [...g.order.slice(0, from + 1), node.id, ...g.order.slice(from + 1)] : g.order };
  });
  return repairGroups({ ...placed, edges: placed.edges.flatMap(e => e.id === edgeId ? [{ ...first, target: node.id }, second] : [e]), ...(groups ? { groups } : {}) });
}

export function reverseEdge(graph: Graph, edgeId: string): Graph {
  return repairGroups({ ...graph, edges: graph.edges.map(e => {
    if (e.id !== edgeId) return e;
    const { sourceAnchor, targetAnchor, ...rest } = e;
    return { ...rest, source: e.target, target: e.source, sourceHandle: 'bottom', targetHandle: 'top',
      ...(targetAnchor ? { sourceAnchor: targetAnchor } : {}), ...(sourceAnchor ? { targetAnchor: sourceAnchor } : {}) };
  }) });
}

/** Classifies a selection at once: its cards and the connections running between them. */
export function setRoles(graph: Graph, ids: string[], role: FlowRole): Graph {
  const next = upgradeGraph(graph), members = new Set(memberIds(next, ids));
  return { ...next, nodes: next.nodes.map(n => members.has(n.id) ? { ...n, data: { ...n.data, role } } : n),
    edges: next.edges.map(e => members.has(e.source) && members.has(e.target) ? { ...e, role } : e) };
}

export type LoopRoute = { order: string[]; closing?: { source: string; target: string } };
const MAX_ROUTE_ITEMS = 16;
/**
 * Orders items along real connections. A complete ring needs nothing more; a chain
 * reports the single closing edge a person could add. Anything else is not a route.
 */
export function loopRoute(graph: Graph, ids: string[]): LoopRoute | null {
  if (ids.length < 2 || ids.length > MAX_ROUTE_ITEMS) return null;
  const members = new Map(ids.map(id => [id, new Set(memberIds(graph, [id]))]));
  const links = (a: string, b: string) => graph.edges.some(e => members.get(a)!.has(e.source) && members.get(b)!.has(e.target));
  const sorted = [...ids].sort((a, b) => (at(graph, a)?.y || 0) - (at(graph, b)?.y || 0) || (at(graph, a)?.x || 0) - (at(graph, b)?.x || 0));
  const search = (path: string[], accept: (path: string[]) => boolean): string[] | null => {
    if (path.length === ids.length) return accept(path) ? path : null;
    for (const next of sorted) {
      if (path.includes(next) || !links(path[path.length - 1], next)) continue;
      const found = search([...path, next], accept);
      if (found) return found;
    }
    return null;
  };
  for (const start of sorted) {
    const ring = search([start], path => links(path[path.length - 1], path[0]));
    if (ring) return { order: ring };
  }
  for (const start of sorted) {
    const chain = search([start], () => true);
    if (chain) return { order: chain, closing: { source: chain[chain.length - 1], target: chain[0] } };
  }
  return null;
}

function realEnd(graph: Graph, id: string, end: 'entry' | 'exit'): string | undefined {
  const members = memberIds(graph, [id]);
  const inside = members.map(m => graph.nodes.find(n => n.id === m)!).sort((a, b) => a.position.y - b.position.y);
  return (end === 'entry' ? inside[0] : inside[inside.length - 1])?.id;
}

const ringRadius = (count: number) => Math.max(MIN_LOOP_RADIUS, count < 3 ? MIN_LOOP_RADIUS : Math.round(170 / Math.sin(Math.PI / count)));

/** Puts the slots on a circle whose top edge starts at `top`, and moves anything underneath out of the way. */
function placeOnRing(graph: Graph, group: GraphGroup, levelId: string | null, center: { x: number; top: number }): Graph {
  const radius = ringRadius(group.order.length), y = center.top + radius + 58, circle = { x: center.x, y, radius };
  const placed = group.order.reduce((current, id, index) => {
    const angle = -Math.PI / 2 + index * 2 * Math.PI / group.order.length;
    return moveItem(current, id, { x: Math.round(circle.x + radius * Math.cos(angle) - NODE_WIDTH / 2), y: Math.round(circle.y + radius * Math.sin(angle) - NODE_HEIGHT / 2) });
  }, graph);
  const bottom = y + radius + 104, movable = directItems(placed, levelId).filter(item => item.id !== group.id && !group.order.includes(item.id) && item.position.y >= center.top - NODE_HEIGHT);
  const overlapping = movable.filter(item => item.position.x + NODE_WIDTH > circle.x - radius - 80 && item.position.x < circle.x + radius + 80);
  const shift = overlapping.length ? bottom - Math.min(...overlapping.map(i => i.position.y)) : 0;
  const cleared = shift > 0 ? overlapping.reduce((current, item) => moveItem(current, item.id, { x: item.position.x, y: item.position.y + shift }), placed) : placed;
  const anchored = new Set(group.order.flatMap(id => memberIds(graph, [id])));
  return { ...cleared,
    // Loop edges use exact circle intersections, which a stored anchor would override.
    edges: cleared.edges.map(e => { if (!anchored.has(e.source) || !anchored.has(e.target)) return e; const { sourceAnchor: _s, targetAnchor: _t, ...auto } = e; return auto; }),
    groups: groupsOf(cleared).map(g => g.id === group.id ? { ...g, circle, position: { x: circle.x - radius - 68, y: y - radius - 68 } } : g) };
}

const withClosingEdge = (graph: Graph, route: LoopRoute): Graph => {
  if (!route.closing) return graph;
  const source = realEnd(graph, route.closing.source, 'exit'), target = realEnd(graph, route.closing.target, 'entry');
  return source && target ? { ...graph, edges: [...graph.edges, connectingEdge(graph, source, target)] } : graph;
};

export function createLoop(graph: Graph, ids: string[], levelId: string | null, label = '新的循环'): { graph: Graph; groupId: string } | null {
  const route = loopRoute(graph, ids);
  if (!route) return null;
  const next = withClosingEdge(upgradeGraph(graph), route);
  const positions = ids.map(id => at(next, id)).filter((p): p is Point => !!p);
  const groupId = newId('group');
  const group: GraphGroup = { id: groupId, kind: 'loop', label, summary: '', parentId: levelId, nodeIds: memberIds(next, ids), order: route.order, position: positions[0] };
  const linked: Graph = { ...next, groups: [...groupsOf(next).map(g => ids.includes(g.id) ? { ...g, parentId: groupId } : g), group] };
  if (!validLoop(linked, group)) return null;
  return { groupId, graph: repairGroups(placeOnRing(linked, group, levelId,
    { x: Math.round(positions.reduce((sum, p) => sum + p.x, 0) / positions.length + NODE_WIDTH / 2), top: Math.min(...positions.map(p => p.y)) })) };
}

export const groupLoopRoute = (graph: Graph, groupId: string): LoopRoute | null => loopRoute(graph, directItems(graph, groupId).map((item: ViewNode) => item.id));

export function subflowToLoop(graph: Graph, groupId: string): Graph {
  const route = groupLoopRoute(graph, groupId), source = groupById(graph, groupId);
  if (!route || !source) return graph;
  const next = withClosingEdge(graph, route);
  const group: GraphGroup = { ...source, kind: 'loop', order: route.order };
  const linked: Graph = { ...next, groups: groupsOf(next).map(g => g.id === groupId ? group : g) };
  if (!validLoop(linked, group)) return graph;
  return repairGroups(placeOnRing(linked, group, source.parentId, { x: source.position.x + NODE_WIDTH / 2, top: source.position.y }));
}

export function loopToSubflow(graph: Graph, groupId: string): Graph {
  return { ...graph, groups: groupsOf(graph).map(g => {
    if (g.id !== groupId) return g;
    const { circle: _circle, ...rest } = g;
    return { ...rest, kind: 'subflow' as const, order: [] };
  }) };
}

export const loopRadius = (graph: Graph, group: GraphGroup) => circleForGroup(group, id => {
  const card = loopSlotNodeId(groupsOf(graph), graph.edges, group, id);
  const p = card ? at(graph, card) : undefined;
  return p && { x: p.x + NODE_WIDTH / 2, y: p.y + NODE_HEIGHT / 2 };
});

/** Resizes the ring around its centre, keeping each slot's angle. */
export function resizeLoop(graph: Graph, groupId: string, radius: number): Graph {
  const group = groupById(graph, groupId);
  if (!group || group.kind !== 'loop') return graph;
  const circle = loopRadius(graph, group), next = Math.max(MIN_LOOP_RADIUS, Math.min(2000, radius));
  const moved = group.order.reduce((current, slot) => {
    const card = loopSlotNodeId(groupsOf(current), current.edges, group, slot), p = card ? at(current, card) : undefined;
    if (!card || !p) return current;
    const angle = Math.atan2(p.y + NODE_HEIGHT / 2 - circle.y, p.x + NODE_WIDTH / 2 - circle.x);
    return moveItem(current, card, { x: Math.round(circle.x + next * Math.cos(angle) - NODE_WIDTH / 2), y: Math.round(circle.y + next * Math.sin(angle) - NODE_HEIGHT / 2) });
  }, graph);
  return { ...moved, groups: groupsOf(moved).map(g => g.id === groupId ? { ...g, circle: { x: circle.x, y: circle.y, radius: next }, position: { x: circle.x - next - 68, y: circle.y - next - 68 } } : g) };
}

export function setGroupKind(graph: Graph, groupId: string, kind: 'subflow' | 'branch'): Graph {
  return { ...graph, groups: groupsOf(graph).map(g => g.id === groupId ? { ...g, kind } : g) };
}
