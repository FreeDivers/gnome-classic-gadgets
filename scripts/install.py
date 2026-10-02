#!/usr/bin/env python3
"""Install to this user's GNOME extensions directory, without restarting the desktop."""
from pathlib import Path
from datetime import datetime
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from build import build

UUID = 'classic-gadgets@FreeDivers.github.io'
LEGACY_UUID = 'classic-gadgets@qinyan.local'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-enable', action='store_true', help='only install files; do not modify enabled extensions')
    parser.add_argument('--no-desktop-menu', action='store_true', help='disable runtime desktop-menu integration (default: keep existing setting)')
    args = parser.parse_args()
    if os.geteuid() == 0:
        raise SystemExit('请用普通用户运行，不要加 sudo。')
    version = subprocess.check_output(['gnome-shell', '--version'], text=True).strip()
    if not version.split()[-1].startswith('50.') and version.split()[-1] != '50':
        raise SystemExit(f'只验证了 GNOME 50；当前为 {version}，未修改安装。')
    bundle = build()
    data = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    state = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state'))
    parent = data / 'gnome-shell/extensions'
    parent.mkdir(parents=True, exist_ok=True)
    target = parent / UUID
    legacy_target = parent / LEGACY_UUID
    # Validate both directories before disabling or moving either installation.
    for existing, expected_uuid in [(target, UUID), (legacy_target, LEGACY_UUID)]:
        if existing.is_symlink():
            raise SystemExit(f'安装路径是符号链接，请先自行确认：{existing}')
        if existing.exists():
            info = existing / 'metadata.json'
            if not info.is_file() or json.loads(info.read_text()).get('uuid') != expected_uuid:
                raise SystemExit(f'目标目录不是本扩展，未覆盖：{existing}')
    staging = Path(tempfile.mkdtemp(prefix='.classic-gadgets-', dir=parent))
    backups = []
    legacy_disabled = False
    try:
        with zipfile.ZipFile(bundle) as archive:
            for name in archive.namelist():
                if Path(name).is_absolute() or '..' in Path(name).parts:
                    raise SystemExit(f'不安全的压缩路径：{name}')
            archive.extractall(staging)
        metadata = json.loads((staging / 'metadata.json').read_text())
        assert metadata['uuid'] == UUID
        if legacy_target.exists() and not args.no_enable:
            result = subprocess.run(['gnome-extensions', 'disable', LEGACY_UUID], capture_output=True, text=True)
            if result.returncode:
                raise SystemExit('无法禁用旧 UUID，未移动已有安装。请在 GNOME 会话中重试；'
                                 '离线安装可用 --no-enable，完成后须重新登录再启用新版。')
            legacy_disabled = True
        backup_root = state / 'classic-desktop-gadgets/backups' / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        for existing in [legacy_target, target]:
            if existing.exists():
                backup = backup_root / existing.name
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(existing), backup)
                backups.append((existing, backup))
        staging.rename(target)
    except BaseException:
        for original, backup in reversed(backups):
            if not original.exists():
                shutil.move(str(backup), original)
        if legacy_disabled:
            # Do not blindly re-enable an installation that may already have been disabled.
            print(f'安装失败，旧版文件已恢复。如需启用旧版：gnome-extensions enable {LEGACY_UUID}', file=sys.stderr)
        raise
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    print(f'已安装：{target}')
    for original, backup in backups:
        print(f'上一版备份：{backup}')
        if original == legacy_target:
            print('旧 UUID 已迁移；设置和个人数据不变。请保存工作并重新登录后再使用新版。')
    # Safely archive/restore only the obsolete override created by our old
    # installer. Ubuntu does not load it. Runtime integration follows the
    # actual DING extension; it never installs a second same-UUID extension.
    legacy = state / 'classic-desktop-gadgets/ding-menu.json'
    if legacy.exists():
        cleanup = subprocess.run([sys.executable, str(Path(__file__).with_name('patch-ding-menu.py')), '--remove'])
        if cleanup.returncode:
            print('旧 DING 副本已有变动，已保留；新版无需依赖它。')
    if args.no_desktop_menu:
        environment = {**os.environ, 'GSETTINGS_SCHEMA_DIR': str(target / 'schemas')}
        subprocess.run(['gsettings', 'set', 'org.gnome.shell.extensions.classic-gadgets', 'desktop-menu', 'false'], env=environment, check=True)
    print('新版在运行时集成实际加载的 DING，保留原菜单；不会写入系统扩展目录。')
    if args.no_enable:
        print(f'启用命令：gnome-extensions enable {UUID}')
        return
    result = subprocess.run(['gnome-extensions', 'enable', UUID], capture_output=True, text=True)
    if result.returncode == 0:
        print('已请求启用。查看状态：gnome-extensions info ' + UUID)
    else:
        print('文件安装成功；当前 Shell 尚未发现新扩展。请保存工作后注销并重新登录，再运行：')
        print('  gnome-extensions enable ' + UUID)
        print('没有自动注销或重启 GNOME；DING 菜单可在扩展设置中单独关闭。')

if __name__ == '__main__':
    main()
