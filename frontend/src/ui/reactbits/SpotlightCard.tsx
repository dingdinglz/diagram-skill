// Adapted from React Bits SpotlightCard — Copyright (c) 2026 David Haz.
// MIT + Commons Clause; provenance and retained license: see README.md.
import { useEffect, useRef, type HTMLAttributes } from 'react';
import { useReducedMotion } from '../useReducedMotion';

// Upstream's smooth/Gaussian falloff, fixed to Flowplan's blue material.
export function spotlightFalloff() {
  const soft = 0.7, core = (1 - soft) ** 1.5 * 0.85;
  const stop = (alpha: number, at: number) => `color-mix(in srgb, #527be0 ${(alpha * 100).toFixed(2)}%, transparent) ${(at * 100).toFixed(2)}%`;
  return [stop(1, 0), ...Array.from({ length: 15 }, (_, i) => {
    const t = core + (1 - core) * i / 14, g = (t - core) / (1 - core);
    const smooth = 1 - g * g * (3 - 2 * g), glow = Math.exp(-4.6 * g * g) * (1 - g ** 6);
    return stop(smooth + (glow - smooth) * soft, t);
  })].join(', ');
}
const FALLOFF = spotlightFalloff();

export function SpotlightCard({ children, className = '', disabled = false, onPointerMove, onPointerLeave, onFocus, ...props }:
  HTMLAttributes<HTMLDivElement> & { disabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const point = useRef({ x: 0, y: 0 });
  const reduced = useReducedMotion();
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => { if (reduced || disabled) { cancelAnimationFrame(frame.current); frame.current = 0; } }, [reduced, disabled]);
  const place = (x: number, y: number) => {
    point.current = { x, y };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      root.current?.style.setProperty('--spot-x', `${point.current.x}px`);
      root.current?.style.setProperty('--spot-y', `${point.current.y}px`);
    });
  };
  return <div {...props} ref={root} className={`spotlight-card ${className}`} data-spotlight={reduced || disabled ? 'off' : 'ready'}
    onPointerMove={event => {
      onPointerMove?.(event);
      if (reduced || disabled || event.pointerType !== 'mouse') return;
      const box = event.currentTarget.getBoundingClientRect();
      place(event.clientX - box.left, event.clientY - box.top);
    }} onPointerLeave={event => { onPointerLeave?.(event); cancelAnimationFrame(frame.current); frame.current = 0; }}
    onFocus={event => {
      onFocus?.(event);
      if (reduced || disabled || !event.target.matches(':focus-visible')) return;
      const box = event.currentTarget.getBoundingClientRect(), target = event.target.getBoundingClientRect();
      place(target.left + target.width / 2 - box.left, target.top + target.height / 2 - box.top);
    }}>
    <span className="spotlight-light" aria-hidden="true" style={{ backgroundImage: `radial-gradient(circle 220px at var(--spot-x, 50%) var(--spot-y, 50%), ${FALLOFF})` }} />
    <span className="spotlight-rim" aria-hidden="true" style={{ backgroundImage: `radial-gradient(circle 150px at var(--spot-x, 50%) var(--spot-y, 50%), ${FALLOFF})` }} />
    {children}
  </div>;
}
