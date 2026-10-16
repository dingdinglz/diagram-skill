#!/usr/bin/env python3
"""Opt-in real Chromium smoke test; requires the agent-browser CLI and built web assets.
Run: python3 tools/browser_smoke.py. Uses only an isolated temporary workspace.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'skills/diagram-plan/scripts/diagram.py'
ARTIFACTS = ROOT / '.test-artifacts/browser-smoke'
SESSION = 'diagram-smoke-' + uuid.uuid4().hex[:8]
BROWSER = shutil.which('agent-browser')


def run(args, check=True, timeout=50):
    result = subprocess.run([str(a) for a in args], cwd=str(ROOT), text=True, capture_output=True, timeout=timeout)
    if check and result.returncode:
        # Never echo the open URL/credential on failure.
        raise AssertionError(result.stderr.strip() or result.stdout.strip() or 'Command failed')
    return result


def browser(*args, check=True):
    return run([BROWSER, '--session', SESSION, '--download-path', ARTIFACTS, *args], check=check)


def evaluate(expression):
    result = browser('--json', 'eval', expression)
    payload = json.loads(result.stdout)
    assert payload['success'], payload.get('error')
    return payload['data']['result']


def wait_for(expression):
    browser('wait', '--fn', expression)


def click(name):
    browser('find', 'role', 'button', 'click', '--name', name)


def canvas_geometry():
    return evaluate('''(() => ({
      viewport: document.querySelector('.react-flow__viewport').style.transform,
      nodes: [...document.querySelectorAll('.react-flow__node')].map(node => ({
        id: node.dataset.id, position: node.style.transform,
        width: node.offsetWidth, height: node.offsetHeight,
        handles: [...node.querySelectorAll('.react-flow__handle')].map(handle => ({
          id: handle.dataset.handleid, x: handle.offsetLeft, y: handle.offsetTop
        }))
      })),
      edges: [...document.querySelectorAll('.react-flow__edge')].map(edge => ({
        id: edge.dataset.id, path: edge.querySelector('.react-flow__edge-path').getAttribute('d')
      }))
    }))()''')


def main():
    if not BROWSER:
        raise SystemExit('Install agent-browser and its browser first; this is a development-only test.')
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='diagram-browser-') as folder:
        project = Path(folder)

        def cli(*args, check=True):
            result = run([sys.executable, SCRIPT, *args, '--project', project], check=check)
            return json.loads(result.stdout) if result.returncode == 0 else result

        try:
            created = cli('create', '--title', '浏览器验收', '--mode', 'agent', '--graph', ROOT / 'examples/sample-flow.json', '--no-open')
            task_id = created['task']['id']
            browser('set', 'viewport', '1500', '1000')
            browser('open', created['url'])
            wait_for('document.querySelector(".app-shell")?.dataset.status === "draft" && document.querySelectorAll(".react-flow__node").length === 7')
            assert 'token=' not in evaluate('location.hash'), 'Credential must be removed from visible URL'
            wait_for('document.querySelectorAll(".react-flow__minimap-node").length === 7')

            browser('wait', '400')
            initial_state = cli('show', '--task', task_id)
            initial_geometry = canvas_geometry()
            browser('click', '[data-id="normalize-fields"]')
            wait_for('!!document.querySelector(".reader-notes")')
            browser('wait', '1000')
            assert cli('show', '--task', task_id) == initial_state, 'Reading notes must not mutate the task'
            assert canvas_geometry() == initial_geometry, 'Reading must preserve geometry and viewport'
            assert evaluate('document.querySelector(".app-shell").dataset.dirty === "false"')
            assert evaluate('document.querySelector("button[aria-label=撤销]").disabled')
            assert not evaluate('!!document.querySelector(".node-notes")'), 'Notes belong in the fixed inspector'
            browser('screenshot', str(ARTIFACTS / 'notes-open.png'))
            browser('scroll', 'down', '250', '--selector', '.inspector-content')
            assert canvas_geometry() == initial_geometry, 'Scrolling the inspector must not pan the canvas'
            for node_id in ('receive-message', 'validate-message', 'finish-attempt'):
                browser('click', '.react-flow__node[data-id="' + node_id + '"]')
                assert canvas_geometry() == initial_geometry
            browser('click', '[data-id="normalize-fields"]')
            click('编辑节点')
            browser('fill', '#node-label', '整理并校验输入格式')
            wait_for('document.querySelector(".app-shell")?.dataset.dirty === "false" && Number(document.querySelector(".app-shell").dataset.revision) > 1')
            click('撤销')
            assert evaluate('document.querySelector("#node-label").value') == '整理输入字段'
            click('返回阅读')
            assert evaluate('!document.querySelector("button[aria-label=重做]").disabled'), 'Reading must preserve redo history'
            click('重做')
            assert evaluate('document.querySelector(".node-reader h2").textContent') == '整理并校验输入格式'
            assert not evaluate('!!document.querySelector("#node-label")'), 'Redo must preserve reading mode'
            click('请 agent 修改')
            browser('fill', '#feedback', '空消息返回明确错误；保留布局。')
            click('提交图与反馈')
            wait_for('document.querySelector(".app-shell")?.dataset.status === "awaiting_agent" && document.querySelector(".app-shell").dataset.busy === "false"')
            handoff = cli('wait', '--task', task_id, '--timeout', '1')
            assert handoff['status'] == 'awaiting_agent' and handoff['artifacts']['hasPng']
            submitted = json.loads(Path(handoff['artifacts']['paths']['json']).read_text())
            assert not next(n for n in submitted['nodes'] if n['id'] == 'normalize-fields')['data']['expanded'], 'Handoff must not persist viewing preferences'
            readonly_state = cli('show', '--task', task_id)
            browser('click', '[data-id="normalize-fields"]')
            browser('wait', '1000')
            assert cli('show', '--task', task_id) == readonly_state, 'Reading a submitted plan must not change its state'
            positions = {n['id']: n['position'] for n in submitted['nodes']}
            submitted['nodes'][1]['data']['notes'] += '\n\n浏览器验收标记：空消息返回 `body.required`，不记录消息正文。'
            revision_file = project / 'revision.json'
            revision_file.write_text(json.dumps(submitted, ensure_ascii=False), encoding='utf-8')
            revision_args = ['revise', '--task', task_id, '--revision', str(handoff['revision']), '--request-id', handoff['requestId'], '--graph', revision_file]
            updated = cli(*revision_args)
            assert {n['id']: n['position'] for n in updated['graph']['nodes']} == positions
            assert cli(*revision_args, check=False).returncode != 0, 'Stale reply must fail'
            wait_for('document.querySelector(".app-shell")?.dataset.status === "draft"')
            click('确认流程')
            click('确认并开始实现')
            wait_for('document.querySelector(".app-shell")?.dataset.status === "approved" && document.querySelector(".app-shell").dataset.busy === "false"')
            approved = cli('wait', '--task', task_id, '--timeout', '1')
            assert approved['approvedVersion']
            approved_files = approved['artifacts']['paths']
            before_hash = {name: hashlib.sha256(Path(path).read_bytes()).hexdigest() for name, path in approved_files.items()}
            assert Path(approved_files['png']).read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
            assert '浏览器验收标记' in Path(approved_files['markdown']).read_text()
            for name, path in approved_files.items():
                shutil.copy2(path, ARTIFACTS / Path(path).name)
            assert evaluate('document.querySelector("#node-label")?.disabled ?? true')
            click('创建修订')
            wait_for('document.querySelector(".app-shell")?.dataset.status === "draft"')
            assert before_hash == {name: hashlib.sha256(Path(path).read_bytes()).hexdigest() for name, path in approved_files.items()}

            click('请 agent 修改')
            browser('fill', '#feedback', '这条请求即将取消。')
            click('提交图与反馈')
            wait_for('document.querySelector(".app-shell")?.dataset.status === "awaiting_agent"')
            cancelled_request = cli('show', '--task', task_id)
            click('取消等待，继续编辑')
            wait_for('document.querySelector(".app-shell")?.dataset.status === "draft"')
            stale = cli('revise', '--task', task_id, '--revision', str(cancelled_request['revision']), '--request-id', cancelled_request['requestId'], '--graph', revision_file, check=False)
            assert stale.returncode != 0
            click('暂停本次规划')
            click('保留草稿并暂停')
            wait_for('document.querySelector(".app-shell")?.dataset.status === "cancelled"')
            assert cli('wait', '--task', task_id, '--timeout', '0')['status'] == 'cancelled'
            cli('stop')
            reopened = cli('start', '--no-open')
            browser('open', reopened['url'])
            wait_for('document.querySelector(".app-shell")?.dataset.status === "cancelled"')
            click('继续编辑')
            wait_for('document.querySelector(".app-shell")?.dataset.status === "draft"')

            # Manual construction really creates an empty graph, not a seeded template.
            click('新建空白画板')
            browser('fill', '#new-title', '手动连接验收')
            click('创建并打开')
            wait_for('document.querySelector(".workspace-title h1")?.textContent === "手动连接验收" && document.querySelector(".app-shell").dataset.busy === "false"')
            assert evaluate('document.querySelectorAll(".react-flow__node").length') == 0
            click('添加开始节点')
            click('编辑节点')
            browser('fill', '#node-label', '用户提交请求')
            click('添加处理步骤')
            click('编辑节点')
            browser('fill', '#node-label', '读取参数')
            ids = evaluate('[...document.querySelectorAll(".react-flow__node")].map(e=>e.dataset.id)')
            points = evaluate('(() => { const ids=' + json.dumps(ids) + '; const p=(id,h)=>{const r=document.querySelector(`[data-id="${id}"] [data-handleid="${h}"]`).getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]};return [p(ids[0],"bottom"),p(ids[1],"top")];})()')
            browser('mouse', 'move', *map(str, points[0])); browser('mouse', 'down')
            midpoint = [round((points[0][i] + points[1][i]) / 2) for i in (0, 1)]
            browser('mouse', 'move', *map(str, midpoint)); browser('mouse', 'move', *map(str, points[1])); browser('mouse', 'up')
            wait_for('document.querySelectorAll(".react-flow__edge").length === 1')
            browser('fill', '#edge-label', '收到有效请求')
            browser('click', '[data-id="' + ids[1] + '"]')
            click('编辑节点')
            browser('fill', '#node-notes', '## 字段\n\n| 字段 | 要求 |\n| --- | --- |\n| id | 必填 |\n\n```json\n{"ok":true}\n```\n\n![禁止加载](https://example.invalid/no-network.png)')
            click('返回阅读')
            click('整理布局')
            wait_for('document.querySelector(".app-shell")?.dataset.dirty === "false"')
            assert evaluate('document.querySelectorAll("img").length') == 0
            assert not evaluate('performance.getEntriesByType("resource").map(e=>e.name).filter(n=>/^https?:/.test(n)&&!n.startsWith(location.origin+"/"))'), 'No external runtime resources'

            # Another client commits during a local edit. The editor must retain local text on 409.
            browser('click', '.inspector-tabs button:first-child')
            # Deselect node through the pane to expose graph title.
            evaluate('document.querySelector(".react-flow__pane").dispatchEvent(new MouseEvent("click",{bubbles:true}))')
            wait_for('!!document.querySelector("#graph-title")')
            race_result = evaluate('''(async () => {
              const id=new URLSearchParams(location.hash.slice(1)).get('task');
              const token=sessionStorage.getItem('flowplan:token:'+location.origin);
              const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
              const state=await (await fetch('/api/tasks/'+id,{headers})).json();
              const el=document.querySelector('#graph-title');
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'本地修改必须保留');
              el.dispatchEvent(new Event('input',{bubbles:true}));
              const graph={...state.graph,description:'其他客户端已更新'};
              return (await fetch('/api/tasks/'+id+'/draft',{method:'PUT',headers,body:JSON.stringify({revision:state.revision,graph})})).status;
            })()''')
            assert race_result == 200
            browser('wait', '--text', '本地修改仍保留')
            assert evaluate('document.querySelector("#graph-title").value') == '本地修改必须保留'
            click('备份本地并重新载入')
            wait_for('document.querySelector(".app-shell")?.dataset.busy === "false" && !document.querySelector(".message-bar.error")')
            assert evaluate('document.querySelector("#graph-description").value') == '其他客户端已更新'
            click('导出完整 PNG')
            browser('wait', '--text', '已导出完整 PNG')
            assert not evaluate('!!document.querySelector(".message-bar.error")')
            browser('screenshot', str(ARTIFACTS / 'editor.png'))
            # A v2 graph exercises grouped circular layout, drilldown and complete export.
            loop = cli('create', '--title', '循环验收', '--mode', 'agent', '--graph', ROOT / 'examples/loop-flow.json', '--no-open')
            loop_id = loop['task']['id']
            browser('open', 'about:blank')
            browser('open', loop['url'])
            wait_for('!!document.querySelector("[data-id=work]") && document.querySelectorAll(".react-flow__edge").length === 5')
            browser('wait', '300')
            assert evaluate('''(() => {const c=document.querySelector('.canvas-area').getBoundingClientRect();return [...document.querySelectorAll('.react-flow__node:not([data-id^="loop-area:"])')].every(n=>{const r=n.getBoundingClientRect();return r.left>=c.left&&r.right<=c.right&&r.top>=c.top&&r.bottom<=c.bottom;});})()'''), 'Initial view must include every main card'
            click('整理布局')
            wait_for('document.querySelector(".app-shell").dataset.dirty === "false" && Number(document.querySelector(".app-shell").dataset.revision) > 1')
            browser('wait', '500')
            loop_state = cli('show', '--task', loop_id)
            loop_geometry = canvas_geometry()
            assert evaluate('[...document.querySelectorAll(".react-flow__edge-path")].some(p=>p.getAttribute("d").includes(" A"))'), 'Circular steps must use circular connections'
            browser('click', '[data-id=work] .node-branch-button')
            wait_for('!!document.querySelector(".detail-diagram")')
            assert evaluate('document.querySelector("[data-id=work] .node-branch-button").textContent.includes("异常")')
            assert evaluate('document.querySelectorAll(".reader-branches button").length') == 2
            evaluate('document.querySelector(".reader-branches button:not(:disabled)").click()')
            wait_for('!!document.querySelector("[data-view-id=disconnect]")')
            assert canvas_geometry() == loop_geometry, 'Opening an exception must not move the main graph'
            browser('scroll', 'down', '200', '--selector', '.detail-diagram-scroll')
            assert canvas_geometry() == loop_geometry
            browser('screenshot', str(ARTIFACTS / 'branch-details.png'))
            browser('click', '[data-id=work] .node-subflow-button')
            wait_for('!!document.querySelector("[data-view-id=work]")')
            assert canvas_geometry() == loop_geometry
            browser('wait', '1000')
            assert cli('show', '--task', loop_id) == loop_state
            click('显示分支')
            wait_for('!!document.querySelector(".react-flow__node[data-id=failed]")')
            full_geometry = canvas_geometry()
            assert full_geometry['viewport'] == loop_geometry['viewport']
            for edge in loop_geometry['edges']:
                assert edge in full_geometry['edges'], 'Showing branches must preserve main edge paths'
            click('主线')
            wait_for('!document.querySelector(".react-flow__node[data-id=failed]")')
            assert canvas_geometry() == loop_geometry
            browser('screenshot', str(ARTIFACTS / 'circular-editor.png'))
            click('存档')
            wait_for('document.querySelector(".app-shell").dataset.busy === "false" && Number(document.querySelector(".app-shell").dataset.revision) > ' + str(loop_state['revision']))
            exported = cli('export', '--task', loop_id)
            for name, path in exported['paths'].items():
                shutil.copy2(path, ARTIFACTS / ('circular-' + Path(path).name))
            assert cli('show', '--task', loop_id)['graph']['schemaVersion'] == 2
            evaluate('''(async () => {const id=new URLSearchParams(location.hash.slice(1)).get('task');const token=sessionStorage.getItem('flowplan:token:'+location.origin);const state=await (await fetch('/api/tasks/'+id,{headers:{Authorization:'Bearer '+token}})).json();state.graph.title='恢复未保存的 v2 草稿';localStorage.setItem('flowplan:recovery:'+id,JSON.stringify({graph:state.graph,revision:state.revision}));})()''')
            browser('reload')
            wait_for('!!document.querySelector(".message-bar.recovery")')
            click('恢复修改')
            wait_for('document.querySelector(".workspace-title h1").textContent === "恢复未保存的 v2 草稿" && document.querySelector(".app-shell").dataset.dirty === "false"')
            print('PASS: fixed read-only inspector, stable circular geometry and branch drilldown, complete v1/v2 PNG, manual editing/connection, undo/redo, revision CAS, approval, immutable history, restart and conflict recovery.')
            print('Artifacts:', ARTIFACTS)
        finally:
            cli('stop', check=False)
            browser('close', check=False)


if __name__ == '__main__':
    main()
