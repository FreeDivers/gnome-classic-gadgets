#!/usr/bin/env python3
"""Verify user-local install/upgrade/uninstall in temporary XDG directories."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
UUID = 'classic-gadgets@FreeDivers.github.io'
checks = []

def check(condition, name):
    if not condition:
        raise AssertionError(name)
    checks.append(name)
    print('PASS:', name)

with tempfile.TemporaryDirectory(prefix='install-check-', dir=ROOT / 'build') as temporary:
    base = Path(temporary)
    env = os.environ.copy()
    env.update({
        'XDG_DATA_HOME': str(base / 'data'),
        'XDG_STATE_HOME': str(base / 'state'),
        'XDG_CONFIG_HOME': str(base / 'config'),
        'DBUS_SESSION_BUS_ADDRESS': 'unix:path=/nonexistent-classic-gadgets-test',
    })
    target = base / 'data/gnome-shell/extensions' / UUID
    for attempt in range(2):
        subprocess.run(['python3', str(ROOT / 'scripts/install.py'), '--no-enable'], env=env, cwd=ROOT, check=True)
        for path in (ROOT / 'extension').rglob('*'):
            if path.is_file() and not path.is_symlink() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                check_path = target / path.relative_to(ROOT / 'extension')
                assert check_path.read_bytes() == path.read_bytes(), check_path
        check(True, 'new user-local install byte matches source' if attempt == 0 else 'reinstall byte matches source')
    check((target / 'locale/zh_CN/LC_MESSAGES/classic-gadgets.mo').is_file(), 'compiled Simplified Chinese catalog installed')
    check(json.loads((target / 'metadata.json').read_text())['gettext-domain'] == 'classic-gadgets', 'installed gettext domain matches the catalog')
    check(len(list((base / 'state/classic-desktop-gadgets/backups').glob('*/' + UUID))) == 1, 'prior installation backed up')
    check(not (target / 'lib/drawing.js').exists() and not (target / 'lib/widgets.js').exists(), 'rejected design excluded')
    private = base / 'config/private-data'
    private.parent.mkdir(parents=True)
    private.write_text('keep my notes')
    subprocess.run(['python3', str(ROOT / 'scripts/uninstall.py')], env=env, cwd=ROOT, check=True)
    check(not target.exists(), 'uninstall removes only extension files')
    check(private.read_text() == 'keep my notes', 'personal config preserved')

bundle = ROOT / 'dist' / (UUID + '.shell-extension.zip')
with zipfile.ZipFile(bundle) as archive:
    check(archive.testzip() is None, 'ZIP CRC verified')
    check(not any('__pycache__' in name or name.endswith('.pyc') for name in archive.namelist()), 'Python bytecode excluded from the bundle')
    check('locale/zh_CN/LC_MESSAGES/classic-gadgets.mo' in archive.namelist(), 'compiled gettext catalog included in ZIP')
    manifest = json.loads((ROOT / 'extension/assets/original-assets.json').read_text())
    for entry in manifest['files']:
        data = archive.read('assets/original/' + entry['path'])
        assert hashlib.sha256(data).hexdigest() == entry['sha256']
    check(True, 'all original images retain source hashes inside ZIP')
    check('ASSET-NOTICE.md' in archive.namelist() and 'LICENSE' in archive.namelist(), 'separate licensing notices included')
record = {'ok': True, 'checks': checks, 'bundle_sha256': hashlib.sha256(bundle.read_bytes()).hexdigest()}
(ROOT / 'build/install-verification.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
