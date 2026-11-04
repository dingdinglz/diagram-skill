import { memo, useEffect, useState, type PointerEvent } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { ChevronRight, FileText, Jump, NODE_ICONS, EXECUTOR_ICONS, GroupIcon } from './icons';
import type { GraphNode, NodeData, NodeKind } from './types';
import { EXECUTOR_LABELS } from './types';
import type { nodePorts } from './geometry';
import { CARD_RADIUS, closestOutlinePoint, type Point } from './anchors';

export function NodeBody({ node, groupId, memberCount, referenceJump = false, branchCount = 0, exceptionsOnly = false, onBranches, onGroup }: {
  node: GraphNode; groupId?: string; memberCount?: number; referenceJump?: boolean; branchCount?: number; exceptionsOnly?: boolean; onBranches?: () => void; onGroup?: () => void;
}) {
  const KindIcon = groupId ? GroupIcon : NODE_ICONS[node.type];
  const ExecutorIcon = EXECUTOR_ICONS[node.data.executor];
  return <div className="node-body">
    <div className="node-main">
      <span className="node-symbol" aria-hidden="true"><KindIcon className="node-kind-icon" size={22} weight="bold" /></span>
      <div className="node-copy"><div className="node-title" title={node.data.label}>{node.data.label || '未命名节点'}</div>
        {!!node.data.summary && <div className="node-summary" title={node.data.summary}>{node.data.summary}</div>}
      </div>
    </div>
    <div className="node-footer">
      {groupId ? <span className="group-count">{memberCount} 个步骤</span> : referenceJump ? <span className="reference-jump"><Jump size={13} />跳转到这一步</span>
        : <span className="executor-label"><ExecutorIcon size={13} />{EXECUTOR_LABELS[node.data.executor]}</span>}
      {!groupId && !referenceJump && !!node.data.notes && <span className="node-note-indicator" title="包含完整说明"><FileText size={12} />说明</span>}
      {groupId && onGroup && <button className="node-subflow-button nodrag nopan" aria-label={`进入 ${node.data.label}`} onClick={e => { e.stopPropagation(); onGroup(); }}>进入<ChevronRight size={11} /></button>}
      {!!branchCount && <button className="node-branch-button nodrag nopan" tabIndex={onBranches ? 0 : -1} aria-label={`查看 ${node.data.label} 的分支`} onClick={e => { e.stopPropagation(); onBranches?.(); }}>{exceptionsOnly ? '异常' : '分支'} · {branchCount}<ChevronRight size={11} /></button>}
    </div>
  </div>;
}

export type CanvasData = NodeData & { groupId?: string; memberCount?: number; reference?: boolean; dropTarget?: boolean; branchCount?: number; exceptionsOnly?: boolean; ports?: ReturnType<typeof nodePorts>;
  onBranches?: () => void; onGroup?: () => void; loopRadius?: number;
  onOutlineStart?: (event: PointerEvent<SVGRectElement>, nodeId: string) => void };
export type CanvasNode = Node<CanvasData, NodeKind | 'loop-area'>;
const FlowNode = memo(function FlowNode({ id, type, data, selected, isConnectable }: NodeProps<CanvasNode>) {
  const update = useUpdateNodeInternals();
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const signature = JSON.stringify(data.ports);
  useEffect(() => { update(id); }, [id, signature, update]);
  const node: GraphNode = { id, type: type as NodeKind, position: { x: 0, y: 0 }, data };
  return <div className={`flow-node kind-${type} executor-${data.executor} ${selected ? 'is-selected' : ''} ${data.groupId ? 'is-group' : ''} ${data.reference ? 'reference-node' : ''} ${data.dropTarget ? 'is-drop-target' : ''}`}>
    <Handle type="target" position={Position.Top} id="top" className="legacy-handle" isConnectable={false} />
    <Handle type="target" position={Position.Left} id="left-in" className="legacy-handle" style={{ top: '35%' }} isConnectable={false} />
    <Handle type="target" position={Position.Right} id="right-in" className="legacy-handle" style={{ top: '35%' }} isConnectable={false} />
    <NodeBody node={node} groupId={data.groupId} memberCount={data.memberCount} referenceJump={data.reference} branchCount={data.branchCount} exceptionsOnly={data.exceptionsOnly} onBranches={data.onBranches} onGroup={data.onGroup} />
    <Handle type="source" position={Position.Bottom} id="bottom" className="legacy-handle" isConnectable={false} />
    <Handle type="source" position={Position.Left} id="left" className="legacy-handle" style={{ top: '70%' }} isConnectable={false} />
    <Handle type="source" position={Position.Right} id="right" className="legacy-handle" style={{ top: '70%' }} isConnectable={false} />
    {data.ports?.map(port => <Handle key={port.id} id={port.id} type={port.type} position={Position.Top} isConnectable={false} className="routed-handle" style={{ left: port.x, top: port.y }} />)}
    {isConnectable && <svg className="connection-outline-layer" width={248} height={116}>
      <rect className="connection-outline nodrag nopan" data-connection-outline={id} x={0} y={0} width={248} height={116} rx={CARD_RADIUS}
        onPointerDown={event => data.onOutlineStart?.(event, id)}
        onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); setHoverPoint(closestOutlinePoint({ x: 0, y: 0, width: 248, height: 116 }, { x: (event.clientX - box.left) * 248 / box.width, y: (event.clientY - box.top) * 116 / box.height })); }}
        onPointerLeave={() => setHoverPoint(null)} />
      {hoverPoint && <circle className="connection-outline-point" cx={hoverPoint.x} cy={hoverPoint.y} r={4} />}
    </svg>}
  </div>;
});
export const LoopArea = memo(function LoopArea({ data }: NodeProps<CanvasNode>) {
  return <div className="loop-area" style={{ width: 2 * data.loopRadius!, height: 2 * data.loopRadius! }}><button className="loop-caption nodrag nopan" onClick={data.onGroup}><span>{data.label}</span><small>查看循环说明</small></button></div>;
});
export default FlowNode;
