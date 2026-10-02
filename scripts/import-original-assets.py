#!/usr/bin/env python3
"""Import untouched historical gadget images from the already-cloned repository.

Assets keep their original copyright; this script does not grant redistribution
rights. No Windows script or executable is run. Imports are pinned and hashed.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = '052da8efccb3b0813469fbc10eceeb52fb100a70'
REPOSITORY = ROOT / 'upstream' / 'VistaGadgets_v2.0'

def run(*args):
    return subprocess.check_output(['git', '-C', str(REPOSITORY), *args])

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify the imported image files without changing anything')
    args = parser.parse_args()
    target = ROOT / 'extension' / 'assets' / 'original'
    manifest_path = ROOT / 'extension' / 'assets' / 'original-assets.json'
    if args.check:
        manifest = json.loads(manifest_path.read_text())
        assert manifest['commit'] == SNAPSHOT, 'Unexpected original asset snapshot'
        paths = [record['path'] for record in manifest['files']]
        assert len(paths) == len(set(paths)), 'Duplicate paths in asset manifest'
        for record in manifest['files']:
            file = target / record['path']
            if not file.is_file() or file.stat().st_size != record['bytes'] or hashlib.sha256(file.read_bytes()).hexdigest() != record['sha256']:
                raise SystemExit(f'Missing or altered original image: {file}')
        print(f"Verified {len(manifest['files'])} byte-identical historical assets")
        return
    try:
        run('cat-file', '-e', SNAPSHOT + '^{commit}')
    except subprocess.CalledProcessError:
        subprocess.run(['git', '-C', str(REPOSITORY), 'fetch', '--unshallow', '--no-tags', 'origin'], check=True)
    records = []
    paths = run('ls-tree', '-r', '--name-only', SNAPSHOT).decode().splitlines()
    for path in paths:
        p = Path(path)
        if p.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.gif'}:
            continue
        if not p.parts[0].endswith('.Gadget'):
            continue
        # Keep original paths and bytes, including locale-specific material.
        data = run('show', f'{SNAPSHOT}:{path}')
        out = target / p
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        records.append({'path': path, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
    manifest = {
        'repository': 'https://github.com/PF94/VistaGadgets_v2.0',
        'commit': SNAPSHOT,
        'reason': 'Snapshot before 9e2780a replaced the picture puzzle background and Garden.jpg with modified/placeholder images.',
        'license': 'Original Microsoft / third-party rights reserved; not covered by the adapter MIT license. No new redistribution permission is implied.',
        'authenticity': 'Byte-identical to this historical community snapshot; not independently authenticated against Windows installation media.',
        'files': records,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Imported {len(records)} historical images, unchanged, from {SNAPSHOT}')

if __name__ == '__main__':
    main()
