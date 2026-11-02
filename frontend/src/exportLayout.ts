/**
 * html-to-image copies computed heights. A balanced CSS multicolumn container can
 * then overflow into an extra column during SVG layout. Preserve the live column
 * assignment using independent block columns before taking the snapshot.
 */
export function stabilizeExportNotes(element: HTMLElement): void {
  const grid = element.querySelector<HTMLElement>('.export-note-grid');
  if (!grid || grid.dataset.exportColumns === 'fixed') return;
  const notes = Array.from(grid.querySelectorAll<HTMLElement>(':scope > .export-note'));
  if (!notes.length) return;
  const bounds = grid.getBoundingClientRect();
  const columns = new Map<number, HTMLElement[]>();
  for (const note of notes) {
    const box = note.getBoundingClientRect();
    if (box.left < bounds.left - 1 || box.right > bounds.right + 1) {
      throw new Error('节点说明超出导出范围，请精简说明后重试。草稿已保留。');
    }
    const key = Math.round(box.left - bounds.left);
    const column = columns.get(key) || [];
    column.push(note);
    columns.set(key, column);
  }
  const wrappers = [...columns.entries()].sort(([a], [b]) => a - b).map(([, children]) => {
    const column = element.ownerDocument.createElement('div');
    column.className = 'export-note-column';
    column.style.display = 'flow-root';
    column.append(...children);
    return column;
  });
  const columnCount = Math.max(wrappers.length, parseInt(grid.style.columnCount, 10) || 1);
  grid.style.columnCount = 'auto';
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;
  grid.style.alignItems = 'start';
  grid.replaceChildren(...wrappers);
  grid.dataset.exportColumns = 'fixed';
}
