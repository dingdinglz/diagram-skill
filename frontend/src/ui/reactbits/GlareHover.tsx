// Adapted from React Bits GlareHover — Copyright (c) 2026 David Haz.
// MIT + Commons Clause; provenance and retained license: see README.md.
import type { ButtonHTMLAttributes, CSSProperties } from 'react';

const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const bump = (t: number, half: number) => Math.abs(t - 0.5) >= half ? 0 : smootherstep(1 - Math.abs(t - 0.5) / half);

/** Upstream's sampled sheen profile; no loop, follow mode or RAF engine. */
export function glareGradient() {
  const stops = Array.from({ length: 33 }, (_, i) => {
    const t = i / 32, profile = 0.55 * bump(t, 0.425) + 0.3 * bump(t, 0.5);
    return `rgb(255 255 255 / ${(profile * 0.16).toFixed(4)}) ${(t * 100).toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
const SHEEN = glareGradient();

// The native button is the component root: no nested control or extra hit area.
export function GlareHover({ children, className = '', style, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type={type} className={`glare-hover ${className}`} style={{ '--glare-band': SHEEN, ...style } as CSSProperties}>
    <span className="glare-surface" aria-hidden="true"><span className="glare-band" /></span>
    {children}
  </button>;
}
