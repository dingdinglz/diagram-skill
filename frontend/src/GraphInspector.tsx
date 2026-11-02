import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Pencil } from './icons';
import { Markdown } from './Markdown';
import type { Graph } from './types';

/** Reading is the default; edits still use the workspace's revision-protected autosave. */
export function GraphInspector({ graph, editable, onEdit }: {
  graph: Graph; editable: boolean; onEdit: (graph: Graph) => void;
}) {
  const [editing, setEditing] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const nextFocus = useRef<'reader' | 'editor' | null>(null);
  const changeMode = (value: boolean) => {
    nextFocus.current = value ? 'editor' : 'reader';
    setEditing(value);
  };
  useLayoutEffect(() => {
    if (nextFocus.current === 'editor') document.getElementById('graph-title')?.focus();
    if (nextFocus.current === 'reader') heading.current?.focus({ preventScroll: true });
    nextFocus.current = null;
  }, [editing]);

  // Keep a disabled editor visible on a save conflict, so local text is never hidden.
  return editing ? <section className="graph-editor" aria-label="编辑流程说明">
    <div className="graph-editor-actions"><button className="reader-back" onClick={() => changeMode(false)}><ArrowLeft size={16} />返回流程说明</button></div>
    <label className="field-label" htmlFor="graph-title">流程名称</label>
    <input id="graph-title" value={graph.title} maxLength={200} disabled={!editable} onChange={event => onEdit({ ...graph, title: event.target.value })} />
    <label className="field-label" htmlFor="graph-description">目标与范围</label>
    <textarea id="graph-description" rows={5} value={graph.description} disabled={!editable} placeholder="一句话说明任务目标与范围" onChange={event => onEdit({ ...graph, description: event.target.value })} />
    <label className="field-label" htmlFor="graph-constraints">约束与验收条件</label>
    <textarea id="graph-constraints" rows={10} value={graph.constraints} disabled={!editable} placeholder={'例如：\n- 最多重试一次\n- 失败时保留用户输入\n- 不修改已有对外接口'} onChange={event => onEdit({ ...graph, constraints: event.target.value })} />
    <p className="field-hint">修改自动保存。支持 Markdown 格式。</p>
  </section> : <section className="graph-reader" aria-label="流程概览">
    <h2 ref={heading} tabIndex={-1}>{graph.title || '未命名流程'}</h2>
    <div className="graph-summary"><span>{graph.nodes.length} 个节点</span><span>{graph.edges.length} 条连线</span></div>
    {editable && <button className="button secondary graph-edit-toggle" onClick={() => changeMode(true)}><Pencil size={16} />编辑流程说明</button>}
    <section className="graph-reader-section"><h3>目标与范围</h3>{graph.description ? <Markdown text={graph.description} /> : <p className="graph-reader-empty">未填写</p>}</section>
    <section className="graph-reader-section"><h3>约束与验收</h3>{graph.constraints ? <Markdown text={graph.constraints} /> : <p className="graph-reader-empty">未填写</p>}</section>
  </section>;
}
