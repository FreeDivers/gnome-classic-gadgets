# SPDX-License-Identifier: MIT
import gettext
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('catalogs', ROOT / 'scripts/i18n.py')
catalogs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalogs)


class CatalogTests(unittest.TestCase):
    def modified_catalog(self, original, replacement):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        folder = Path(directory.name)
        text = (ROOT / 'po/zh_CN.po').read_text()
        self.assertIn(original, text)
        (folder / 'zh_CN.po').write_text(text.replace(original, replacement, 1))
        return patch.object(catalogs, 'PO_DIR', folder)

    def test_missing_placeholder_is_rejected(self):
        with self.modified_catalog('msgstr "请输入 {min} 到 {max} 之间的数字"', 'msgstr "请输入 {max} 以内的数字"'):
            with self.assertRaisesRegex(ValueError, 'placeholders'):
                catalogs.validate(catalogs.POT)

    def test_placeholders_can_be_reordered(self):
        with self.modified_catalog('msgstr "{field}：{error}"', 'msgstr "{error}（{field}）"'):
            self.assertGreater(catalogs.validate(catalogs.POT), 500)

    def test_fuzzy_translation_is_rejected(self):
        with self.modified_catalog('msgid "Find my location"', '#, fuzzy\nmsgid "Find my location"'):
            with self.assertRaisesRegex(ValueError, 'fuzzy translation'):
                catalogs.validate(catalogs.POT)

    def test_empty_translation_is_rejected(self):
        with self.modified_catalog('msgstr "定位当前位置"', 'msgstr ""'):
            with self.assertRaisesRegex(ValueError, 'untranslated message'):
                catalogs.validate(catalogs.POT)

    def test_incorrect_language_header_is_rejected(self):
        with self.modified_catalog('Language: zh_CN', 'Language: ja'):
            with self.assertRaisesRegex(ValueError, 'Language header'):
                catalogs.validate(catalogs.POT)

    def test_bad_plural_header_is_rejected_by_msgfmt(self):
        with self.modified_catalog('nplurals=1; plural=0;', 'nplurals=2; plural=(n != 1);'):
            with self.assertRaises(subprocess.CalledProcessError):
                catalogs.validate(catalogs.POT)

    def test_only_protocol_location_data_remains_in_chinese_js_literals(self):
        files = [str(p.relative_to(ROOT)) for p in sorted((ROOT / 'extension').rglob('*.js')) if 'assets' not in p.parts]
        with tempfile.TemporaryDirectory() as directory:
            pot = Path(directory) / 'all.pot'
            catalogs.run('xgettext', '--language=JavaScript', '--from-code=UTF-8', '--extract-all', '--no-wrap', '-o', str(pot), *files)
            chinese = {message for _context, message in catalogs.messages(pot) if any('\u3400' <= ch <= '\u9fff' for ch in message)}
        # These are the original stored city and CMA's missing-country fallback,
        # not UI labels. Chinese regexes/province keys parse external API data.
        self.assertEqual(chinese, {'上海', '中国'})

    def test_update_and_compile_preserve_a_user_translation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts').mkdir()
            shutil.copy2(ROOT / 'scripts/i18n.py', root / 'scripts/i18n.py')
            shutil.copy2(ROOT / 'package.json', root / 'package.json')
            shutil.copytree(ROOT / 'extension', root / 'extension', ignore=shutil.ignore_patterns('assets', 'locale', '__pycache__'))
            shutil.copytree(ROOT / 'po', root / 'po')
            po = root / 'po/zh_CN.po'
            po.write_text(po.read_text().replace('msgstr "定位当前位置"', 'msgstr "我的定位按钮"'))
            for command in ('update', 'compile'):
                subprocess.run(['python3', str(root / 'scripts/i18n.py'), command], cwd=root, check=True, capture_output=True)
            with (root / 'extension/locale/zh_CN/LC_MESSAGES/classic-gadgets.mo').open('rb') as stream:
                translated = gettext.GNUTranslations(stream)
            self.assertEqual(translated.gettext('Find my location'), '我的定位按钮')
            self.assertIn('msgstr "我的定位按钮"', po.read_text())

    def test_ding_entry_uses_our_catalog_without_changing_ding_domain(self):
        program = '''import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('menu',sys.argv[1]); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
print(json.dumps(m.SNIPPET))'''
        snippets = []
        for language, expected in [('zh_CN', '添加小组件…'), ('en', 'Add Widgets…')]:
            env = {**os.environ, 'LC_ALL': 'zh_CN.UTF-8' if language == 'zh_CN' else 'C.UTF-8', 'LANGUAGE': language}
            output = subprocess.check_output(['python3', '-B', '-c', program, str(ROOT / 'extension/helpers/desktop-menu-prepare.py')], env=env, text=True)
            snippet = json.loads(output)
            self.assertIn(expected, snippet)
            self.assertIn('请先启用 Windows Vista/7 小组件扩展' if language == 'zh_CN' else 'Enable Windows Vista/7 Widgets first', snippet)
            self.assertNotIn('textdomain', snippet)
            snippets.append(snippet)
        self.assertNotEqual(*snippets)


if __name__ == '__main__':
    unittest.main()
