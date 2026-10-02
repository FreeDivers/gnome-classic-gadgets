#!/usr/bin/env python3
"""Validate adapter source, original/fluent resources and schemas without running Windows code."""
from pathlib import Path
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / 'extension'

# 1. Every JavaScript module parses: extension.js, prefs.js, lib/**, lib/ui, lib/gadgets, helpers/**.
modules = sorted(EXT.rglob('*.js'))
for path in modules:
    subprocess.run(['node', '--check', str(path)], check=True)

# GTK belongs only in a client helper (or the full preferences process), never Shell.
for module in [EXT / 'extension.js', *sorted((EXT / 'lib').rglob('*.js'))]:
    assert 'gi://Gtk' not in module.read_text() and 'gi://Adw' not in module.read_text(), f'GTK imported into Shell: {module}'
for helper in ['gadget-options.js', 'options-window.js', 'gadget-gallery.js', 'gallery-window.js', 'gallery-drop-target.js', 'desktop-menu-prepare.py']:
    assert (EXT / 'helpers' / helper).is_file(), f'missing native GTK options helper: {helper}'

assert 'new St.' not in (EXT / 'lib/ui/gallery.js').read_text(), 'Gallery must be a real GTK client, not Shell actors'
assert 'new Adw.Window' in (EXT / 'helpers/gallery-window.js').read_text()

# 2. GSettings schema (strict) including the theme key and its two choices.
subprocess.run(['glib-compile-schemas', '--strict', '--dry-run', str(EXT / 'schemas')], check=True)
schema = (EXT / 'schemas/org.gnome.shell.extensions.classic-gadgets.gschema.xml').read_text()
assert '<key name="theme" type="s">' in schema and '<choice value="classic"/>' in schema and '<choice value="fluent"/>' in schema, 'theme key missing'

# Gettext sources/catalogs must agree, including named placeholders and plurals.
subprocess.run([sys.executable, str(ROOT / 'scripts/i18n.py'), 'check'], check=True)

# 3. Asset manifests: the originals always, the Rectify11 (fluent) import when present.
subprocess.run([sys.executable, str(ROOT / 'scripts/import-original-assets.py'), '--check'], check=True)
fluent_manifest = EXT / 'assets/fluent-assets.json'
if fluent_manifest.exists():
    subprocess.run([sys.executable, str(ROOT / 'scripts/import-fluent-assets.py'), '--check'], check=True)
else:
    print('NOTE: no fluent import (assets/fluent-assets.json missing); the Fluent theme falls back to the original skins')

# 4. Static image references in lib/gadgets/<type>.js exist in that gadget's original or fluent folder.
#    The type → folder map is the FOLDERS table exported by lib/gadget.js.
gadget_source = (EXT / 'lib/gadget.js').read_text()
folders_source = re.search(r'export const FOLDERS = Object\.freeze\(\{([^}]*)\}\)', gadget_source).group(1)
folders = dict(re.findall(r"(\w+):\s*'([^']+)'", folders_source))
assert len(folders) == 14, folders
image_pattern = re.compile(r'''['"]((?:images|Images|View\d|assets)/[^'"`]+\.(?:png|gif|jpg))['"]''')
references = 0
for module in sorted((EXT / 'lib/gadgets').glob('*.js')):
    gadget_type = module.stem
    text = module.read_text()
    if gadget_type not in folders:
        assert not image_pattern.search(text), f'{module.name}: image reference outside a gadget module'
        continue
    folder = folders[gadget_type] + '.Gadget'
    for path in sorted(set(image_pattern.findall(text))):
        original = EXT / 'assets/original' / folder / path
        fluent = EXT / 'assets/fluent' / folder / path
        assert original.is_file() or fluent.is_file(), (gadget_type, path)
        references += 1
assert references > 0, 'no static image references found'
for gadget_type in folders:
    assert (EXT / 'lib/gadgets' / f'{gadget_type}.js').is_file(), f'missing lib/gadgets/{gadget_type}.js'

# 5. Pure modules stay pure: node:test imports lib/core.js and lib/logic/* without GI.
for module in [EXT / 'lib/core.js', EXT / 'lib/network-sources.js', EXT / 'lib/i18n.js', *sorted((EXT / 'lib/logic').glob('*.js'))]:
    text = module.read_text()
    assert 'gi://' not in text and 'resource://' not in text, f'{module.relative_to(ROOT)} must not import GI or Shell modules'

# 6. The rejected redesign stays out; metadata and the module index are intact.
css = (EXT / 'stylesheet.css').read_text()
assert 'cg-widget' not in css, 'Rejected card design still present'
assert not (EXT / 'lib/drawing.js').exists(), 'Rejected procedural skins still ship'
assert not (EXT / 'lib/widgets.js').exists(), 'Rejected card renderer still ships'
metadata = json.loads((EXT / 'metadata.json').read_text())
assert metadata['shell-version'] == ['50']
assert "from './lib/original-widgets.js'" in (EXT / 'extension.js').read_text()
print(f'PASS: {len(modules)} JavaScript modules, GSettings schema, asset manifests, {references} static image references, pure logic modules, original-only renderer')
