import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, ArrowUp, ChevronDown, ChevronRight, Enter, GroupIcon, NODE_ICONS, Pencil, Trash2 } from './icons';
import { groupLinks, groupOutline } from './groups';
import { groupsOf, type ViewNode } from './views';
import type { Graph, GraphGroup } from './types';
import { GROUP_KIND_LABELS } from './types';

function OutlineRow({ graph, item, depth, onReveal }: { graph: Graph; item: ViewNode; depth: number; onReveal: (id: string) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const child = groupsOf(graph).find(g => g.id === item.groupId);
  const Icon = child ? GroupIcon : NODE_ICONS[item.type];
  return <li>
    <div className={`outline-row kind-${item.type} ${child ? 'is-group' : ''}`}>
      {child ? <button className="outline-toggle" aria-expanded={open} aria-label={`${open ? '收起' : '展开'} ${item.data.label}`} onClick={() => setOpen(value => !value)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="outline-toggle" aria-hidden="true" />}
      <button className="outline-target" title={item.data.label} onClick={() => onReveal(item.id)}>
        <Icon size={16} /><span>{item.data.label || '未命名节点'}</span>
        {child && <small>{child.nodeIds.length}</small>}
      </button>
    </div>
    {child && open && <ul><OutlineItems graph={graph} groupId={child.id} depth={depth + 1} onReveal={onReveal} /></ul>}
  </li>;
}

function OutlineItems({ graph, groupId, depth, onReveal }: { graph: Graph; groupId: string; depth: number; onReveal: (id: string) => void }) {
  return <>{groupOutline(graph, groupId).map(item => <OutlineRow key={item.id} graph={graph} item={item} depth={depth} onReveal={onReveal} />)}</>;
}

/** The group's single description: what it holds, what crosses its boundary, and how to work inside it. */
export function GroupPanel({ graph, group, current, editable, autoEdit, heading, onEdit, onEnter, onUp, onReveal, onDissolve }: {
  graph: Graph; group: GraphGroup; current: boolean; editable: boolean; autoEdit: boolean; heading: RefObject<HTMLHeadingElement | null>;
  onEdit: (graph: Graph) => void; onEnter: (id: string) => void; onUp: () => void; onReveal: (id: string) => void; onDissolve: (id: string) => void;
}) {
  const [editing, setEditing] = useState(autoEdit && editable);
  const label = useRef<HTMLInputElement>(null);
  const nextFocus = useRef<'label' | 'heading' | null>(autoEdit && editable ? 'label' : null);
  useLayoutEffect(() => {
    if (nextFocus.current === 'label') { label.current?.focus(); label.current?.select(); }
    if (nextFocus.current === 'heading') heading.current?.focus({ preventScroll: true });
    nextFocus.current = null;
  }, [editing, heading]);
  const mode = (value: boolean) => { nextFocus.current = value ? 'label' : 'heading'; setEditing(value); };
  const patch = (change: Partial<GraphGroup>) => onEdit({ ...graph, groups: groupsOf(graph).map(g => g.id === group.id ? { ...g, ...change } : g) });
  const kind = GROUP_KIND_LABELS[group.kind];
  const { incoming, outgoing } = groupLinks(graph, group.id);

  if (editing && editable) return <div className="group-panel" data-group={group.id}>
    <button className="reader-back" onClick={() => mode(false)}><ArrowLeft size={14} />返回阅读</button>
    <label className="field-label" htmlFor="group-label">{kind}名称</label>
    <input ref={label} id="group-label" value={group.label} maxLength={2000} onChange={e => patch({ label: e.target.value })} />
    <label className="field-label" htmlFor="group-summary">一句话说明</label>
    <textarea id="group-summary" rows={3} value={group.summary} placeholder="这一段完成什么，在上层卡片上显示" onChange={e => patch({ summary: e.target.value })} />
    <div className="group-dissolve">
      <button className="button subtle danger" onClick={() => onDissolve(group.id)}><Trash2 size={14} />解散{kind}</button>
      <p className="field-hint">步骤和连线都会保留，并展开到上一层。</p>
    </div>
  </div>;

  return <div className="group-panel" data-group={group.id}>
    <div className="selection-heading"><span className="kind-badge">{kind}</span><span className="reader-executor">{group.nodeIds.length} 个步骤</span></div>
    <h2 ref={heading} tabIndex={-1}>{group.label || `未命名${kind}`}</h2>
    {group.summary && <p className="reader-summary">{group.summary}</p>}
    <div className="group-actions">
      {current ? <button className="button secondary" onClick={onUp}><ArrowUp size={14} />返回上一层</button>
        : <button className="button primary" onClick={() => onEnter(group.id)}><Enter size={14} />进入{kind}</button>}
      {editable && <button className="button secondary" onClick={() => mode(true)}><Pencil size={14} />编辑</button>}
    </div>
    <section className="group-section"><h3>内部结构</h3>
      <ul className="group-outline"><OutlineItems graph={graph} groupId={group.id} depth={0} onReveal={onReveal} /></ul>
    </section>
    {!!(incoming.length || outgoing.length) && <section className="group-section"><h3>与外部的连接</h3>
      <ul className="group-links">
        {incoming.map(link => <li key={link.edge.id}><span>来自</span><button onClick={() => onReveal(link.nodeId)}>{link.label}</button>{!!link.edge.label && <small>{link.edge.label}</small>}</li>)}
        {outgoing.map(link => <li key={link.edge.id}><span>去往</span><button onClick={() => onReveal(link.nodeId)}>{link.label}</button>{!!link.edge.label && <small>{link.edge.label}</small>}</li>)}
      </ul>
    </section>}
  </div>;
}
