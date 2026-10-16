import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, ViewportPortal, useReactFlow, getViewportForBounds, type Connection, type NodeChange, type EdgeChange } from '@xyflow/react';
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCheck, ChevronRight, CircleDot, Clock3, Code2, Diamond, FileJson, Flag, GitBranch, History, Layers2, LayoutGrid, Loader2, Maximize, MessageSquare, MousePointer2, PanelRightClose, PanelRightOpen, Plus, Redo2, RotateCcw, Save, ShieldCheck, Sparkles, Square, Trash2, Undo2, X, AlertCircle, Pause, LockKeyhole, Image, FileText, FolderOpen } from 'lucide-react';
import FlowNode, { LoopArea, type CanvasNode } from './FlowNode';
import { FlowEdge, type RoutedEdge } from './FlowEdge';
import { moveItem, groupsOf, upgradeGraph, NODE_WIDTH, NODE_HEIGHT, type ViewScope } from './views';
import { createRootScene, nodePorts } from './geometry';
import { closestOutlinePoint, containsRounded, outlineAnchor, projectAnchor, type Point } from './anchors';
import { NodeInspector } from './NodeInspector';
import { Markdown } from './Markdown';
import { useWorkspace } from './useWorkspace';
import { api, downloadArtifact, hasToken } from './api';
import { approvalIssues, createNode, graphWarnings, layoutGraph, newId, removeNodes, removeEdges, reconnectGraphEdge } from './model';
import type { Graph, GraphNode, HistoricalVersion, NodeKind, Executor } from './types';
import { KIND_LABELS, EXECUTOR_LABELS, STATUS_LABELS, VERSION_LABELS } from './types';

const nodeTypes = { start: FlowNode, step: FlowNode, decision: FlowNode, end: FlowNode, 'loop-area': LoopArea };
const edgeTypes = { routed: FlowEdge };
const palette = [{ type: 'start', Icon: CircleDot, hint: '入口或触发' }, { type: 'step', Icon: Square, hint: '一个明确动作' }, { type: 'decision', Icon: Diamond, hint: '标明分支条件' }, { type: 'end', Icon: Flag, hint: '结果或终点' }] as const;
const time = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
type ConnectionEnd = { nodeId: string; anchor: Point };
type ConnectionDrag = { pointerId: number; initialClient: Point; fixed: Point; pointer: Point; from: ConnectionEnd; edgeId?: string; endpoint?: 'source' | 'target'; candidate?: ConnectionEnd };

function Workspace() {
  const ws = useWorkspace();
  const flow = useReactFlow<CanvasNode>();
  const canvas = useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'details' | 'history'>('details');
  const [panelOpen, setPanelOpen] = useState(true);
  const [historical, setHistorical] = useState<HistoricalVersion | null>(null);
  const [showBranches, setShowBranches] = useState(false);
  const [detailScope, setDetailScope] = useState<ViewScope | undefined>();
  const [dialog, setDialog] = useState<'new' | 'feedback' | 'approve' | 'cancel' | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [feedback, setFeedback] = useState('');
  const [versionLoading, setVersionLoading] = useState(false);
  const [nodeMeasurements, setNodeMeasurements] = useState<Record<string, { width: number; height: number }>>({});
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDrag | null>(null);
  const connectionDragRef = useRef<ConnectionDrag | null>(null);
  const suppressCanvasClick = useRef(false);
  const displayGraph = historical?.graph || ws.graph;
  const editable = ws.editable && !historical;
  const selectedNode = displayGraph.nodes.find(n => n.id === selectedNodeId);
  const selectedEdge = displayGraph.edges.find(e => e.id === selectedEdgeId);
  const issues = approvalIssues(displayGraph);
  const warnings = graphWarnings(displayGraph);

  useEffect(() => {
    setSelectedNodeId(null); setSelectedEdgeId(null); setHistorical(null); setShowBranches(false); setDetailScope(undefined);
  }, [ws.task?.id]);
  useEffect(() => { setDetailScope(undefined); setShowBranches(false); }, [historical?.id]);
  const scene = useMemo(() => createRootScene(displayGraph, showBranches, nodeMeasurements), [displayGraph, showBranches, nodeMeasurements]);
  const fittedView = useRef('');
  useEffect(() => {
    const key = `${ws.task?.id || ''}:${historical?.id || 'current'}`;
    if (!ws.task || fittedView.current === key) return;
    const frame = requestAnimationFrame(() => {
      const box = canvas.current?.getBoundingClientRect();
      if (!box?.width || !box.height) return;
      fittedView.current = key;
      // Initialize from the projected scene, including groups. The provider may
      // still hold the previous task's measured nodes during a task switch.
      void flow.setViewport(getViewportForBounds(scene.bounds, box.width, box.height, .15, 1, .16));
    });
    return () => cancelAnimationFrame(frame);
  }, [ws.task?.id, historical?.id, scene.bounds, flow]);
  const view = scene.view;
  const openDetails = useCallback((id: string, scope?: ViewScope) => {
    setSelectedNodeId(id); setSelectedEdgeId(null); setDetailScope(scope); setPanel('details'); setPanelOpen(true);
  }, []);
  const setConnectionPreview = useCallback((next: ConnectionDrag | null) => {
    connectionDragRef.current = next; setConnectionDrag(next);
  }, []);
  useEffect(() => { setConnectionPreview(null); }, [ws.task?.id, historical?.id, editable, setConnectionPreview]);
  const beginOutlineConnection = useCallback((event: ReactPointerEvent<SVGRectElement>, nodeId: string) => {
    if (!editable || event.button !== 0 || !scene.rects[nodeId]) return;
    event.preventDefault(); event.stopPropagation();
    const pointer = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const anchor = outlineAnchor(scene.rects[nodeId], pointer);
    setConnectionPreview({ pointerId: event.pointerId, initialClient: { x: event.clientX, y: event.clientY }, fixed: projectAnchor(scene.rects[nodeId], anchor), pointer, from: { nodeId, anchor } });
  }, [editable, scene.rects, flow, setConnectionPreview]);
  const beginEndpointMove = (event: ReactPointerEvent<SVGCircleElement>, endpoint: 'source' | 'target') => {
    const geometry = scene.edges.find(e => e.edge.id === selectedEdgeId);
    if (!editable || event.button !== 0 || !geometry) return;
    event.preventDefault(); event.stopPropagation();
    const nodeId = geometry.edge[endpoint], anchor = outlineAnchor(scene.rects[nodeId], geometry[endpoint]);
    setConnectionPreview({ pointerId: event.pointerId, initialClient: { x: event.clientX, y: event.clientY }, fixed: geometry[endpoint === 'source' ? 'target' : 'source'], pointer: geometry[endpoint], from: { nodeId, anchor }, edgeId: geometry.edge.id, endpoint });
  };
  useEffect(() => {
    const candidateAt = (point: Point): ConnectionEnd | undefined => {
      const candidates = scene.view.nodes.filter(n => !n.groupId && ws.graph.nodes.some(real => real.id === n.id)).map(n => {
        const rect = scene.rects[n.id], projected = closestOutlinePoint(rect, point);
        return { nodeId: n.id, anchor: outlineAnchor(rect, point), distance: Math.hypot(projected.x - point.x, projected.y - point.y), inside: containsRounded(rect, point) };
      }).filter(candidate => candidate.inside || candidate.distance <= 14 / flow.getZoom()).sort((a, b) => a.distance - b.distance);
      return candidates[0];
    };
    const move = (event: PointerEvent) => {
      const drag = connectionDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      const pointer = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setConnectionPreview({ ...drag, pointer, candidate: candidateAt(pointer) });
    };
    const end = (event: PointerEvent) => {
      const drag = connectionDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moved = Math.hypot(event.clientX - drag.initialClient.x, event.clientY - drag.initialClient.y) >= 4;
      const candidate = candidateAt(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      setConnectionPreview(null);
      if (moved) { suppressCanvasClick.current = true; window.setTimeout(() => { suppressCanvasClick.current = false; }, 0); }
      if (!moved || !candidate || !editable) return;
      const graph = upgradeGraph(ws.graph);
      let edgeId = drag.edgeId;
      if (edgeId && drag.endpoint) {
        const endpoint = drag.endpoint;
        ws.edit(reconnectGraphEdge(graph, edgeId, endpoint, candidate.nodeId, candidate.anchor));
      } else {
        edgeId = newId('edge');
        ws.edit({ ...graph, edges: [...graph.edges, { id: edgeId, source: drag.from.nodeId, target: candidate.nodeId, sourceAnchor: drag.from.anchor, targetAnchor: candidate.anchor, sourceHandle: 'bottom', targetHandle: 'top', label: '', role: 'main' }] });
      }
      setSelectedEdgeId(edgeId); setSelectedNodeId(null); setPanel('details'); setPanelOpen(true);
    };
    const cancel = () => setConnectionPreview(null);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); window.removeEventListener('blur', cancel);
    };
  }, [editable, scene, ws.graph, ws.edit, flow, setConnectionPreview]);
  const nodes = useMemo<CanvasNode[]>(() => [
    ...scene.loops.map(loop => ({ id: `loop-area:${loop.id}`, type: 'loop-area' as const,
      position: { x: loop.center.x-loop.radius-48, y: loop.center.y-loop.radius-48 },
      width: 2*(loop.radius+48), height: 2*(loop.radius+48),
      selectable: false, draggable: false, connectable: false, zIndex: -1,
      data: { label: loop.label, notes: '', executor: 'program' as const, expanded: false, loopRadius: loop.radius+48, onGroup: () => openDetails(loop.id, {groupId:loop.id}) } })),
    ...view.nodes.map(node => ({ ...node, width: NODE_WIDTH, height: NODE_HEIGHT, measured: nodeMeasurements[node.id], selected: node.id === selectedNodeId, connectable: editable && !node.groupId,
      data: { ...node.data, groupId: node.groupId, ports: nodePorts(node, scene), branchCount: view.branches[node.id]?.length || 0, exceptionsOnly: view.branches[node.id]?.every(b=>b.exception),
        onOutlineStart: beginOutlineConnection, onBranches: () => openDetails(node.id, {branchEdgeId:view.branches[node.id]?.[0]?.edgeId}),
        onGroup: node.groupId ? () => openDetails(node.id, {groupId:node.groupId}) : undefined } }))
  ], [view, scene, selectedNodeId, nodeMeasurements, editable, openDetails, beginOutlineConnection]);
  const edges = useMemo<RoutedEdge[]>(() => scene.edges.map(geometry => ({ ...geometry.edge, type: 'routed',
    sourceHandle: `out:${geometry.edge.id}`, targetHandle: `in:${geometry.edge.id}`, selected: geometry.edge.id === selectedEdgeId,
    data: { geometry } })), [scene, selectedEdgeId]);
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const dimensions = changes.filter(change => change.type === 'dimensions');
    if (dimensions.length) setNodeMeasurements(previous => {
      let next = previous;
      for (const change of dimensions) {
        if (change.dimensions && (previous[change.id]?.width !== change.dimensions.width || previous[change.id]?.height !== change.dimensions.height)) {
          next = { ...next, [change.id]: change.dimensions };
        }
      }
      return next;
    });
    if (!editable) return;
    let graph = ws.graph;
    const removed = changes.filter(c => c.type === 'remove').map(c => c.id);
    if (removed.length) graph = removeNodes(graph, removed);
    changes.forEach(change => {
      if (change.type === 'position' && change.position) graph = moveItem(graph, change.id, change.position);
    });
    if (graph !== ws.graph) ws.edit(graph, removed.length > 0);
  }, [editable, ws.graph, ws.edit]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (!editable) return;
    const removed = changes.filter(c => c.type === 'remove').map(c => c.id);
    if (removed.length) ws.edit(removeEdges(ws.graph, removed));
  }, [editable, ws.graph, ws.edit]);
  const connect = useCallback((connection: Connection) => {
    if (!editable || !connection.source || !connection.target || !ws.graph.nodes.some(n => n.id === connection.source) || !ws.graph.nodes.some(n => n.id === connection.target)) return;
    const edge = { id: newId('edge'), source: connection.source, target: connection.target,
      sourceHandle: ['bottom', 'left', 'right'].includes(connection.sourceHandle || '') ? connection.sourceHandle : 'bottom',
      targetHandle: ['top', 'left-in', 'right-in'].includes(connection.targetHandle || '') ? connection.targetHandle : 'top',
      label: '', ...(ws.graph.schemaVersion === 2 ? { role: 'main' as const } : {}) };
    ws.edit({ ...ws.graph, edges: [...ws.graph.edges, edge] });
    setSelectedEdgeId(edge.id); setSelectedNodeId(null); setPanel('details'); setPanelOpen(true);
  }, [editable, ws.graph, ws.edit]);
  const addNode = (kind: NodeKind) => {
    if (!editable) return;
    const box = canvas.current?.getBoundingClientRect();
    const position = selectedNode ? { x: selectedNode.position.x, y: selectedNode.position.y + 180 } : box ? flow.screenToFlowPosition({ x: box.left + box.width / 2 - 124, y: box.top + box.height / 2 - 50 }) : { x: 80, y: 80 };
    const node = createNode(kind, position);
    ws.edit({ ...ws.graph, nodes: [...ws.graph.nodes, node] });
    setSelectedNodeId(node.id); setSelectedEdgeId(null); setPanel('details'); setPanelOpen(true);
  };
  const deleteSelection = () => {
    if (!editable) return;
    if (selectedNodeId) { ws.edit(removeNodes(ws.graph, [selectedNodeId])); setSelectedNodeId(null); }
    else if (selectedEdgeId) { ws.edit(removeEdges(ws.graph, [selectedEdgeId])); setSelectedEdgeId(null); }
  };
  const autoLayout = () => {
    if (!editable) return;
    const measurements: Record<string, { width: number; height: number }> = {};
    flow.getNodes().forEach(n => { if (n.measured?.width && n.measured?.height) measurements[n.id] = { width: n.measured.width, height: n.measured.height }; });
    ws.edit(layoutGraph(ws.graph, measurements));
    setTimeout(() => flow.fitView({ padding: .22, duration: 300, maxZoom: 1 }), 100);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') { if (!ws.busy) setDialog(null); setSelectedEdgeId(null); setSelectedNodeId(null); return; }
      if (dialog || historical) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? ws.redo() : ws.undo(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (editable) void ws.perform('checkpoint'); }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  const selectVersion = async (versionId: string) => {
    if (!ws.task) return;
    setVersionLoading(true);
    try {
      await ws.flush();
      setHistorical(await api.version(ws.task.id, versionId)); setSelectedNodeId(null); setSelectedEdgeId(null);
      setTimeout(() => flow.fitView({ padding: .2, maxZoom: 1 }), 100);
    } catch (e) { ws.report(e); }
    finally { setVersionLoading(false); }
  };
  const downloadVersion = async (file: string) => {
    if (!ws.task || !historical) return;
    try { await downloadArtifact(ws.task.id, historical.id, file); } catch (e) { ws.report(e); }
  };
  const restoreVersion = async (id: string) => { if (await ws.perform('restore', { versionId: id })) { setHistorical(null); setPanel('details'); } };

  return <div className={`app-shell ${panelOpen ? '' : 'inspector-hidden'}`} data-status={ws.task?.status || 'empty'} data-revision={ws.task?.revision || 0} data-dirty={ws.dirty} data-busy={!!ws.busy}>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => event.preventDefault()} aria-label="Flowplan 图先行"><span className="brand-mark"><GitBranch size={22} /></span><span>Flowplan<small>图先行 · 再实现</small></span></a>
      <div className="sidebar-section-label">你的规划空间 <span>LOCAL</span></div>
      <button className="new-task-button" onClick={() => { setNewTitle(''); setDialog('new'); }} disabled={!!ws.busy || ws.conflict}><Plus size={16} />新建空白画板</button>
      <nav className="task-list" aria-label="任务列表">
        {ws.tasks.map(task => <button key={task.id} className={`task-item ${ws.task?.id === task.id ? 'active' : ''}`} onClick={() => void ws.openTask(task.id)} disabled={!!ws.busy || ws.conflict}>
          <span className={`task-dot status-${task.status}`} /><span className="task-item-text">{task.title || '未命名流程'}<small>{STATUS_LABELS[task.status]} · {time(task.updatedAt)}</small></span>{ws.task?.id === task.id && <ChevronRight size={13} />}
        </button>)}
        {ws.initialized && !ws.tasks.length && <p className="sidebar-empty">每个任务，一张清晰的图。<br />历史会保留在当前项目中。</p>}
      </nav>
      <div className="node-palette">
        <div className="sidebar-section-label">绘图工具 <MousePointer2 size={12} /></div>
        {palette.map(({ type, Icon, hint }) => <button key={type} className="palette-button" disabled={!editable} onClick={() => addNode(type)} aria-label={`添加${KIND_LABELS[type]}`}><span className={`palette-icon palette-${type}`}><Icon size={17} /></span><span>{KIND_LABELS[type]}<small>{hint}</small></span><Plus size={13} /></button>)}
        <p className="palette-tip">从卡片边缘任意位置拖出箭头。<br />选中连线后，可拖动两端。</p>
      </div>
      <div className="sidebar-footer"><ShieldCheck size={15} /><span>只在你的电脑上<small>本地文件 · 无模型密钥</small></span></div>
    </aside>

    <main className="workspace">
      <header className="workspace-header">
        <div className="workspace-title"><div className="breadcrumb"><FolderOpen size={12} /><span>规划空间</span><ChevronRight size={12} /><span>{historical ? '历史快照' : '核心流程'}</span></div><h1>{displayGraph.title || '把想法画清楚'}</h1></div>
        <div className="header-actions">
          {ws.task && <span className={`status-pill status-${ws.task.status}`}><span />{STATUS_LABELS[ws.task.status]}</span>}
          <span className={`save-indicator ${!ws.online ? 'offline' : ''}`}>{!ws.online ? '连接中断' : ws.saving ? '保存中…' : ws.dirty ? '未保存' : ws.task ? <><Check size={12} />已保存</> : '本地工作区'}</span>
          <div className="header-separator" />
          <button className={`button subtle ${panel === 'history' && panelOpen ? 'active' : ''}`} onClick={() => { setPanel('history'); setPanelOpen(true); }} disabled={!ws.task}><History size={15} /><span>历史</span>{!!ws.task?.versions.length && <span className="count-badge">{ws.task.versions.length}</span>}</button>
          <button className="icon-button" aria-label={panelOpen ? '收起详情面板' : '展开详情面板'} onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button>
        </div>
      </header>

      {ws.error && <div className="message-bar error" role="alert"><AlertCircle size={16} /><span>{ws.error}</span>{ws.conflict ? <button onClick={() => void ws.reload()} disabled={!!ws.busy}>备份本地并重新载入</button> : <><button onClick={() => void ws.flush().catch(() => {})}>重试保存</button><button aria-label="关闭错误提示" onClick={() => ws.setError('')}><X size={14} /></button></>}</div>}
      {ws.notice && !ws.error && <div className="message-bar notice" role="status"><CheckCheck size={16} /><span>{ws.notice}</span><button aria-label="关闭提示" onClick={() => ws.setNotice('')}><X size={14} /></button></div>}
      {ws.recovery && <div className="message-bar recovery"><RotateCcw size={16} /><span>发现浏览器里尚未保存的修改，是否恢复？</span><button onClick={ws.recover}>恢复修改</button><button onClick={ws.discardRecovery}>丢弃缓存</button></div>}
      {historical && <div className="history-view-banner"><History size={15} /><span>正在查看 {historical.id} · {VERSION_LABELS[historical.kind] || historical.kind} · 只读</span><button onClick={() => { setHistorical(null); setSelectedNodeId(null); setSelectedEdgeId(null); }}>回到当前版本 <ArrowRight size={13} /></button></div>}

      <div className="editor-body">
        <div className="canvas-area" ref={canvas}>
          {!!ws.task && <div className="canvas-toolbar">
            <button className="icon-button" title="撤销 ⌘/Ctrl Z" aria-label="撤销" onClick={ws.undo} disabled={!editable || !ws.canUndo}><Undo2 size={17} /></button>
            <button className="icon-button" title="重做 ⌘/Ctrl Shift Z" aria-label="重做" onClick={ws.redo} disabled={!editable || !ws.canRedo}><Redo2 size={17} /></button>
            <span className="toolbar-divider" />
            {displayGraph.schemaVersion === 2 && <div className="view-switch" aria-label="流程显示范围"><button aria-pressed={!showBranches} onClick={() => setShowBranches(false)}>主线</button><button aria-pressed={showBranches} onClick={() => setShowBranches(true)}>显示分支</button></div>}
            <button className="toolbar-text-button" onClick={autoLayout} disabled={!editable || !displayGraph.nodes.length}><LayoutGrid size={15} />整理布局</button>
            <span className="toolbar-divider" />
            <button className="icon-button" aria-label="适应画布" title="适应画布" onClick={() => void flow.fitView({ padding: .2, maxZoom: 1, duration: 250 })}><Maximize size={16} /></button>
            <button className="icon-button" aria-label="导出完整 PNG" title="导出完整 PNG（含所有说明）" onClick={() => void ws.exportPng()} disabled={!!ws.busy || !!historical || !displayGraph.nodes.length}><ArrowDownToLine size={17} /></button>
          </div>}
          <ReactFlow<CanvasNode, RoutedEdge> key={`${ws.task?.id || 'empty'}-${historical?.id || 'current'}`} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect}
            onNodeClick={(_, node) => { if (!suppressCanvasClick.current && node.type !== 'loop-area') openDetails(node.id); }}
            onNodeDoubleClick={(_, node) => { if (node.type !== 'loop-area') openDetails(node.id); }}
            onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); setPanel('details'); setPanelOpen(true); }}
            onPaneClick={() => { if (!suppressCanvasClick.current) { setSelectedNodeId(null); setSelectedEdgeId(null); } }}
            onNodeDragStart={ws.beginDrag} onNodeDragStop={ws.endDrag}
            nodesDraggable={editable && !connectionDrag} nodesConnectable={editable} elementsSelectable={!ws.busy} deleteKeyCode={null} minZoom={.15} maxZoom={1.7}
            proOptions={{ hideAttribution: true }} panOnScroll selectionOnDrag={false} zoomOnDoubleClick={false} aria-label="流程图画布">
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d7dbd4" />
            <ViewportPortal><svg className="connection-edit-overlay" width={1} height={1}>
              {editable && selectedEdgeId && scene.edges.filter(e => e.edge.id === selectedEdgeId && e.edge.source === selectedEdge?.source && e.edge.target === selectedEdge?.target).map(geometry => <g key={geometry.edge.id}>
                {(['source', 'target'] as const).map(endpoint => <circle key={endpoint} className="connection-endpoint nodrag nopan" data-edge-id={geometry.edge.id} data-anchor-end={endpoint} cx={geometry[endpoint].x} cy={geometry[endpoint].y} r={7}
                  onPointerDown={event => beginEndpointMove(event, endpoint)}><title>{endpoint === 'source' ? '拖动连线起点' : '拖动连线终点'}</title></circle>)}
              </g>)}
              {connectionDrag && (() => {
                const tip = connectionDrag.candidate ? projectAnchor(scene.rects[connectionDrag.candidate.nodeId], connectionDrag.candidate.anchor) : connectionDrag.pointer;
                const source = connectionDrag.endpoint === 'source' ? tip : connectionDrag.fixed, target = connectionDrag.endpoint === 'source' ? connectionDrag.fixed : tip;
                return <g><defs><marker id="connection-preview-arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#648160" /></marker></defs>
                  <path className="connection-preview" d={`M${source.x},${source.y} L${target.x},${target.y}`} markerEnd="url(#connection-preview-arrow)" />
                  <circle className={`connection-drop-point ${connectionDrag.candidate ? 'valid' : ''}`} cx={tip.x} cy={tip.y} r={7} />
                </g>;
              })()}
            </svg></ViewportPortal>
            {!!displayGraph.nodes.length && <><Controls showInteractive={false} position="bottom-right" /><MiniMap position="bottom-left" pannable zoomable nodeColor={node => node.type === 'decision' ? '#e6cba1' : '#ccdcd1'} maskColor="rgba(248,247,243,.65)" /></>}
          </ReactFlow>
          {!displayGraph.nodes.length && <div className="empty-canvas">
            <div className="empty-diagram"><span><CircleDot size={16} /></span><i /><span><Square size={16} /></span><i /><span><Flag size={16} /></span></div>
            <div className="eyebrow">THINK IN FLOWS</div>
            <h2>{ws.task ? '从一个起点开始' : '先把流程想清楚。'}</h2>
            <p>{ws.task ? '添加节点，连接关键步骤。\n复杂说明留在卡片里，让主线保持清楚。' : '把任务变成可以一起讨论、修改、确认的图。\n人确认方向，agent 再动手。'}</p>
            {ws.task ? <button className="button primary" disabled={!editable} onClick={() => addNode('start')}><Plus size={16} />添加开始节点</button> : <button className="button primary" disabled={!ws.initialized || !hasToken()} onClick={() => setDialog('new')}><Plus size={16} />创建第一张流程图</button>}
            <span className="empty-hint">也可以让 coding agent 用 skill 生成初稿，再在这里修改。</span>
          </div>}
          {!!displayGraph.nodes.length && <div className="canvas-legend"><span className="legend-dot program" />程序<span className="legend-dot llm" />LLM<span className="legend-dot human" />人工<span className="legend-divider" />{displayGraph.nodes.length} 个节点 · {displayGraph.edges.length} 条连线</div>}
          {!!ws.busy && <div className="busy-overlay" role="status"><span><Loader2 className="spin" size={18} />{ws.busy}</span></div>}
        </div>

        {panelOpen && <aside className="inspector">
          <div className="inspector-tabs"><button className={panel === 'details' ? 'active' : ''} onClick={() => setPanel('details')}><Layers2 size={14} />{selectedNodeId ? '节点详情' : selectedEdge ? '连线详情' : '流程说明'}</button><button className={panel === 'history' ? 'active' : ''} onClick={() => setPanel('history')}><History size={14} />版本历史</button></div>
          <div className="inspector-content">
            {panel === 'history' ? <>
              <div className="section-heading"><h2>每一次理解，都有迹可循</h2><p>自动保存草稿；在反馈、修订和确认时留下版本。旧版本不会被覆盖。</p></div>
              <button className="button secondary full-width" onClick={() => void ws.perform('checkpoint')} disabled={!editable}><Save size={15} />存档当前版本</button>
              <div className="history-list">{[...(ws.task?.versions || [])].reverse().map(version => <button key={version.id} className={`history-item ${historical?.id === version.id ? 'active' : ''}`} onClick={() => void selectVersion(version.id)} disabled={!!ws.busy || versionLoading}>
                <span className="history-pin">{version.kind === 'approve' || version.kind === 'approved' ? <Check size={12} /> : <span />}</span><span><strong>{VERSION_LABELS[version.kind] || version.kind}</strong><small>{version.id} · {time(version.createdAt)}</small>{!!version.feedback && <em>{version.feedback}</em>}</span><ChevronRight size={13} />
              </button>)}</div>
              {historical && <section className="history-actions"><h3>这个版本的文件</h3><div className="artifact-buttons"><button onClick={() => void downloadVersion('diagram.json')}><FileJson size={15} />JSON</button><button onClick={() => void downloadVersion('diagram.md')}><FileText size={15} />文字</button><button disabled={!historical.hasPng} onClick={() => void downloadVersion('diagram.png')}><Image size={15} />PNG</button></div>{!historical.hasPng && <p className="field-hint">此版本尚未经过浏览器提交，因此没有 PNG。</p>}<button className="button secondary full-width" disabled={!!ws.busy} onClick={() => void restoreVersion(historical.id)}><RotateCcw size={14} />恢复为新草稿</button><p className="field-hint">恢复不会修改历史，也不会自动暂停已开始的实现。</p></section>}
            </> : selectedNodeId && (selectedNode || groupsOf(displayGraph).some(g => g.id === selectedNodeId)) ? <NodeInspector
              key={`${ws.task?.id}:${historical?.id}:${selectedNodeId}:${JSON.stringify(detailScope)}`} graph={displayGraph} selectedId={selectedNodeId}
              initialScope={detailScope} editable={editable} onEdit={ws.edit} onDelete={deleteSelection} />
            : selectedEdge ? <>

              <div className="selection-heading"><span className="kind-badge">流程连线</span><button className="icon-button danger" aria-label="删除选中连线" disabled={!editable} onClick={deleteSelection}><Trash2 size={15} /></button></div>
              <div className="edge-endpoints"><span>{displayGraph.nodes.find(n => n.id === selectedEdge.source)?.data.label}</span><ArrowDown size={16} /><span>{displayGraph.nodes.find(n => n.id === selectedEdge.target)?.data.label}</span></div>
              <label className="field-label" htmlFor="edge-label">分支条件或说明<span>例如：校验通过 / 失败且尚未重试</span></label><textarea id="edge-label" rows={3} value={selectedEdge.label || ''} disabled={!editable} onChange={event => ws.edit({ ...ws.graph, edges: ws.graph.edges.map(e => e.id === selectedEdge.id ? { ...e, label: event.target.value } : e) })} />
              <label className="field-label" htmlFor="edge-role">显示分类</label><select id="edge-role" disabled={!editable} value={selectedEdge.role || 'main'} onChange={event => { const graph = upgradeGraph(ws.graph); ws.edit({ ...graph, edges: graph.edges.map(e => e.id === selectedEdge.id ? { ...e, role: event.target.value as 'main' | 'support' | 'exception' } : e) }); }}><option value="main">主线 · 粗实线</option><option value="support">次要分支 · 细实线</option><option value="exception">异常分支 · 细虚线</option></select>
              <p className="field-hint">主循环上的主线会进一步加粗，便于顺着箭头阅读。</p>
              <p className="field-hint">拖动连线两端，可沿卡片边缘调整位置，或接到其他卡片。</p>
              {(selectedEdge.sourceAnchor || selectedEdge.targetAnchor) && <button className="button subtle" disabled={!editable} onClick={() => ws.edit({ ...ws.graph, edges: ws.graph.edges.map(edge => { if (edge.id !== selectedEdge.id) return edge; const { sourceAnchor: _source, targetAnchor: _target, ...automatic } = edge; return automatic; }) })}>自动选择连接点</button>}
              <div className="inspector-callout"><GitBranch size={17} /><p>条件判断的每条出口都需要标签，避免人和 agent 对同一条线理解不同。</p></div>
              <div className="node-identity">连线 ID <code>{selectedEdge.id}</code></div>
            </> : <>
              <div className="section-heading"><span className="section-kicker">THE BIG PICTURE</span><h2>主线清楚，细节有处安放。</h2><p>这里约定目标和边界。点击节点，补充它的输入、输出与行为。</p></div>
              <label className="field-label" htmlFor="graph-title">流程名称</label><input id="graph-title" value={displayGraph.title} maxLength={200} disabled={!editable} onChange={event => ws.edit({ ...ws.graph, title: event.target.value })} />
              <label className="field-label" htmlFor="graph-description">这次要解决什么</label><textarea id="graph-description" rows={3} value={displayGraph.description} disabled={!editable} placeholder="一句话说明任务目标与范围" onChange={event => ws.edit({ ...ws.graph, description: event.target.value })} />
              <label className="field-label" htmlFor="graph-constraints">约束与验收条件</label><textarea id="graph-constraints" rows={7} value={displayGraph.constraints} disabled={!editable} placeholder={'例如：\n- 最多重试一次\n- 失败时保留用户输入\n- 不修改已有对外接口'} onChange={event => ws.edit({ ...ws.graph, constraints: event.target.value })} />
              {!!displayGraph.constraints && !editable && <div className="notes-preview"><Markdown text={displayGraph.constraints} /></div>}
              <div className="inspector-callout"><Sparkles size={17} /><p>默认争取 5–9 个主节点。必要分支不能省，细节可以放进节点说明。</p></div>
              {!!warnings.length && <div className="quality-warnings">{warnings.map(warning => <p key={warning}><AlertCircle size={14} />{warning}</p>)}</div>}
              <div className="artifact-summary"><span><FileJson size={14} />结构化 JSON</span><span><FileText size={14} />文字视图</span><span><Image size={14} />完整 PNG</span><p>同一版本，自动生成。不需要维护三份内容。</p></div>
            </>}
          </div>
        </aside>}
      </div>

      <footer className="review-bar">
        <div className="review-status">{historical ? <><History size={17} /><span>历史快照不可修改<small>可以恢复成新草稿，继续讨论</small></span></> : ws.task?.status === 'approved' ? <><ShieldCheck size={20} /><span>已确认，可以开始实现<small>实现必须依据批准版本 {ws.task.approvedVersion}</small></span></> : ws.task?.status === 'awaiting_agent' ? <><Clock3 size={19} /><span>等待 agent 根据反馈修订<small>页面暂时只读；agent 已停止等待时，请回终端让它继续</small></span></> : ws.task?.status === 'cancelled' ? <><Pause size={18} /><span>规划已暂停，草稿仍保留<small>暂停不授权 agent 开始实现</small></span></> : <><LockKeyhole size={17} /><span>确认之前，agent 不开始编码<small>先对齐核心流程，再补实现细节</small></span></>}</div>
        <div className="review-actions">
          {historical ? <button className="button secondary" disabled={!!ws.busy} onClick={() => void restoreVersion(historical.id)}><RotateCcw size={15} />恢复为新草稿</button> : ws.task?.status === 'approved' ? <button className="button secondary" disabled={!!ws.busy} onClick={() => ws.task?.approvedVersion && void restoreVersion(ws.task.approvedVersion)}><Plus size={15} />创建修订</button> : ws.task?.status === 'awaiting_agent' ? <button className="button secondary" disabled={!!ws.busy} onClick={() => void ws.perform('resume')}><RotateCcw size={15} />取消等待，继续编辑</button> : ws.task?.status === 'cancelled' ? <button className="button primary" disabled={!!ws.busy} onClick={() => void ws.perform('resume')}><ArrowRight size={15} />继续编辑</button> : <>
            <button className="icon-button" aria-label="暂停本次规划" title="暂停规划，保留草稿" disabled={!editable} onClick={() => setDialog('cancel')}><Pause size={16} /></button>
            <button className="button subtle checkpoint-button" disabled={!editable} onClick={() => void ws.perform('checkpoint')}><Save size={15} />存档</button>
            <button className="button secondary" disabled={!editable} onClick={() => { setFeedback(''); setDialog('feedback'); }}><MessageSquare size={15} />请 agent 修改</button>
            <button className="button primary" disabled={!editable || !displayGraph.nodes.length} onClick={() => setDialog('approve')}><Check size={16} />确认流程<ArrowRight size={14} /></button>
          </>}
        </div>
      </footer>
    </main>

    {dialog && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !ws.busy) setDialog(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="icon-button modal-close" aria-label="关闭对话框" onClick={() => setDialog(null)} disabled={!!ws.busy}><X size={18} /></button>
      {dialog === 'new' ? <><span className="modal-icon"><Plus size={22} /></span><div className="eyebrow">A CLEAR BEGINNING</div><h2 id="dialog-title">创建一张空白画板</h2><p>先给这次任务一个名字，然后手动搭建核心流程。</p><label className="field-label" htmlFor="new-title">任务名称</label><input id="new-title" autoFocus value={newTitle} maxLength={200} placeholder="例如：消息处理与失败重试" onChange={event => setNewTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && newTitle.trim() && !ws.busy) void ws.createTask(newTitle).then(ok => { if (ok) setDialog(null); }); }} /><div className="modal-tip"><Sparkles size={16} /><span>想让 agent 生成？在 coding agent 中调用 diagram-plan skill，并选择“生成初稿”。画板不会单独连接模型。</span></div><button className="button primary full-width" disabled={!newTitle.trim() || !!ws.busy} onClick={() => void ws.createTask(newTitle).then(ok => { if (ok) setDialog(null); })}>{ws.busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}创建并打开</button></> : dialog === 'feedback' ? <><span className="modal-icon"><MessageSquare size={22} /></span><div className="eyebrow">ONE MORE ITERATION</div><h2 id="dialog-title">告诉 agent 要改哪里</h2><p>当前图、完整说明和 PNG 会一并交给 agent。提交后暂时只读，避免双方同时修改。</p><label className="field-label" htmlFor="feedback">修改要求</label><textarea id="feedback" autoFocus rows={6} value={feedback} placeholder="例如：在校验失败后增加一次重试；保持现在的主线与布局。" onChange={event => setFeedback(event.target.value)} disabled={!!ws.busy} /><button className="button primary full-width" disabled={!feedback.trim() || !!ws.busy} onClick={() => void ws.perform('submit', { feedback }).then(ok => { if (ok) setDialog(null); })}>{ws.busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}提交图与反馈</button></> : dialog === 'approve' ? <><span className="modal-icon"><ShieldCheck size={24} /></span><div className="eyebrow">SHARED UNDERSTANDING</div><h2 id="dialog-title">按这张图，开始实现。</h2><p>确认将冻结当前版本，生成一致的 JSON、Markdown 与完整 PNG。之后改图，需要创建修订并重新确认。</p><div className="approval-summary"><strong>{displayGraph.title}</strong><span>{displayGraph.nodes.length} 个节点 · {displayGraph.edges.length} 条连线 · {displayGraph.nodes.filter(n => n.data.notes).length} 张说明卡片</span></div>{!!issues.length && <div className="approval-issues">{issues.map((issue, i) => <p key={i}><AlertCircle size={14} />{issue}</p>)}</div>}<p className="field-hint">这是对 agent 的实施授权；不是宿主工具权限级别的强制拦截。</p><button className="button primary full-width" disabled={!!issues.length || !!ws.busy} onClick={() => void ws.perform('approve').then(ok => { if (ok) setDialog(null); })}>{ws.busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}确认并开始实现</button></> : <><span className="modal-icon"><Pause size={22} /></span><h2 id="dialog-title">暂停这次规划？</h2><p>当前草稿和历史都会保留。agent 会收到取消状态，不应开始实现。你可以随时回来继续编辑。</p><button className="button primary full-width" disabled={!!ws.busy} onClick={() => void ws.perform('cancel').then(ok => { if (ok) setDialog(null); })}>保留草稿并暂停</button></>}
      {!!ws.busy && <p className="modal-progress" role="status">{ws.busy}</p>}
      {!!ws.error && <p className="modal-error" role="alert">{ws.error}</p>}
    </section></div>}
  </div>;
}

export default function App() {
  return <ReactFlowProvider><Workspace /></ReactFlowProvider>;
}
