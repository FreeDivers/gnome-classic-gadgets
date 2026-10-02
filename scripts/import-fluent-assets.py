#!/usr/bin/env python3
"""Import the Rectify11 (Fluent) gadget images from the already-cloned repository.

Only image files (.png .jpg .jpeg .gif) of the seven re-skinned gadgets are copied,
byte-identical, from a pinned commit; no script or executable from the pack is run.
The images are modified Microsoft assets redistributed by the Rectify11 gadget pack
without a license grant: they are NOT covered by the adapter's MIT license and are
kept out of git (.gitignore: /extension/assets/fluent/). Theme.resolve() only uses
files listed in the manifest written here (extension/assets/fluent-assets.json).
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = 'a06af838755e71a75e5e9c4305046fb28721e743'
REPOSITORY = ROOT / 'upstream' / 'Rectify11-Gadgets'
PREFIX = 'GPInstallerBuilder/Files64/Gadgets'
# Rectify11 directory → our folder name under assets/fluent (same names as assets/original).
FOLDERS = {
    'Clock.Gadget': 'Clock.Gadget',
    'Calendar.Gadget': 'Calendar.Gadget',
    'CPU.Gadget': 'CPU.Gadget',
    'PicturePuzzle.Gadget': 'PicturePuzzle.Gadget',
    'SlideShow.Gadget': 'SlideShow.Gadget',
    'Currency.Gadget': 'Currency.Gadget',
    'RecycleBin.gadget': 'RecycleBin.Gadget',
}
IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.gif'}
TARGET = ROOT / 'extension' / 'assets' / 'fluent'
MANIFEST = ROOT / 'extension' / 'assets' / 'fluent-assets.json'

def run(*args):
    return subprocess.check_output(['git', '-C', str(REPOSITORY), *args])

def check():
    manifest = json.loads(MANIFEST.read_text())
    assert manifest['commit'] == SNAPSHOT, 'Unexpected fluent asset snapshot'
    paths = [record['path'] for record in manifest['files']]
    assert len(paths) == len(set(paths)), 'Duplicate paths in fluent asset manifest'
    assert all(path.split('/', 1)[0] in FOLDERS.values() for path in paths), 'Fluent manifest lists a folder outside the seven re-skinned gadgets'
    for record in manifest['files']:
        file = TARGET / record['path']
        if not file.is_file() or file.stat().st_size != record['bytes'] or hashlib.sha256(file.read_bytes()).hexdigest() != record['sha256']:
            raise SystemExit(f'Missing or altered fluent image: {file}')
    print(f"Verified {len(manifest['files'])} byte-identical Rectify11 (fluent) assets")

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true', help='verify the imported image files without changing anything')
    args = parser.parse_args()
    if args.check:
        check()
        return
    try:
        run('cat-file', '-e', SNAPSHOT + '^{commit}')
    except subprocess.CalledProcessError:
        subprocess.run(['git', '-C', str(REPOSITORY), 'fetch', '--unshallow', '--no-tags', 'origin'], check=True)
    if TARGET.exists():
        shutil.rmtree(TARGET)  # never keep files from an older import that the manifest no longer lists
    records = []
    for source, folder in FOLDERS.items():
        listing = run('ls-tree', '-r', '-z', '--name-only', SNAPSHOT, '--', f'{PREFIX}/{source}').decode()
        paths = [path for path in listing.split('\0') if path]
        assert paths, f'{source}: not found at {SNAPSHOT}'
        for path in paths:
            relative = Path(path).relative_to(f'{PREFIX}/{source}')
            if relative.suffix.lower() not in IMAGE_SUFFIXES:
                continue
            data = run('show', f'{SNAPSHOT}:{path}')
            out = TARGET / folder / relative
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            records.append({'path': f'{folder}/{relative.as_posix()}', 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
    manifest = {
        'repository': 'https://github.com/Rectify11/Gadgets',
        'commit': SNAPSHOT,
        'source': f'{PREFIX}/<dir> for {", ".join(FOLDERS)}; image files only',
        'license': 'Rectify11 Gadgets pack; modified Microsoft assets; no license granted; not covered by MIT',
        'files': records,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Imported {len(records)} Rectify11 (fluent) images, unchanged, from {SNAPSHOT}')

if __name__ == '__main__':
    main()
