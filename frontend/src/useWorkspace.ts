import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, initialTaskId, saveBlob } from './api';
import { blankGraph, cloneGraph, sameGraph, approvalIssues } from './model';
import { renderGraphPng } from './export';
import type { Graph, Task, TaskSummary } from './types';

const recoveryKey = (id: string) => `flowplan:recovery:${id}`;
export function useWorkspace() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [graph, setGraph] = useState<Graph>(blankGraph());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusyState] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [online, setOnline] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [recovery, setRecovery] = useState<Graph | null>(null);
  const taskRef = useRef(task), graphRef = useRef(graph), dirtyRef = useRef(dirty), busyRef = useRef('');
  const savingPromise = useRef<Promise<void> | null>(null);
  const conflictRef = useRef(false);
  const past = useRef<Graph[]>([]), future = useRef<Graph[]>([]), dragStart = useRef<Graph | null>(null);

  const setBusy = (value: string) => { busyRef.current = value; setBusyState(value); };
  const report = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      conflictRef.current = true; setConflict(true);
      setError('这个任务已在其他页面或 agent 中更新。本地修改仍保留，请先导出备份，再重新载入。');
    } else if (e instanceof ApiError && e.status === 401) {
      setError('本地会话已失效。请在终端重新运行 start 或 create，使用新链接打开。草稿仍保存在项目中。');
    } else setError(e instanceof Error ? e.message : '操作失败，请重试。');
  }, []);
  const refreshTasks = useCallback(async () => {
    setTasks(await api.list());
  }, []);
  const acceptTask = useCallback((next: Task, resetHistory = false) => {
    taskRef.current = next; setTask(next);
    graphRef.current = next.graph; setGraph(next.graph);
    dirtyRef.current = false; setDirty(false);
    conflictRef.current = false; setConflict(false);
    if (resetHistory) { past.current = []; future.current = []; }
    const params = new URLSearchParams({ task: next.id });
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${params}`);
  }, []);
  const loadTask = useCallback(async (id: string, inspectRecovery = true) => {
    const next = await api.task(id);
    acceptTask(next, true);
    setRecovery(null);
    if (inspectRecovery && next.status === 'draft') {
      try {
        const saved = JSON.parse(localStorage.getItem(recoveryKey(id)) || 'null');
        if (saved?.graph?.schemaVersion === 1 && Array.isArray(saved.graph.nodes) && Array.isArray(saved.graph.edges) && !sameGraph(saved.graph, next.graph)) setRecovery(saved.graph);
      } catch { /* corrupt recovery cache is never authoritative */ }
    }
    setError(''); setOnline(true);
  }, [acceptTask]);

  const flush = useCallback(async (): Promise<void> => {
    if (savingPromise.current) await savingPromise.current;
    if (!dirtyRef.current || !taskRef.current || taskRef.current.status !== 'draft') return;
    if (conflictRef.current) throw new Error('请先处理版本冲突，未覆盖任何本地修改。');
    const current = taskRef.current, snapshot = graphRef.current;
    setSaving(true);
    const promise = (async () => {
      const next = await api.save(current.id, current.revision, snapshot);
      if (taskRef.current?.id !== current.id) return;
      taskRef.current = next; setTask(next); setOnline(true);
      if (sameGraph(graphRef.current, snapshot)) {
        graphRef.current = next.graph; setGraph(next.graph);
        dirtyRef.current = false; setDirty(false);
        localStorage.removeItem(recoveryKey(current.id));
      }
    })();
    savingPromise.current = promise;
    try { await promise; }
    catch (e) { report(e); throw e; }
    finally { if (savingPromise.current === promise) savingPromise.current = null; setSaving(false); }
    if (dirtyRef.current) await flush();
  }, [report]);

  const edit = useCallback((next: Graph, record = true) => {
    if (taskRef.current?.status !== 'draft' || busyRef.current || conflictRef.current) return;
    if (sameGraph(next, graphRef.current)) return;
    if (record) { past.current.push(graphRef.current); if (past.current.length > 80) past.current.shift(); future.current = []; }
    graphRef.current = next; setGraph(next); dirtyRef.current = true; setDirty(true); setNotice('');
  }, []);
  const undo = useCallback(() => {
    if (!past.current.length || taskRef.current?.status !== 'draft' || busyRef.current || conflictRef.current) return;
    future.current.push(graphRef.current);
    const previous = past.current.pop()!;
    edit(previous, false);
  }, [edit]);
  const redo = useCallback(() => {
    if (!future.current.length || taskRef.current?.status !== 'draft' || busyRef.current || conflictRef.current) return;
    past.current.push(graphRef.current);
    edit(future.current.pop()!, false);
  }, [edit]);
  const beginDrag = () => { dragStart.current = graphRef.current; };
  const endDrag = () => {
    if (dragStart.current && !sameGraph(dragStart.current, graphRef.current)) {
      past.current.push(dragStart.current); if (past.current.length > 80) past.current.shift(); future.current = [];
      setGraph({ ...graphRef.current });
    }
    dragStart.current = null;
  };

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const list = await api.list();
        if (disposed) return;
        setTasks(list);
        const id = initialTaskId || list[0]?.id;
        if (id) await loadTask(id);
      } catch (e) { if (!disposed) report(e); }
      finally { if (!disposed) setInitialized(true); }
    })();
    return () => { disposed = true; };
  }, [loadTask, report]);

  useEffect(() => {
    if (!dirty || !task || busy || conflict) return;
    try { localStorage.setItem(recoveryKey(task.id), JSON.stringify({ graph, revision: task.revision })); }
    catch { setNotice('浏览器恢复缓存已满；请保持页面打开，等待自动保存成功。'); }
    const timer = setTimeout(() => { void flush().catch(() => {}); }, 650);
    return () => clearTimeout(timer);
  }, [graph, dirty, task?.id, busy, conflict, flush]);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (dirtyRef.current || busyRef.current || savingPromise.current || conflictRef.current) return;
      const current = taskRef.current;
      try {
        const [next, list] = await Promise.all([current ? api.task(current.id) : Promise.resolve(null), api.list()]);
        if (dirtyRef.current || busyRef.current || savingPromise.current || conflictRef.current) return;
        setOnline(true); setTasks(list);
        if (next && taskRef.current?.id === next.id && next.revision !== taskRef.current.revision) {
          acceptTask(next, true);
          setNotice(next.status === 'draft' && current?.status === 'awaiting_agent' ? 'Agent 已提交修订，请检查后再确认。' : '已同步最新版本。');
        }
      } catch { setOnline(false); }
    }, 2200);
    return () => clearInterval(timer);
  }, [acceptTask]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || busyRef.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const openTask = async (id: string) => {
    if (busyRef.current || taskRef.current?.id === id) return;
    setBusy('正在打开任务…');
    try { await flush(); await loadTask(id); }
    catch (e) { report(e); }
    finally { setBusy(''); }
  };
  const createTask = async (title: string) => {
    setBusy('正在创建画板…');
    try {
      await flush();
      const next = await api.create(title.trim() || '未命名流程');
      acceptTask(next, true); setRecovery(null); setError(''); await refreshTasks();
      return true;
    } catch (e) { report(e); return false; }
    finally { setBusy(''); }
  };
  const perform = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!taskRef.current || busyRef.current) return false;
    if (action === 'approve') {
      const issues = approvalIssues(graphRef.current);
      if (issues.length) { setError(issues.join(' ')); return false; }
    }
    setBusy(['approve', 'submit', 'checkpoint'].includes(action) ? '正在渲染完整 PNG 并保存版本…' : '正在保存状态…');
    setError('');
    try {
      await flush();
      const current = taskRef.current!;
      const snapshot = cloneGraph(graphRef.current);
      let payload: Record<string, unknown> = { revision: current.revision, ...extra };
      if (['approve', 'submit', 'checkpoint'].includes(action)) {
        const png = await renderGraphPng(snapshot);
        payload = { ...payload, graph: snapshot, png };
      } else if (action === 'cancel' && current.status === 'draft') payload.graph = snapshot;
      const next = await api.action(current.id, action, payload);
      acceptTask(next, action !== 'checkpoint');
      localStorage.removeItem(recoveryKey(current.id));
      setRecovery(null);
      setNotice(action === 'approve' ? '已冻结批准版本：JSON、Markdown、PNG 均已保存。请回到 agent 继续。' : action === 'submit' ? '已提交当前图与反馈。若 agent 已结束等待，请回终端让它继续读取。' : action === 'checkpoint' ? '已存档当前版本，包含完整 PNG。' : '状态已保存。');
      await refreshTasks();
      return true;
    } catch (e) { report(e); return false; }
    finally { setBusy(''); }
  };
  const exportPng = async () => {
    if (!taskRef.current || busyRef.current) return;
    setBusy('正在导出完整 PNG…');
    try {
      await flush();
      const png = await renderGraphPng(cloneGraph(graphRef.current));
      const bytes = Uint8Array.from(atob(png.split(',')[1]), character => character.charCodeAt(0));
      saveBlob(new Blob([bytes], { type: 'image/png' }), `${taskRef.current.id}-diagram.png`);
      setNotice('已导出完整 PNG，包含所有节点说明。');
    } catch (e) { report(e); }
    finally { setBusy(''); }
  };
  const exportLocal = () => saveBlob(new Blob([JSON.stringify(graphRef.current, null, 2)], { type: 'application/json' }), `${taskRef.current?.id || 'draft'}-local-backup.json`);
  const reload = async () => {
    if (!taskRef.current) return;
    setBusy('正在载入服务器版本…');
    try {
      if (dirtyRef.current) exportLocal();
      const id = taskRef.current.id;
      await loadTask(id, false); localStorage.removeItem(recoveryKey(id));
      setNotice('已载入服务器版本；未保存修改已下载为 JSON 备份。');
    } catch (e) { report(e); }
    finally { setBusy(''); }
  };
  const recover = () => { if (recovery) edit(recovery); setRecovery(null); };
  const discardRecovery = () => { if (taskRef.current) localStorage.removeItem(recoveryKey(taskRef.current.id)); setRecovery(null); };

  return { tasks, task, graph, dirty, saving, busy, error, notice, conflict, online, initialized, recovery,
    edit, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0, beginDrag, endDrag,
    openTask, createTask, perform, exportPng, exportLocal, reload, recover, discardRecovery,
    flush, report, setError, setNotice, refreshTasks,
    editable: task?.status === 'draft' && !busy && !conflict,
  };
}
