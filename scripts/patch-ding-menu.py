#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Retire the obsolete same-UUID DING override installed by 2.1/2.2.

Ubuntu ignores that per-user copy for its session extension. Since 2.3 the
running gadget extension integrates with the ACTUALLY loaded DING; do not
install another override or edit /usr/share. --remove restores any old backup.
"""
from pathlib import Path
from datetime import datetime
import argparse
import hashlib
import json
import os
import shutil
import subprocess

UUID = 'ding@rastersoft.com'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def remove(data, state):
    record_path = state / 'classic-desktop-gadgets/ding-menu.json'
    if not record_path.exists(): print('没有本脚本安装的 DING 菜单集成。'); return
    record = json.loads(record_path.read_text()); target = data / 'gnome-shell/extensions' / UUID
    if str(target) != record['target'] or target.is_symlink(): raise ValueError('安装路径已变化；未修改文件')
    menu = target / 'app/desktopManager.js'
    if not menu.is_file() or digest(menu) != record['patched_sha256']:
        raise ValueError('DING 副本已有其他修改，为避免覆盖它们，请手动移除 BEGIN/END classic-gadgets 标记块；原备份位置：' + str(record.get('backup')))
    archive = state / 'classic-desktop-gadgets/backups' / datetime.now().strftime('removed-ding-%Y%m%d-%H%M%S-%f') / UUID
    archive.parent.mkdir(parents=True, exist_ok=True); shutil.move(target, archive)
    backup = Path(record['backup']) if record.get('backup') else None
    if backup and backup.exists(): shutil.move(backup, target)
    record_path.unlink(); print(f'已撤销菜单集成；旧副本保留在 {archive}。下次登录生效。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--remove', action='store_true', help='retire only the old user-local override')
    parser.add_argument('--status', action='store_true', help='query the currently running integration')
    args = parser.parse_args()
    data = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    state = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state'))
    try:
        if args.status:
            raise SystemExit(subprocess.run(['gdbus', 'call', '--session', '--dest', 'org.gnome.Shell',
                '--object-path', '/org/gnome/Shell/Extensions/ClassicGadgets', '--method',
                'org.gnome.Shell.Extensions.ClassicGadgets.GetDesktopMenuStatus']).returncode)
        remove(data, state)
        if not args.remove:
            print('2.3 起由小组件扩展自动集成当前运行的 DING；不再安装同名用户副本。')
            print('在扩展设置中切换「桌面右键菜单」，或用 --status 检查运行状态。')
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))

if __name__ == '__main__': main()
