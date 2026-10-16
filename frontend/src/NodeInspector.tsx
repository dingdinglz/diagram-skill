import { useState } from 'react';
import { ArrowLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import type { Graph, Executor, NodeKind, FlowRole } from './types';
import { EXECUTOR_LABELS, KIND_LABELS } from './types';
import { Markdown } from './Markdown';
import { DetailDiagram } from './SceneDiagram';
import { buildView, groupsOf, upgradeGraph, type ViewScope, type ViewNode, type BranchLink } from './views';
import { removeNodes, ungroupNode } from './model';

type Page = { nodeId?: string; scope?: ViewScope };
export function NodeInspector({ graph, selectedId, initialScope, editable, onEdit, onDelete }: {
  graph: Graph; selectedId: string; initialScope?: ViewScope; editable: boolean; onEdit:(graph:Graph)=>void; onDelete:()=>void;
}) {
  const selectedGroup=groupsOf(graph).find(g=>g.id===selectedId);
  const [trail,setTrail]=useState<Page[]>([{nodeId:selectedId},...(initialScope?[{scope:initialScope}]:selectedGroup?[{scope:{groupId:selectedId}}]:[])]);
  const [editing,setEditing]=useState(false);
  const current=trail[trail.length-1];
  const node=graph.nodes.find(n=>n.id===current.nodeId);
  const group=groupsOf(graph).find(g=>g.id===(current.scope?.groupId||current.nodeId));
  const view=current.scope?buildView(graph,current.scope,true):null;
  const push=(page:Page)=>{setEditing(false);setTrail(t=>[...t,page]);};
  const visit=(n:ViewNode)=>n.groupId?push({scope:{groupId:n.groupId}}):push({nodeId:n.members[0]});
  const update=(patch:Partial<NonNullable<typeof node>['data']>)=>{
    if(!node)return;
    const next=('summary' in patch||'role' in patch)?upgradeGraph(graph):graph;
    onEdit({...next,nodes:next.nodes.map(n=>n.id===node.id?{...n,data:{...n.data,...patch}}:n)});
  };
  const main=buildView(graph);
  const branches:BranchLink[]=node?(main.branches[node.id]||graph.edges.filter(e=>e.source===node.id&&(e.role==='exception'||e.role==='support'||graph.nodes.find(n=>n.id===e.target)?.data.role==='exception')).map(e=>({edgeId:e.id,label:e.label||'查看分支',target:e.target,exception:e.role==='exception'}))):(main.branches[current.scope?.branchEdgeId ? selectedId : group?.id || ''] || []);
  return <section className="node-reader" aria-label="节点阅读详情">
    {trail.length>1&&<button className="reader-back" onClick={()=>{setTrail(t=>t.slice(0,-1));setEditing(false);}}><ArrowLeft size={14}/>返回上层</button>}
    {current.scope?<>
      <span className="reader-kicker">{group?.kind==='loop'?'循环':group?'子流程':'分支流程'}</span>
      <h2>{view!.title}</h2>{view!.summary&&<p className="reader-summary">{view!.summary}</p>}
      <DetailDiagram key={JSON.stringify(current.scope)} graph={graph} scope={current.scope} onNode={visit}/>
      {group&&editable&&<details className="group-editor"><summary>编辑分组说明</summary>
        <label className="field-label">分组名称<input value={group.label} onChange={e=>onEdit({...graph,groups:groupsOf(graph).map(g=>g.id===group.id?{...g,label:e.target.value}:g)})}/></label>
        <label className="field-label">一句话说明<textarea rows={3} value={group.summary} onChange={e=>onEdit({...graph,groups:groupsOf(graph).map(g=>g.id===group.id?{...g,summary:e.target.value}:g)})}/></label>
      </details>}
    </>:node?<>
      <div className="selection-heading"><span className="kind-badge">{KIND_LABELS[node.type]}</span><span className="reader-executor">{EXECUTOR_LABELS[node.data.executor]}</span></div>
      {!editing || !editable?<>
        <h2>{node.data.label}</h2>{node.data.summary&&<p className="reader-summary">{node.data.summary}</p>}
        <div className="reader-notes"><Markdown text={node.data.notes||'暂无补充说明。'}/></div>
        {editable&&<button className="button secondary" aria-label="编辑节点" onClick={()=>setEditing(true)}><Pencil size={14}/>编辑节点</button>}
      </>:<>
        <button className="reader-back" onClick={()=>setEditing(false)}><ArrowLeft size={14}/>返回阅读</button>
        <label className="field-label" htmlFor="node-label">动作标题</label><textarea id="node-label" rows={2} value={node.data.label} onChange={e=>update({label:e.target.value})}/>
        <label className="field-label" htmlFor="node-summary">一句话解释</label><textarea id="node-summary" rows={2} value={node.data.summary||''} onChange={e=>update({summary:e.target.value})}/>
        <div className="field-row"><label>节点类型<select value={node.type} onChange={e=>onEdit({...graph,nodes:graph.nodes.map(n=>n.id===node.id?{...n,type:e.target.value as NodeKind}:n)})}>{Object.entries(KIND_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>执行主体<select value={node.data.executor} onChange={e=>update({executor:e.target.value as Executor})}>{Object.entries(EXECUTOR_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
        <label className="field-label" htmlFor="node-role">显示分类</label><select id="node-role" value={node.data.role||'main'} onChange={e=>update({role:e.target.value as FlowRole})}><option value="main">主线</option><option value="support">次要步骤</option><option value="exception">异常处理</option></select>
        {groupsOf(graph).some(g=>g.nodeIds.includes(node.id))&&<div className="field-hint">循环成员随循环一起显示。<button className="button subtle" onClick={()=>onEdit(ungroupNode(graph,node.id))}>移出分组</button></div>}
        <label className="field-label" htmlFor="node-notes">完整说明</label><textarea id="node-notes" className="notes-textarea" rows={11} value={node.data.notes} onChange={e=>update({notes:e.target.value})}/>
        <button className="button subtle danger" aria-label="删除选中节点" onClick={()=>{if(node.id===selectedId)onDelete();else{onEdit(removeNodes(graph,[node.id]));setTrail(t=>t.slice(0,-1));}}}><Trash2 size={14}/>删除节点</button>
      </>}
      <div className="node-identity">节点 ID <code>{node.id}</code></div>
    </>:group?<button className="button secondary" onClick={()=>push({scope:{groupId:group.id}})}>查看 {group.label}</button>:<p>该节点已被删除。</p>}
    {!!branches.length&&<section className="reader-branches"><h3>相关分支 <span>{branches.length}</span></h3>{branches.map(b=><button key={b.edgeId} disabled={b.edgeId===current.scope?.branchEdgeId} onClick={()=>push({scope:{branchEdgeId:b.edgeId}})}><span>{b.label}<small>{graph.nodes.find(n=>n.id===b.target)?.data.label}</small></span><ChevronRight size={14}/></button>)}</section>}
  </section>;
}
