#!/usr/bin/env python3
"""Focused UI regressions. Run after npm run build; all data is temporary.

Each case starts its own browser, so responsive/focus checks are independent.
A failed case is never reopened or retried: browser loss remains a real failure.
"""
from contextlib import contextmanager
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import uuid

import browser_smoke as harness
from browser_smoke import BROWSER, ROOT, SCRIPT, browser, click, evaluate, run, wait_for


@contextmanager
def live_motion_preference():
    endpoint = browser('get', 'cdp-url').stdout.strip()
    page_url = evaluate('location.href')
    process = subprocess.Popen(['node', '--experimental-websocket', str(ROOT / 'tools/emulate_reduced_motion.mjs'), endpoint, page_url],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert process.stdout.readline().strip() == 'ready', process.stderr.read()

        def change(preference):
            process.stdin.write(preference + '\n')
            process.stdin.flush()
            assert process.stdout.readline().strip() == 'ok', process.stderr.read()

        yield change
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise


def main():
    if not BROWSER:
        raise SystemExit('Install agent-browser and its browser before running UI checks.')
    with tempfile.TemporaryDirectory(prefix='flowplan-ui-') as folder:
        project = Path(folder)

        def cli(*args):
            return json.loads(run([sys.executable, SCRIPT, *args, '--project', project]).stdout)

        created = cli('create', '--title', '界面回归测试', '--mode', 'agent',
                      '--graph', ROOT / 'examples/loop-flow.json', '--no-open')
        original = cli('show', '--task', created['task']['id'])

        @contextmanager
        def case(name, width=1440, height=900, reduced_motion=False):
            harness.SESSION = 'flowplan-ui-' + uuid.uuid4().hex[:10]
            try:
                launch_args = ['--args', '--force-prefers-reduced-motion'] if reduced_motion else []
                browser(*launch_args, 'open', created['url'])
                browser('set', 'viewport', str(width), str(height))
                wait_for('document.querySelector(".app-shell")?.dataset.status === "draft"')
                evaluate('(async()=>{await document.fonts.ready;return true})()')
                print('UI case:', name, flush=True)
                yield
                assert evaluate('!!document.querySelector(".app-shell")'), 'Browser lost the workspace'
            finally:
                browser('close', check=False)

        try:
            with case('readable type roles and self-hosted Chinese font'):
                assert evaluate('''(()=>{
                  const sizes={'.status-pill':13,'.save-indicator':13,'.canvas-legend':13,'.sidebar-help':14,'.inspector-tabs button':14,'.graph-reader .markdown':16,'.workspace-title h1':20};
                  return Object.entries(sizes).every(([selector,size])=>parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)===size);
                })()''')
                assert evaluate('getComputedStyle(document.querySelector(".sidebar-help svg")).width') == '20px'
                assert evaluate('getComputedStyle(document.querySelector(".inspector-tabs button svg")).width') == '18px'
                assert evaluate('''(()=>{
                  const fonts=[...document.fonts].filter(f=>f.family.replace(/["']/g,'')==='Noto Sans SC Variable');
                  return fonts.some(f=>f.status==='loaded') && !fonts.some(f=>f.status==='error') && document.fonts.check('500 14px "Noto Sans SC Variable"','流程草稿');
                })()''')
                assert evaluate('performance.getEntriesByType("resource").filter(r=>r.name.includes(".woff2")).every(r=>new URL(r.name).origin===location.origin)')

            with case('search'):
                assert evaluate('getComputedStyle(document.querySelector(".sidebar")).backgroundColor') == 'rgb(248, 249, 252)'
                assert not evaluate('!!document.querySelector(".workspace-switch, .sidebar-footer, .artifact-summary")')
                assert not evaluate('!!document.querySelector(".task-item.active small")'), 'Draft metadata is already in the header'
                assert not evaluate('document.body.innerText.includes("批准当前版本，授权 agent 开始实现")')
                task_title = evaluate('document.querySelector(".task-item-text").childNodes[0].textContent')
                # agent-browser 0.21.4 drops modifiers in press combinations.
                # Dispatch that shortcut to test the app handler. Plain keys
                # below still use real browser keyboard input.
                evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"k", ctrlKey:true, bubbles:true, cancelable:true}))')
                assert evaluate('document.activeElement?.getAttribute("aria-label")') == '搜索流程'
                browser('fill', '[aria-label="搜索流程"]', '没有这个流程-unique')
                assert evaluate('document.querySelectorAll(".task-item").length') == 0
                click('清除搜索')
                browser('fill', '[aria-label="搜索流程"]', task_title[:2])
                assert evaluate('document.querySelectorAll(".task-item").length') == 1

            with case('document reading, semantic overview and viewport continuity'):
                assert evaluate('!!document.querySelector(".graph-reader .markdown")')
                assert not evaluate('!!document.querySelector("#graph-title")')
                click('编辑流程说明')
                wait_for('document.activeElement?.id === "graph-title"')
                click('返回流程说明')
                assert evaluate('document.activeElement === document.querySelector(".graph-reader h2")')
                click('100% 阅读')
                wait_for('document.querySelector(".zoom-value")?.textContent === "100%"')
                center = '''(() => {
                  const box=document.querySelector('.canvas-area').getBoundingClientRect();
                  const m=new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
                  return {x:(box.width/2-m.e)/m.a,y:(box.height/2-m.f)/m.a};
                })()'''
                before = evaluate(center)
                click('收起详情面板')
                wait_for('!document.querySelector(".inspector")')
                after = evaluate(center)
                assert evaluate('document.querySelector(".zoom-value").textContent') == '100%'
                assert abs(before['x'] - after['x']) < 2 and abs(before['y'] - after['y']) < 2
                for _ in range(4):
                    click('缩小画布')
                    browser('wait', '220')
                assert evaluate('document.querySelector(".canvas-area").classList.contains("is-overview")')
                assert evaluate('parseFloat(getComputedStyle(document.querySelector(".node-title")).fontSize) >= 22')
                assert not evaluate('!!document.querySelector(".dock-pointer")'), 'No decorative selected-mode affordance'

            with case('Aurora pause controls, editing safety and GPU fallback'):
                wait_for('document.querySelector(".aurora-background").dataset.state === "running"')
                assert evaluate('document.querySelector(".aurora-canvas").width <= 1280')
                assert evaluate('getComputedStyle(document.querySelector(".aurora-background")).pointerEvents') == 'none'
                rate = evaluate('''(async () => {
                  const c=document.querySelector('.aurora-canvas'), start=+c.dataset.frame;
                  await new Promise(r=>setTimeout(r,500)); return +c.dataset.frame-start;
                })()''')
                assert 1 <= rate <= 17, ('Aurora must animate within its 30fps draw budget', rate)
                point = evaluate('(()=>{const r=document.querySelector(".canvas-area").getBoundingClientRect();return [r.x+24,r.y+160]})()')
                browser('mouse', 'move', str(point[0]), str(point[1]))
                browser('mouse', 'down')
                wait_for('document.querySelector(".aurora-background").dataset.state === "paused"')
                assert evaluate('''(async () => {
                  const c=document.querySelector('.aurora-canvas'), start=c.dataset.frame;
                  await new Promise(r=>setTimeout(r,180));return c.dataset.frame===start;
                })()''')
                browser('mouse', 'up')
                wait_for('document.querySelector(".aurora-background").dataset.state === "running"')
                assert evaluate('''(()=>{
                  document.querySelector('.canvas-area').dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:1}));
                  return document.querySelector('.aurora-background').dataset.state==='paused';
                })()''')
                wait_for('document.querySelector(".aurora-background").dataset.state === "running"')
                click('编辑流程说明')
                wait_for('document.querySelector(".aurora-background").dataset.state === "paused"')
                click('返回流程说明')
                wait_for('document.querySelector(".aurora-background").dataset.state === "running"')
                click('请 agent 修改')
                wait_for('document.querySelector(".aurora-background").dataset.state === "paused"')
                browser('press', 'Escape')
                wait_for('document.querySelector(".aurora-background").dataset.state === "running"')
                viewport = evaluate('document.querySelector(".react-flow__viewport").getAttribute("style")')
                click('暂停背景动效')
                wait_for('document.querySelector(".aurora-background").dataset.state === "static"')
                assert not evaluate('!!document.querySelector(".aurora-canvas")')
                assert evaluate('document.querySelector(".react-flow__viewport").getAttribute("style")') == viewport
                browser('reload')
                wait_for('document.querySelector(".app-shell")?.dataset.status === "draft"')
                assert evaluate('document.querySelector(".aurora-background").dataset.state') == 'static'
                assert evaluate('localStorage.getItem("flowplan:ambient-motion")') == 'off'
                click('开启背景动效')
                wait_for('document.querySelector(".aurora-background").dataset.state === "running"')
                evaluate('document.querySelector(".aurora-canvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext(); true')
                wait_for('document.querySelector(".aurora-background").dataset.state === "fallback"')
                assert not evaluate('!!document.querySelector(".aurora-canvas")')
                click('暂停背景动效')
                evaluate('window.__getContext=HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext=function(kind,...args){if(kind==="webgl2")throw new Error("Test unavailable GPU");return window.__getContext.call(this,kind,...args)}; true')
                click('开启背景动效')
                wait_for('document.querySelector(".aurora-background").dataset.state === "fallback"')
                evaluate('HTMLCanvasElement.prototype.getContext=window.__getContext; true')
                click('暂停背景动效')
                click('开启背景动效')
                wait_for('document.querySelector(".aurora-background").dataset.state === "running"')

            with case('dock motion and native scope interaction'):
                wait_for('document.querySelector(".node-palette").dataset.motion === "spring"')
                geometry = '''[...document.querySelectorAll('.palette-button')].map(el=>{
                  const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];
                })'''
                before = evaluate(geometry)
                browser('hover', '.palette-step')
                wait_for('new DOMMatrix(getComputedStyle(document.querySelector(".palette-step .dock-icon")).transform).a > 1.15')
                assert evaluate(geometry) == before, 'Dock animation must not move targets'
                assert evaluate('parseFloat(getComputedStyle(document.querySelector(".node-palette .spotlight-light")).opacity) > 0')
                browser('hover', '.review-actions .glare-hover')
                assert evaluate('getComputedStyle(document.querySelector(".review-actions .glare-band")).animationName') == 'material-sheen'
                browser('mouse', 'move', '0', '0')
                wait_for('Math.abs(new DOMMatrix(getComputedStyle(document.querySelector(".palette-step .dock-icon")).transform).a - 1) < .001')
                browser('focus', '.palette-start')
                browser('press', 'ArrowRight')
                assert evaluate('document.activeElement.classList.contains("palette-step")')
                click('显示分支')
                assert evaluate('document.querySelector(".view-switch button:last-child").getAttribute("aria-pressed")') == 'true'
                browser('press', 'ArrowLeft')
                assert evaluate('document.querySelector(".view-switch button:first-of-type").getAttribute("aria-pressed")') == 'true'
                browser('focus', '.view-switch button:last-child')
                browser('press', 'Space')
                assert evaluate('document.querySelector(".view-switch button:last-child").getAttribute("aria-pressed")') == 'true'
                click('主线')

            with case('live reduced-motion preference preserves editing focus'):
                browser('hover', '.palette-step')
                wait_for('new DOMMatrix(getComputedStyle(document.querySelector(".palette-step .dock-icon")).transform).a > 1.15')
                click('编辑流程说明')
                assert evaluate('window.__motionFocus = document.activeElement; window.__motionFocus.tagName === "INPUT"')
                with live_motion_preference() as set_preference:
                    set_preference('reduce')
                    wait_for('document.querySelector(".app-shell").dataset.reducedMotion === "true"')
                    assert evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches')
                    assert evaluate('document.activeElement === window.__motionFocus')
                    assert evaluate('document.querySelector(".node-palette").dataset.motion') == 'static'
                    assert evaluate('document.querySelector(".aurora-background").dataset.state') == 'static'
                    assert not evaluate('!!document.querySelector(".aurora-canvas")')
                    assert evaluate('getComputedStyle(document.querySelector(".palette-step .dock-icon")).transform') == 'none'
                    click('显示分支')
                    assert evaluate('''(async () => {
                      const el=document.querySelector('.scope-indicator'), frames=[];
                      for(let i=0;i<6;i++){await new Promise(requestAnimationFrame);frames.push(getComputedStyle(el).clipPath);}
                      return new Set(frames).size===1;
                    })()''')
                    evaluate('window.__motionFocus.focus(); true')
                    set_preference('no-preference')
                    wait_for('document.querySelector(".node-palette").dataset.motion === "spring"')
                    assert evaluate('!matchMedia("(prefers-reduced-motion: reduce)").matches')
                    assert evaluate('document.activeElement === window.__motionFocus')
                    browser('hover', '.palette-step')
                    wait_for('new DOMMatrix(getComputedStyle(document.querySelector(".palette-step .dock-icon")).transform).a > 1.15')

            with case('reduced motion is actually static', reduced_motion=True):
                assert evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches')
                assert evaluate('document.querySelector(".app-shell").dataset.reducedMotion') == 'true'
                assert evaluate('document.querySelector(".node-palette").dataset.motion') == 'static'
                assert evaluate('document.querySelector(".aurora-background").dataset.state') == 'static'
                assert not evaluate('!!document.querySelector(".aurora-canvas")')
                browser('hover', '.palette-step')
                assert evaluate('getComputedStyle(document.querySelector(".palette-step .dock-icon")).transform') == 'none'
                click('显示分支')
                assert evaluate('''(async () => {
                  const el=document.querySelector('.scope-indicator'), frames=[];
                  for(let i=0;i<6;i++){await new Promise(requestAnimationFrame);frames.push(getComputedStyle(el).clipPath);}
                  return new Set(frames).size===1;
                })()'''), 'Reduced-motion scope selection must not interpolate'
                click('请 agent 修改')
                assert evaluate('getComputedStyle(document.querySelector(".modal")).transform') == 'none'
                browser('press', 'Escape')
                click('100% 阅读')
                assert evaluate('document.querySelector(".zoom-value").textContent') == '100%'

            with case('dialog keyboard focus'):
                click('请 agent 修改')
                wait_for('document.activeElement?.id === "feedback"')
                for _ in range(4):
                    browser('press', 'Tab')
                    assert evaluate('!!document.activeElement?.closest("[role=dialog]")')
                evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Tab", shiftKey:true, bubbles:true, cancelable:true}))')
                assert evaluate('!!document.activeElement?.closest("[role=dialog]")')
                browser('press', 'Escape')
                assert not evaluate('!!document.querySelector(".modal")')
                assert evaluate('document.activeElement?.textContent.includes("请 agent 修改")')
                click('新建流程')
                wait_for('document.activeElement?.id === "new-title"')
                browser('press', 'Escape')

            for width, height in [(1280, 800), (1024, 768), (760, 844), (390, 844), (360, 740), (320, 568)]:
                with case(f'responsive {width}', width, height):
                    wait_for('document.documentElement.scrollWidth <= innerWidth')
                    assert evaluate('''(() => {
                      const box = document.querySelector('.canvas-toolbar').getBoundingClientRect();
                      return box.left >= 0 && box.right <= innerWidth + 1 && document.querySelector('.canvas-toolbar').scrollWidth <= box.width + 1;
                    })()'''), f'Toolbar overflow at {width}'
                    if width <= 760:
                        assert evaluate('document.querySelector(".node-palette").dataset.motion') == 'static'
                        assert evaluate('document.querySelector(".aurora-background").dataset.state') == 'static'
                        assert not evaluate('!!document.querySelector(".aurora-canvas")')
                        if width > 350:
                            assert evaluate('document.querySelector(".canvas-toolbar").getBoundingClientRect().height <= 60'), 'Standard mobile tools should use one row'
                        else:
                            assert evaluate('document.querySelector(".canvas-toolbar").getBoundingClientRect().height <= 110'), '320px tools may wrap, without shrinking labels'
                        assert evaluate('''(()=>{
                          const bar=document.querySelector('.canvas-toolbar').getBoundingClientRect();
                          return [...document.querySelectorAll('.canvas-toolbar button')].filter(b=>b.getClientRects().length).every(b=>{
                            const r=b.getBoundingClientRect();return r.left>=bar.left && r.right<=bar.right+1 && r.top>=bar.top && r.bottom<=bar.bottom+1;
                          });
                        })()''')
                        assert evaluate('document.querySelector(".sidebar").inert')
                        click('打开任务导航')
                        wait_for('document.activeElement?.getAttribute("aria-label") === "搜索流程"')
                        assert evaluate('document.querySelector(".workspace").inert')
                        browser('press', 'Escape')
                        assert not evaluate('document.querySelector(".workspace").inert')
                        click('展开详情面板')
                        wait_for('document.activeElement?.id === "workspace-inspector"')
                        assert evaluate('document.querySelector(".canvas-area").inert')
                        click('关闭详情面板')
                        assert not evaluate('document.querySelector(".canvas-area").inert')

            with case('mobile dialog bounds', 390, 844):
                click('请 agent 修改')
                assert evaluate('''(() => {
                  const box=document.querySelector('.modal').getBoundingClientRect();
                  return box.left>=0 && box.right<=innerWidth && box.height<=innerHeight;
                })()''')
                browser('set', 'viewport', '390', '440')
                wait_for('document.querySelector(".modal").getBoundingClientRect().bottom <= innerHeight')
                assert evaluate('document.querySelector(".modal").scrollWidth <= document.querySelector(".modal").clientWidth')
                assert evaluate('''(() => {
                  const action=document.querySelector('.modal-actions button').getBoundingClientRect();
                  const modal=document.querySelector('.modal').getBoundingClientRect();
                  return action.top>=modal.top && action.bottom<=modal.bottom && action.bottom<=innerHeight;
                })()'''), 'Primary dialog action must remain visible at short heights'

            with case('mobile reduced motion and readable zoom', 390, 844, reduced_motion=True):
                assert evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches')
                click('100% 阅读')
                wait_for('document.querySelector(".zoom-value")?.textContent === "100%"')
                click('展开详情面板')
                assert evaluate('getComputedStyle(document.querySelector(".inspector")).animationName') == 'none'
                assert evaluate('getComputedStyle(document.querySelector(".inspector")).transform') == 'none'
                assert not evaluate('[...document.styleSheets].some(sheet => sheet.href && !sheet.href.startsWith(location.origin))')
                assert evaluate('getComputedStyle(document.querySelector(".mobile-review-meta")).display') != 'none'

            assert cli('show', '--task', created['task']['id']) == original, 'UI navigation changed task data'
            print('UI smoke passed: local font delivery/readable type roles, search, bounded Aurora rendering/pause/persistence/GPU fallback, spotlight/glare, stable dock targets, scope keyboard controls, startup/live reduced-motion modes, dialog focus/bounds, six responsive widths, readable zoom, visible save status.')
        finally:
            run([sys.executable, SCRIPT, 'stop', '--project', project], check=False)


if __name__ == '__main__':
    main()
