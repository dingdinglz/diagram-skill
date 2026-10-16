import dagre from '@dagrejs/dagre';
import type { Graph, GraphGroup } from './types';
import { buildView, groupsOf, NODE_HEIGHT, NODE_WIDTH } from './views';
import { circleForGroup, loopSlotNodeId, MIN_LOOP_RADIUS, type Circle, type Point } from './circles';

const TAU = 2 * Math.PI;
const positiveAngle = (angle: number) => ((angle % TAU) + TAU) % TAU;
const polar = (circle: Circle, angle: number): Point => ({ x: circle.x + circle.radius * Math.cos(angle), y: circle.y + circle.radius * Math.sin(angle) });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
type Measurements = Record<string, { width: number; height: number }>;
type Loop = { group: GraphGroup; items: string[] };
type Unit = { id: string; items: string[]; loops: string[]; x: number; y: number; width: number; height: number };

// Layout is an explicit edit. Reading a view never calls this function.
export function layoutGroups(graph: Graph, measurements: Measurements = {}): Graph {
  const groups = groupsOf(graph);
  const nodePositions = new Map<string, Point>(), groupPositions = new Map<string, Point>(), circles = new Map<string, Circle>();
  const visited = new Set<string>();
  const size = (id: string) => measurements[id] || { width: NODE_WIDTH, height: NODE_HEIGHT };
  const topLeft = (id: string, point: Point): Point => ({ x: point.x - size(id).width / 2, y: point.y - size(id).height / 2 });

  function arrange(scopeId?: string, offset: Point = { x: 60, y: 50 }) {
    const scopeKey = scopeId || '$root';
    if (visited.has(scopeKey)) return;
    visited.add(scopeKey);
    const view = buildView(graph, scopeId ? { groupId: scopeId } : {}, true);
    const items = view.nodes.filter(n => !n.reference);
    if (!items.length) return;
    const visible = new Set(items.map(n => n.id));
    const representative = (id: string) => visible.has(id) ? id : items.find(n => n.members.includes(id))?.id;
    const loops: Loop[] = view.loops.map(group => ({ group, items: [...new Set(group.order.flatMap(id => {
      if (visible.has(id)) return [id];
      const resolved = loopSlotNodeId(groups, graph.edges, group, id);
      const item = resolved && representative(resolved);
      return item ? [item] : [];
    }))] })).filter(loop => loop.items.length);
    const positions = new Map<string, Point>(), localCircles = new Map<string, Circle>();
    const firstLoopForItem = new Map<string, string>();
    const units: Unit[] = [];
    const remaining = new Set(loops.map(loop => loop.group.id));
    const depth = (group: GraphGroup) => {
      let count = 0, parent = group.parentId;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) { seen.add(parent); count++; parent = groups.find(g => g.id === parent)?.parentId || null; }
      return count;
    };
    const orderedLoops = [...loops].sort((a, b) => depth(a.group) - depth(b.group));

    for (const seed of orderedLoops) {
      if (!remaining.has(seed.group.id)) continue;
      // Shared cards and visible parent/child loops travel through Dagre together.
      const component: Loop[] = [], pending = [seed];
      remaining.delete(seed.group.id);
      while (pending.length) {
        const current = pending.shift()!;
        component.push(current);
        for (const candidate of orderedLoops) {
          if (!remaining.has(candidate.group.id)) continue;
          if (candidate.items.some(id => current.items.includes(id)) || candidate.group.parentId === current.group.id || current.group.parentId === candidate.group.id) {
            remaining.delete(candidate.group.id); pending.push(candidate);
          }
        }
      }
      const componentCircles: Circle[] = [];
      const componentItems = new Set<string>();
      for (const loop of component) {
        loop.items.forEach(id => componentItems.add(id));
        const widest = Math.max(...loop.items.map(id => Math.hypot(size(id).width, size(id).height)));
        const radius = Math.max(MIN_LOOP_RADIUS, (widest + 80) / (2 * Math.sin(Math.PI / Math.max(3, loop.items.length))));
        const anchors = loop.items.flatMap((id, index) => positions.has(id) ? [{ id, index, point: positions.get(id)! }] : []);
        const overlap = (candidate: Circle) => componentCircles.reduce((sum, other) => sum + Math.max(0, candidate.radius + other.radius + 40 - distance(candidate, other)) ** 2, 0);
        let circle: Circle;
        if (!anchors.length) {
          const parent = loop.group.parentId && localCircles.get(loop.group.parentId);
          const right = Math.max(0, ...componentCircles.map(c => c.x + c.radius));
          circle = componentCircles.length ? { x: right + radius + 140, y: parent ? parent.y : radius, radius } : { x: radius, y: radius, radius };
        } else if (anchors.length === 1) {
          const anchor = anchors[0], owner = localCircles.get(firstLoopForItem.get(anchor.id) || '');
          const angle = owner ? Math.atan2(anchor.point.y - owner.y, anchor.point.x - owner.x) : -Math.PI / 2;
          circle = { x: anchor.point.x + radius * Math.cos(angle), y: anchor.point.y + radius * Math.sin(angle), radius };
          // Three circles sharing one point cannot all be externally tangent.
          // Keep the card fixed and avoid coincident circles in that case.
          if (componentCircles.some(other => distance(circle, other) < Math.min(circle.radius, other.radius) / 2)) {
            const alternatives = Array.from({ length: 12 }, (_, index) => ({
              x: anchor.point.x + radius * Math.cos(angle + index * TAU / 12),
              y: anchor.point.y + radius * Math.sin(angle + index * TAU / 12), radius,
            }));
            circle = alternatives.reduce((best, candidate) => overlap(candidate) < overlap(best) ? candidate : best, circle);
          }
        } else if (anchors.length === 2) {
          const a = anchors[0].point, b = anchors[1].point, chord = distance(a, b);
          const r = Math.max(radius, chord / 2), lift = Math.sqrt(Math.max(0, r * r - chord * chord / 4));
          const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const normal = chord > .001 ? { x: -(b.y - a.y) / chord, y: (b.x - a.x) / chord } : { x: 0, y: -1 };
          const candidates = [-1, 1].map(sign => ({ x: midpoint.x + sign * lift * normal.x, y: midpoint.y + sign * lift * normal.y, radius: r }));
          circle = overlap(candidates[0]) <= overlap(candidates[1]) ? candidates[0] : candidates[1];
        } else {
          const inferred = circleForGroup({ ...loop.group, circle: undefined, order: anchors.map(a => a.id) }, id => positions.get(id));
          circle = { ...inferred, radius: Math.max(radius, inferred.radius) };
        }
        localCircles.set(loop.group.id, circle); componentCircles.push(circle);

        const first = anchors[0];
        const phase = first ? Math.atan2(first.point.y - circle.y, first.point.x - circle.x) - first.index * TAU / loop.items.length : -Math.PI / 2;
        const angles = loop.items.map((_, index) => phase + index * TAU / loop.items.length);
        // Fill each ordered interval between shared cards without moving them.
        if (anchors.length > 1) {
          const gaps = anchors.map((anchor, index) => {
            const next = anchors[(index + 1) % anchors.length];
            const start = Math.atan2(anchor.point.y - circle.y, anchor.point.x - circle.x);
            const end = Math.atan2(next.point.y - circle.y, next.point.x - circle.x);
            return { anchor, next, start, angle: positiveAngle(end - start) };
          });
          if (Math.abs(gaps.reduce((sum, gap) => sum + gap.angle, 0) - TAU) < .001) {
            for (const gap of gaps) {
              const count = (gap.next.index - gap.anchor.index + loop.items.length) % loop.items.length;
              for (let i = 1; i < count; i++) angles[(gap.anchor.index + i) % loop.items.length] = gap.start + gap.angle * i / count;
            }
          }
        }
        loop.items.forEach((id, index) => {
          if (!positions.has(id)) { positions.set(id, polar(circle, angles[index])); firstLoopForItem.set(id, loop.group.id); }
        });
      }
      const ids = [...componentItems], memberCircles = component.map(loop => localCircles.get(loop.group.id)!);
      const left = Math.min(...ids.map(id => positions.get(id)!.x - size(id).width / 2), ...memberCircles.map(c => c.x - c.radius - 68));
      const top = Math.min(...ids.map(id => positions.get(id)!.y - size(id).height / 2), ...memberCircles.map(c => c.y - c.radius - 68));
      const right = Math.max(...ids.map(id => positions.get(id)!.x + size(id).width / 2), ...memberCircles.map(c => c.x + c.radius + 68));
      const bottom = Math.max(...ids.map(id => positions.get(id)!.y + size(id).height / 2), ...memberCircles.map(c => c.y + c.radius + 68));
      units.push({ id: `unit:${units.length}`, items: ids, loops: component.map(loop => loop.group.id), x: left, y: top, width: right - left, height: bottom - top });
    }
    for (const item of items) {
      if (positions.has(item.id)) continue;
      const dimensions = size(item.id);
      positions.set(item.id, { x: dimensions.width / 2, y: dimensions.height / 2 });
      units.push({ id: `unit:${units.length}`, items: [item.id], loops: [], x: 0, y: 0, ...dimensions });
    }

    const layout = new dagre.graphlib.Graph({ multigraph: true });
    layout.setGraph({ rankdir: 'TB', nodesep: 100, ranksep: 104 });
    layout.setDefaultEdgeLabel(() => ({}));
    const unitForItem = new Map(units.flatMap(unit => unit.items.map(id => [id, unit.id] as const)));
    units.forEach(unit => layout.setNode(unit.id, { width: unit.width, height: unit.height }));
    view.edges.forEach(edge => {
      const source = unitForItem.get(edge.source), target = unitForItem.get(edge.target);
      if (source && target && source !== target) layout.setEdge(source, target, { weight: edge.role === 'main' || !edge.role ? 8 : 1 }, edge.id);
    });
    dagre.layout(layout);
    for (const unit of units) {
      const placed = layout.node(unit.id);
      const dx = offset.x + placed.x - unit.width / 2 - unit.x, dy = offset.y + placed.y - unit.height / 2 - unit.y;
      for (const id of unit.items) {
        const point = positions.get(id)!;
        const position = topLeft(id, { x: point.x + dx, y: point.y + dy });
        const target = groups.some(g => g.id === id) ? groupPositions : nodePositions;
        if (!target.has(id)) target.set(id, position);
      }
      for (const id of unit.loops) {
        const local = localCircles.get(id)!;
        if (!circles.has(id)) circles.set(id, { x: local.x + dx, y: local.y + dy, radius: local.radius });
        if (!groupPositions.has(id)) groupPositions.set(id, { x: local.x + dx - local.radius - 68, y: local.y + dy - local.radius - 68 });
      }
    }
    for (const item of items) {
      if (!item.groupId) continue;
      const position = groupPositions.get(item.groupId)!;
      arrange(item.groupId, { x: position.x + 60, y: position.y + 50 });
    }
  }

  arrange();
  // Each canonical card receives one position even when memberships overlap.
  return {
    ...graph,
    nodes: graph.nodes.map(node => nodePositions.has(node.id) ? { ...node, position: nodePositions.get(node.id)! } : node),
    groups: groups.map(group => ({ ...group, ...(groupPositions.has(group.id) ? { position: groupPositions.get(group.id)! } : {}),
      ...(circles.has(group.id) ? { circle: circles.get(group.id)! } : {}) })),
  };
}
