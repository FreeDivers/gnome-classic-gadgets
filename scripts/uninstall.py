#!/usr/bin/env python3
"""Disable and remove only this extension. Personal notes/settings are retained."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys

UUID = 'classic-gadgets@FreeDivers.github.io'
if os.geteuid() == 0:
    raise SystemExit('请用普通用户运行，不要加 sudo。')
target = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share')) / 'gnome-shell/extensions' / UUID
if target.is_symlink():
    raise SystemExit(f'安装路径是符号链接，未删除：{target}')
if not target.exists():
    print('本扩展尚未安装。')
    raise SystemExit(0)
metadata = target / 'metadata.json'
if not metadata.is_file() or json.loads(metadata.read_text()).get('uuid') != UUID:
    raise SystemExit(f'该目录不是本扩展，未删除：{target}')
subprocess.run(['gnome-extensions', 'disable', UUID], capture_output=True)
subprocess.run([sys.executable, str(Path(__file__).with_name('patch-ding-menu.py')), '--remove'])
shutil.rmtree(target)
print('已移除扩展文件。便笺、联系人、布局和网络缓存均保留，未清除个人数据。')
