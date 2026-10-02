# SPDX-License-Identifier: MIT
"""Exercise UUID migration without touching the user's GNOME session or files."""
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('installer', ROOT / 'scripts/install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
sys.path.pop(0)


class UUIDMigrationTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='gadget-uuid-')
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.parent = self.base / 'data/gnome-shell/extensions'
        self.target = self.parent / installer.UUID
        self.legacy = self.parent / installer.LEGACY_UUID
        self.state = self.base / 'state'
        self.private = self.base / 'config/private-data'
        self.private.parent.mkdir()
        self.private.write_text('keep notes, contacts and layout')
        self.bundle = self.base / 'extension.zip'
        with zipfile.ZipFile(self.bundle, 'w') as archive:
            archive.writestr('metadata.json', json.dumps({'uuid': installer.UUID}))
            archive.writestr('extension.js', '// new version\n')

    def seed(self, target, uuid):
        target.mkdir(parents=True)
        (target / 'metadata.json').write_text(json.dumps({'uuid': uuid}))
        (target / 'user-note').write_text('keep this installation')

    def install(self, *args, disable_fails=False):
        self.commands = []

        def run(command, **kwargs):
            self.commands.append(command)
            code = 1 if disable_fails and command[:2] == ['gnome-extensions', 'disable'] else 0
            return subprocess.CompletedProcess(command, code, '', '')

        with patch.dict(os.environ, {
            'XDG_DATA_HOME': str(self.base / 'data'),
            'XDG_STATE_HOME': str(self.state),
            'XDG_CONFIG_HOME': str(self.base / 'config'),
        }), patch.object(sys, 'argv', ['install.py', *args]), \
                patch.object(installer.os, 'geteuid', return_value=1000), \
                patch.object(installer, 'build', return_value=self.bundle), \
                patch.object(installer.subprocess, 'check_output', return_value='GNOME Shell 50.1'), \
                patch.object(installer.subprocess, 'run', side_effect=run), \
                redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            installer.main()

    def assert_preserved(self):
        self.assertEqual(self.private.read_text(), 'keep notes, contacts and layout')
        self.assertFalse(list(self.parent.glob('.classic-gadgets-*')))

    def test_offline_migration_archives_old_directory_without_changing_enablement(self):
        self.seed(self.legacy, installer.LEGACY_UUID)
        self.install('--no-enable')
        self.assertFalse(self.legacy.exists())
        self.assertEqual(json.loads((self.target / 'metadata.json').read_text())['uuid'], installer.UUID)
        backups = list(self.state.glob(f'classic-desktop-gadgets/backups/*/{installer.LEGACY_UUID}/user-note'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), 'keep this installation')
        self.assertEqual(self.commands, [])
        self.assert_preserved()

    def test_online_migration_disables_old_uuid_before_enabling_new_uuid(self):
        self.seed(self.legacy, installer.LEGACY_UUID)
        self.install()
        self.assertEqual(self.commands, [
            ['gnome-extensions', 'disable', installer.LEGACY_UUID],
            ['gnome-extensions', 'enable', installer.UUID],
        ])
        self.assertFalse(self.legacy.exists())
        self.assert_preserved()

    def test_both_installed_versions_are_backed_up(self):
        self.seed(self.legacy, installer.LEGACY_UUID)
        self.seed(self.target, installer.UUID)
        self.install('--no-enable')
        backups = list(self.state.glob('classic-desktop-gadgets/backups/*/*/user-note'))
        self.assertEqual({path.parent.name for path in backups}, {installer.UUID, installer.LEGACY_UUID})
        self.assert_preserved()

    def test_disable_failure_does_not_move_or_replace_files(self):
        self.seed(self.legacy, installer.LEGACY_UUID)
        self.seed(self.target, installer.UUID)
        with self.assertRaisesRegex(SystemExit, '无法禁用旧 UUID'):
            self.install(disable_fails=True)
        self.assertTrue((self.legacy / 'user-note').is_file())
        self.assertTrue((self.target / 'user-note').is_file())
        self.assertEqual(self.commands, [['gnome-extensions', 'disable', installer.LEGACY_UUID]])
        self.assert_preserved()

    def test_unrelated_legacy_directory_is_not_moved(self):
        self.seed(self.legacy, 'another-extension@example.com')
        with self.assertRaisesRegex(SystemExit, '不是本扩展'):
            self.install('--no-enable')
        self.assertTrue((self.legacy / 'user-note').is_file())
        self.assertFalse(self.target.exists())
        self.assert_preserved()

    def test_legacy_symlink_is_not_followed(self):
        outside = self.base / 'outside'
        self.seed(outside, installer.LEGACY_UUID)
        self.parent.mkdir(parents=True)
        self.legacy.symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(SystemExit, '符号链接'):
            self.install('--no-enable')
        self.assertTrue(self.legacy.is_symlink())
        self.assertTrue((outside / 'user-note').is_file())
        self.assertFalse(self.target.exists())
        self.assert_preserved()

    def test_failed_install_restores_both_directories_without_enabling_either_uuid(self):
        self.seed(self.legacy, installer.LEGACY_UUID)
        self.seed(self.target, installer.UUID)
        with patch.object(Path, 'rename', side_effect=OSError('simulated install failure')):
            with self.assertRaisesRegex(OSError, 'simulated install failure'):
                self.install()
        self.assertTrue((self.legacy / 'user-note').is_file())
        self.assertTrue((self.target / 'user-note').is_file())
        self.assertEqual(self.commands, [['gnome-extensions', 'disable', installer.LEGACY_UUID]])
        self.assert_preserved()

    def test_clean_install_never_calls_legacy_uuid(self):
        self.install()
        self.assertEqual(self.commands, [['gnome-extensions', 'enable', installer.UUID]])
        self.assert_preserved()


if __name__ == '__main__':
    unittest.main()
