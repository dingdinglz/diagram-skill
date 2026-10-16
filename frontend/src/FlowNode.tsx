import { memo } from 'react';
import { Handle, NodeToolbar, Position, useInternalNode, useStore, useViewport, type Node, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, Code2, Sparkles, UserRound, CircleDot, Flag, GitBranch, AlignLeft, X } from 'lucide-react';
import type { GraphNode, NodeData, NodeKind } from './types';
import { EXECUTOR_LABELS } from './types';
import { Markdown } from './Markdown';

const ExecutorIcon = { program: Code2, llm: Sparkles, human: UserRound };
export function NodeBody({ node, toggle, forceCollapsed = false }: { node: GraphNode; toggle?: () => void; forceCollapsed?: boolean }) {
  const Icon = ExecutorIcon[node.data.executor] || Code2;
  const KindIcon = node.type === 'start' ? CircleDot : node.type === 'end' ? Flag : node.type === 'decision' ? GitBranch : null;
  const expanded = !forceCollapsed && node.data.expanded && !!node.data.notes;
  return <>
    <div className={`node-body ${node.type === 'decision' ? 'diamond-body' : ''}`}>
      {node.type === 'decision' && <svg className="diamond-outline" viewBox="0 0 248 144" preserveAspectRatio="none" aria-hidden="true"><path d="M124 1.5 246.5 72 124 142.5 1.5 72Z" fill="#fdf9ed" stroke="#d6c29b" strokeWidth="1" style={{ fill: '#fdf9ed', stroke: '#d6c29b' }} vectorEffect="non-scaling-stroke" /></svg>}
      <div className="node-eyebrow"><Icon size={12} /><span>{EXECUTOR_LABELS[node.data.executor]}</span>{KindIcon && <KindIcon className="kind-icon" size={13} />}</div>
      <div className="node-title">{node.data.label || <span className="muted">未命名节点</span>}</div>
      {!!node.data.notes && <button type="button" className="node-note-toggle nodrag nopan" onClick={event => { event.stopPropagation(); toggle?.(); }} aria-label={`${expanded ? '收起' : '展开'} ${node.data.label} 的说明`} aria-expanded={expanded} aria-controls={expanded ? `node-notes-${node.id}` : undefined} tabIndex={toggle ? 0 : -1}>
        <AlignLeft size={11} /><span>附有说明</span>{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>}
    </div>
  </>;
}

function NodeNotes({ node, close }: { node: GraphNode; close: () => void }) {
  const internal = useInternalNode(node.id);
  const viewport = useViewport();
  const canvasWidth = useStore(state => state.width);
  const canvasHeight = useStore(state => state.height);
  if (!internal || canvasWidth <= 24 || canvasHeight <= 24) return null;

  const width = Math.min(380, canvasWidth - 24);
  const maxHeight = Math.min(420, canvasHeight - 24);
  const nodeLeft = internal.internals.positionAbsolute.x * viewport.zoom + viewport.x;
  const nodeRight = nodeLeft + (internal.measured.width || 248) * viewport.zoom;
  const nodeTop = internal.internals.positionAbsolute.y * viewport.zoom + viewport.y;
  const preferredLeft = nodeRight + 12 + width <= canvasWidth - 12 ? nodeRight + 12 : nodeLeft - width - 12;
  const left = Math.max(12, Math.min(preferredLeft, canvasWidth - width - 12));
  const top = Math.max(12, Math.min(nodeTop, canvasHeight - maxHeight - 12));

  // Portal outside the measured node; keep long notes readable and inside the canvas.
  return <NodeToolbar nodeId={node.id} isVisible className="node-notes nodrag nopan nowheel"
    id={`node-notes-${node.id}`} data-node-id={node.id} role="region" aria-label={`${node.data.label} 的说明`}
    style={{ transform: 'none', left, top, width, maxHeight, zIndex: 1001 }}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') close(); }}>
    <div className="node-notes-header"><span>{node.data.label}</span><button type="button" className="icon-button" aria-label={`关闭 ${node.data.label} 的说明`} onClick={close}><X size={15} /></button></div>
    <div className="node-notes-scroll" tabIndex={0}><Markdown text={node.data.notes} /></div>
  </NodeToolbar>;
}

export type CanvasNode = Node<NodeData & { onToggle?: (id: string) => void }, NodeKind>;
const FlowNode = memo(function FlowNode({ id, type, data, selected, isConnectable }: NodeProps<CanvasNode>) {
  const node: GraphNode = { id, type: type as NodeKind, position: { x: 0, y: 0 }, data };
  return <div className={`flow-node kind-${type} executor-${data.executor} ${selected ? 'is-selected' : ''}`}>
    <Handle type="target" position={Position.Top} id="top" isConnectable={isConnectable} />
    <Handle type="target" position={Position.Left} id="left-in" className="side-handle in-handle" style={{ top: '35%' }} isConnectable={isConnectable} />
    <Handle type="target" position={Position.Right} id="right-in" className="side-handle in-handle" style={{ top: '35%' }} isConnectable={isConnectable} />
    <NodeBody node={node} toggle={data.onToggle ? () => data.onToggle?.(id) : undefined} />
    <Handle type="source" position={Position.Bottom} id="bottom" isConnectable={isConnectable} />
    <Handle type="source" position={Position.Left} id="left" className="side-handle" style={{ top: '70%' }} isConnectable={isConnectable} />
    <Handle type="source" position={Position.Right} id="right" className="side-handle" style={{ top: '70%' }} isConnectable={isConnectable} />
    {data.expanded && !!data.notes && <NodeNotes node={node} close={() => data.onToggle?.(id)} />}
  </div>;
});
export default FlowNode;
