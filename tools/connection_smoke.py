#!/usr/bin/env python3
"""Check outline connection gestures in an isolated temporary workspace."""
import json
import math
from pathlib import Path
import shutil
import sys
import tempfile

import browser_smoke as smoke


def main():
    if not smoke.BROWSER:
        raise SystemExit('Install agent-browser and its browser first.')
    smoke.ARTIFACTS = smoke.ROOT / '.test-artifacts/connection-smoke'
    smoke.ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='diagram-connections-') as folder:
        project = Path(folder)

        def cli(*args, check=True):
            result = smoke.run([sys.executable, smoke.SCRIPT, *args, '--project', project], check=check)
            return json.loads(result.stdout) if result.returncode == 0 else result

        def point(node_id, x, y):
            return smoke.evaluate('''(() => { const r=document.querySelector('[data-connection-outline="%s"]').getBoundingClientRect(); return [Math.round(r.x+r.width*%s),Math.round(r.y+r.height*%s)]; })()''' % (node_id, x, y))

        def grip(endpoint):
            return smoke.evaluate('''(() => { const r=document.querySelector('[data-anchor-end="%s"]').getBoundingClientRect(); return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]; })()''' % endpoint)

        def select_edge():
            position = smoke.evaluate('''(() => { const path=document.querySelector('.react-flow__edge-path'), point=path.getPointAtLength(path.getTotalLength()/2); const screen=new DOMPoint(point.x,point.y).matrixTransform(path.getScreenCTM()); return [screen.x,screen.y]; })()''')
            smoke.browser('mouse', 'move', *[str(round(p)) for p in position])
            smoke.browser('mouse', 'down')
            smoke.browser('mouse', 'up')
            smoke.wait_for('document.querySelectorAll("[data-anchor-end]").length === 2')

        def assert_rendered_endpoints(edge):
            for endpoint in ('source', 'target'):
                actual = smoke.evaluate('''(() => { const path=document.querySelector('.react-flow__edge-path'), p=path.getPointAtLength(%s); const screen=new DOMPoint(p.x,p.y).matrixTransform(path.getScreenCTM()); return [screen.x,screen.y]; })()''' % ('0' if endpoint == 'source' else 'path.getTotalLength()'))
                anchor = edge[endpoint + 'Anchor']
                expected = point(edge[endpoint], anchor['x'], anchor['y'])
                assert max(abs(actual[i] - expected[i]) for i in (0, 1)) < 1, (endpoint, actual, expected)

        def drag(start, end):
            assert len(start) == len(end) == 2 and min(start + end) >= 0, (start, end)
            smoke.browser('mouse', 'move', *[str(round(p)) for p in start])
            smoke.browser('mouse', 'down')
            smoke.browser('mouse', 'move', *[str(round((start[i] + end[i]) / 2)) for i in (0, 1)])
            smoke.browser('mouse', 'move', *[str(round(p)) for p in end])
            smoke.browser('mouse', 'up')

        def saved_graph():
            smoke.wait_for('document.querySelector(".app-shell")?.dataset.dirty === "false"')
            return cli('show', '--task', task_id)['graph']

        graph = {'schemaVersion': 2, 'title': '连接点验收', 'description': '', 'constraints': '', 'groups': [], 'edges': [],
                 'nodes': [{'id': name, 'type': 'step', 'position': {'x': x, 'y': y},
                            'data': {'label': name.upper(), 'notes': '', 'executor': 'program', 'expanded': False, 'summary': '', 'role': 'main'}}
                           for name, x, y in [('a', 100, 100), ('b', 500, 180), ('c', 380, 470)]]}
        fixture = project / 'fixture.json'
        fixture.write_text(json.dumps(graph), encoding='utf-8')
        try:
            created = cli('create', '--title', graph['title'], '--mode', 'manual', '--graph', fixture, '--no-open')
            task_id = created['task']['id']
            smoke.browser('set', 'viewport', '1500', '1000')
            smoke.browser('open', created['url'])
            smoke.wait_for('document.querySelectorAll("[data-connection-outline]").length === 3')
            smoke.browser('wait', '300')
            original_positions = {node['id']: node['position'] for node in graph['nodes']}
            smoke.browser('screenshot', str(smoke.ARTIFACTS / 'connection-start.png'))

            drag(point('a', .23, 0), point('b', 1, .61))
            smoke.wait_for('document.querySelectorAll(".react-flow__edge").length === 1')
            smoke.wait_for('document.querySelectorAll("[data-anchor-end]").length === 2')
            connected = saved_graph()
            edge = connected['edges'][0]
            assert abs(edge['sourceAnchor']['x'] - .23) < .01 and edge['sourceAnchor']['y'] == 0
            assert edge['targetAnchor']['x'] == 1 and abs(edge['targetAnchor']['y'] - .61) < .01
            assert edge['sourceHandle'] == 'bottom' and edge['targetHandle'] == 'top'
            assert_rendered_endpoints(edge)
            assert {node['id']: node['position'] for node in connected['nodes']} == original_positions
            smoke.click('撤销')
            smoke.wait_for('document.querySelectorAll(".react-flow__edge").length === 0')
            smoke.click('重做')
            smoke.wait_for('document.querySelectorAll(".react-flow__edge").length === 1')
            assert saved_graph()['edges'] == connected['edges']

            drag(grip('target'), point('c', .37, 0))
            rebound = saved_graph()['edges'][0]
            assert rebound['id'] == edge['id'] and rebound['target'] == 'c'
            assert rebound['sourceAnchor'] == edge['sourceAnchor']
            assert abs(rebound['targetAnchor']['x'] - .37) < .01 and rebound['targetAnchor']['y'] == 0
            smoke.click('撤销')
            assert saved_graph()['edges'][0] == edge
            smoke.click('重做')
            assert saved_graph()['edges'][0] == rebound

            drag(grip('source'), point('a', 1, 0))
            corner = saved_graph()['edges'][0]['sourceAnchor']
            assert .95 < corner['x'] < 1 and 0 < corner['y'] < .1, corner
            assert_rendered_endpoints(saved_graph()['edges'][0])
            before_cancel = cli('show', '--task', task_id)
            start = grip('target')
            smoke.browser('mouse', 'move', *map(str, start))
            smoke.browser('mouse', 'down')
            smoke.browser('mouse', 'move', '600', '450')
            smoke.browser('press', 'Escape')
            smoke.browser('mouse', 'up')
            smoke.browser('wait', '800')
            assert cli('show', '--task', task_id) == before_cancel, 'Cancelling must preserve graph and revision'

            # Selecting and reading the edge must not record another graph edit.
            select_edge()
            smoke.browser('wait', '800')
            assert cli('show', '--task', task_id) == before_cancel
            smoke.click('自动选择连接点')
            automatic = saved_graph()['edges'][0]
            assert 'sourceAnchor' not in automatic and 'targetAnchor' not in automatic
            smoke.click('撤销')
            restored = saved_graph()
            assert restored['edges'] == before_cancel['graph']['edges']
            assert {node['id']: node['position'] for node in restored['nodes']} == original_positions
            smoke.browser('reload')
            smoke.wait_for('document.querySelectorAll(".react-flow__edge").length === 1')
            assert saved_graph() == restored
            assert_rendered_endpoints(restored['edges'][0])
            start = smoke.evaluate('''(() => { const r=document.querySelector('[data-id="b"] .node-title').getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2]; })()''')
            drag(start, [start[0] + 28, start[1] + 22])
            moved = saved_graph()
            moved_positions = {node['id']: node['position'] for node in moved['nodes']}
            assert moved_positions['b'] != original_positions['b']
            assert moved_positions['a'] == original_positions['a'] and moved_positions['c'] == original_positions['c']
            assert moved['edges'] == restored['edges']
            smoke.click('撤销')
            assert saved_graph() == restored

            nested = cli('create', '--title', '相切循环验收', '--mode', 'agent', '--graph', smoke.ROOT / 'examples/tangent-loops.json', '--no-open')
            task_id = nested['task']['id']
            smoke.browser('open', 'about:blank')
            smoke.browser('open', nested['url'])
            smoke.wait_for('document.querySelectorAll("[data-connection-outline]").length === 5 && document.querySelectorAll(".react-flow__edge").length === 6')
            smoke.click('整理布局')
            smoke.wait_for('document.querySelector(".app-shell").dataset.dirty === "false" && Number(document.querySelector(".app-shell").dataset.revision) > 1')
            smoke.browser('wait', '500')
            laid = saved_graph()
            circles = [group['circle'] for group in laid['groups']]
            assert abs(math.hypot(circles[0]['x'] - circles[1]['x'], circles[0]['y'] - circles[1]['y']) - sum(c['radius'] for c in circles)) < .001
            assert smoke.evaluate('document.querySelectorAll(".react-flow__node[data-id=shared]").length') == 1
            assert smoke.evaluate('document.querySelectorAll(".react-flow__node-loop-area").length') == 2
            assert smoke.evaluate('[...document.querySelectorAll(".react-flow__edge-path")].every(p=>p.getAttribute("d").includes(" A"))')
            smoke.browser('screenshot', str(smoke.ARTIFACTS / 'tangent-loops.png'))
            geometry = smoke.canvas_geometry()
            state = cli('show', '--task', task_id)
            smoke.browser('click', '[data-id="loop-area:retry-loop"] .loop-caption')
            smoke.wait_for('!!document.querySelector(".group-panel[data-group=retry-loop]")')
            smoke.browser('wait', '800')
            assert cli('show', '--task', task_id) == state
            assert smoke.canvas_geometry() == geometry, 'Reading a nested loop must preserve the main drawing'
            smoke.browser('screenshot', str(smoke.ARTIFACTS / 'nested-loop-details.png'))

            start = smoke.evaluate('''(() => { const r=document.querySelector('[data-id="shared"] .node-title').getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2]; })()''')
            drag(start, [start[0] + 35, start[1] - 25])
            moved = saved_graph()
            assert [group['circle'] for group in moved['groups']] == circles
            for before, after in zip(laid['nodes'], moved['nodes']):
                assert (before['position'] != after['position']) == (before['id'] == 'shared')
            smoke.click('撤销')
            assert saved_graph() == laid
            smoke.click('存档')
            smoke.wait_for('document.querySelector(".app-shell").dataset.busy === "false" && Number(document.querySelector(".app-shell").dataset.revision) > ' + str(state['revision'] + 2))
            exported = cli('export', '--task', task_id)
            for path in exported['paths'].values():
                shutil.copy2(path, smoke.ARTIFACTS / ('tangent-' + Path(path).name))
            assert saved_graph() == laid, 'Complete export must preserve circle geometry and membership'
            print('PASS: arbitrary outline connection, rendered endpoints, rounded corner, endpoint rebinding, single-step undo/redo, cancellation, saved anchors after reload, automatic anchors and card dragging.')
            print('PASS: nested tangent loops, one shared card, stable details, node-only drag, persisted circles and complete PNG export.')
        finally:
            smoke.browser('close', check=False)
            cli('stop', check=False)


if __name__ == '__main__':
    main()
