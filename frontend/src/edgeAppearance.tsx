import type { CSSProperties } from 'react';
import type { EdgeGeometry } from './geometry';

type EdgeKind = 'loop' | 'main' | 'support' | 'exception';

// Use the same hierarchy in the editor, detail diagrams and exported PNGs.
// Explicit secondary roles take precedence over a circular route.
export function edgeAppearance(geometry: EdgeGeometry, selected = false) {
  const role = geometry.edge.role || 'main';
  const kind: EdgeKind = role === 'main' && geometry.isLoop ? 'loop' : role;
  const stroke = selected ? 'var(--accent)' : `var(--flow-edge-${kind})`;
  const width = `var(--flow-edge-${kind}-width)`;
  const style: CSSProperties = {
    stroke,
    strokeWidth: selected ? `calc(${width} + 0.6px)` : width,
    strokeDasharray: kind === 'exception' ? '6 5' : undefined,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  return { kind, stroke, style, arrowSize: kind === 'loop' ? 15 : kind === 'main' ? 13 : 10 };
}

export function EdgeArrow({ id, appearance }: { id: string; appearance: ReturnType<typeof edgeAppearance> }) {
  return <marker id={id} viewBox="0 0 10 10" refX="10" refY="5"
    markerWidth={appearance.arrowSize} markerHeight={appearance.arrowSize}
    markerUnits="userSpaceOnUse" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 L2 5z" fill={appearance.stroke} stroke="none" />
  </marker>;
}
