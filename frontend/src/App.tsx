import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap, ViewportPortal, useReactFlow, useViewport, getViewportForBounds, type Connection, type NodeChange, type EdgeChange } from '@xyflow/react';
import { ArrowDown, ArrowDownToLine, ArrowRight, Check, CheckCheck, ChevronRight, Clock3, FileJson, GitBranch, History, LayoutGrid, LevelMapIcon, Loader2, Maximize, MessageSquare, MousePointer2, PanelRightClose, PanelRightOpen, Plus, Redo2, RotateCcw, Save, ShieldCheck, Sparkles, Trash2, Undo2, X, AlertCircle, Pause, Image, FileText, Search, PanelLeft, Keyboard, Minus, BookOpen, NODE_ICONS, AmbientLight, ArrowUp, GroupSelection, MoveUp, LoopIcon, Reverse, Import, IconContext, UI_ICON_STYLE } from './icons';
import { BrandMark } from './BrandMark';
import { LayoutGroup, MotionConfig, motion } from 'motion/react';
import { ContentTransition, SelectionIndicator, UI_TRANSITION } from './ui/Motion';
import { NodeDock } from './ui/reactbits/NodeDock';
import { FlowScope } from './ui/reactbits/FlowScope';
import { Aurora } from './ui/reactbits/Aurora';
import { SpotlightCard } from './ui/reactbits/SpotlightCard';
import { GlareHover } from './ui/reactbits/GlareHover';
import { useReducedMotion } from './ui/useReducedMotion';
import FlowNode, { LoopArea, type CanvasNode } from './FlowNode';
import { FlowEdge, type RoutedEdge } from './FlowEdge';
import { moveItem, groupsOf, upgradeGraph, buildView, NODE_WIDTH, NODE_HEIGHT, type ViewScope } from './views';
import { createRootScene, createScene, nodePorts } from './geometry';
import { connectingEdge, createLoop, freeSpot, insertOnEdge, loopRoute, reverseEdge, setRoles, STEP_GAP } from './authoring';
import { addNodeAtLevel, createEmptySubflow, createGroup, dissolveGroup, groupEndpoint, groupingBlock, groupPath, levelOf, moveIntoGroup, moveToParentLevel } from './groups';
import { closestOutlinePoint, containsRounded, outlineAnchor, projectAnchor, type Point } from './anchors';
import { LevelMap } from './LevelMap';
import { levelChain, levelMap } from './levelMap';
import { NodeInspector } from './NodeInspector';
import { Dialog } from './Dialog';
import { GraphInspector } from './GraphInspector';
import { useWorkspace } from './useWorkspace';
import { api, downloadArtifact, hasToken } from './api';
import { approvalIssues, createNode, graphWarnings, layoutGraph, newId, removeNodes, removeEdges, reconnectGraphEdge } from './model';
import type { FlowRole, Graph, HistoricalVersion, NodeKind } from './types';
import { GROUP_KIND_LABELS, STATUS_LABELS, VERSION_LABELS } from './types';

const nodeTypes = { start: FlowNode, step: FlowNode, decision: FlowNode, end: FlowNode, 'loop-area': LoopArea };
const edgeTypes = { routed: FlowEdge };
const time = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
type ConnectionEnd = { nodeId: string; anchor: Point };
type ConnectionDrag = { pointerId: number; initialClient: Point; fixed: Point; pointer: Point; from: ConnectionEnd; edgeId?: string; endpoint?: 'source' | 'target'; candidate?: ConnectionEnd };

function Workspace() {
  const ws = useWorkspace();
  const reducedMotion = useReducedMotion();
  const flow = useReactFlow<CanvasNode>();
  const { zoom } = useViewport();
  const canvas = useRef<HTMLDivElement>(null);
  const inspectorContent = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const panelToggleRef = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'details' | 'history'>('details');
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 1100);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 760);
  const [historical, setHistorical] = useState<HistoricalVersion | null>(null);
  const [showBranches, setShowBranches] = useState(false);
  const [ambientEnabled, setAmbientEnabled] = useState(() => {
    try { return localStorage.getItem('flowplan:ambient-motion') !== 'off'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('flowplan:ambient-motion', ambientEnabled ? 'on' : 'off'); } catch { /* Storage can be unavailable. */ }
  }, [ambientEnabled]);
  const [detailScope, setDetailScope] = useState<ViewScope | undefined>();
  const [levelTrail, setLevelTrail] = useState<string[]>([]);
  const [multiIds, setMultiIds] = useState<Set<string>>(() => new Set());
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [autoEditId, setAutoEditId] = useState<string | null>(null);
  const focusEdgeLabel = useRef<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState('');
  const boxSelecting = useRef(false);
  const levelViewports = useRef(new Map<string, { x: number; y: number; zoom: number }>());
  const enterOrigin = useRef<{ x: number; y: number; direction: 'in' | 'out' } | null>(null);
  const [dialog, setDialog] = useState<'new' | 'feedback' | 'approve' | 'cancel' | 'shortcuts' | null>(null);
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
  // An undo or agent revision can remove a level; fall back to the nearest level that still exists.
  const levelId = useMemo(() => [...levelTrail].reverse().find(id => groupsOf(displayGraph).some(g => g.id === id)) || null, [levelTrail, displayGraph]);
  const levelPath = useMemo(() => levelChain(displayGraph, levelId), [displayGraph, levelId]);
  const [levelMapOpen, setLevelMapOpen] = useState(() => {
    if (window.innerWidth <= 760) return false;
    try { return localStorage.getItem('flowplan:level-map') !== 'off'; } catch { return true; }
  });
  const toggleLevelMap = () => {
    const next = !levelMapOpen;
    setLevelMapOpen(next);
    if (!narrow) try { localStorage.setItem('flowplan:level-map', next ? 'on' : 'off'); } catch { /* Storage can be unavailable. */ }
  };
  const levelEntries = useMemo(() => levelMapOpen && levelId ? levelMap(displayGraph, levelId, showBranches, nodeMeasurements) : [], [levelMapOpen, displayGraph, levelId, showBranches, nodeMeasurements]);

  useEffect(() => {
    setSelectedNodeId(null); setSelectedEdgeId(null); setHistorical(null); setShowBranches(false); setDetailScope(undefined); setSidebarOpen(false);
    setLevelTrail([]); setMultiIds(new Set()); levelViewports.current.clear();
  }, [ws.task?.id]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => {
      setNarrow(media.matches); setSidebarOpen(false); if (media.matches) setPanelOpen(false);
      let remembered = true;
      try { remembered = localStorage.getItem('flowplan:level-map') !== 'off'; } catch { /* Storage can be unavailable. */ }
      setLevelMapOpen(!media.matches && remembered);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!sidebarOpen || !narrow) return;
    const previous = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); setSidebarOpen(false); }
      if (event.key !== 'Tab') return;
      const items = [...(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input') || [])];
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap, true);
    return () => { document.removeEventListener('keydown', trap, true); previous?.focus(); };
  }, [sidebarOpen, narrow]);
  useEffect(() => {
    if (!narrow || !panelOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    inspectorRef.current?.focus({ preventScroll: true });
    return () => {
      requestAnimationFrame(() => {
        if (previous?.isConnected && !previous.closest('[inert]') && previous.getClientRects().length) previous.focus({ preventScroll: true });
        else panelToggleRef.current?.focus({ preventScroll: true });
      });
    };
  }, [narrow, panelOpen]);
  useEffect(() => { setDetailScope(undefined); setShowBranches(false); setLevelTrail([]); setMultiIds(new Set()); levelViewports.current.clear(); }, [historical?.id]);
  useEffect(() => { if (inspectorContent.current) inspectorContent.current.scrollTop = 0; }, [selectedNodeId, selectedEdgeId, panel, historical?.id, ws.task?.id]);
  const scene = useMemo(() => levelId ? createScene(buildView(displayGraph, { groupId: levelId }, true), nodeMeasurements) : createRootScene(displayGraph, showBranches, nodeMeasurements), [displayGraph, levelId, showBranches, nodeMeasurements]);
  const fitCanvas = useCallback((duration = 0) => {
    const box = canvas.current?.getBoundingClientRect();
    if (!box?.width || !box.height) return;
    const topInset = (toolbarRef.current?.offsetHeight || 52) + (levelPath.length ? 76 : 24);
    const usableHeight = Math.max(100, box.height - topInset - 100);
    let viewport = getViewportForBounds(scene.bounds, box.width, usableHeight, .15, 1, .06);
    // Keep the fitted graph clear of the level map when there is room to do so; a centered column needs no shift.
    const mapRight = !narrow && levelMapOpen && levelPath.length ? (canvas.current?.querySelector('.level-map')?.getBoundingClientRect().right || box.left + 264) - box.left + 12 : 0;
    if (mapRight && box.width - mapRight >= 420 && viewport.x + scene.bounds.x * viewport.zoom < mapRight) {
      const inset = getViewportForBounds(scene.bounds, box.width - mapRight, usableHeight, .15, 1, .06);
      viewport = { ...inset, x: inset.x + mapRight };
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    void flow.setViewport({ ...viewport, y: viewport.y + topInset }, { duration: reduced ? 0 : duration });
  }, [flow, scene.bounds, levelPath.length, levelMapOpen, narrow]);
  const readCanvas = () => {
    const box = canvas.current?.getBoundingClientRect();
    const node = view.nodes.find(node => node.id === selectedNodeId) || view.nodes[0];
    if (!box || !node) return;
    const topInset = (toolbarRef.current?.offsetHeight || 52) + (levelPath.length ? 76 : 24);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    void flow.setViewport({ x: box.width / 2 - node.position.x - NODE_WIDTH / 2, y: topInset - node.position.y, zoom: 1 }, { duration: reduced ? 0 : 250 });
  };
  const zoomCanvas = (direction: 'in' | 'out') => {
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
    if (direction === 'in') void flow.zoomIn({ duration }); else void flow.zoomOut({ duration });
  };
  const fitCanvasRef = useRef(fitCanvas);
  fitCanvasRef.current = fitCanvas;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let frame = 0;
    let previous = { width: element.clientWidth, height: element.clientHeight };
    const observer = new ResizeObserver(() => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      if (Math.abs(next.width - previous.width) < 1 && Math.abs(next.height - previous.height) < 1) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Keep the same graph point centered when the inspector or window resizes.
        // A layout change is not an instruction to discard the user's zoom/pan.
        const viewport = flow.getViewport();
        void flow.setViewport({ ...viewport, x: viewport.x + (next.width - previous.width) / 2, y: viewport.y + (next.height - previous.height) / 2 });
        previous = next;
      });
    });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [flow, ws.task?.id, historical?.id]);
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
      fitCanvasRef.current();
    });
    return () => cancelAnimationFrame(frame);
  }, [ws.task?.id, historical?.id, scene.bounds, flow]);
  const view = scene.view;
  const openDetails = useCallback((id: string, scope?: ViewScope) => {
    setSelectedNodeId(id); setSelectedEdgeId(null); setDetailScope(scope); setPanel('details'); setPanelOpen(true); setMultiIds(new Set()); setAutoEditId(null);
  }, []);
  // Moving between levels keeps each level's viewport, so returning lands where the reader left.
  const goToLevel = useCallback((next: string | null, selectId: string | null = null, origin?: { x: number; y: number; direction: 'in' | 'out' }) => {
    levelViewports.current.set(levelId || '', flow.getViewport());
    enterOrigin.current = origin || null;
    setLevelTrail(groupPath(displayGraph, next).map(g => g.id));
    setSelectedNodeId(selectId); setSelectedEdgeId(null); setDetailScope(undefined); setMultiIds(new Set());
  }, [flow, displayGraph, levelId]);
  const enterGroup = useCallback((id: string) => {
    const card = canvas.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect(), box = canvas.current?.getBoundingClientRect();
    goToLevel(id, null, card && box ? { x: card.left + card.width / 2 - box.left, y: card.top + card.height / 2 - box.top, direction: 'in' } : undefined);
  }, [goToLevel]);
  const leaveLevel = useCallback(() => {
    if (levelId) goToLevel(levelPath[levelPath.length - 2]?.id || null, levelId, { x: (canvas.current?.clientWidth || 0) / 2, y: (canvas.current?.clientHeight || 0) / 2, direction: 'out' });
  }, [goToLevel, levelId, levelPath]);
  const revealItem = useCallback((id: string) => {
    const level = levelOf(displayGraph, id);
    if (level !== levelId) goToLevel(level, id);
    if (!level && !buildView(displayGraph).nodes.some(n => n.id === id)) setShowBranches(true);
    openDetails(id);
  }, [displayGraph, levelId, goToLevel, openDetails]);
  // Index 0 is the main flow; the last index is the level already on screen, which re-opens its description.
  const jumpToLevel = (index: number) => {
    if (index === levelPath.length) { setSelectedNodeId(null); setSelectedEdgeId(null); setMultiIds(new Set()); setPanel('details'); setPanelOpen(true); return; }
    goToLevel(levelPath[index - 1]?.id || null, levelPath[index].id, { x: (canvas.current?.clientWidth || 0) / 2, y: (canvas.current?.clientHeight || 0) / 2, direction: 'out' });
  };
  const levelBarTop = (toolbarRef.current?.offsetHeight || 56) + 12;
  const firstLevel = useRef(true);
  useEffect(() => {
    if (firstLevel.current) { firstLevel.current = false; return; }
    const frame = requestAnimationFrame(() => {
      const saved = levelViewports.current.get(levelId || '');
      if (saved) void flow.setViewport(saved); else fitCanvasRef.current();
      const origin = enterOrigin.current, renderer = canvas.current?.querySelector<HTMLElement>('.react-flow__renderer');
      enterOrigin.current = null;
      if (origin && renderer && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        renderer.style.transformOrigin = `${origin.x}px ${origin.y}px`;
        renderer.animate([{ opacity: .15, transform: `scale(${origin.direction === 'in' ? .9 : 1.08})` }, { opacity: 1, transform: 'scale(1)' }], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [levelId, flow]);
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
      const candidates = scene.view.nodes.filter(n => !(n.groupId && connectionDragRef.current?.from.nodeId === n.id)).map(n => {
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
      // Summary cards and external references stand for real nodes; only a real card keeps a drawn anchor.
      const realEnd = (end: ConnectionEnd, role: 'entry' | 'exit') => {
        const item = scene.view.nodes.find(n => n.id === end.nodeId);
        if (item?.groupId) return { id: groupEndpoint(graph, item.groupId, role) };
        if (item?.reference) return { id: item.members[0] };
        return { id: end.nodeId, anchor: end.anchor };
      };
      let edgeId = drag.edgeId;
      if (edgeId && drag.endpoint) {
        const end = realEnd(candidate, drag.endpoint === 'target' ? 'entry' : 'exit');
        if (end.id) ws.edit(reconnectGraphEdge(graph, edgeId, drag.endpoint, end.id, end.anchor));
      } else {
        const source = realEnd(drag.from, 'exit'), target = realEnd(candidate, 'entry');
        if (!source.id || !target.id) return;
        edgeId = newId('edge');
        ws.edit({ ...graph, edges: [...graph.edges, { id: edgeId, source: source.id, target: target.id, ...(source.anchor ? { sourceAnchor: source.anchor } : {}), ...(target.anchor ? { targetAnchor: target.anchor } : {}), sourceHandle: 'bottom', targetHandle: 'top', label: '', role: 'main' }] });
      }
      // A decision's exit is not finished until it is labelled, so the condition field takes the focus.
      if (!drag.edgeId && realEndIsDecision(drag.from.nodeId)) focusEdgeLabel.current = edgeId;
      setSelectedEdgeId(edgeId); setSelectedNodeId(null); setPanel('details'); setPanelOpen(true);
    };
    const realEndIsDecision = (id: string) => scene.view.nodes.find(n => n.id === id)?.type === 'decision';
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
      selectable: false, draggable: editable, connectable: false, zIndex: -1,
      data: { label: loop.label, notes: '', executor: 'program' as const, expanded: false, loopRadius: loop.radius+48, onGroup: () => { if (!suppressCanvasClick.current) openDetails(loop.id); } } })),
    ...view.nodes.map(node => ({ ...node, width: NODE_WIDTH, height: NODE_HEIGHT, measured: nodeMeasurements[node.id], selected: node.id === selectedNodeId || multiIds.has(node.id), connectable: editable && !node.reference,
      draggable: !node.reference, selectable: !node.reference,
      data: { ...node.data, groupId: node.groupId, reference: node.reference, dropTarget: node.id === dropTargetId, memberCount: groupsOf(displayGraph).find(g => g.id === node.groupId)?.nodeIds.length, ports: nodePorts(node, scene), branchCount: view.branches[node.id]?.length || 0, exceptionsOnly: view.branches[node.id]?.every(b=>b.exception),
        onOutlineStart: beginOutlineConnection, onBranches: () => openDetails(node.id, {branchEdgeId:view.branches[node.id]?.[0]?.edgeId}),
        onGroup: node.groupId ? () => enterGroup(node.groupId!) : undefined } }))
  ], [view, scene, selectedNodeId, multiIds, dropTargetId, displayGraph, nodeMeasurements, editable, openDetails, enterGroup, beginOutlineConnection]);
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
    // Clicks are handled in onNodeClick; React Flow's selection changes only matter while box-selecting.
    const selections = boxSelecting.current ? changes.filter(change => change.type === 'select') : [];
    if (selections.length) {
      setMultiIds(previous => {
        const next = new Set(previous);
        for (const change of selections) {
          if (change.selected && !change.id.startsWith('loop-area:')) next.add(change.id); else next.delete(change.id);
        }
        return next;
      });
      setSelectedNodeId(null); setSelectedEdgeId(null);
    }
    if (!editable) return;
    let graph = ws.graph;
    const removed = changes.filter(c => c.type === 'remove').map(c => c.id);
    if (removed.length) graph = removeNodes(graph, removed);
    changes.forEach(change => {
      if (change.type !== 'position' || !change.position) return;
      if (!change.id.startsWith('loop-area:')) { graph = moveItem(graph, change.id, change.position); return; }
      // The ring is drawn from its circle, so its card moves by the same distance as its members.
      const id = change.id.slice('loop-area:'.length), ring = scene.loops.find(l => l.id === id), group = groupsOf(graph).find(g => g.id === id);
      if (ring && group) graph = moveItem(graph, id, { x: group.position.x + change.position.x - (ring.center.x - ring.radius - 48), y: group.position.y + change.position.y - (ring.center.y - ring.radius - 48) });
    });
    if (graph !== ws.graph) ws.edit(graph, removed.length > 0);
  }, [editable, ws.graph, ws.edit, scene.loops]);
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
  // With a card or connection selected, a new node continues the flow from there instead of floating alone.
  const selectedItem = view.nodes.find(n => n.id === selectedNodeId);
  const chainSource = selectedItem?.type !== 'end' ? selectedItem : undefined;
  const selectedGeometry = scene.edges.find(e => e.edge.id === selectedEdgeId);
  const dockContext = selectedGeometry ? '插入到连线' : chainSource ? `接在 ${chainSource.data.label || '未命名节点'} 后` : '添加节点';
  const chainFrom = (graph: Graph, node: { id: string }) => {
    if (!chainSource) return graph;
    const source = chainSource.groupId ? groupEndpoint(graph, chainSource.groupId, 'exit') : chainSource.id;
    return source ? { ...graph, edges: [...graph.edges, connectingEdge(graph, source, node.id)] } : graph;
  };
  const placement = () => {
    const box = canvas.current?.getBoundingClientRect();
    const wanted = chainSource ? { x: chainSource.position.x, y: chainSource.position.y + STEP_GAP } : box ? flow.screenToFlowPosition({ x: box.left + box.width / 2 - 124, y: box.top + box.height / 2 - 50 }) : { x: 80, y: 80 };
    return freeSpot(view.nodes, wanted);
  };
  const addNode = (kind: NodeKind) => {
    if (!editable) return;
    const node = createNode(kind, placement());
    if (selectedEdge && selectedGeometry) {
      const rect = (id: string) => scene.rects[id];
      ws.edit(insertOnEdge(ws.graph, selectedEdge.id, node, levelId, rect(selectedGeometry.edge.source), rect(selectedGeometry.edge.target)));
    } else ws.edit(chainFrom(addNodeAtLevel(ws.graph, node, levelId), node));
    setSelectedNodeId(node.id); setSelectedEdgeId(null); setPanel('details'); setPanelOpen(true); setMultiIds(new Set()); setAutoEditId(node.id);
  };
  // A new item is selected with its name ready to type; naming is the next thing it needs.
  const selectNewGroup = (groupId: string) => { openDetails(groupId); setAutoEditId(groupId); };
  const addSubflow = () => {
    if (!editable) return;
    const created = createEmptySubflow(ws.graph, placement(), levelId);
    if (!created) return;
    const inner = groupsOf(created.graph).find(g => g.id === created.groupId)!.nodeIds[0];
    ws.edit(chainFrom(created.graph, { id: inner })); selectNewGroup(created.groupId);
  };
  const groupItems = (ids: string[]) => {
    if (!editable) return;
    const created = createGroup(ws.graph, ids, levelId);
    if (created) { ws.edit(created.graph); selectNewGroup(created.groupId); }
  };
  const dissolve = (id: string) => {
    if (!editable) return;
    ws.edit(dissolveGroup(ws.graph, id));
    setSelectedNodeId(null); setSelectedEdgeId(null); setMultiIds(new Set());
  };
  const groupAtPointer = (event: MouseEvent | TouchEvent, dragged: string[]) => {
    const pointer = 'changedTouches' in event ? event.changedTouches[0] : event;
    if (!pointer) return null;
    const point = flow.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
    return view.nodes.find(n => n.groupId && groupsOf(ws.graph).find(g => g.id === n.groupId)?.kind !== 'loop' && !dragged.includes(n.id) && containsRounded(scene.rects[n.id], point))?.id || null;
  };
  const multiSelected = multiIds.size > 1 ? [...multiIds] : [];
  const selectionBlock = multiSelected.length ? groupingBlock(ws.graph, multiSelected) : null;
  const selectionRoute = multiSelected.length ? loopRoute(ws.graph, multiSelected) : null;
  const makeLoop = () => {
    const created = editable && createLoop(ws.graph, multiSelected, levelId);
    if (created) { ws.edit(created.graph); selectNewGroup(created.groupId); }
  };
  const importGraph = async (file?: File) => {
    if (!file) return;
    setImportError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('文件超过 2 MB，无法导入。');
      const graph = JSON.parse(await file.text()) as Graph;
      if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes)) throw new Error('这不是流程 JSON：缺少 nodes 列表。');
      const failure = await ws.importTask(newTitle.trim() || graph.title || file.name.replace(/\.json$/i, ''), graph);
      if (failure) setImportError(`文件没有通过校验：${failure}`); else setDialog(null);
    } catch (e) { setImportError(e instanceof SyntaxError ? '文件不是有效的 JSON。' : e instanceof Error ? e.message : '导入失败。'); }
    finally { if (importInput.current) importInput.current.value = ''; }
  };
  useEffect(() => {
    if (selectedEdgeId && focusEdgeLabel.current === selectedEdgeId) { focusEdgeLabel.current = null; document.getElementById('edge-label')?.focus(); }
  }, [selectedEdgeId]);
  const deleteSelection = () => {
    if (!editable) return;
    if (multiIds.size > 1) {
      ws.edit([...multiIds].reduce((graph, id) => groupsOf(graph).some(g => g.id === id) ? dissolveGroup(graph, id) : removeNodes(graph, [id]), ws.graph));
      setMultiIds(new Set()); setSelectedNodeId(null);
    }
    else if (selectedNodeId && groupsOf(ws.graph).some(g => g.id === selectedNodeId)) dissolve(selectedNodeId);
    else if (selectedNodeId) { ws.edit(removeNodes(ws.graph, [selectedNodeId])); setSelectedNodeId(null); setMultiIds(new Set()); }
    else if (selectedEdgeId) { ws.edit(removeEdges(ws.graph, [selectedEdgeId])); setSelectedEdgeId(null); }
  };
  const autoLayout = () => {
    if (!editable) return;
    const measurements: Record<string, { width: number; height: number }> = {};
    flow.getNodes().forEach(n => { if (n.measured?.width && n.measured?.height) measurements[n.id] = { width: n.measured.width, height: n.measured.height }; });
    ws.edit(layoutGraph(ws.graph, measurements));
    setTimeout(() => fitCanvasRef.current(250), 100);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (dialog) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSidebarOpen(true); searchRef.current?.focus(); return; }
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) { if (event.key === 'Escape') (event.target as HTMLElement).blur(); return; }
      if (event.key === 'Escape') {
        if (narrow && levelMapOpen) { setLevelMapOpen(false); return; }
        if (levelId && !selectedNodeId && !selectedEdgeId && !multiIds.size && !connectionDrag) { leaveLevel(); return; }
        setSidebarOpen(false); if (narrow) setPanelOpen(false); setSelectedEdgeId(null); setSelectedNodeId(null); setMultiIds(new Set()); return;
      }
      if (event.key === 'Enter' && !(event.target as HTMLElement).closest('button, a')) {
        const focused = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node')?.dataset.id;
        if (focused && focused !== selectedNodeId && !focused.startsWith('loop-area:')) {
          event.preventDefault();
          const reference = view.nodes.find(n => n.id === focused && n.reference);
          if (reference) revealItem(reference.members[0]); else openDetails(focused);
          return;
        }
        if (selectedNodeId && groupsOf(displayGraph).some(g => g.id === selectedNodeId) && !multiIds.size) { event.preventDefault(); enterGroup(selectedNodeId); }
        return;
      }
      if (event.key === '?') { setDialog('shortcuts'); return; }
      if (historical) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? ws.redo() : ws.undo(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (editable) void ws.perform('checkpoint'); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) { if (selectedNodeId && groupsOf(ws.graph).some(g => g.id === selectedNodeId)) dissolve(selectedNodeId); }
        else groupItems(multiSelected.length ? multiSelected : selectedNodeId ? [selectedNodeId] : []);
        return;
      }
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
      setTimeout(() => fitCanvasRef.current(250), 100);
    } catch (e) { ws.report(e); }
    finally { setVersionLoading(false); }
  };
  const downloadVersion = async (file: string) => {
    if (!ws.task || !historical) return;
    try { await downloadArtifact(ws.task.id, historical.id, file); } catch (e) { ws.report(e); }
  };
  const restoreVersion = async (id: string) => { if (await ws.perform('restore', { versionId: id })) { setHistorical(null); setPanel('details'); } };

  const filteredTasks = ws.tasks.filter(task => (task.title || '未命名流程').toLocaleLowerCase().includes(taskSearch.trim().toLocaleLowerCase()));

  const ambientControl = <button type="button" className={`icon-button ambient-toggle ${!displayGraph.nodes.length ? 'ambient-toggle-empty' : ''}`}
    aria-label={reducedMotion ? '背景动效已关闭' : ambientEnabled ? '暂停背景动效' : '开启背景动效'}
    title={reducedMotion ? '系统已减少动态效果' : ambientEnabled ? '暂停背景动效' : '开启背景动效'}
    aria-pressed={ambientEnabled && !reducedMotion} disabled={reducedMotion}
    onClick={() => setAmbientEnabled(value => !value)}><AmbientLight size={20} /></button>;

  return <div className={`app-shell ${panelOpen ? '' : 'inspector-hidden'} ${sidebarOpen ? 'sidebar-open' : ''}`} data-status={ws.task?.status || 'empty'} data-revision={ws.task?.revision || 0} data-dirty={ws.dirty} data-busy={!!ws.busy} data-reduced-motion={!!reducedMotion}>
    {sidebarOpen && narrow && <button className="sidebar-backdrop" aria-label="关闭任务导航" onClick={() => setSidebarOpen(false)} />}
    <aside ref={sidebarRef} className="sidebar" aria-label="工作区导航" role={sidebarOpen && narrow ? 'dialog' : undefined} aria-modal={sidebarOpen && narrow ? true : undefined} inert={narrow && !sidebarOpen}>
      <div className="brand-row"><a className="brand" href="#" onClick={event => event.preventDefault()} aria-label="Flowplan"><span className="brand-mark"><BrandMark /></span><span>Flowplan</span></a><button className="icon-button mobile-only" aria-label="收起任务导航" onClick={() => setSidebarOpen(false)}><X size={18} /></button></div>
      <label className="task-search"><Search size={15} /><input ref={searchRef} aria-label="搜索流程" placeholder="搜索流程…" value={taskSearch} onChange={event => setTaskSearch(event.target.value)} /><kbd>⌘ K</kbd></label>
      <button className="new-task-button" onClick={() => { setNewTitle(''); setImportError(''); setSidebarOpen(false); setDialog('new'); }} disabled={!!ws.busy || ws.conflict}><Plus size={16} />新建流程</button>
      <div className="sidebar-section-label"><span>流程</span><span className="task-count">{ws.tasks.length}</span></div>
      <nav className="task-list" aria-label="任务列表">
        {filteredTasks.map(task => <button key={task.id} className={`task-item ${ws.task?.id === task.id ? 'active' : ''}`} aria-current={ws.task?.id === task.id ? 'page' : undefined} title={`${task.title || '未命名流程'} · ${STATUS_LABELS[task.status]} · ${time(task.updatedAt)}`} onClick={() => { setSidebarOpen(false); void ws.openTask(task.id); }} disabled={!!ws.busy || ws.conflict}>
          {ws.task?.id === task.id && <SelectionIndicator id="task-selection" className="task-selection" />}
          <FileText size={18} className="task-icon" /><span className="task-item-text">{task.title || '未命名流程'}{task.status !== 'draft' && <small><span className={`task-dot status-${task.status}`} />{STATUS_LABELS[task.status]}</small>}</span>
        </button>)}
        {taskSearch && !filteredTasks.length && <div className="sidebar-empty"><Search size={20} /><p>没有匹配的流程</p><button onClick={() => setTaskSearch('')}>清除搜索</button></div>}
        {ws.initialized && !ws.tasks.length && !taskSearch && <p className="sidebar-empty">暂无流程</p>}
      </nav>
      <div className="sidebar-bottom"><button className="sidebar-help" onClick={() => { setSidebarOpen(false); setDialog('shortcuts'); }}><Keyboard size={16} /><span>快捷键</span><kbd>?</kbd></button></div>
    </aside>

    <main className="workspace" inert={narrow && sidebarOpen}>
      <header className="workspace-header">
        <button className="icon-button mobile-only" aria-label="打开任务导航" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><PanelLeft size={19} /></button>
        <div className="workspace-title"><h1 title={displayGraph.title}>{displayGraph.title || '开始你的下一份计划'}</h1></div>
        <div className="header-actions">
          {ws.task && <span className={`status-pill status-${ws.task.status}`}><span />{STATUS_LABELS[ws.task.status]}</span>}
          <span role="status" className={`save-indicator ${!ws.online ? 'offline' : ''}`}>{!ws.online ? '连接中断' : ws.saving ? '保存中…' : ws.dirty ? '未保存' : ws.task ? <><Check size={12} />已保存</> : '本地工作区'}</span>
          {!!ws.task && <div className="header-separator" />}
          {!!displayGraph.nodes.length && <button className="icon-button export-button" aria-label="导出完整 PNG" title="导出完整 PNG（含所有说明）" onClick={() => void ws.exportPng()} disabled={!!ws.busy || !!historical}><ArrowDownToLine size={18} /></button>}
          {!!ws.task && <><button className={`button subtle ${panel === 'history' && panelOpen ? 'active' : ''}`} aria-label="查看版本历史" onClick={() => { setPanel('history'); setPanelOpen(true); }} disabled={!ws.task}><History size={15} /><span>历史</span>{!!ws.task?.versions.length && <span className="count-badge">{ws.task.versions.length}</span>}</button>
          <button ref={panelToggleRef} className="icon-button" aria-controls="workspace-inspector" aria-expanded={panelOpen} aria-label={panelOpen ? '收起详情面板' : '展开详情面板'} onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? <PanelRightClose className="right-panel-icon" size={20} /> : <PanelRightOpen className="right-panel-icon" size={18} />}</button></>}
        </div>
      </header>

      {ws.error && <div className="message-bar error" role="alert"><AlertCircle size={16} /><span>{ws.error}</span>{ws.conflict ? <button onClick={() => void ws.reload()} disabled={!!ws.busy}>备份本地并重新载入</button> : <><button onClick={() => void ws.flush().catch(() => {})}>重试保存</button><button aria-label="关闭错误提示" onClick={() => ws.setError('')}><X size={14} /></button></>}</div>}
      {ws.notice && !ws.error && <div className="message-bar notice" role="status"><CheckCheck size={16} /><span>{ws.notice}</span><button aria-label="关闭提示" onClick={() => ws.setNotice('')}><X size={14} /></button></div>}
      {ws.recovery && <div className="message-bar recovery"><RotateCcw size={16} /><span>发现浏览器里尚未保存的修改，是否恢复？</span><button onClick={ws.recover}>恢复修改</button><button onClick={ws.discardRecovery}>丢弃缓存</button></div>}
      {historical && <div className="history-view-banner"><History size={15} /><span>正在查看 {historical.id} · {VERSION_LABELS[historical.kind] || historical.kind} · 只读</span><button onClick={() => { setHistorical(null); setSelectedNodeId(null); setSelectedEdgeId(null); }}>回到当前版本 <ArrowRight size={13} /></button></div>}

      <div className="editor-body">
        <div className={`canvas-area ${zoom < .65 ? 'is-overview' : ''}`} style={{ '--canvas-zoom': zoom } as CSSProperties} ref={canvas} inert={narrow && panelOpen}>
          <Aurora enabled={ambientEnabled} paused={!!dialog || !!ws.busy || !!connectionDrag || (narrow && (panelOpen || sidebarOpen))} />
          {!displayGraph.nodes.length && ambientControl}
          {!!ws.task && !!displayGraph.nodes.length && <div ref={toolbarRef} className="canvas-toolbar" role="toolbar" aria-label="画布操作">
            <button className="icon-button" title="撤销 ⌘/Ctrl Z" aria-label="撤销" onClick={ws.undo} disabled={!editable || !ws.canUndo}><Undo2 size={17} /></button>
            <button className="icon-button" title="重做 ⌘/Ctrl Shift Z" aria-label="重做" onClick={ws.redo} disabled={!editable || !ws.canRedo}><Redo2 size={17} /></button>
            <span className="toolbar-divider" />
            {displayGraph.schemaVersion === 2 && !levelId && <FlowScope branches={showBranches} onChange={setShowBranches} />}
            <button className="toolbar-text-button auto-layout" aria-label="整理布局" title="整理布局" onClick={autoLayout} disabled={!editable || !displayGraph.nodes.length}><LayoutGrid size={18} /><span>整理布局</span></button>
            <span className="toolbar-divider" />
            <button className="toolbar-text-button readable-view" onClick={readCanvas} disabled={!displayGraph.nodes.length} title="以原始字号阅读选中节点；拖动画布查看相邻步骤"><BookOpen size={15} />100% 阅读</button>
            {ambientControl}
          </div>}
          <ReactFlow<CanvasNode, RoutedEdge> key={`${ws.task?.id || 'empty'}-${historical?.id || 'current'}`} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect}
            onNodeClick={(event, node) => {
              if (suppressCanvasClick.current || node.type === 'loop-area') return;
              if (node.data.reference) { revealItem(view.nodes.find(n => n.id === node.id)!.members[0]); return; }
              if (event.shiftKey || event.metaKey || event.ctrlKey) {
                const next = new Set(multiIds.size ? multiIds : selectedNodeId ? [selectedNodeId] : []);
                if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
                setSelectedEdgeId(null);
                if (next.size > 1) { setMultiIds(next); setSelectedNodeId(null); }
                else { const [only] = next; if (only) openDetails(only); else { setMultiIds(new Set()); setSelectedNodeId(null); } }
                return;
              }
              openDetails(node.id);
            }}
            onNodeDoubleClick={(_, node) => { if (node.data.groupId) enterGroup(node.data.groupId); else if (node.type !== 'loop-area' && !node.data.reference) { openDetails(node.id); if (editable) setAutoEditId(node.id); } }}
            onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); setPanel('details'); setPanelOpen(true); }}
            onPaneClick={() => { if (!suppressCanvasClick.current) { setSelectedNodeId(null); setSelectedEdgeId(null); setMultiIds(new Set()); } }}
            onNodeDragStart={ws.beginDrag}
            onNodeDrag={(event, _, dragged) => setDropTargetId(groupAtPointer(event, dragged.map(n => n.id)))}
            onNodeDragStop={(event, _, dragged) => {
              const ids = dragged.map(n => n.id), target = ids.some(id => id.startsWith('loop-area:')) ? null : groupAtPointer(event, ids);
              setDropTargetId(null);
              if (ids.some(id => id.startsWith('loop-area:'))) { suppressCanvasClick.current = true; window.setTimeout(() => { suppressCanvasClick.current = false; }, 0); }
              // Applied before endDrag, so the move and the join undo as one step.
              if (target && editable && !groupingBlock(ws.graph, ids)) { ws.edit(moveIntoGroup(ws.graph, ids, target), false); setSelectedNodeId(null); setMultiIds(new Set()); }
              ws.endDrag();
            }}
            nodesDraggable={editable && !connectionDrag} nodesConnectable={editable} elementsSelectable={!ws.busy} deleteKeyCode={null} minZoom={.15} maxZoom={1.7}
            proOptions={{ hideAttribution: true }} panOnScroll selectionOnDrag={false} multiSelectionKeyCode={['Meta', 'Control', 'Shift']} onSelectionStart={() => { boxSelecting.current = true; setMultiIds(new Set()); }} onSelectionEnd={() => { boxSelecting.current = false; }} zoomOnDoubleClick={false} aria-label="流程图画布">
            <Background variant={BackgroundVariant.Dots} gap={24} size={.8} color="#cbd3df" />
            <ViewportPortal><svg className="connection-edit-overlay" width={1} height={1}>
              {editable && selectedEdgeId && scene.edges.filter(e => e.edge.id === selectedEdgeId && e.edge.source === selectedEdge?.source && e.edge.target === selectedEdge?.target).map(geometry => <g key={geometry.edge.id}>
                {(['source', 'target'] as const).map(endpoint => <circle key={endpoint} className="connection-endpoint nodrag nopan" data-edge-id={geometry.edge.id} data-anchor-end={endpoint} cx={geometry[endpoint].x} cy={geometry[endpoint].y} r={7}
                  onPointerDown={event => beginEndpointMove(event, endpoint)}><title>{endpoint === 'source' ? '拖动连线起点' : '拖动连线终点'}</title></circle>)}
              </g>)}
              {connectionDrag && (() => {
                const tip = connectionDrag.candidate ? projectAnchor(scene.rects[connectionDrag.candidate.nodeId], connectionDrag.candidate.anchor) : connectionDrag.pointer;
                const source = connectionDrag.endpoint === 'source' ? tip : connectionDrag.fixed, target = connectionDrag.endpoint === 'source' ? connectionDrag.fixed : tip;
                return <g><defs><marker id="connection-preview-arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="var(--accent)" /></marker></defs>
                  <path className="connection-preview" d={`M${source.x},${source.y} L${target.x},${target.y}`} markerEnd="url(#connection-preview-arrow)" />
                  <circle className={`connection-drop-point ${connectionDrag.candidate ? 'valid' : ''}`} cx={tip.x} cy={tip.y} r={7} />
                </g>;
              })()}
            </svg></ViewportPortal>
            {!!displayGraph.nodes.length && <><MiniMap style={{ width: 112, height: 72 }} position="bottom-left" pannable zoomable nodeBorderRadius={14} nodeColor={node => node.type === 'decision' ? '#e2c88f' : '#b9c7df'} maskColor="rgba(240,243,248,.78)" maskStrokeColor="#4263df33" maskStrokeWidth={1} /></>}
          </ReactFlow>
          {!displayGraph.nodes.length && <SpotlightCard className="empty-canvas">
            <div className="empty-diagram" aria-hidden="true"><span><NODE_ICONS.start size={24} weight="bold" /></span><i /><span><NODE_ICONS.step size={24} weight="bold" /></span><i /><span><NODE_ICONS.end size={24} weight="bold" /></span></div>
            <h2>{!ws.initialized ? '正在打开工作空间…' : ws.task ? '从第一个节点开始' : '先创建一份计划'}</h2>
            <p>{ws.task ? '添加节点，连接步骤。' : '新建空白流程，或让 agent 生成初稿。'}</p>
            {ws.task ? <GlareHover className="button primary" disabled={!editable} onClick={() => addNode('start')}><Plus size={16} />添加开始节点</GlareHover> : <GlareHover className="button primary" disabled={!ws.initialized || !hasToken()} onClick={() => setDialog('new')}><Plus size={16} />创建第一张流程图</GlareHover>}
          </SpotlightCard>}
          {!!levelPath.length && <nav className="level-bar" aria-label="当前层级" style={{ top: levelBarTop }}>
            <button className="icon-button" aria-label="返回上一层" title="返回上一层 Esc" onClick={leaveLevel}><ArrowUp size={18} /></button>
            <ol>
              <li><button onClick={() => jumpToLevel(0)}>主流程</button></li>
              {levelPath.length > 3 && <li className="level-gap"><ChevronRight size={14} /><button aria-label={`展开全部 ${levelPath.length + 1} 层`} title="查看全部层级" aria-expanded={levelMapOpen} aria-controls="level-map" onClick={toggleLevelMap}>…</button></li>}
              {levelPath.map((group, index) => index < levelPath.length - 2 && levelPath.length > 3 ? null : <li key={group.id}><ChevronRight size={14} />
                <button aria-current={index === levelPath.length - 1 ? 'location' : undefined} title={group.label} onClick={() => jumpToLevel(index + 1)}>{group.label || '未命名子流程'}</button>
              </li>)}
            </ol>
            <button className={`level-map-toggle${levelMapOpen ? ' is-open' : ''}`} aria-expanded={levelMapOpen} aria-controls="level-map" aria-label={`第 ${levelPath.length + 1} 层，${levelMapOpen ? '收起' : '展开'}层级结构`} title={levelMapOpen ? '收起层级结构' : '展开层级结构'} onClick={toggleLevelMap}><LevelMapIcon size={16} />第 {levelPath.length + 1} 层</button>
          </nav>}
          {!!levelEntries.length && <LevelMap entries={levelEntries} selectedId={selectedNodeId} top={levelBarTop + 50} onSelect={index => { jumpToLevel(index); if (narrow) setLevelMapOpen(false); }} />}
          {!!displayGraph.nodes.length && <div className="canvas-legend">{levelId ? <span>本层 <strong>{view.nodes.filter(n => !n.reference).length}</strong> 项</span> : <><span><strong>{displayGraph.nodes.length}</strong> 个节点</span><span className="legend-separator" aria-hidden="true" /><span><strong>{displayGraph.edges.length}</strong> 条连线</span></>}</div>}
          {!!displayGraph.nodes.length && <div className="canvas-zoom" role="group" aria-label="画布缩放"><button aria-label="放大画布" title="放大" onClick={() => zoomCanvas('in')} disabled={zoom >= 1.7}><Plus size={16} /></button><button className="zoom-value" aria-label={`当前缩放 ${Math.round(zoom * 100)}%，点击以 100% 阅读`} onClick={readCanvas}>{Math.round(zoom * 100)}%</button><button aria-label="缩小画布" title="缩小" onClick={() => zoomCanvas('out')} disabled={zoom <= .15}><Minus size={16} /></button><button aria-label="查看流程全貌" title="查看全貌" onClick={() => fitCanvas(250)}><Maximize size={15} /></button></div>}
          {!!ws.task && !multiSelected.length && <NodeDock disabled={!editable} context={dockContext} onAdd={type => type === 'group' ? addSubflow() : addNode(type)} />}
          {!!multiSelected.length && <div className="selection-bar" role="toolbar" aria-label="多选操作">
            <span className="selection-count"><span>已选 </span><strong>{multiSelected.length}</strong> 项</span>
            {editable && <>
              <button className="button primary" disabled={!!selectionBlock} title={selectionBlock || '⌘/Ctrl G'} onClick={() => groupItems(multiSelected)}><GroupSelection size={16} />组成子流程</button>
              <button className="button secondary" disabled={!selectionRoute} title={!selectionRoute ? '所选步骤连成一条线后才能组成循环' : selectionRoute.closing ? '会新增一条回到起点的连线' : '按现有连线组成循环'} onClick={makeLoop}><LoopIcon size={16} />{selectionRoute?.closing ? '补回边成环' : '组成循环'}</button>
              {!!levelId && <button className="button secondary" onClick={() => { ws.edit(moveToParentLevel(ws.graph, multiSelected, levelId)); setMultiIds(new Set()); }}><MoveUp size={16} />移到上一层</button>}
              <select className="selection-role" aria-label="批量设置显示分类" value="" onChange={event => { if (event.target.value) ws.edit(setRoles(ws.graph, multiSelected, event.target.value as FlowRole)); }}><option value="">分类…</option><option value="main">主线</option><option value="support">次要</option><option value="exception">异常</option></select>
              <button className="icon-button danger" aria-label="删除所选" title="删除所选" onClick={deleteSelection}><Trash2 size={18} /></button>
            </>}
            <button className="icon-button" aria-label="取消选择" title="取消选择 Esc" onClick={() => setMultiIds(new Set())}><X size={18} /></button>
            {selectionBlock && <p className="selection-hint">{selectionBlock}</p>}
          </div>}
          {!!ws.busy && <div className="busy-overlay" role="status"><span><Loader2 className="spin" size={18} />{ws.busy}</span></div>}
        </div>

        {panelOpen && !!ws.task && <motion.aside initial={reducedMotion ? false : { x: 10, opacity: 0.85 }} animate={{ x: 0, opacity: 1 }} transition={reducedMotion ? { duration: 0 } : UI_TRANSITION} ref={inspectorRef} id="workspace-inspector" className="inspector" tabIndex={-1} aria-label="流程详情面板">
          <div className="inspector-tabs" aria-label="详情视图"><button aria-pressed={panel === 'details'} className={panel === 'details' ? 'active' : ''} onClick={() => setPanel('details')}><FileText size={18} />{selectedEdge ? '连线详情' : selectedNode ? '节点详情' : selectedNodeId || levelId ? `${GROUP_KIND_LABELS[groupsOf(displayGraph).find(g => g.id === (selectedNodeId || levelId))?.kind || 'subflow']}详情` : '流程说明'}{panel === 'details' && <SelectionIndicator id="inspector-tab" className="tab-indicator" />}</button><button aria-pressed={panel === 'history'} className={panel === 'history' ? 'active' : ''} onClick={() => setPanel('history')}><History size={14} />版本历史{panel === 'history' && <SelectionIndicator id="inspector-tab" className="tab-indicator" />}</button><button className="icon-button inspector-close" aria-label="关闭详情面板" onClick={() => setPanelOpen(false)}><X size={15} /></button></div>
          <div ref={inspectorContent} className="inspector-content">
            <ContentTransition identity={[ws.task?.id, panel, selectedNodeId, selectedEdgeId, historical?.id].join(':')}>
            {panel === 'history' ? <>
              <div className="section-heading"><h2>版本历史</h2><p>草稿自动保存。存档、反馈与确认时生成快照，历史版本不会被覆盖。</p></div>
              <button className="button secondary full-width" onClick={() => void ws.perform('checkpoint')} disabled={!editable}><Save size={15} />存档当前版本</button>
              <div className="history-list">{[...(ws.task?.versions || [])].reverse().map(version => <button key={version.id} className={`history-item ${historical?.id === version.id ? 'active' : ''}`} onClick={() => void selectVersion(version.id)} disabled={!!ws.busy || versionLoading}>
                <span className="history-pin">{version.kind === 'approve' || version.kind === 'approved' ? <Check size={12} /> : <span />}</span><span><strong>{VERSION_LABELS[version.kind] || version.kind}</strong><small><time dateTime={version.createdAt}>{time(version.createdAt)}</time><code title={version.id}>{version.id}</code></small>{!!version.feedback && <em>{version.feedback}</em>}</span><ChevronRight size={13} />
              </button>)}</div>
              {!ws.task?.versions.length && <div className="history-empty"><History size={24} /><h3>还没有历史版本</h3><p>存档当前流程，保留一个可以随时回看的版本。</p></div>}
              {historical && <section className="history-actions"><h3>这个版本的文件</h3><div className="artifact-buttons"><button onClick={() => void downloadVersion('diagram.json')}><FileJson size={15} />JSON</button><button onClick={() => void downloadVersion('diagram.md')}><FileText size={15} />文字</button><button disabled={!historical.hasPng} onClick={() => void downloadVersion('diagram.png')}><Image size={15} />PNG</button></div>{!historical.hasPng && <p className="field-hint">此版本尚未经过浏览器提交，因此没有 PNG。</p>}<button className="button secondary full-width" disabled={!!ws.busy} onClick={() => void restoreVersion(historical.id)}><RotateCcw size={14} />恢复为新草稿</button><p className="field-hint">恢复不会修改历史，也不会自动暂停已开始的实现。</p></section>}
            </> : !multiSelected.length && selectedNodeId && (selectedNode || groupsOf(displayGraph).some(g => g.id === selectedNodeId)) ? <NodeInspector
              key={`${ws.task?.id}:${historical?.id}:${selectedNodeId}:${JSON.stringify(detailScope)}:${autoEditId === selectedNodeId}`} graph={displayGraph} selectedId={selectedNodeId}
              initialScope={detailScope} levelId={levelId} autoEdit={autoEditId === selectedNodeId} editable={editable} onEdit={ws.edit} onDelete={deleteSelection}
              onEnter={enterGroup} onUp={leaveLevel} onReveal={revealItem} onDissolve={dissolve} onGroupNode={id => groupItems([id])} />
            : !selectedEdge && levelId ? <NodeInspector
              key={`${ws.task?.id}:${historical?.id}:level:${levelId}`} graph={displayGraph} selectedId={levelId}
              levelId={levelId} autoEdit={false} editable={editable} onEdit={ws.edit} onDelete={deleteSelection}
              onEnter={enterGroup} onUp={leaveLevel} onReveal={revealItem} onDissolve={dissolve} onGroupNode={id => groupItems([id])} />
            : selectedEdge ? <>

              <div className="selection-heading"><span className="kind-badge">流程连线</span><button className="icon-button danger" aria-label="删除选中连线" disabled={!editable} onClick={deleteSelection}><Trash2 size={15} /></button></div>
              <div className="edge-endpoints"><span>{displayGraph.nodes.find(n => n.id === selectedEdge.source)?.data.label}</span><ArrowDown size={16} /><span>{displayGraph.nodes.find(n => n.id === selectedEdge.target)?.data.label}</span></div>
              <label className="field-label" htmlFor="edge-label">分支条件或说明<span>例如：校验通过 / 失败且尚未重试</span></label><textarea id="edge-label" rows={3} value={selectedEdge.label || ''} disabled={!editable} onChange={event => ws.edit({ ...ws.graph, edges: ws.graph.edges.map(e => e.id === selectedEdge.id ? { ...e, label: event.target.value } : e) })} />
              <label className="field-label" htmlFor="edge-role">显示分类</label><select id="edge-role" disabled={!editable} value={selectedEdge.role || 'main'} onChange={event => { const graph = upgradeGraph(ws.graph); ws.edit({ ...graph, edges: graph.edges.map(e => e.id === selectedEdge.id ? { ...e, role: event.target.value as 'main' | 'support' | 'exception' } : e) }); }}><option value="main">主线 · 粗实线</option><option value="support">次要分支 · 细实线</option><option value="exception">异常分支 · 细虚线</option></select>
              <p className="field-hint">主循环上的主线会进一步加粗，便于顺着箭头阅读。</p>
              <p className="field-hint">拖动连线两端，可沿卡片边缘调整位置，或接到其他卡片。</p>
              <button className="button subtle" disabled={!editable} onClick={() => ws.edit(reverseEdge(ws.graph, selectedEdge.id))}><Reverse size={14} />反转方向</button>
              {(selectedEdge.sourceAnchor || selectedEdge.targetAnchor) && <button className="button subtle" disabled={!editable} onClick={() => ws.edit({ ...ws.graph, edges: ws.graph.edges.map(edge => { if (edge.id !== selectedEdge.id) return edge; const { sourceAnchor: _source, targetAnchor: _target, ...automatic } = edge; return automatic; }) })}>自动选择连接点</button>}
              <div className="inspector-callout"><GitBranch size={17} /><p>条件判断的每条出口都需要标签，避免人和 agent 对同一条线理解不同。</p></div>
              <div className="node-identity">连线 ID <code>{selectedEdge.id}</code></div>
            </> : <>
              <GraphInspector key={`${ws.task?.id}:${historical?.id || 'current'}`} graph={displayGraph} editable={editable} onEdit={ws.edit} />
              {!!warnings.length && <div className="quality-warnings">{warnings.map(warning => <p key={warning}><AlertCircle size={14} />{warning}</p>)}</div>}
            </>}
            </ContentTransition>
          </div>
        </motion.aside>}
      </div>

      {!!ws.task && <footer className="review-bar">
        <div className="mobile-review-meta"><span role="status" className={`mobile-save-status ${!ws.online ? 'offline' : ''}`}>{!ws.online ? <><AlertCircle size={12} />连接中断</> : ws.saving ? <><Loader2 size={12} className="spin" />保存中…</> : ws.dirty ? <><Clock3 size={12} />未保存</> : <><Check size={12} />{ws.task ? '已保存' : '本地工作区'}</>}</span><span>{historical ? '历史快照 · 只读' : STATUS_LABELS[ws.task.status]}</span></div>
        {(historical || ws.task.status !== 'draft') && <div className="review-status">{historical ? <><History size={17} /><span>历史快照 · 只读</span></> : ws.task.status === 'approved' ? <><ShieldCheck size={18} /><span>已确认 · {ws.task.approvedVersion}</span></> : ws.task.status === 'awaiting_agent' ? <><Clock3 size={18} /><span title="页面暂时只读；如 agent 已停止等待，请回终端让它继续。">等待 agent 修订</span></> : <><Pause size={18} /><span>已暂停</span></>}</div>}
        <div className="review-actions">
          {historical ? <button className="button secondary" disabled={!!ws.busy} onClick={() => void restoreVersion(historical.id)}><RotateCcw size={15} />恢复为新草稿</button> : ws.task?.status === 'approved' ? <button className="button secondary" disabled={!!ws.busy} onClick={() => ws.task?.approvedVersion && void restoreVersion(ws.task.approvedVersion)}><Plus size={15} />创建修订</button> : ws.task?.status === 'awaiting_agent' ? <button className="button secondary" disabled={!!ws.busy} onClick={() => void ws.perform('resume')}><RotateCcw size={15} />取消等待，继续编辑</button> : ws.task?.status === 'cancelled' ? <button className="button primary" disabled={!!ws.busy} onClick={() => void ws.perform('resume')}><ArrowRight size={15} />继续编辑</button> : <>
            <button className="icon-button" aria-label="暂停本次规划" title="暂停规划，保留草稿" disabled={!editable} onClick={() => setDialog('cancel')}><Pause size={16} /></button>
            <button className="button subtle checkpoint-button" disabled={!editable} onClick={() => void ws.perform('checkpoint')}><Save size={15} />存档</button>
            <button className="button secondary" disabled={!editable} onClick={() => { setFeedback(''); setDialog('feedback'); }}><MessageSquare size={15} />请 agent 修改</button>
            <GlareHover className="button primary" disabled={!editable || !displayGraph.nodes.length} onClick={() => setDialog('approve')}><Check size={16} />确认流程</GlareHover>
          </>}
        </div>
      </footer>}
    </main>

    {dialog && <Dialog onClose={() => setDialog(null)} busy={!!ws.busy} labelledBy="dialog-title" actions={
      dialog === 'new' ? <button className="button primary full-width" disabled={!newTitle.trim() || !!ws.busy} onClick={() => void ws.createTask(newTitle).then(ok => { if (ok) setDialog(null); })}>{ws.busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}创建并打开</button>
      : dialog === 'feedback' ? <button className="button primary full-width" disabled={!feedback.trim() || !!ws.busy} onClick={() => void ws.perform('submit', { feedback }).then(ok => { if (ok) setDialog(null); })}>{ws.busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}提交图与反馈</button>
      : dialog === 'approve' ? <button className="button primary full-width" disabled={!!issues.length || !!ws.busy} onClick={() => void ws.perform('approve').then(ok => { if (ok) setDialog(null); })}>{ws.busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}确认并开始实现</button>
      : dialog === 'cancel' ? <button className="button primary full-width" disabled={!!ws.busy} onClick={() => void ws.perform('cancel').then(ok => { if (ok) setDialog(null); })}>保留草稿并暂停</button> : undefined
    }>
      {dialog === 'shortcuts' ? <><h2 id="dialog-title">快捷键</h2><dl className="shortcut-list"><div><dt>搜索流程</dt><dd><kbd>⌘ / Ctrl</kbd><kbd>K</kbd></dd></div><div><dt>撤销</dt><dd><kbd>⌘ / Ctrl</kbd><kbd>Z</kbd></dd></div><div><dt>重做</dt><dd><kbd>⌘ / Ctrl</kbd><kbd>Shift</kbd><kbd>Z</kbd></dd></div><div><dt>存档当前版本</dt><dd><kbd>⌘ / Ctrl</kbd><kbd>S</kbd></dd></div><div><dt>删除选中节点或连线</dt><dd><kbd>Delete</kbd></dd></div><div><dt>新节点接在选中项后</dt><dd>选中后点底部添加</dd></div><div><dt>编辑节点文字</dt><dd>双击卡片</dd></div><div><dt>多选节点</dt><dd><kbd>Shift</kbd><kbd>点击 / 拖选</kbd></dd></div><div><dt>把所选组成子流程</dt><dd><kbd>⌘ / Ctrl</kbd><kbd>G</kbd></dd></div><div><dt>解散选中的子流程</dt><dd><kbd>⌘ / Ctrl</kbd><kbd>Shift</kbd><kbd>G</kbd></dd></div><div><dt>进入选中的子流程</dt><dd><kbd>Enter</kbd></dd></div><div><dt>退出选择 / 返回上一层 / 关闭弹窗</dt><dd><kbd>Esc</kbd></dd></div></dl><div className="modal-tip"><MousePointer2 size={17} /><span>拖动卡片边缘即可创建连线；选中连线后拖动端点可重新连接。把节点拖到子流程卡片上即可移入，双击卡片进入。滚动画布平移，双指缩放调整视野。</span></div></> : dialog === 'new' ? <><span className="modal-icon"><Plus size={22} /></span><h2 id="dialog-title">新建流程</h2><label className="field-label" htmlFor="new-title">任务名称</label><input id="new-title" autoFocus value={newTitle} maxLength={200} placeholder="例如：消息处理与失败重试" onChange={event => setNewTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && newTitle.trim() && !ws.busy) void ws.createTask(newTitle).then(ok => { if (ok) setDialog(null); }); }} /><div className="modal-tip"><Sparkles size={16} /><span>生成初稿：在 coding agent 中调用 diagram-plan skill。</span></div><input ref={importInput} id="import-file" className="visually-hidden" type="file" accept=".json,application/json" tabIndex={-1} aria-label="选择流程 JSON 文件" onChange={event => void importGraph(event.target.files?.[0])} /><button className="button secondary full-width import-button" disabled={!!ws.busy} onClick={() => importInput.current?.click()}><Import size={16} />导入流程 JSON</button>{importError && <p className="import-error" role="alert">{importError}</p>}</> : dialog === 'feedback' ? <><span className="modal-icon"><MessageSquare size={22} /></span><h2 id="dialog-title">告诉 agent 要改哪里</h2><p>当前图、完整说明和 PNG 会一并交给 agent。提交后暂时只读，避免双方同时修改。</p><label className="field-label" htmlFor="feedback">修改要求</label><textarea id="feedback" autoFocus rows={6} value={feedback} placeholder="例如：在校验失败后增加一次重试；保持现在的主线与布局。" onChange={event => setFeedback(event.target.value)} disabled={!!ws.busy} /></> : dialog === 'approve' ? <><span className="modal-icon"><ShieldCheck size={24} /></span><h2 id="dialog-title">确认并开始实现？</h2><p>确认后将授权 agent 按当前流程实现，并冻结此版本。后续修改需创建修订。</p><div className="approval-summary"><strong>{displayGraph.title}</strong><span>{displayGraph.nodes.length} 个节点 · {displayGraph.edges.length} 条连线 · {displayGraph.nodes.filter(n => n.data.notes).length} 张说明卡片</span></div>{!!issues.length && <div className="approval-issues">{issues.map((issue, i) => <p key={i}><AlertCircle size={14} />{issue}</p>)}</div>}<p className="field-hint">这是对 agent 的实施授权；不是宿主工具权限级别的强制拦截。</p></> : <><span className="modal-icon"><Pause size={22} /></span><h2 id="dialog-title">暂停这次规划？</h2><p>当前草稿和历史都会保留。agent 会收到取消状态，不应开始实现。你可以随时回来继续编辑。</p></>}
      {!!ws.busy && <p className="modal-progress" role="status">{ws.busy}</p>}
      {!!ws.error && <p className="modal-error" role="alert">{ws.error}</p>}
    </Dialog>}
  </div>;
}

export default function App() {
  const scope = useId();
  const reduced = useReducedMotion();
  return <IconContext.Provider value={UI_ICON_STYLE}><MotionConfig reducedMotion={reduced ? 'always' : 'never'} transition={UI_TRANSITION}><LayoutGroup id={scope}>
    <ReactFlowProvider><Workspace /></ReactFlowProvider>
  </LayoutGroup></MotionConfig></IconContext.Provider>;
}
