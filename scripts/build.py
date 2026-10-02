#!/usr/bin/env python3
"""Build a local GNOME extension bundle; original and fluent assets keep their own rights."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent

def build():
    subprocess.run([sys.executable, str(ROOT / 'scripts/check.py')], check=True)
    subprocess.run([sys.executable, str(ROOT / 'scripts/i18n.py'), 'compile'], check=True)
    source = ROOT / 'extension'
    subprocess.run(['glib-compile-schemas', '--strict', str(source / 'schemas')], check=True)
    metadata = json.loads((source / 'metadata.json').read_text())
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    target = dist / f"{metadata['uuid']}.shell-extension.zip"
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(source.rglob('*')):
            if not path.is_file() or path.is_symlink() or '__pycache__' in path.parts or path.suffix == '.pyc':
                continue
            info = zipfile.ZipInfo(path.relative_to(source).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
        for name in ['LICENSE', 'ASSET-NOTICE.md']:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (ROOT / name).read_bytes())
    with zipfile.ZipFile(target) as archive:
        names = archive.namelist()
        assert archive.testzip() is None
        assert 'metadata.json' in names
        assert 'schemas/gschemas.compiled' in names
        assert 'locale/zh_CN/LC_MESSAGES/classic-gadgets.mo' in names
        assert 'lib/i18n.js' in names and 'lib/i18n-runtime.js' in names
        # The split framework ships completely: base class, per-gadget modules, runtime stylesheets, helpers.
        for required in ['helpers/gadget-gallery.js', 'helpers/gallery-window.js', 'helpers/gallery-drop-target.js', 'helpers/desktop-menu-prepare.py', 'lib/ui/desktop-menu.js', 'lib/gadget.js', 'lib/original-widgets.js', 'lib/theme.js', 'lib/dbus.js', 'lib/ui/ui.css', 'lib/gadgets/clock.js', 'assets/original-assets.json']:
            assert required in names, f'{required} missing from the bundle'
        if (source / 'assets/fluent-assets.json').exists():
            assert 'assets/fluent-assets.json' in names and any(name.startswith('assets/fluent/') for name in names), 'fluent import missing from the bundle'
        if (source / 'helpers').is_dir():
            assert any(name.startswith('helpers/') for name in names), 'helpers/ missing from the bundle'
        assert not any(name.startswith(('tests/', 'upstream/', 'build/')) or '..' in Path(name).parts for name in names)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix(target.suffix + '.sha256').write_text(f'{digest}  {target.name}\n')
    print(f'本机安装包：{target}\n原版与 Fluent 皮肤不适用 MIT；请参阅 ASSET-NOTICE.md。')
    return target

if __name__ == '__main__':
    build()
