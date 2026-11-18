import { useEffect, useRef, useState, type ComponentPropsWithRef } from 'react';

const MIN_WIDTH = 184;
const WIDTH_KEY = 'flowplan:sidebar-width';
const clamp = (value: number, max: number) => Math.max(MIN_WIDTH, Math.min(max, Math.round(value)));

export function TaskSidebar({ narrow, collapsed, children, ...props }: ComponentPropsWithRef<'aside'> & { narrow: boolean; collapsed: boolean }) {
  const [preferred, setPreferred] = useState<number | null>(() => {
    try {
      const value = Number(localStorage.getItem(WIDTH_KEY));
      return Number.isFinite(value) && value >= MIN_WIDTH ? value : null;
    } catch { return null; }
  });
  const [viewport, setViewport] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const max = Math.max(MIN_WIDTH, Math.min(420, Math.floor(viewport * .30)));
  const width = clamp(preferred ?? (viewport <= 1280 ? 212 : 232), max);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const remember = (value: number) => {
    setPreferred(value);
    try { localStorage.setItem(WIDTH_KEY, String(value)); } catch { /* Optional preference. */ }
  };

  return <aside {...props} className="sidebar" hidden={!narrow && collapsed} style={narrow ? undefined : { width }}>
    {children}
    {!narrow && !collapsed && <div className="sidebar-splitter" role="separator" tabIndex={0} aria-orientation="vertical"
      aria-label="任务导航宽度" aria-controls={props.id} aria-valuemin={MIN_WIDTH} aria-valuemax={max} aria-valuenow={width} aria-valuetext={`${width} 像素`}
      title="拖动调整导航宽度，也可使用左右方向键"
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, width };
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (start?.id === event.pointerId) setPreferred(clamp(start.width + event.clientX - start.x, max));
      }}
      onPointerUp={event => {
        const start = drag.current;
        if (start?.id === event.pointerId) remember(clamp(start.width + event.clientX - start.x, max));
      }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        const next = { ArrowLeft: width - 16, ArrowRight: width + 16, Home: MIN_WIDTH, End: max }[event.key];
        if (next === undefined) return;
        event.preventDefault(); event.stopPropagation(); remember(clamp(next, max));
      }} />}
  </aside>;
}
