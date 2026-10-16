export interface Point { x: number; y: number }
export interface AnchorRect extends Point { width: number; height: number }

// Keep this value in sync with --node-radius in tokens.css.
export const CARD_RADIUS = 10;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const radiusOf = (rect: AnchorRect) => Math.min(CARD_RADIUS, rect.width / 2, rect.height / 2);

export function containsRounded(rect: AnchorRect, point: Point, padding = 0): boolean {
  const radius = Math.max(0, radiusOf(rect) + padding);
  const dx = Math.abs(point.x - rect.x - rect.width / 2) - (rect.width / 2 + padding - radius);
  const dy = Math.abs(point.y - rect.y - rect.height / 2) - (rect.height / 2 + padding - radius);
  return Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2 <= radius ** 2;
}

/** Closest point on the complete rounded outline, including the corner arcs. */
export function closestOutlinePoint(rect: AnchorRect, point: Point): Point {
  const { x, y, width: w, height: h } = rect, r = radiusOf(rect);
  const candidates: Point[] = [
    { x: clamp(point.x, x + r, x + w - r), y },
    { x: x + w, y: clamp(point.y, y + r, y + h - r) },
    { x: clamp(point.x, x + r, x + w - r), y: y + h },
    { x, y: clamp(point.y, y + r, y + h - r) },
  ];
  for (const [cx, cy, start] of [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]]) {
    let angle = Math.atan2(point.y - cy, point.x - cx);
    if (start === Math.PI && angle < 0) angle += Math.PI * 2;
    angle = clamp(angle, start, start + Math.PI / 2);
    candidates.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return candidates.reduce((best, candidate) =>
    Math.hypot(candidate.x - point.x, candidate.y - point.y) < Math.hypot(best.x - point.x, best.y - point.y) ? candidate : best);
}

/** Convert pointer coordinates to a persistent normalized outline anchor. */
export function outlineAnchor(rect: AnchorRect, point: Point): Point {
  const projected = closestOutlinePoint(rect, point);
  return { x: clamp((projected.x - rect.x) / rect.width, 0, 1), y: clamp((projected.y - rect.y) / rect.height, 0, 1) };
}

/** Resolve saved normalized coordinates against the current card size. */
export function projectAnchor(rect: AnchorRect, anchor: Point): Point {
  return closestOutlinePoint(rect, { x: rect.x + anchor.x * rect.width, y: rect.y + anchor.y * rect.height });
}

/** Intersect a ray from the card centre with its rounded outline. */
export function boundaryToward(rect: AnchorRect, toward: Point): Point {
  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const dx = toward.x - centre.x, dy = toward.y - centre.y;
  if (!dx && !dy) return { x: centre.x, y: rect.y + rect.height };
  const scale = 1 / Math.max(Math.abs(dx) / (rect.width / 2), Math.abs(dy) / (rect.height / 2));
  let low = 0, high = scale;
  for (let i = 0; i < 45; i++) {
    const middle = (low + high) / 2;
    if (containsRounded(rect, { x: centre.x + middle * dx, y: centre.y + middle * dy })) low = middle;
    else high = middle;
  }
  return { x: centre.x + high * dx, y: centre.y + high * dy };
}
