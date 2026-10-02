#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Extract, validate and compile the extension's gettext catalogs."""
from pathlib import Path
import argparse
import ast
import gettext
import json
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DOMAIN = 'classic-gadgets'
PO_DIR = ROOT / 'po'
POT = PO_DIR / f'{DOMAIN}.pot'
PLACEHOLDER = re.compile(r'\{([A-Za-z][A-Za-z0-9_]*)\}')


def run(*args):
    return subprocess.run(args, cwd=ROOT, check=True, text=True, capture_output=True)


def read_po(path):
    """Read the msgid/context/plural fields and flags of a GNU PO file."""
    entries, entry, field = [], {}, None
    for line in path.read_text(encoding='utf-8').splitlines() + ['']:
        if not line.strip():
            if 'msgid' in entry:
                entries.append(entry)
            entry, field = {}, None
        elif line.startswith('#,'):
            entry.setdefault('flags', set()).update(flag.strip() for flag in line[2:].split(','))
        elif line.startswith('#'):
            continue
        elif line.startswith('"') and field:
            entry[field] += ast.literal_eval(line)
        else:
            match = re.fullmatch(r'(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+(".*")', line)
            if not match:
                raise ValueError(f'{path}: invalid PO line: {line}')
            field, value = match.groups()
            entry[field] = ast.literal_eval(value)
    return entries


def messages(path):
    return {(entry.get('msgctxt'), entry['msgid']): entry for entry in read_po(path) if entry['msgid']}


def extract(target):
    js = [str(path.relative_to(ROOT)) for path in sorted((ROOT / 'extension').rglob('*.js'))
          if 'assets' not in path.relative_to(ROOT / 'extension').parts]
    package = json.loads((ROOT / 'package.json').read_text())
    common = ['--from-code=UTF-8', '--add-comments=Translators:', '--no-wrap', '--sort-output',
              '--keyword', '--keyword=_', '--keyword=N_', '--keyword=ngettext:1,2', '--keyword=pgettext:1c,2',
              f'--package-name={package["name"]}', f'--package-version={package["version"]}',
              '--copyright-holder=Windows Vista/7 Widgets contributors', '--msgid-bugs-address=']
    with tempfile.TemporaryDirectory() as directory:
        first, second = Path(directory) / 'js.pot', Path(directory) / 'py.pot'
        run('xgettext', *common, '--language=JavaScript', '-o', str(first), *js)
        run('xgettext', *common, '--language=Python', '-o', str(second), 'extension/helpers/desktop-menu-prepare.py')
        run('msgcat', '--use-first', '--sort-output', '--no-wrap', '-o', str(target), str(first), str(second))
    # Omit extraction timestamps so a no-op update has no diff.
    text = target.read_text(encoding='utf-8')
    text = re.sub(r'^"POT-Creation-Date: .*\\n"\n', '', text, flags=re.M)
    target.write_text(text, encoding='utf-8')


def catalogs():
    return sorted(PO_DIR.glob('*.po'))


def update():
    PO_DIR.mkdir(exist_ok=True)
    extract(POT)
    for catalog in catalogs():
        run('msgmerge', '--update', '--backup=none', '--no-fuzzy-matching', '--no-wrap', '--sort-output', str(catalog), str(POT))
    print(f'Updated {POT.relative_to(ROOT)} and {len(catalogs())} catalog(s).')


def validate(template):
    expected = messages(template)
    if not expected:
        raise ValueError('No translatable messages found')
    if not catalogs():
        raise ValueError('No translation catalogs found')
    if 'zh_CN.po' not in {p.name for p in catalogs()}:
        raise ValueError('The Simplified Chinese catalog is missing')
    for catalog in catalogs():
        actual = messages(catalog)
        if expected.keys() != actual.keys():
            missing, extra = expected.keys() - actual.keys(), actual.keys() - expected.keys()
            raise ValueError(f'{catalog.name}: {len(missing)} missing and {len(extra)} obsolete messages; run npm run i18n:update')
        for key, original in expected.items():
            translated = actual[key]
            if 'fuzzy' in translated.get('flags', set()):
                raise ValueError(f'{catalog.name}: fuzzy translation: {key}')
            if original.get('msgid_plural') != translated.get('msgid_plural'):
                raise ValueError(f'{catalog.name}: outdated plural: {key}')
            placeholders = set(PLACEHOLDER.findall(original['msgid']))
            if original.get('msgid_plural') and set(PLACEHOLDER.findall(original['msgid_plural'])) != placeholders:
                raise ValueError(f'Singular and plural placeholders differ: {key}')
            translations = [value for field, value in translated.items() if field.startswith('msgstr')]
            if not translations or any(not value for value in translations):
                raise ValueError(f'{catalog.name}: untranslated message: {key}')
            for value in translations:
                if set(PLACEHOLDER.findall(value)) != placeholders:
                    raise ValueError(f'{catalog.name}: placeholders do not match: {key}')
        with tempfile.TemporaryDirectory() as directory:
            mo = Path(directory) / 'messages.mo'
            run('msgfmt', '--check', '--check-format', '-o', str(mo), str(catalog))
            with mo.open('rb') as stream:
                loaded = gettext.GNUTranslations(stream)
            if loaded.info().get('language') != catalog.stem:
                raise ValueError(f'{catalog.name}: incorrect Language header')
    return len(expected)


def check():
    with tempfile.TemporaryDirectory() as directory:
        fresh = Path(directory) / 'fresh.pot'
        extract(fresh)
        if not POT.is_file() or messages(fresh) != messages(POT):
            raise ValueError('The POT template is out of date; run npm run i18n:update')
        count = validate(fresh)
    print(f'PASS: {count} gettext messages; {len(catalogs())} complete catalog(s); placeholders and plurals checked.')


def compile_catalogs():
    check()
    for catalog in catalogs():
        dest = ROOT / 'extension/locale' / catalog.stem / 'LC_MESSAGES' / f'{DOMAIN}.mo'
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Do not overwrite a working catalog if msgfmt rejects an edit.
        with tempfile.TemporaryDirectory(dir=dest.parent) as directory:
            temp = Path(directory) / dest.name
            run('msgfmt', '--check', '--check-format', '-o', str(temp), str(catalog))
            temp.replace(dest)
        print(f'Compiled {dest.relative_to(ROOT)}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['update', 'check', 'compile'], nargs='?', default='compile')
    args = parser.parse_args()
    for tool in ('xgettext', 'msgcat', 'msgmerge', 'msgfmt'):
        if not shutil.which(tool):
            parser.error(f'{tool} is missing; install the gettext package')
    try:
        {'update': update, 'check': check, 'compile': compile_catalogs}[args.command]()
    except subprocess.CalledProcessError as error:
        parser.exit(1, error.stderr)
    except ValueError as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
