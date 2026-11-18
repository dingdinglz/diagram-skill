import { useEffect, useRef, useState } from 'react';

type PanelWidthOptions = {
  storageKey: string; min: number; defaultWidth: (viewport: number) => number; maxWidth: (viewport: number) => number;
  edge: 'left' | 'right'; controls?: string; label: string; className: string;
};

export function usePanelWidth({ storageKey, min, defaultWidth, maxWidth, edge, controls, label, className }: PanelWidthOptions) {
  const [preferred, setPreferred] = useState<number | null>(() => {
    try {
      const value = Number(localStorage.getItem(storageKey));
      return Number.isFinite(value) && value >= min ? value : null;
    } catch { return null; }
  });
  const [viewport, setViewport] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const max = Math.max(min, Math.floor(maxWidth(viewport)));
  const clamp = (value: number) => Math.max(min, Math.min(max, Math.round(value)));
  const width = clamp(preferred ?? defaultWidth(viewport));
  const direction = edge === 'left' ? -1 : 1;
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const remember = (value: number) => {
    setPreferred(value);
    try { localStorage.setItem(storageKey, String(value)); } catch { /* Optional preference. */ }
  };

  const splitter = <div className={`panel-splitter ${className}`} role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={label} aria-controls={controls} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} aria-valuetext={`${width} 像素`}
    title={`拖动调整${label}，也可使用左右方向键`}
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, width };
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (start?.id === event.pointerId) setPreferred(clamp(start.width + direction * (event.clientX - start.x)));
    }}
    onPointerUp={event => {
      const start = drag.current;
      if (start?.id === event.pointerId) remember(clamp(start.width + direction * (event.clientX - start.x)));
    }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      const next = { ArrowLeft: width - direction * 16, ArrowRight: width + direction * 16, Home: min, End: max }[event.key];
      if (next === undefined) return;
      event.preventDefault(); event.stopPropagation(); remember(clamp(next));
    }} />;
  return { width, splitter };
}
