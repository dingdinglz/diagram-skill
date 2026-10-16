import { describe, expect, it } from 'vitest';
import { boundaryToward, closestOutlinePoint, containsRounded, outlineAnchor, projectAnchor } from './anchors';

const rect = { x: 30, y: 70, width: 248, height: 116 };

describe('rounded card anchors', () => {
  it('preserves arbitrary positions on every straight side', () => {
    for (const point of [{ x: 63, y: 70 }, { x: 278, y: 103 }, { x: 81, y: 186 }, { x: 30, y: 151 }]) {
      const anchor = outlineAnchor(rect, point);
      expect(projectAnchor(rect, anchor)).toEqual(point);
    }
  });

  it('projects all four square corners onto the visible rounded outline', () => {
    for (const point of [{ x: 30, y: 70 }, { x: 278, y: 70 }, { x: 278, y: 186 }, { x: 30, y: 186 }]) {
      const projected = closestOutlinePoint(rect, point);
      const cx = point.x === rect.x ? rect.x + 10 : rect.x + rect.width - 10;
      const cy = point.y === rect.y ? rect.y + 10 : rect.y + rect.height - 10;
      expect(Math.hypot(projected.x - cx, projected.y - cy)).toBeCloseTo(10, 9);
      expect(projected).not.toEqual(point);
      expect(containsRounded(rect, point)).toBe(false);
      expect(containsRounded(rect, projected, .001)).toBe(true);
      expect(projectAnchor(rect, outlineAnchor(rect, point)).x).toBeCloseTo(projected.x, 9);
    }
  });

  it('keeps anchors relative to a moved or resized card', () => {
    const anchor = outlineAnchor(rect, { x: rect.x + 63, y: rect.y });
    expect(projectAnchor({ ...rect, x: 130, y: 270 }, anchor)).toEqual({ x: 193, y: 270 });
    expect(projectAnchor({ ...rect, width: 496 }, anchor)).toEqual({ x: 156, y: 70 });
  });

  it('places automatic ray intersections on straight and curved boundaries', () => {
    expect(boundaryToward(rect, { x: 1000, y: 128 })).toEqual({ x: 278, y: 128 });
    const corner = boundaryToward(rect, { x: 278, y: 70 });
    expect(corner.x).toBeLessThan(278);
    expect(corner.y).toBeGreaterThan(70);
    expect(containsRounded(rect, corner, .001)).toBe(true);
    expect(closestOutlinePoint(rect, corner).x).toBeCloseTo(corner.x, 7);
  });

  it('accepts imported interior normalized coordinates and resolves them to the outline', () => {
    expect(projectAnchor(rect, { x: .25, y: .2 })).toEqual({ x: 92, y: 70 });
    expect(boundaryToward(rect, { x: 154, y: 128 })).toEqual({ x: 154, y: 186 });
  });
});
