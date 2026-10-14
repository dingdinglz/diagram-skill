import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, Code2, Sparkles, UserRound, CircleDot, Flag, GitBranch, AlignLeft } from 'lucide-react';
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
      {!!node.data.notes && <button type="button" className="node-note-toggle nodrag nopan" onClick={event => { event.stopPropagation(); toggle?.(); }} aria-label={`${expanded ? '收起' : '展开'} ${node.data.label} 的说明`} tabIndex={toggle ? 0 : -1}>
        <AlignLeft size={11} /><span>附有说明</span>{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>}
    </div>
    {expanded && <div className="node-notes nodrag nowheel"><Markdown text={node.data.notes} /></div>}
  </>;
}
export type CanvasNode = Node<NodeData & { onToggle?: (id: string) => void }, NodeKind>;
const FlowNode = memo(function FlowNode({ id, type, data, selected, isConnectable }: NodeProps<CanvasNode>) {
  const node: GraphNode = { id, type: type as NodeKind, position: { x: 0, y: 0 }, data };
  return <div className={`flow-node kind-${type} executor-${data.executor} ${selected ? 'is-selected' : ''} ${data.expanded && data.notes ? 'has-expanded-notes' : ''}`}>
    <Handle type="target" position={Position.Top} id="top" isConnectable={isConnectable} />
    <Handle type="target" position={Position.Left} id="left-in" className="side-handle in-handle" style={{ top: '35%' }} isConnectable={isConnectable} />
    <Handle type="target" position={Position.Right} id="right-in" className="side-handle in-handle" style={{ top: '35%' }} isConnectable={isConnectable} />
    <NodeBody node={node} toggle={data.onToggle ? () => data.onToggle?.(id) : undefined} />
    <Handle type="source" position={Position.Bottom} id="bottom" isConnectable={isConnectable} />
    <Handle type="source" position={Position.Left} id="left" className="side-handle" style={{ top: '70%' }} isConnectable={isConnectable} />
    <Handle type="source" position={Position.Right} id="right" className="side-handle" style={{ top: '70%' }} isConnectable={isConnectable} />
  </div>;
});
export default FlowNode;
