# SPDX-License-Identifier: MIT
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
import json
import sys
import hashlib
import subprocess

os.environ['LANGUAGE'] = 'zh_CN'
os.environ['LC_ALL'] = 'zh_CN.UTF-8'
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
module = load('desktop_prepare', ROOT / 'extension/helpers/desktop-menu-prepare.py')
legacy = load('legacy', ROOT / 'scripts/patch-ding-menu.py')
SOURCE = Path('/usr/share/gnome-shell/extensions/ding@rastersoft.com')

class DesktopMenuTest(unittest.TestCase):
    def test_current_system_copy_is_only_patched_in_private_cache(self):
        menu = SOURCE / 'app/desktopManager.js'; before = menu.read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            record = module.prepare(SOURCE, Path(directory) / 'cache')
            target = Path(record['root']); after = (target / 'app/desktopManager.js').read_text()
            self.assertEqual(after.count(module.BEGIN), 1)
            self.assertIn('添加小组件…', after)
            self.assertIn("'ShowGallery'", after)
            self.assertEqual(after.replace('\n' + module.SNIPPET, ''), before.decode())
            subprocess.run(['node', '--check', str(target / 'app/desktopManager.js')], check=True)
            self.assertEqual(module.prepare(SOURCE, Path(directory) / 'cache'), record)
            self.assertEqual(menu.read_bytes(), before)
            for name, digest in record['files'].items():
                self.assertEqual(hashlib.sha256((target/name).read_bytes()).hexdigest(), digest)
    def test_unknown_menu_version_is_not_modified(self):
        with self.assertRaises(ValueError): module.patch_text('an unrelated future menu')
    def test_old_patch_is_updated_without_duplicate_entry(self):
        old = module.patch_text((SOURCE / 'app/desktopManager.js').read_text())
        after = module.patch_text(old.replace('添加小组件…', '添加小工具…'))
        self.assertEqual(after.count(module.BEGIN), 1)
        self.assertIn('添加小组件…', after)
        self.assertEqual(module.patch_text(after), after)
    def test_damaged_cache_is_preserved_and_repaired(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / 'cache'; result = module.prepare(SOURCE, cache)
            menu = Path(result['root'])/'app/desktopManager.js'; menu.write_text('changed by user')
            repaired = module.prepare(SOURCE, cache)
            self.assertEqual(result, repaired)
            self.assertIn('添加小组件', menu.read_text())
            backups = list(cache.glob('replaced-*/previous/app/desktopManager.js'))
            self.assertEqual(len(backups), 1); self.assertEqual(backups[0].read_text(), 'changed by user')
    def test_obsolete_installed_override_is_archived_and_backup_restored(self):
        with tempfile.TemporaryDirectory() as directory:
            data, state = Path(directory)/'data', Path(directory)/'state'
            target = data/'gnome-shell/extensions'/module.UUID; (target/'app').mkdir(parents=True)
            (target/'app/desktopManager.js').write_text('old patch')
            (target/'user-note').write_text('keep me')
            backup = state/'old-backup'/module.UUID; backup.mkdir(parents=True)
            (backup/'personal-content').write_text('previous user extension')
            record = state/'classic-desktop-gadgets/ding-menu.json';record.parent.mkdir(parents=True)
            record.write_text(json.dumps({'target':str(target),'patched_sha256':legacy.digest(target/'app/desktopManager.js'),'backup':str(backup)}))
            legacy.remove(data,state)
            self.assertEqual((target/'personal-content').read_text(),'previous user extension')
            archived = list(state.glob('classic-desktop-gadgets/backups/removed-ding-*/ding@rastersoft.com/user-note'))
            self.assertEqual(archived[0].read_text(),'keep me')
            self.assertFalse(record.exists())

if __name__ == '__main__': unittest.main()
