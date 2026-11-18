import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, FileText, Folder, FolderPlus, Grip, Plus, Search, X } from './icons';
import { api } from './api';
import { SelectionIndicator } from './ui/Motion';
import { STATUS_LABELS } from './types';
import type { LibraryIndex } from './library';
import { useLibraryDrag } from './useLibraryDrag';

type Props = {
  index: LibraryIndex; folderId: string | null; query: string; activeId?: string; disabled: boolean; initialized: boolean; shown: boolean;
  browse: (id: string | null) => void; open: (id: string) => void; createTask: () => void; refresh: () => Promise<unknown>;
};
export function LibraryNav({ index, folderId, query, activeId, disabled, initialized, shown, browse, open, createTask, refresh }: Props) {
  const search = query.trim().toLocaleLowerCase();
  const folder = folderId ? index.byId.get(folderId) : null;
  const visible = search ? index.entries.filter(entry => index.title(entry).toLocaleLowerCase().includes(search)) : index.children.get(folderId) || [];
  const [adding, setAdding] = useState(false), [name, setName] = useState('');
  const [tools, setTools] = useState<string | null>(null);
  const [saving, setSaving] = useState(false), pending = useRef(false);
  const [error, setError] = useState(''), [announcement, announce] = useState('');
  const addButton = useRef<HTMLButtonElement>(null), list = useRef<HTMLElement>(null);
  const locked = disabled || saving;
  useEffect(() => { setAdding(false); setTools(null); setError(''); }, [folderId, shown]);
  useEffect(() => { if (search) setAdding(false); setTools(null); }, [search]);

  async function save(write: () => Promise<unknown>, done: () => void) {
    if (disabled || pending.current) return;
    pending.current = true; setSaving(true); setError('');
    try {
      await write(); done();
      try { await refresh(); } catch { setError('已保存，暂时无法刷新目录。'); }
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试。'); }
    finally { pending.current = false; setSaving(false); }
  }
  function move(id: string, parentId: string | null, position?: number) {
    const entry = index.byId.get(id);
    if (!entry) return;
    void save(() => api.moveEntry(id, parentId, position), () => {
      if (entry.parentId !== parentId) setTools(null);
      announce(entry.parentId === parentId ? `已调整「${index.title(entry)}」的顺序` : `已将「${index.title(entry)}」移至${index.path(parentId)}`);
    });
  }
  const drag = useLibraryDrag({ index, folderId, enabled: !locked && shown && !search && !adding, onMove: move });
  const location = (id: string | null) => { setTools(null); setAdding(false); setError(''); browse(id); };
  const cancelAdd = () => { setAdding(false); setError(''); addButton.current?.focus(); };
  const createFolder = () => {
    if (!name.trim()) return;
    void save(() => api.createFolder(name.trim(), folderId), () => { setAdding(false); announce(`已创建文件夹「${name.trim()}」`); });
  };
  function closeOnEscape(event: KeyboardEvent, close: () => void) {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); }
  }
  return <>
    <div className="library-actions">
      <button className="new-task-button" onClick={() => { setAdding(false); setTools(null); createTask(); }} disabled={locked}><Plus size={16} />新建流程</button>
      <button ref={addButton} className="new-task-button library-add-folder" aria-label="新建文件夹" title="新建文件夹" aria-expanded={adding} onClick={() => {
        if (adding) cancelAdd(); else { browse(folderId); setName(''); setError(''); setTools(null); setAdding(true); }
      }} disabled={locked}><FolderPlus /></button>
    </div>
    <div className="sidebar-section-label library-location" data-parent-drop={folder && !search ? folder.parentId || '' : undefined} data-drop={drag.target?.zone === 'parent' || undefined}>
      {folder && !search && <button className="icon-button" aria-label="返回上一级文件夹" title="返回上一级文件夹" onClick={() => location(folder.parentId)}><ArrowLeft /></button>}
      <span className="library-location-name" title={index.path(folderId)}>{search ? '搜索结果' : folder ? drag.dragId ? '移到上一级' : index.title(folder) : '项目根目录'}</span>
      <span className="task-count">{visible.length}</span>
    </div>
    {adding && <form className="library-inline library-create" data-library-inline="" onSubmit={event => { event.preventDefault(); createFolder(); }} onKeyDown={event => closeOnEscape(event, cancelAdd)}>
      <input id="library-name" aria-label="文件夹名称" placeholder="文件夹名称" autoFocus required maxLength={500} value={name} disabled={locked} onChange={event => setName(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); createFolder(); }
      }} />
      <button className="icon-button" type="submit" title="创建文件夹" aria-label="创建文件夹" disabled={locked || !name.trim()}><Check /></button>
      <button className="icon-button" type="button" title="取消" aria-label="取消新建文件夹" onClick={cancelAdd} disabled={locked}><X /></button>
    </form>}
    {error && <p className="library-error" role="alert">{error}</p>}
    <span className="visually-hidden" role="status">{announcement}</span>
    <nav ref={list} className="task-list" aria-label="任务列表" onClickCapture={drag.blockClick} data-library-dragging={!!drag.dragId}>
      {visible.map(entry => {
        const titleText = index.title(entry), task = index.summaries.get(entry.id), isFolder = entry.kind === 'folder';
        const path = search ? index.path(entry.parentId) : '';
        const title = task ? `${titleText} · ${STATUS_LABELS[task.status]} · ${new Date(task.updatedAt).toLocaleString('zh-CN')}` : titleText;
        const expanded = tools === entry.id && !drag.dragId;
        const siblings = index.children.get(entry.parentId) || [];
        const position = expanded ? siblings.findIndex(sibling => sibling.id === entry.id) : -1;
        const closeTools = () => { setTools(null); list.current?.querySelector<HTMLButtonElement>(`[data-entry-id="${CSS.escape(entry.id)}"] .library-grip`)?.focus(); };
        return <Fragment key={entry.id}>
          <div className="library-row" data-entry-id={entry.id} data-source={drag.dragId === entry.id || undefined} data-drop={drag.target?.id === entry.id ? drag.target.zone : undefined}>
            <button className={`task-item ${activeId === entry.id ? 'active' : ''}`} aria-current={activeId === entry.id ? 'page' : undefined} title={path ? `${title} · ${path}` : title}
              onPointerDown={event => { if (event.pointerType === 'mouse') drag.start(event, entry.id); }}
              onClick={() => { if (isFolder) location(entry.id); else { location(entry.parentId); open(entry.id); } }} disabled={locked}>
              {activeId === entry.id && <SelectionIndicator id="task-selection" className="task-selection" />}
              {isFolder ? <Folder className="task-icon" /> : <FileText className="task-icon" />}
              <span className="task-item-text">{titleText}{task && task.status !== 'draft' && <small><span className={`task-dot status-${task.status}`} />{STATUS_LABELS[task.status]}</small>}{path && <small className="library-path">{path}</small>}</span>
              {isFolder && <ChevronRight className="library-chevron" />}
            </button>
            <button className="icon-button library-grip" aria-label={`整理：${titleText}`} title={search ? '移动到文件夹' : '拖动排序，点击查看更多操作'} aria-expanded={expanded} disabled={locked}
              data-library-inline={expanded ? '' : undefined} onKeyDown={event => { if (expanded) closeOnEscape(event, closeTools); }}
              onPointerDown={event => drag.start(event, entry.id)} onClick={() => { setAdding(false); setTools(expanded ? null : entry.id); }}><Grip /></button>
            {drag.dragId === entry.id && <span className="library-drag-preview" aria-hidden="true">{isFolder ? <Folder /> : <FileText />}<span>{titleText}</span></span>}
          </div>
          {expanded && <div className="library-inline library-tools" role="group" aria-label={`整理${titleText}`} data-library-inline="" onKeyDown={event => closeOnEscape(event, closeTools)}>
            <select aria-label="移动到文件夹" value="" disabled={locked} onChange={event => move(entry.id, event.target.value === '/' ? null : event.target.value)}>
              <option value="" disabled>移动到…</option>
              {index.destinations(entry.id).filter(dest => (dest.id || null) !== entry.parentId).map(dest => <option key={dest.id} value={dest.id || '/'}>{dest.path}</option>)}
            </select>
            <button className="icon-button" aria-label="上移一位" title="上移一位" disabled={locked || position <= 0} onClick={() => move(entry.id, entry.parentId, position - 1)}><ArrowUp /></button>
            <button className="icon-button" aria-label="下移一位" title="下移一位" disabled={locked || position >= siblings.length - 1} onClick={() => move(entry.id, entry.parentId, position + 1)}><ArrowDown /></button>
          </div>}
        </Fragment>;
      })}
      {drag.target?.zone === 'end' && <div className="library-end-line" aria-hidden="true" />}
      {search && !visible.length && <div className="sidebar-empty"><Search size={20} /><p>没有匹配的流程或文件夹</p><button onClick={() => location(folderId)}>清除搜索</button></div>}
      {initialized && !adding && !search && !visible.length && <p className="sidebar-empty">{folder ? '空文件夹' : '暂无流程或文件夹'}</p>}
    </nav>
  </>;
}
