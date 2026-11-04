import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, GroupSelection, Pencil, Preview, Trash2 } from './icons';
import type { Graph, Executor, NodeKind, FlowRole } from './types';
import { EXECUTOR_LABELS, KIND_LABELS } from './types';
import { Markdown } from './Markdown';
import { DetailDiagram } from './SceneDiagram';
import { buildView, groupsOf, upgradeGraph, type ViewScope, type ViewNode, type BranchLink } from './views';
import { removeNodes, ungroupNode } from './model';
import { GroupPanel } from './GroupPanel';
import { groupingBlock, groupOutline, levelOf, moveIntoGroup } from './groups';

type Page = { nodeId?: string; groupId?: string; scope?: ViewScope };
export function NodeInspector({ graph, selectedId, initialScope, levelId, autoEdit, editable, onEdit, onDelete, onEnter, onUp, onReveal, onDissolve, onGroupNode }: {
  graph: Graph; selectedId: string; initialScope?: ViewScope; levelId: string | null; autoEdit: boolean; editable: boolean; onEdit:(graph:Graph)=>void; onDelete:()=>void;
  onEnter:(id:string)=>void; onUp:()=>void; onReveal:(id:string)=>void; onDissolve:(id:string)=>void; onGroupNode:(id:string)=>void;
}) {
  const selectedGroup=groupsOf(graph).find(g=>g.id===selectedId);
  const [trail,setTrail]=useState<Page[]>([selectedGroup?{groupId:selectedId}:{nodeId:selectedId},...(initialScope?[{scope:initialScope}]:[])]);
  const [editing,setEditing]=useState(autoEdit&&editable&&!selectedGroup);
  const [notesPreview,setNotesPreview]=useState(false);
  const headingRef=useRef<HTMLHeadingElement>(null);
  const focusNext=useRef<'reader'|'editor'|null>(autoEdit&&editable&&!selectedGroup?'editor':null);
  const selectLabel=useRef(autoEdit);
  const editMode=(value:boolean)=>{focusNext.current=value?'editor':'reader';setEditing(value);};
  useLayoutEffect(()=>{
    if(focusNext.current==='editor'){const field=document.getElementById('node-label') as HTMLTextAreaElement|null;field?.focus();if(selectLabel.current)field?.select();selectLabel.current=false;}
    else if(focusNext.current==='reader')headingRef.current?.focus({preventScroll:true});
    focusNext.current=null;
  },[editing,trail]);
  const current=trail[trail.length-1];
  const node=graph.nodes.find(n=>n.id===current.nodeId);
  const group=groupsOf(graph).find(g=>g.id===current.groupId);
  const view=current.scope?buildView(graph,current.scope,true):null;
  const push=(page:Page)=>{focusNext.current='reader';setEditing(false);setTrail(t=>[...t,page]);};
  const visit=(n:ViewNode)=>n.groupId?push({groupId:n.groupId}):push({nodeId:n.members[0]});
  const update=(patch:Partial<NonNullable<typeof node>['data']>)=>{
    if(!node)return;
    const next=('summary' in patch||'role' in patch)?upgradeGraph(graph):graph;
    onEdit({...next,nodes:next.nodes.map(n=>n.id===node.id?{...n,data:{...n.data,...patch}}:n)});
  };
  const main=buildView(graph);
  const branches:BranchLink[]=node?(main.branches[node.id]||graph.edges.filter(e=>e.source===node.id&&(e.role==='exception'||e.role==='support'||graph.nodes.find(n=>n.id===e.target)?.data.role==='exception')).map(e=>({edgeId:e.id,label:e.label||'查看分支',target:e.target,exception:e.role==='exception'}))):(main.branches[current.scope?.branchEdgeId ? selectedId : group?.id || ''] || []);
  return <section className="node-reader" aria-label="节点阅读详情">
    {trail.length>1&&<button className="reader-back" onClick={()=>{focusNext.current='reader';setTrail(t=>t.slice(0,-1));setEditing(false);}}><ArrowLeft size={14}/>返回上层</button>}
    {current.scope?<>
      <h2 ref={headingRef} tabIndex={-1}>{view!.title}</h2>{view!.summary&&<p className="reader-summary">{view!.summary}</p>}
      <DetailDiagram key={JSON.stringify(current.scope)} graph={graph} scope={current.scope} onNode={visit}/>
    </>:node?<>
      <div className="selection-heading"><span className="kind-badge">{KIND_LABELS[node.type]}</span><span className="reader-executor">{EXECUTOR_LABELS[node.data.executor]}</span></div>
      {!editing || !editable?<>
        <h2 ref={headingRef} tabIndex={-1}>{node.data.label}</h2>{node.data.summary&&<p className="reader-summary">{node.data.summary}</p>}
        <div className="reader-notes"><Markdown text={node.data.notes||'暂无补充说明。'}/></div>
        {editable&&<div className="group-actions"><button className="button secondary" aria-label="编辑节点" onClick={()=>editMode(true)}><Pencil size={14}/>编辑节点</button>{!groupingBlock(graph,[node.id])&&levelOf(graph,node.id)===levelId&&<button className="button secondary" title="⌘/Ctrl G" onClick={()=>onGroupNode(node.id)}><GroupSelection size={14}/>放入新子流程</button>}</div>}
      </>:<>
        <button className="reader-back" onClick={()=>editMode(false)}><ArrowLeft size={14}/>返回阅读</button>
        <label className="field-label" htmlFor="node-label">动作标题</label><textarea id="node-label" rows={2} value={node.data.label} onChange={e=>update({label:e.target.value})}/>
        <label className="field-label" htmlFor="node-summary">一句话解释</label><textarea id="node-summary" rows={2} value={node.data.summary||''} onChange={e=>update({summary:e.target.value})}/>
        <div className="field-row"><label>节点类型<select value={node.type} onChange={e=>onEdit({...graph,nodes:graph.nodes.map(n=>n.id===node.id?{...n,type:e.target.value as NodeKind}:n)})}>{Object.entries(KIND_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>执行主体<select value={node.data.executor} onChange={e=>update({executor:e.target.value as Executor})}>{Object.entries(EXECUTOR_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
        <label className="field-label" htmlFor="node-role">显示分类</label><select id="node-role" value={node.data.role||'main'} onChange={e=>update({role:e.target.value as FlowRole})}><option value="main">主线</option><option value="support">次要步骤</option><option value="exception">异常处理</option></select>
        {groupsOf(graph).some(g=>g.nodeIds.includes(node.id))&&<div className="node-memberships field-hint"><span>所属分组</span>{groupsOf(graph).filter(g=>g.nodeIds.includes(node.id)).map(memberGroup=><div className="node-membership" key={memberGroup.id}><span>{memberGroup.label}</span><button className="button subtle" aria-label={`从 ${memberGroup.label} 移出节点`} onClick={()=>onEdit(ungroupNode(graph,node.id,memberGroup.id))}>移出</button></div>)}</div>}
        {!groupingBlock(graph,[node.id])&&(()=>{const targets=groupOutline(graph,levelOf(graph,node.id)).filter(item=>item.groupId&&groupsOf(graph).find(g=>g.id===item.groupId)?.kind!=='loop');return !!targets.length&&<><label className="field-label" htmlFor="node-move">移入子流程</label><select id="node-move" value="" onChange={e=>{if(e.target.value)onEdit(moveIntoGroup(graph,[node.id],e.target.value));}}><option value="">选择同一层的子流程…</option>{targets.map(item=><option key={item.id} value={item.groupId}>{item.data.label}</option>)}</select></>;})()}
        <div className="field-label-row"><label className="field-label" htmlFor="node-notes">完整说明<span>支持 Markdown</span></label><button className="toolbar-text-button" aria-pressed={notesPreview} onClick={()=>setNotesPreview(v=>!v)}>{notesPreview?<Pencil size={14}/>:<Preview size={14}/>}{notesPreview?'继续编辑':'预览'}</button></div>{notesPreview?<div className="reader-notes notes-preview"><Markdown text={node.data.notes||'暂无补充说明。'}/></div>:<textarea id="node-notes" className="notes-textarea" rows={11} value={node.data.notes} onChange={e=>update({notes:e.target.value})}/>}
        <button className="button subtle danger" aria-label="删除选中节点" onClick={()=>{if(node.id===selectedId)onDelete();else{onEdit(removeNodes(graph,[node.id]));setTrail(t=>t.slice(0,-1));}}}><Trash2 size={14}/>删除节点</button>
      </>}
      <div className="node-identity">节点 ID <code>{node.id}</code></div>
    </>:group?<GroupPanel key={group.id} graph={graph} group={group} current={group.id===levelId} editable={editable} autoEdit={autoEdit&&trail.length===1} heading={headingRef} onEdit={onEdit} onEnter={onEnter} onUp={onUp} onReveal={onReveal} onDissolve={onDissolve}/>:<p>该节点已被删除。</p>}
    {!!branches.length&&<section className="reader-branches"><h3>相关分支 <span>{branches.length}</span></h3>{branches.map(b=><button key={b.edgeId} disabled={b.edgeId===current.scope?.branchEdgeId} onClick={()=>push({scope:{branchEdgeId:b.edgeId}})}><span>{b.label}<small>{graph.nodes.find(n=>n.id===b.target)?.data.label}</small></span><ChevronRight size={14}/></button>)}</section>}
  </section>;
}
