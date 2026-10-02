#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Prepare a verified private copy of the ACTIVE DING, without installing a
same-UUID extension (Ubuntu deliberately ignores user overrides of mode extensions).
Only our generated cache is written. DING keeps its original code and licence.
"""
from pathlib import Path
import argparse
import hashlib
import gettext
import locale
import json
import os
import shutil
import tempfile

DOMAIN = 'classic-gadgets'
try:
    messages_locale = locale.setlocale(locale.LC_MESSAGES, '')
except locale.Error:
    messages_locale = 'C'
# Match GLib gettext: C/POSIX (including C.UTF-8) uses source strings even
# when LANGUAGE is set. Do not change DING's process-wide gettext domain.
languages = ['C'] if messages_locale.split('.')[0] in ('C', 'POSIX') else None
_ = gettext.translation(DOMAIN, localedir=Path(__file__).resolve().parents[1] / 'locale', languages=languages, fallback=True).gettext

UUID = 'ding@rastersoft.com'
BEGIN = '        // BEGIN classic-gadgets desktop menu integration'
END = '        // END classic-gadgets desktop menu integration'
SNIPPET = '''
        // BEGIN classic-gadgets desktop menu integration
        const classicGadgetsItem = new Gtk.MenuItem({label: @ADD_WIDGETS@});
        classicGadgetsItem.connect('activate', () => {
            Gio.DBus.session.call('org.gnome.Shell', '/org/gnome/Shell/Extensions/ClassicGadgets',
                'org.gnome.Shell.Extensions.ClassicGadgets', 'ShowGallery', null, null,
                Gio.DBusCallFlags.NONE, 5000, null, (bus, result) => {
                    try { bus.call_finish(result); }
                    catch (error) { logError(error, @ENABLE_WIDGETS@); }
                });
        });
        this._menu.add(classicGadgetsItem);
        // END classic-gadgets desktop menu integration
'''.replace('@ADD_WIDGETS@', json.dumps(_('Add Widgets…'), ensure_ascii=False)).replace(
    '@ENABLE_WIDGETS@', json.dumps(_('Enable Windows Vista/7 Widgets first'), ensure_ascii=False))


def patch_text(text):
    if BEGIN in text:
        if text.count(BEGIN) != 1 or text.count(END) != 1:
            raise ValueError(_('DING menu markers are incomplete; nothing was changed'))
        start = text.index(BEGIN)
        stop = text.index(END, start) + len(END)
        return text[:start] + SNIPPET.strip('\n') + text[stop:]
    anchor = '        this._menu.add(newFolder);'
    if text.count(anchor) != 1 or '_createDesktopBackgroundMenu()' not in text or 'new Gtk.MenuItem' not in text:
        raise ValueError(_('This DING menu structure is not supported; the desktop menu was not changed'))
    return text.replace(anchor, anchor + '\n' + SNIPPET, 1)


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(source, cache):
    source, cache = Path(source).resolve(), Path(cache)
    metadata = source / 'metadata.json'
    if not metadata.is_file() or json.loads(metadata.read_text()).get('uuid') != UUID:
        raise ValueError(_('Not a valid DING extension directory'))
    menu = source / 'app/desktopManager.js'
    patched = patch_text(menu.read_text())
    files = sorted(p for p in source.rglob('*') if p.is_file() and not any(part in ['.git', '__pycache__'] for part in p.relative_to(source).parts))
    original = {str(p.relative_to(source)): file_hash(p) for p in files}
    original['app/desktopManager.js'] = hashlib.sha256(patched.encode()).hexdigest()
    identity = hashlib.sha256((str(source) + json.dumps(original, sort_keys=True)).encode()).hexdigest()
    root = cache / identity
    record = {'source': str(source), 'root': str(root), 'sha256': identity, 'files': original, 'format': 1}
    manifest = root / '.classic-gadgets-menu.json'
    if manifest.is_file() and json.loads(manifest.read_text()) == record:
        if all((root / name).is_file() and file_hash(root / name) == digest for name, digest in original.items()):
            return record
        # Do not launch a damaged cache; a new private staging copy repairs it.
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.exists():
        # Keep unexpected modifications instead of deleting an unknown directory.
        preserved = Path(tempfile.mkdtemp(prefix='replaced-', dir=cache)) / 'previous'
        root.rename(preserved)
    staging = Path(tempfile.mkdtemp(prefix='.prepare-', dir=cache))
    try:
        for src in files:
            dest = staging / src.relative_to(source)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
        (staging / 'app/desktopManager.js').write_text(patched)
        (staging / '.classic-gadgets-menu.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
        staging.rename(root)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--cache', default=str(Path(os.environ.get('XDG_CACHE_HOME', Path.home() / '.cache')) / 'classic-desktop-gadgets/desktop-menu'))
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.source, args.cache), ensure_ascii=False))
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))


if __name__ == '__main__':
    main()
