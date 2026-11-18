import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { LibraryIndex } from './library';

type Target = { id: string; zone: 'before' | 'after' | 'inside' | 'parent' | 'end' };
type Options = {
  index: LibraryIndex; folderId: string | null; enabled: boolean;
  onMove: (id: string, parentId: string | null, index?: number) => void;
};

export function libraryRowZone(folder: boolean, fraction: number): Target['zone'] {
  if (folder && fraction >= .25 && fraction <= .75) return 'inside';
  return fraction < .5 ? 'before' : 'after';
}

// Resolve a semantic hit, never an index cached at pointerdown. The move API
// counts mixed siblings *after* removing the dragged entry from its old slot.
export function libraryDropPlacement(store: LibraryIndex, folderId: string | null, id: string, target: Target | null) {
  if (!target || store.byId.get(id)?.parentId !== folderId || target.id === id) return null;
  const siblings = store.children.get(folderId) ?? [];
  const from = siblings.findIndex(entry => entry.id === id);
  if (from < 0) return null;
  let parentId = folderId;
  let slot = siblings.length;
  if (target.zone === 'parent') {
    const folder = folderId === null ? null : store.byId.get(folderId);
    if (folder?.kind !== 'folder' || target.id !== (folder.parentId ?? '')) return null;
    parentId = folder.parentId;
  } else if (target.zone === 'end') {
    if (target.id !== (folderId ?? '')) return null;
  } else {
    const anchor = store.byId.get(target.id);
    if (!anchor || anchor.parentId !== folderId) return null;
    if (target.zone === 'inside') {
      if (anchor.kind !== 'folder') return null;
      parentId = anchor.id;
    } else {
      slot = siblings.findIndex(entry => entry.id === anchor.id);
      if (slot < 0) return null;
      if (target.zone === 'after') slot++;
    }
  }

  // Reject broken ancestry and inserting a folder into its own subtree.
  const seen = new Set([id]);
  for (let ancestor = parentId; ancestor !== null;) {
    const entry = store.byId.get(ancestor);
    if (seen.has(ancestor) || entry?.kind !== 'folder') return null;
    seen.add(ancestor);
    ancestor = entry.parentId;
  }
  if (parentId !== folderId) return { parentId, index: store.children.get(parentId)?.length ?? 0 };
  if (slot > from) slot--;
  return slot === from ? null : { parentId, index: slot };
}

function hitTarget(hit: Element | null, nav: HTMLElement, y: number, { index, folderId }: Options): Target | null {
  if (!hit) return null;
  const parent = hit.closest<HTMLElement>('.library-location[data-parent-drop]');
  if (parent && parent.parentElement === nav.parentElement) return { id: parent.dataset.parentDrop!, zone: 'parent' };
  if (hit === nav) return { id: folderId ?? '', zone: 'end' };
  const row = hit.closest<HTMLElement>('.library-row[data-entry-id]');
  if (!row || !nav.contains(row)) return null;
  const id = row.dataset.entryId!;
  const { top, height } = row.getBoundingClientRect();
  if (!height) return null;
  return { id, zone: libraryRowZone(index.byId.get(id)?.kind === 'folder', (y - top) / height) };
}

function scrollAtEdge(nav: HTMLElement, y: number, dt: number) {
  const { top, bottom, height } = nav.getBoundingClientRect();
  const band = Math.min(48, height / 3);
  if (!band) return;
  const proximity = Math.max(0, 1 - Math.min(y - top, bottom - y) / band);
  if (proximity) nav.scrollTop += (y < (top + bottom) / 2 ? -1 : 1) * Math.ceil(.75 * dt * proximity);
}

export function useLibraryDrag(options: Options) {
  const latest = useRef(options);
  const cancel = useRef<(() => void) | null>(null);
  const suppress = useRef<number | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  useLayoutEffect(() => { latest.current = options; });
  useLayoutEffect(() => () => cancel.current?.(), [options.enabled, options.folderId]);
  useLayoutEffect(() => {
    // A fresh press anywhere (including a non-draggable button) is a new
    // gesture, even if the previous release never dispatched a click here.
    const reset = () => { suppress.current = null; };
    window.addEventListener('pointerdown', reset, true);
    return () => window.removeEventListener('pointerdown', reset, true);
  }, []);

  function start(e: ReactPointerEvent<HTMLElement>, id: string) {
    const { index, folderId, enabled } = latest.current;
    if (!enabled || cancel.current || e.button !== 0 || !e.isPrimary || index.byId.get(id)?.parentId !== folderId) return;
    const handle: HTMLElement = e.currentTarget;
    const row = handle.closest<HTMLElement>('.library-row[data-entry-id]');
    const nav = row?.closest<HTMLElement>('.task-list');
    if (!nav || row?.dataset.entryId !== id || handle.closest('[inert],[hidden],[aria-hidden="true"]')) return;
    const { pointerId, clientX: originX, clientY: originY } = e;
    const events = new AbortController();
    const listen = { capture: true, signal: events.signal };
    let x = originX, y = originY, active = false, frame = 0, lastTime = performance.now();
    let previous: Target | null = null;
    function finish() {
      events.abort();
      cancelAnimationFrame(frame);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      cancel.current = null;
      if (active) {
        row!.style.removeProperty('--drag-x');
        row!.style.removeProperty('--drag-y');
        suppress.current = pointerId;
        setDragId(null);
        setTarget(null);
      }
    }
    function usable() {
      return !document.hidden && handle.isConnected && !handle.closest('[inert],[hidden],[aria-hidden="true"]') &&
        nav!.getClientRects().length > 0 && getComputedStyle(nav!).visibility === 'visible' &&
        latest.current.index.byId.get(id)?.parentId === folderId;
    }
    function resolve(hit: Element | null) {
      const candidate = hitTarget(hit, nav!, y, latest.current);
      const move = libraryDropPlacement(latest.current.index, folderId, id, candidate);
      return { target: move ? candidate : null, move };
    }
    function tick(now: number) {
      if (!usable()) return finish();
      if (active) {
        let hit = document.elementFromPoint(x, y); // event.target is captured by the handle
        if (nav!.contains(hit)) {
          const before = nav!.scrollTop;
          scrollAtEdge(nav!, y, Math.min(40, now - lastTime));
          if (nav!.scrollTop !== before) hit = document.elementFromPoint(x, y);
        }
        const next = resolve(hit).target;
        if (next?.zone !== previous?.zone || next?.id !== previous?.id) {
          previous = next;
          setTarget(next);
        }
      }
      lastTime = now;
      frame = requestAnimationFrame(tick);
    }
    window.addEventListener('pointermove', event => {
      if (event.pointerId !== pointerId) return;
      if (!(event.buttons & 1)) return finish(); // released outside the window before capture
      x = event.clientX; y = event.clientY;
      if (!active) {
        if (Math.hypot(x - originX, y - originY) < 6) return;
        if (!usable()) return finish();
        handle.setPointerCapture(pointerId);
        active = true;
        setDragId(id);
      }
      // Viewport pixels for a pointer-transparent fixed preview in the origin row.
      // Pointer position alone never goes through React state.
      row.style.setProperty('--drag-x', `${x}px`);
      row.style.setProperty('--drag-y', `${y}px`);
      event.preventDefault();
    }, { ...listen, passive: false });
    window.addEventListener('pointerup', event => {
      if (event.pointerId !== pointerId) return;
      x = event.clientX; y = event.clientY;
      const move = active && usable() ? resolve(document.elementFromPoint(x, y)).move : null;
      finish();
      if (move) latest.current.onMove(id, move.parentId, move.index);
    }, listen);
    window.addEventListener('pointercancel', event => { if (event.pointerId === pointerId) finish(); }, listen);
    handle.addEventListener('lostpointercapture', event => {
      if (event.pointerId === pointerId && !handle.hasPointerCapture(pointerId)) finish();
    }, listen);
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); finish();
    }, listen);
    window.addEventListener('blur', finish, { signal: events.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) finish(); }, listen);
    cancel.current = finish;
    frame = requestAnimationFrame(tick);
  }

  function blockClick(e: ReactMouseEvent) {
    if (suppress.current === null || e.detail === 0) return; // preserve keyboard activation
    const native = e.nativeEvent;
    if ('pointerId' in native && native.pointerId !== suppress.current) return;
    suppress.current = null;
    e.preventDefault(); e.stopPropagation();
  }
  return { start, dragId, target, blockClick };
}
