import type { Library, LibraryEntry } from './types';

export function libraryIndex({ entries, tasks }: Library) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const summaries = new Map(tasks.map(task => [task.id, task]));
  const children = new Map<string | null, LibraryEntry[]>();
  for (const entry of entries) {
    if (!children.has(entry.parentId)) children.set(entry.parentId, []);
    children.get(entry.parentId)!.push(entry);
  }
  const title = (entry: LibraryEntry) => entry.kind === 'folder' ? entry.name : summaries.get(entry.id)?.title || '未命名流程';
  function path(id: string | null) {
    const parts: string[] = [];
    while (id) {
      const entry = byId.get(id);
      if (!entry) break;
      parts.push(title(entry)); id = entry.parentId;
    }
    return ['项目根目录', ...parts.reverse()].join(' / ');
  }
  function destinations(excludeId?: string) {
    const result = [{ id: '', path: '项目根目录' }];
    const stack = [{ id: null as string | null, path: '' }];
    while (stack.length) {
      const parent = stack.pop()!;
      if (parent.id) result.push({ id: parent.id, path: parent.path });
      const siblings = children.get(parent.id) || [];
      for (let i = siblings.length - 1; i >= 0; i--) {
        const child = siblings[i];
        if (child.kind === 'folder' && child.id !== excludeId) stack.push({ id: child.id, path: parent.path ? `${parent.path} / ${child.name}` : child.name });
      }
    }
    return result;
  }
  return { entries, byId, summaries, children, title, path, destinations };
}
export type LibraryIndex = ReturnType<typeof libraryIndex>;
