import { describe, expect, it } from 'vitest';
import loopFlow from '../../examples/loop-flow.json';
import nestedSubflows from '../../examples/nested-subflows.json';
import { levelChain, levelMap, levelPositionText, levelThumbnail } from './levelMap';
import type { Graph } from './types';

const example = (name: 'loop-flow' | 'nested-subflows') => (name === 'loop-flow' ? loopFlow : nestedSubflows) as unknown as Graph;

describe('level map', () => {
  it('describes every level from the main flow down and marks where the next one sits', () => {
    const entries = levelMap(example('nested-subflows'), 'inspect');
    expect(entries.map(e => e.id)).toEqual([null, 'fulfill', 'pack', 'inspect']);
    expect(entries.map(e => e.markerIds)).toEqual([['fulfill'], ['pack'], ['inspect'], []]);
    entries.slice(0, -1).forEach(e => expect(e.position).toBeGreaterThan(0));
    expect(levelPositionText(entries[3], true)).toBe(`当前 · 共 ${entries[3].total} 项`);
  });

  it('treats an enclosing loop as context, not a level to stop at', () => {
    const graph = example('loop-flow');
    expect(levelChain(graph, 'work').map(g => g.id)).toEqual(['work']);
    const [root] = levelMap(graph, 'work');
    expect(root.markerIds).toEqual(['work']);
    expect(levelPositionText(root, false)).toBe(`在循环「${root.loopLabel}」上`);
  });

  it('marks the steps on a loop when the loop itself is the level', () => {
    const graph = example('loop-flow');
    const [root, loop] = levelMap(graph, 'request-loop');
    expect(loop.id).toBe('request-loop');
    expect(root.markerIds.length).toBeGreaterThan(1);
    expect(levelPositionText(root, false)).toBe('循环「请求处理循环」所在位置');
  });

  it('fits the real geometry inside the frame and leaves out outside references', () => {
    const entries = levelMap(example('nested-subflows'), 'pack');
    entries.forEach(entry => {
      const thumb = levelThumbnail(entry.scene, 72, 50);
      expect(thumb.cards.length).toBe(entry.total);
      expect(thumb.cards.some(card => card.id.startsWith('reference:'))).toBe(false);
      thumb.cards.forEach(card => {
        expect(card.x).toBeGreaterThanOrEqual(0); expect(card.x + card.width).toBeLessThanOrEqual(72);
        expect(card.y).toBeGreaterThanOrEqual(0); expect(card.y + card.height).toBeLessThanOrEqual(50);
      });
    });
  });
});
