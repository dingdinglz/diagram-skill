import { describe, expect, it } from 'vitest';
import { libraryIndex } from './library';
import type { LibraryEntry } from './types';
import { libraryDropPlacement as place, libraryRowZone } from './useLibraryDrag';

const task = (id: string, parentId: string | null = null): LibraryEntry => ({ id, parentId, kind: 'task' });
const folder = (id: string, parentId: string | null = null): LibraryEntry => ({ id, parentId, kind: 'folder', name: id });
const index = (...entries: LibraryEntry[]) => libraryIndex({ entries, tasks: [] });
const store = index(task('a'), folder('f'), folder('g', 'f'), task('b'), task('c'), task('leaf', 'g'));

describe('library drag placement', () => {
  it('splits task rows into halves and reserves the middle of folders for nesting', () => {
    const offsets = [.1, .3, .5, .7, .9];
    expect(offsets.map(y => libraryRowZone(false, y))).toEqual(['before', 'before', 'after', 'after', 'after']);
    expect(offsets.map(y => libraryRowZone(true, y))).toEqual(['before', 'inside', 'inside', 'inside', 'after']);
  });

  it('uses indices in the mixed sibling list after removal in both directions', () => {
    expect(place(store, null, 'a', { zone: 'after', id: 'b' })).toEqual({ parentId: null, index: 2 });
    expect(place(store, null, 'a', { zone: 'before', id: 'c' })).toEqual({ parentId: null, index: 2 });
    expect(place(store, null, 'c', { zone: 'before', id: 'f' })).toEqual({ parentId: null, index: 1 });
    expect(place(store, null, 'f', { zone: 'after', id: 'b' })).toEqual({ parentId: null, index: 2 });
    expect(place(store, null, 'f', { zone: 'end', id: '' })).toEqual({ parentId: null, index: 3 });
  });

  it('appends inside a folder or one directory up, including root', () => {
    expect(place(store, null, 'b', { zone: 'inside', id: 'f' })).toEqual({ parentId: 'f', index: 1 });
    expect(place(store, 'g', 'leaf', { zone: 'parent', id: 'f' })).toEqual({ parentId: 'f', index: 1 });
    expect(place(store, 'f', 'g', { zone: 'parent', id: '' })).toEqual({ parentId: null, index: 4 });
  });

  it('rejects no-ops at either edge of the source or at the end', () => {
    expect(place(store, null, 'f', { zone: 'after', id: 'a' })).toBeNull();
    expect(place(store, null, 'f', { zone: 'before', id: 'b' })).toBeNull();
    expect(place(store, null, 'c', { zone: 'end', id: '' })).toBeNull();
  });

  it('rejects self, descendants, non-folders, out-of-view rows and stale header hits', () => {
    expect(place(store, null, 'f', { zone: 'inside', id: 'f' })).toBeNull();
    expect(place(store, null, 'f', { zone: 'inside', id: 'g' })).toBeNull();
    expect(place(store, null, 'f', { zone: 'inside', id: 'a' })).toBeNull();
    expect(place(store, null, 'b', { zone: 'after', id: 'g' })).toBeNull();
    expect(place(store, 'f', 'g', { zone: 'end', id: '' })).toBeNull();
    expect(place(store, 'g', 'leaf', { zone: 'parent', id: '' })).toBeNull();
    expect(place(store, null, 'b', { zone: 'parent', id: '' })).toBeNull();
    expect(place(store, null, 'b', null)).toBeNull();
  });

  it('resolves against the release-time order; removed and reparented entries are not targets', () => {
    const target = { zone: 'before', id: 'c' } as const;
    const changed = index(task('b'), task('a'), folder('f'), task('c'));
    expect(place(changed, null, 'b', target)).toEqual({ parentId: null, index: 2 });
    expect(place(index(task('b')), null, 'b', target)).toBeNull();
    expect(place(index(task('c')), null, 'b', target)).toBeNull();
    expect(place(index(task('c'), folder('f'), task('b', 'f')), null, 'b', target)).toBeNull();
    expect(place(index(task('b'), folder('f'), task('c', 'f')), null, 'b', target)).toBeNull();
  });
});
