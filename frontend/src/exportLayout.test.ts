import { describe, expect, it } from 'vitest';
import { stabilizeExportNotes } from './exportLayout';

// Geometry/DOM doubles keep the existing Node-only test environment. The browser
// smoke also checks the real serialized export, with all seven notes retained.
interface Box {
  className: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  children: Box[];
  append(...children: Box[]): void;
  replaceChildren(...children: Box[]): void;
  getBoundingClientRect(): DOMRect;
}
function box(): Box {
  return {
    className: '', style: {} as Record<string, string>, dataset: {} as Record<string, string>,
    children: [],
    append(...children: Box[]) { this.children.push(...children); },
    replaceChildren(...children: Box[]) { this.children = children; },
    getBoundingClientRect: () => ({ left: -100000, right: -98816 }) as DOMRect,
  };
}
function fixture(positions: number[]) {
  const grid = box();
  grid.style = { columnCount: '2', columnGap: '20px' };
  const notes = positions.map((left, i) => {
    const note = box();
    note.className = 'export-note';
    note.dataset.exportNote = String(i);
    note.getBoundingClientRect = () => ({ left: -100000 + left, right: -100000 + left + 582 }) as DOMRect;
    return note;
  });
  grid.children = [...notes];
  const root = {
    querySelector: () => Object.assign(grid, { querySelectorAll: () => notes }),
    ownerDocument: { createElement: box },
  } as unknown as HTMLElement;
  return { root, grid, notes };
}

describe('stable export note columns', () => {
  it('preserves column membership, order, content identity and gaps', () => {
    const { root, grid, notes } = fixture([0, 0, 0, 602, 602, 602, 602]);
    stabilizeExportNotes(root);
    expect(grid.style.columnCount).toBe('auto');
    expect(grid.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(grid.style.columnGap).toBe('20px');
    expect(grid.children.map(c => c.children.map(n => n.dataset.exportNote))).toEqual([['0', '1', '2'], ['3', '4', '5', '6']]);
    grid.children.flatMap(c => c.children).forEach((note, i) => expect(note).toBe(notes[i]));
    stabilizeExportNotes(root);
    expect(grid.children).toHaveLength(2);
  });

  it('preserves empty column space and handles empty documents', () => {
    const { root, grid } = fixture([0]);
    stabilizeExportNotes(root);
    expect(grid.children).toHaveLength(1);
    expect(grid.style.gridTemplateColumns).toContain('repeat(2,');
    expect(() => stabilizeExportNotes(fixture([]).root)).not.toThrow();
    expect(() => stabilizeExportNotes({ querySelector: () => null } as unknown as HTMLElement)).not.toThrow();
  });

  it('rejects existing overflow before moving any note', () => {
    const { root, grid } = fixture([0, 602, 1204]);
    expect(() => stabilizeExportNotes(root)).toThrow('节点说明超出导出范围');
    expect(grid.children).toHaveLength(3);
    expect(grid.children[0].className).toBe('export-note');
    expect(grid.style.columnCount).toBe('2');
  });
});
