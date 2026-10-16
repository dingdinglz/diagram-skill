import { BaseEdge, EdgeLabelRenderer, type EdgeProps, type Edge } from '@xyflow/react';
import { useId } from 'react';
import type { EdgeGeometry } from './geometry';
import { edgeAppearance, EdgeArrow } from './edgeAppearance';

export type RoutedEdge = Edge<{ geometry: EdgeGeometry }, 'routed'>;
export function FlowEdge({ id, data, selected }: EdgeProps<RoutedEdge>) {
  const marker = useId().replace(/:/g, '');
  if (!data) return null;
  const { path, label, edge } = data.geometry;
  const appearance = edgeAppearance(data.geometry, selected);
  return <><defs><EdgeArrow id={marker} appearance={appearance} /></defs>
    <BaseEdge id={id} path={path} markerEnd={`url(#${marker})`} style={appearance.style} />
    {!!edge.label && <EdgeLabelRenderer><div className="flow-edge-label nodrag nopan" title={edge.label} style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)` }}>{edge.label}</div></EdgeLabelRenderer>}
  </>;
}
