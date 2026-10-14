export type NodeKind = 'start' | 'step' | 'decision' | 'end';
export type Executor = 'program' | 'llm' | 'human';
export type NodeData = {
  label: string;
  notes: string;
  executor: Executor;
  expanded: boolean;
  [key: string]: unknown;
};
export interface GraphNode {
  id: string;
  type: NodeKind;
  position: { x: number; y: number };
  data: NodeData;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}
export interface Graph {
  schemaVersion: 1;
  title: string;
  description: string;
  constraints: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export type Status = 'draft' | 'awaiting_agent' | 'approved' | 'cancelled';
export interface Version {
  id: string;
  kind: string;
  createdAt: string;
  revision: number;
  feedback: string;
  hasPng: boolean;
  title: string;
}
export interface Task {
  id: string;
  mode: 'manual' | 'agent';
  status: Status;
  revision: number;
  graph: Graph;
  feedback: string;
  requestId: string | null;
  approvedVersion: string | null;
  createdAt: string;
  updatedAt: string;
  versions: Version[];
}
export interface TaskSummary {
  id: string;
  title: string;
  status: Status;
  revision: number;
  updatedAt: string;
  mode: 'manual' | 'agent';
}
export interface HistoricalVersion extends Version { graph: Graph }
export const KIND_LABELS: Record<NodeKind, string> = { start: '开始', step: '处理步骤', decision: '条件判断', end: '结束' };
export const EXECUTOR_LABELS: Record<Executor, string> = { program: '程序', llm: 'LLM', human: '人工' };
export const STATUS_LABELS: Record<Status, string> = { draft: '草稿', awaiting_agent: '等待 agent 修订', approved: '已确认', cancelled: '已暂停' };
export const VERSION_LABELS: Record<string, string> = {
  initial: '初稿', checkpoint: '手动存档', submit: '提交反馈', submitted: '提交反馈', feedback: '提交反馈',
  agent_revision: 'Agent 修订', approve: '批准版本', approved: '批准版本', restore: '恢复为新草稿',
};
