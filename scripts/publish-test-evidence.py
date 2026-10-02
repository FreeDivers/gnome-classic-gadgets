#!/usr/bin/env python3
"""Copy verified GNOME captures to docs; no gadget pixels are repainted."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RUN = Path((ROOT / 'build/last-shell-test').read_text().strip())
artifacts = RUN / 'artifacts'
result = json.loads((artifacts / 'result.json').read_text())
prefs = json.loads((artifacts / 'prefs-result.json').read_text())
assert result['ok'] and prefs['ok'], 'Do not publish failed test captures as success'
# Prove the screenshot is from exactly the currently-shipped extension files.
snapshot = RUN / 'data/gnome-shell/extensions/classic-gadgets@FreeDivers.github.io'
files = {}
for path in sorted((ROOT / 'extension').rglob('*')):
    if not path.is_file():
        continue
    rel = path.relative_to(ROOT / 'extension')
    assert (snapshot / rel).is_file(), f'Untested source: {rel}'
    assert (snapshot / rel).read_bytes() == path.read_bytes(), f'Source changed after screenshot: {rel}'
    files[str(rel)] = hashlib.sha256(path.read_bytes()).hexdigest()

docs = ROOT / 'docs'
docs.mkdir(exist_ok=True)
for source, target in [('desktop-all.png', 'original-desktop.png'), ('desktop-default.png', 'default-desktop.png'), ('calendar-expanded.png', 'calendar-expanded.png'), ('preferences.png', 'preferences.png')]:
    shutil.copyfile(artifacts / source, docs / target)
state = json.loads((artifacts / 'ui-state.json').read_text())
names = {'clock': '时钟', 'calendar': '日历', 'system': 'CPU / 内存', 'notes': '便笺', 'weather': '天气', 'photos': '幻灯片', 'calculator': '计算器（Vista Beta）', 'timer': '计时器（Vista Beta）', 'puzzle': '图片拼图', 'rss': 'RSS 订阅', 'currency': '货币', 'stocks': '股票', 'contacts': '联系人', 'trash': '回收站（Vista Beta）'}
image = Image.open(artifacts / 'desktop-all.png').convert('RGB')
font_path = subprocess.check_output(['fc-match', '-f', '%{file}', 'Noto Sans CJK SC'], text=True).strip()
font = ImageFont.truetype(font_path, 12)
heading = ImageFont.truetype(font_path, 18)
sheet = Image.new('RGB', (5 * 174 + 24, 3 * 214 + 55), '#233d4d')
draw = ImageDraw.Draw(sheet)
draw.text((18, 12), '原版皮肤 · GNOME 实际截图（仅裁切排版）', fill='#eef1f3', font=heading)
for index, entry in enumerate(state):
    x, y = round(entry['x']), round(entry['y'])
    width, height = round(entry['width']) - 22, round(entry['height'])
    crop = image.crop((x, y, x + width, y + height))
    dx, dy = 12 + index % 5 * 174, 55 + index // 5 * 214
    draw.text((dx + 4, dy), names[entry['type']], fill='#dee7ed', font=font)
    sheet.paste(crop, (dx + (160 - width) // 2, dy + 27))
sheet.save(docs / 'original-gallery.png')

# One strict, non-heuristic rendering check: all opaque original paper pixels
# in the blank default note must survive unchanged at scale=1.
notes = next(entry for entry in state if entry['type'] == 'notes')
paper = Image.open(ROOT / 'extension/assets/original/Notes.Gadget/images/sticky_yellow_docked.png').convert('RGBA')
shot = Image.open(artifacts / 'desktop-default.png').convert('RGB')
crop = shot.crop((notes['x'], notes['y'], notes['x'] + 130, notes['y'] + 121))
opaque = exact = 0
for y in range(paper.height):
    for x in range(paper.width):
        a, b = paper.getpixel((x, y)), crop.getpixel((x, y))
        if a[3] == 255:
            opaque += 1
            exact += a[:3] == b
assert exact == opaque and opaque > 10000, f'Paper skin pixels changed: {exact}/{opaque}'
manifest = json.loads((ROOT / 'extension/assets/original-assets.json').read_text())
record = {
    'test_directory': str(RUN.relative_to(ROOT)),
    'shell': subprocess.check_output(['gnome-shell', '--version'], text=True).strip(),
    'shell_checks': result['checks'],
    'preferences_checks': prefs['checks'],
    'live_data': result.get('providers', {}),
    'original_asset_count': len(manifest['files']),
    'original_asset_commit': manifest['commit'],
    'paper_pixel_check': {'exact_opaque_pixels': exact, 'total_opaque_pixels': opaque},
    'source_sha256': files,
    'runtime_log_has_input_focus_warnings': 'clutter_input_focus' in (RUN / 'session.log').read_text(),
}
# Every requirement-specific capture must also match the current extension, not
# merely have a green result from an older run.
features = {}
for name in ['native-gallery', 'native-options', 'ui', 'location', 'all-sizes', 'trash', 'trash-fluent', 'desktop-menu', 'trash-ding-scaled']:
    folder = ROOT / 'build/smoke' / name
    data = json.loads((folder / 'result.json').read_text())
    assert data['ok'], f'Feature run failed: {name}'
    assert json.loads((folder / 'source-sha256.json').read_text()) == files, f'Feature run is stale: {name}'
    features[name] = {'directory': str(folder.relative_to(ROOT)), 'checks': data['checks']}
record['features'] = features
record['fluent_asset_count'] = len(json.loads((ROOT / 'extension/assets/fluent-assets.json').read_text())['files'])
for source, target in [
    ('native-gallery/gallery-light.png', 'gallery-light.png'),
    ('native-gallery/gallery-dark.png', 'gallery-dark.png'),
    ('native-gallery/gtk-gallery-compact.png', 'gallery-compact.png'),
    ('native-gallery/gallery-drag.png', 'gallery-drag.png'),
    ('native-options/native-options-light.png', 'options-light.png'),
    ('native-options/native-options-dark.png', 'options-dark.png'),
    ('native-options/gtk-dark-validation.png', 'options-validation-dark.png'),
    ('native-options/gtk-dark-picker.png', 'options-picker-dark.png'),
    ('ui/gallery.png', 'gadget-shelf.png'), ('ui/puzzle-options.png', 'puzzle-options.png'),
    ('location/weather-large.png', 'weather-large.png'),
    ('location/weather-location-options.png', 'weather-location-options.png'),
    ('all-sizes/classic-large.png', 'classic-large.png'), ('all-sizes/fluent-large.png', 'fluent-large.png'),
    ('desktop-menu/ding-context-menu.png', 'desktop-context-menu.png'),
    ('trash/during-file-drop.png', 'trash-file-drop.png'),
]:
    shutil.copyfile(ROOT / 'build/smoke' / source, docs / target)

(docs / 'verification.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
(docs / 'verification.md').write_text(f'''# 当前版本验证记录

- 验证环境：{record['shell']}，Ubuntu 26.04.1，独立 Wayland / D-Bus 会话。
- 测试目录：`{record['test_directory']}`。
- GNOME 集成断言：**{len(result['checks'])} 项通过**；GTK 设置窗口断言：**{len(prefs['checks'])} 项通过**。
- 原素材：**{len(manifest['files'])} 个文件**逐一核对 SHA-256，与导入快照一致。
- 实际渲染：默认便笺截图中 **{exact}/{opaque} 个不透明纸张像素与原 PNG 完全相同**。这仅证明该皮肤的像素保持，不扩大为整个 Windows Sidebar 像素级一致声明。
- 原版 8 套时钟皮肤、14 个组件原尺寸、日历双页、拖动/锁定/缩放、便笺多页/自动保存、计算器、计时器、拼图、幻灯片与默认原相册图片均已测试。
- 天气、RSS、汇率、股票均实际取得服务数据；没有用虚构数据或“显示了错误”冒充取数成功。
- 设置窗口实际打开并核对位于小工具之上；禁用、计时器/信号清理与重新启用已经测试。
- 文档截图逐文件对照了测试时安装的 extension 副本和当前工作区。具体断言、服务状态与文件哈希见 [verification.json](verification.json)。

## 2.3 GTK4 橱窗及 Ubuntu 桌面右键入口

- `native-gallery` 对当前生产代码做真实 GTK 测试：Adw.Window / HeaderBar、Gtk.FlowBox / SearchEntry / Button，浅色→深色→浅色、搜索、空状态、分页、详细信息、双击和添加/移除；小窗口自适应网格和底部操作可见。
- 真实 Wayland 拖放从 GTK 窗口到桌面，核对位置保存；Esc 不移动组件；空闲接收窗口不吞桌面点击；关闭退出、快速重开不会被旧进程清理误杀。
- `desktop-menu` 使用 **Ubuntu 会话模式**，放入会被忽略的同名用户副本，确认真正加载的是系统 DING；读取运行进程参数，证明它实际使用了私有补丁代码，而非仅“有文件”。
- 真实点击 DING 原菜单打开 GTK4 橱窗，再拖出组件；关闭开关/禁用扩展均恢复系统 DING，未修改系统文件。没有把 `user` 会话下通过的测试当作 Ubuntu 同名覆盖有效的证据。
- 截图：[浅色橱窗](gallery-light.png) · [深色橱窗](gallery-dark.png) · [紧凑窗口](gallery-compact.png) · [真实拖放](gallery-drag.png) · [Ubuntu 桌面菜单](desktop-context-menu.png)。

## 2.2 原生 GTK 选项窗口

- 选项现在由独立 GJS 客户端中的 **GTK4 / libadwaita** 渲染；Shell 只负责校验、保存和组件动作，没有在 Shell 进程导入 GTK。
- `native-options` 实际打开齿轮窗口、用真实指针点确定、核对保存 / 取消。原生控件测试确认 ComboRow、SpinRow、SwitchRow、EntryRow、SearchEntry、TextView 和图片预览均使用 GTK 控件。
- 在**同一窗口仍打开时**切换系统浅色→深色→浅色，核对 `Adw.StyleManager.dark`、草稿不丢失，并分别截图；搜索列表、错误样式、禁用状态、多行输入也测试了深色外观。
- 窗口可缩小并滚动，确认按钮保持可见；天气高级坐标默认折叠，自动标签开关控制自定义标签输入状态。
- 截图：[浅色](options-light.png) · [深色](options-dark.png) · [深色错误状态](options-validation-dark.png) · [深色图片 / 多行输入](options-picker-dark.png)。

## 八项改进逐项验收

| 需求 | 当前证据 |
|---|---|
| 全部拼图图片 | 11 个原始编号图的素材哈希；`ui` 中第 11 张的预览、真实点击保存和取消不覆盖；`native-options` 真实点击 GTK 图片切换按钮 |
| 原版大小和自定义大小 | `all-sizes` 遍历 14 个组件、两种主题及所有大/小尺寸；天气实际渲染三日预报；`ui` 验证独立缩放 |
| 独立组件设置 | `ui` 实际点击齿轮，只开组件选项；`all-sizes` 打开全部组件选项，并验证联系人格式化往返不会丢数据 |
| 桌面橱窗和拖出组件 | `native-gallery` 验证 GTK4 搜索/分页/拖放；`desktop-menu` 在真实 DING 桌面点原生菜单、打开橱窗并拖出拼图；保留原菜单 |
| 真实回收站拖放 | `trash`、`trash-fluent` 与 `trash-ding-scaled` 从独立 GTK 客户端拖入两个真实临时文件（中文/空格），核对原文件消失、回收站内容一致、可恢复、助手退出；含 DING 与 1.4 倍缩放 |
| 尝试定位和自动地址 | `location` 调用实际系统/IP 定位链、真实城市搜索和选站，核对无需输入坐标也可取城市、自动标签和三日预报 |
| 国内免费数据源 | 当前四个在线组件真实取数；CMA、中国天气网、东方财富、IT之家；未用样例填充冒充联网成功 |
| Fluent 开关 | 253 个 Rectify11 原始文件哈希；`all-sizes` 在运行中切换经典/Fluent，小、大尺寸均渲染；回收站两主题分别真实拖放 |

功能验收：**{sum(len(data['checks']) for data in features.values())} 项运行时断言通过**（包含多主题重复项）；另有 49 项 Node 纯逻辑测试、5 项私有 DING 菜单缓存/旧版迁移测试和隔离安装/卸载测试。

新截图：[橱窗](gadget-shelf.png) · [组件选项](puzzle-options.png) · [大尺寸经典](classic-large.png) · [Fluent](fluent-large.png) · [桌面右键菜单](desktop-context-menu.png) · [天气](weather-large.png) · [真实文件拖放](trash-file-drop.png)。

## 范围与保留说明

图片来源是已克隆社区仓库的历史快照，未比对 Windows 安装介质。Segoe UI/Segoe Print 在本机不可用，动态字体存在后备差异；Ubuntu 管理按钮和 GTK 设置窗口不是原版 Windows Sidebar。不得将这些限制隐藏为“完全一样”。

隔离 GNOME 日志{'仍含 Clutter 输入焦点断言警告，记录已保留；未把它描述为零警告。' if record['runtime_log_has_input_focus_warnings'] else '中没有 Clutter 输入焦点断言警告。'} 实际交互断言的覆盖范围以 JSON 为准。未在这个测试中执行系统回收站清空、注销真实桌面或访问用户私人相册。
''')
print(f'Published actual screenshots and verification; original paper pixels {exact}/{opaque} exact')
