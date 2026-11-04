import { createRootScene, createScene, type Rect, type Scene } from './geometry';
import { groupPath } from './groups';
import { buildView, groupsOf } from './views';
import type { Graph, GraphGroup } from './types';

type Measurements = Record<string, { width: number; height: number }>;

export interface LevelMapEntry {
  id: string | null;
  label: string;
  scene: Scene;
  /** The card leading to the next level, or a loop's steps when the loop itself is next. Empty on the current level. */
  markerIds: string[];
  /** 1-based reading position of the marker among this level's items. */
  position: number;
  total: number;
  /** Set when the marker sits on a loop, where a linear position would mean nothing. */
  loopLabel: string | null;
  /** True when the next level is the loop itself rather than a card on it. */
  entersLoop: boolean;
}

/**
 * The levels a reader actually moves through. Loops draw inline with their parent,
 * so an enclosing loop is context rather than a stop, unless it is the level itself.
 */
export function levelChain(graph: Graph, id: string | null): GraphGroup[] {
  return groupPath(graph, id).filter(group => group.kind !== 'loop' || group.id === id);
}

const realItems = (scene: Scene) => scene.view.nodes.filter(node => !node.reference);

function levelScene(graph: Graph, id: string | null, markerId: string | null, showBranches: boolean, measurements: Measurements) {
  if (id) return createScene(buildView(graph, { groupId: id }, true), measurements);
  const scene = createRootScene(graph, showBranches, measurements);
  // A subflow entered from a secondary path is absent from the main-line view; it must still be findable.
  return showBranches || !markerId || scene.rects[markerId] ? scene : createRootScene(graph, true, measurements);
}

/** Root-first description of each level, naming where the next level sits inside it. */
export function levelMap(graph: Graph, levelId: string | null, showBranches = false, measurements: Measurements = {}): LevelMapEntry[] {
  const chain = levelChain(graph, levelId), groups = groupsOf(graph);
  return [null, ...chain].map((group, index) => {
    const id = group?.id || null, next = chain[index]?.id || null;
    const scene = levelScene(graph, id, next, showBranches, measurements);
    const items = realItems(scene).sort((a, b) => scene.rects[a.id].y - scene.rects[b.id].y || scene.rects[a.id].x - scene.rects[b.id].x);
    const position = items.findIndex(item => item.id === next) + 1;
    const parent = groups.find(g => g.id === chain[index]?.parentId);
    const entersLoop = !position && chain[index]?.kind === 'loop';
    const onLoop = entersLoop ? chain[index] : position && parent?.kind === 'loop' ? parent : null;
    const markerIds = position ? [next!] : entersLoop ? items.filter(item => chain[index].nodeIds.includes(item.id) || item.groupId && chain[index].order.includes(item.id)).map(item => item.id) : [];
    return { id, label: group ? group.label || '未命名子流程' : '主流程', scene, markerIds, position, total: items.length,
      loopLabel: onLoop ? onLoop.label || '未命名循环' : null, entersLoop };
  });
}

export function levelPositionText(entry: LevelMapEntry, current: boolean): string {
  if (current) return entry.total ? `当前 · 共 ${entry.total} 项` : '当前 · 还没有内容';
  if (entry.entersLoop) return `循环「${entry.loopLabel}」所在位置`;
  if (entry.loopLabel) return `在循环「${entry.loopLabel}」上`;
  return entry.markerIds.length ? `第 ${entry.position} 项，共 ${entry.total} 项` : `共 ${entry.total} 项`;
}

export interface LevelThumbnail { cards: (Rect & { id: string; group: boolean })[]; paths: string[]; loops: { x: number; y: number; radius: number }[]; transform: string; scale: number }

const MAX_SCALE = .1, PADDING = 7, MIN_CARD = { width: 7, height: 4 };

/** Fits a level's real geometry into a small frame. Cards keep a legible minimum size at any graph scale. */
export function levelThumbnail(scene: Scene, width: number, height: number): LevelThumbnail {
  const items = realItems(scene), rects = items.map(item => scene.rects[item.id]);
  if (!rects.length) return { cards: [], paths: [], loops: [], transform: '', scale: 0 };
  const spans = [
    ...rects.map(r => ({ left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height })),
    ...scene.loops.map(l => ({ left: l.center.x - l.radius, top: l.center.y - l.radius, right: l.center.x + l.radius, bottom: l.center.y + l.radius })),
  ];
  const left = Math.min(...spans.map(s => s.left)), top = Math.min(...spans.map(s => s.top));
  const right = Math.max(...spans.map(s => s.right)), bottom = Math.max(...spans.map(s => s.bottom));
  const scale = Math.min(MAX_SCALE, (width - PADDING * 2) / (right - left), (height - PADDING * 2) / (bottom - top));
  const dx = (width - (right - left) * scale) / 2 - left * scale, dy = (height - (bottom - top) * scale) / 2 - top * scale;
  const visible = new Set(items.map(item => item.id));
  return {
    scale,
    transform: `translate(${dx} ${dy}) scale(${scale})`,
    paths: scene.edges.filter(e => visible.has(e.edge.source) && visible.has(e.edge.target)).map(e => e.path),
    loops: scene.loops.map(l => ({ x: l.center.x * scale + dx, y: l.center.y * scale + dy, radius: l.radius * scale })),
    cards: items.map(item => {
      const r = scene.rects[item.id];
      const w = Math.max(MIN_CARD.width, r.width * scale), h = Math.max(MIN_CARD.height, r.height * scale);
      return { id: item.id, group: !!item.groupId, width: w, height: h,
        x: (r.x + r.width / 2) * scale + dx - w / 2, y: (r.y + r.height / 2) * scale + dy - h / 2 };
    }),
  };
}
