import type { GraphEdge, GraphGroup } from './types';

export interface Point { x: number; y: number }
export interface Circle extends Point { radius: number }

export const MIN_LOOP_RADIUS = 205;

/** Resolve an old child-loop slot to an actual card, retaining its real entry. */
export function loopSlotNodeId(groups: GraphGroup[], edges: GraphEdge[], parent: GraphGroup, slotId: string): string | undefined {
  const seen = new Set<string>();
  function resolve(owner: GraphGroup, id: string): string | undefined {
    const child = groups.find(g => g.id === id);
    if (!child) return id;
    if (child.kind !== 'loop' || seen.has(child.id)) return undefined;
    seen.add(child.id);
    const route = child.order.map(item => resolve(child, item)).filter((item): item is string => !!item);
    const index = owner.order.indexOf(id);
    const previous = owner.order[(index + owner.order.length - 1) % owner.order.length];
    const preceding = new Set(groups.find(g => g.id === previous)?.nodeIds || [previous]);
    const incoming = edges.filter(e => preceding.has(e.source) && child.nodeIds.includes(e.target));
    return incoming.find(e => route.includes(e.target))?.target || incoming[0]?.target || route[0] || child.nodeIds[0];
  }
  return resolve(parent, slotId);
}

/** Infer legacy geometry without modifying positions or adding persisted fields. */
export function circleForGroup(group: GraphGroup, pointForItem: (id: string) => Point | undefined): Circle {
  if (group.circle) return { ...group.circle };
  const points = group.order.map(pointForItem).filter((p): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length === 1) return { x: points[0].x, y: points[0].y + MIN_LOOP_RADIUS, radius: MIN_LOOP_RADIUS };
  if (!points.length) return { x: group.position.x + MIN_LOOP_RADIUS, y: group.position.y + MIN_LOOP_RADIUS, radius: MIN_LOOP_RADIUS };

  const mean = { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  let xx = 0, xy = 0, yy = 0, bx = 0, by = 0;
  for (const p of points) {
    const x = p.x - mean.x, y = p.y - mean.y, squared = x * x + y * y;
    xx += x * x; xy += x * y; yy += y * y;
    bx += x * squared / 2; by += y * squared / 2;
  }
  const determinant = xx * yy - xy * xy;
  if (determinant > 1e-9 * Math.max(1, (xx + yy) ** 2)) {
    const x = mean.x + (bx * yy - by * xy) / determinant;
    const y = mean.y + (by * xx - bx * xy) / determinant;
    const radius = Math.sqrt(points.reduce((sum, p) => sum + (p.x - x) ** 2 + (p.y - y) ** 2, 0) / points.length);
    return { x, y, radius: Math.max(1, radius) };
  }

  // Two points define a diameter. Collinear legacy positions use their extent.
  let first = points[0], last = points[1], longest = 0;
  for (const a of points) for (const b of points) {
    const length = Math.hypot(a.x - b.x, a.y - b.y);
    if (length > longest) { first = a; last = b; longest = length; }
  }
  return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, radius: Math.max(100, longest / 2) };
}
