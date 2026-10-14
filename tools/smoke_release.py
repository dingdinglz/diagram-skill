#!/usr/bin/env python3
"""Verify the distributable starts with no Node/npm on PATH, using only stdlib."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    version = json.loads((ROOT / 'package.json').read_text())['version']
    archive = ROOT / 'release' / ('diagram-plan-' + version + '.zip')
    if not archive.is_file():
        raise SystemExit('Run npm run release first.')
    with tempfile.TemporaryDirectory(prefix='diagram-release-') as folder:
        base = Path(folder)
        with zipfile.ZipFile(str(archive)) as bundle:
            names = bundle.namelist()
            assert not any('__pycache__' in name or 'node_modules' in name or '.diagram-skill/' in name for name in names)
            bundle.extractall(str(base))
        skill = base / 'diagram-plan'
        assert (skill / 'LICENSE').read_bytes() == (ROOT / 'LICENSE').read_bytes(), 'Release license must match the project license'
        project = base / 'workspace'
        project.mkdir()
        script = skill / 'scripts/diagram.py'
        environment = dict(os.environ, PATH=str(base / 'empty-path'))
        (base / 'empty-path').mkdir()

        def cli(*args):
            result = subprocess.run([sys.executable, str(script), *args, '--project', str(project)],
                                    env=environment, text=True, capture_output=True, timeout=20)
            if result.returncode:
                raise AssertionError(result.stderr)
            return json.loads(result.stdout)

        try:
            created = cli('create', '--title', '无 Node 的发布包验收', '--no-open')
            url = created['url'].split('#')[0]
            with urllib.request.urlopen(url, timeout=5) as response:
                html = response.read().decode('utf-8')
            assets = re.findall(r'(?:src|href)="(\./assets/[^\"]+)"', html)
            assert len(assets) >= 2, 'Missing prebuilt JS/CSS'
            for asset in assets:
                with urllib.request.urlopen(url + asset[2:], timeout=5) as response:
                    assert response.status == 200 and len(response.read()) > 100
            state = cli('show', '--task', created['task']['id'])
            assert state['status'] == 'draft' and state['graph']['nodes'] == []
            assert (skill / 'THIRD_PARTY_NOTICES.md').stat().st_size > 1000
            cli('stop')
            restarted = cli('start', '--no-open')
            assert restarted['port'] > 0
            assert cli('show', '--task', state['id'])['graph'] == state['graph']
            print('PASS: extracted skill starts, serves bundled assets, preserves state and restarts with an empty PATH (no Node/npm).')
        finally:
            cli('stop')


if __name__ == '__main__':
    main()
