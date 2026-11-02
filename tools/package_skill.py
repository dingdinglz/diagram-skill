#!/usr/bin/env python3
"""Build-time packaging only. Release users need neither npm nor node_modules."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / 'skills' / 'diagram-plan'


def third_party_notices():
    packages = subprocess.check_output(
        ['npm', 'ls', '--omit=dev', '--parseable', '--all'], cwd=str(ROOT), universal_newlines=True
    ).splitlines()
    sections = ['# Third-party notices\n\nBundled JavaScript dependencies, their transitive dependencies, and application-adapted source. '
                'Original project code is covered by the accompanying LICENSE. Third-party code retains its own licenses, reproduced below.\n']
    missing = []
    for path in sorted(set(packages)):
        directory = Path(path)
        if directory == ROOT or not (directory / 'package.json').is_file():
            continue
        metadata = json.loads((directory / 'package.json').read_text(encoding='utf-8'))
        licenses = sorted(p for p in directory.iterdir() if p.is_file() and
                          (p.name.lower().startswith('license') or p.name.lower().startswith('licence') or
                           p.name.lower().startswith('copying') or p.name.lower().startswith('notice')))
        heading = '{}@{}'.format(metadata['name'], metadata.get('version', '?'))
        sections.append('\n## {}\n\nDeclared license: `{}`\n'.format(heading, metadata.get('license', 'See package license')))
        if not licenses:
            missing.append(heading)
            continue
        for license_file in licenses:
            sections.append('\n### {}\n\n```text\n{}\n```\n'.format(license_file.name, license_file.read_text(encoding='utf-8', errors='replace').strip()))
    if missing:
        raise SystemExit('Missing license texts; resolve before distributing: ' + ', '.join(missing))
    # Application-adapted source is not an npm dependency; keep its license in
    # generated notices as well as the release archive's licenses directory.
    for license_file in sorted((SKILL / 'licenses').glob('*LICENSE*')):
        sections.append('\n## Application-adapted source: {}\n\n{}\n'.format(
            license_file.name, license_file.read_text(encoding='utf-8').strip()))
    (SKILL / 'THIRD_PARTY_NOTICES.md').write_text('\n'.join(sections), encoding='utf-8')


def main():
    required = ['SKILL.md', 'scripts/diagram.py', 'references/graph-schema.md', 'web/index.html']
    for relative in required:
        if not (SKILL / relative).is_file():
            raise SystemExit('Missing {}. Run npm run build first.'.format(relative))
    license_file = ROOT / 'LICENSE'
    if not license_file.is_file():
        raise SystemExit('Missing project LICENSE; cannot package the skill.')
    (SKILL / 'LICENSE').write_bytes(license_file.read_bytes())
    third_party_notices()
    version = json.loads((ROOT / 'package.json').read_text())['version']
    output = ROOT / 'release'
    output.mkdir(exist_ok=True)
    archive = output / ('diagram-plan-' + version + '.zip')
    with zipfile.ZipFile(str(archive), 'w', zipfile.ZIP_DEFLATED) as result:
        for path in sorted(SKILL.rglob('*')):
            relative = path.relative_to(SKILL)
            if path.is_symlink():
                raise SystemExit('Refusing symlink in release: ' + str(relative))
            if not path.is_file() or '__pycache__' in relative.parts or path.suffix == '.pyc' or path.name == '.DS_Store':
                continue
            result.write(str(path), str(Path('diagram-plan') / relative))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / (archive.name + '.sha256')).write_text(digest + '  ' + archive.name + '\n', encoding='utf-8')
    print(json.dumps({'archive': str(archive), 'sha256': digest, 'bytes': archive.stat().st_size}, indent=2))


if __name__ == '__main__':
    main()
