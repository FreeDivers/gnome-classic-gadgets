⚠️本项目是由 AI 生成的。⚠️

# Windows Vista/7 小组件

简体中文 | [English](README.en.md)

把 Windows Vista / 7 风格的小组件放到 GNOME 桌面上。

共有 14 个组件：时钟、日历、CPU / 内存、便笺、天气、幻灯片、计算器、计时器、图片拼图、RSS、货币换算、股票、联系人和回收站。

![经典皮肤下的桌面小组件](docs/calendar-expanded.png)

## 安装和更新

需要 Python 3、Node.js、gettext，以及 GNOME 的 GJS、GTK4 / libadwaita 环境。在项目根目录运行，安装脚本不要加 `sudo`：

```bash
sudo apt install gettext
python3 scripts/install.py
```

扩展会安装到当前用户目录，已有版本会先备份。更新后请保存工作，注销并重新登录；只禁用再启用可能仍会使用旧代码。安装脚本不会替你注销或重启桌面。

如果登录后没有启用，运行：

```bash
gnome-extensions enable classic-gadgets@FreeDivers.github.io
```

卸载用 `python3 scripts/uninstall.py`，便笺、联系人和布局等个人数据会保留。

## 怎么用

默认显示时钟、日历、CPU / 内存和便笺。

- 从顶栏菜单或桌面右键菜单打开「添加小组件…」，双击添加，也可以拖到桌面。
- 拖动组件空白处或右侧拖动柄来移动，点击齿轮修改该组件的设置。右键菜单里可以调整大小、不透明度或锁定位置。
- 在顶栏「外观」中切换皮肤。组件位置、设置和便笺内容会自动保存。

## 开发

在项目根目录运行：

```bash
npm test
npm run build
```

## 许可

新写的适配代码和文档采用 [MIT 许可证](LICENSE)。微软及 Rectify11 的皮肤素材不在 MIT 范围内；含素材的安装包用于本机测试，公开分发前需核实授权。详见[素材来源与许可](ASSET-NOTICE.md)。
