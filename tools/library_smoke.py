#!/usr/bin/env python3
"""Browser/CLI round trip for the library sidebar. Run after npm run build."""
import json
import sys
import tempfile
import time

from browser_smoke import ARTIFACTS, BROWSER, SCRIPT, browser, click, evaluate, run, wait_for


ROW = '.library-row[data-entry-id]'
ROW_IDS = f'[...document.querySelectorAll("{ROW}")].map(row => row.dataset.entryId)'
PARENT_DROP = '.library-location[data-parent-drop]'
SEARCH = '[aria-label="搜索流程"]'


def row(entry_id):
    return f'{ROW}[data-entry-id={json.dumps(entry_id)}]'


def wait_rows(*ids):
    wait_for(f'JSON.stringify({ROW_IDS}) === JSON.stringify({json.dumps(ids)})')


def open_entry(entry_id):
    browser('click', row(entry_id) + ' .task-item')


def no_modal():
    assert evaluate('!document.querySelector(".modal, dialog[open]")'), 'Unexpected modal'


def create_inline(action, name, screenshot=None):
    click(action)
    browser('fill', '#library-name', name)
    assert evaluate('!!document.querySelector(".sidebar #library-name")'), 'Creation belongs in the sidebar'
    no_modal()
    if screenshot:
        browser('screenshot', str(ARTIFACTS / screenshot))
    browser('press', 'Enter')
    wait_for('!document.querySelector("#library-name")')


def point(selector, height_fraction):
    return evaluate(f'''(() => {{
      const r = document.querySelector({json.dumps(selector)}).getBoundingClientRect();
      return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height * {height_fraction})];
    }})()''')


def drag(entry_id, target, height_fraction=.5, *, cancel=False, screenshot=None):
    start = point(row(entry_id) + ' .library-grip', .5)
    browser('mouse', 'move', *map(str, start))
    browser('mouse', 'down')
    try:
        # Cross the activation threshold before measuring the live drop target.
        browser('mouse', 'move', str(start[0] + 12), str(start[1]))
        browser('mouse', 'move', *map(str, point(target, height_fraction)))
        if screenshot:
            browser('screenshot', str(ARTIFACTS / screenshot))
        if cancel:
            browser('press', 'Escape')
    finally:
        browser('mouse', 'up')
    no_modal()


def main():
    if not BROWSER:
        raise SystemExit('Install agent-browser and its browser first.')
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='flowplan-library-') as project:
        def cli(*args):
            return json.loads(run([sys.executable, SCRIPT, *args, '--project', project]).stdout)

        def children(parent):
            siblings = [e for e in cli('library')['entries'] if e.get('parentId') == parent]
            return [e['id'] for e in siblings]

        def wait_saved(parent, *ids):
            deadline = time.monotonic() + 8
            while True:
                actual = children(parent)
                if actual == list(ids):
                    return
                if time.monotonic() >= deadline:
                    raise AssertionError(f'CLI children of {parent}: expected {ids}, got {actual}')
                time.sleep(.1)

        try:
            folder = cli('folder-create', '--name', '发布计划')['id']
            created = cli('create', '--title', '验收演练', '--no-open')
            original = created['task']['id']
            browser('set', 'viewport', '1440', '900')
            browser('open', created['url'])
            open_entry(folder)
            wait_for('document.querySelector(".library-location-name")?.textContent === "发布计划"')
            create_inline('新建文件夹', '归档')
            wait_for(f'{ROW_IDS}.length === 1')
            sub, = evaluate(ROW_IDS)
            wait_saved(folder, sub)
            click('新建流程')
            browser('fill', '#new-title', '验收检查')
            click('创建并打开')
            wait_for('document.querySelector("h1")?.textContent === "验收检查"')
            task = next(t['id'] for t in cli('library')['tasks'] if t['title'] == '验收检查')
            wait_for(f'{ROW_IDS}.length === 2')
            first, second = evaluate(ROW_IDS)
            assert {first, second} == {task, sub}

            # Search includes a task outside the current folder. A grip gesture
            # here must not move it or require a dialog/inline move command.
            browser('fill', SEARCH, '验收')
            hits = sorted([task, original])
            wait_for(f'JSON.stringify({ROW_IDS}.sort()) === JSON.stringify({json.dumps(hits)})')
            before = cli('library')['entries']
            drag(original, row(task), .1)
            browser('focus', SEARCH)
            evaluate('document.activeElement.select()')
            browser('press', 'Backspace')
            wait_rows(first, second)
            assert cli('library')['entries'] == before, 'Dragging a search result changed the library'

            # Start with a real change regardless of where newly created items
            # are inserted. The two gestures exercise opposite row edge zones.
            edge = .9 if first == task else .1
            drag(task, row(sub), edge, cancel=True)
            wait_rows(first, second)
            wait_saved(folder, first, second)
            drag(task, row(sub), edge, screenshot='library-desktop.png')
            wait_rows(second, first)
            wait_saved(folder, second, first)
            drag(task, row(sub), 1 - edge)
            wait_rows(first, second)
            wait_saved(folder, first, second)

            # The center of that same folder row reparents instead of sorting.
            drag(task, row(sub))
            wait_saved(sub, task)
            wait_saved(folder, sub)
            browser('reload')  # Navigation follows the open task's persisted parent.
            wait_rows(task)
            drag(task, PARENT_DROP)
            wait_saved(sub)
            browser('reload')
            wait_for(f'{ROW_IDS}.length === 2 && {ROW_IDS}.includes({json.dumps(task)})')
            first, second = evaluate(ROW_IDS)
            assert {first, second} == {task, sub}
            wait_saved(folder, first, second)
            cli('move', '--id', second, '--parent', folder, '--index', '0')
            wait_rows(second, first)  # CLI changes arrive without a reload.
            assert cli('show', '--task', original) == created['task']

            browser('set', 'viewport', '390', '844')
            click('打开任务导航')
            click('返回上一级文件夹')
            open_entry(folder)
            wait_rows(second, first)
            create_inline('新建文件夹', '移动端验收', screenshot='library-mobile.png')
            wait_for(f'{ROW_IDS}.length === 3')
            mobile = next(e for e in cli('library')['entries'] if e.get('name') == '移动端验收')
            assert mobile['parentId'] == folder
            # A tap/keyboard alternative on the same grip needs no dialog.
            grip = row(mobile['id']) + ' .library-grip'
            browser('focus', grip)
            browser('press', 'Space')
            no_modal()
            click('上移一位')
            wait_saved(folder, second, mobile['id'], first)
            browser('select', '.library-tools select', '/')
            wait_saved(folder, second, first)
            click('返回上一级文件夹')
            open_entry(mobile['id'])
            wait_for('document.querySelector(".library-location-name")?.textContent === "移动端验收"')
            print('Library smoke passed: inline creation, search, drag sorting, reparenting, cancellation, CLI sync and narrow navigation.')
        finally:
            browser('close', check=False)
            run([sys.executable, SCRIPT, 'stop', '--project', project], check=False)


if __name__ == '__main__':
    main()
