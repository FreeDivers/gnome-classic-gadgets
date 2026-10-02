> 历史记录：以下是源码收集阶段的说明，当前实现与运行方式请看根目录 README.md。

# Windows 7 / Vista 小工具源码参考

已从 GitHub 筛选并克隆以下仓库，用于在 Ubuntu 上重新实现 Windows 7 / Vista 风格的桌面小工具。

**当前完成的是源码收集和移植前分析，不是已经可运行的 Ubuntu 移植版。** 未执行下载仓库中的安装器、构建脚本或小工具，也没有安装依赖、修改桌面配置或启用自启动。

## 1. 已克隆的仓库

| 仓库 | 本地目录 | 内容与定位 | 授权情况 |
| --- | --- | --- | --- |
| [PF94/VistaGadgets_v2.0](https://github.com/PF94/VistaGadgets_v2.0) | [`upstream/VistaGadgets_v2.0/`](../upstream/VistaGadgets_v2.0/) | 14 个 Vista 风格小工具，包含 HTML、CSS、JavaScript、图片；最贴近经典外观的参考 | 无统一开源许可证；部分微软源文件有明确使用限制 |
| [Rectify11/Gadgets](https://github.com/Rectify11/Gadgets) | [`upstream/Rectify11-Gadgets/`](../upstream/Rectify11-Gadgets/) | 35 个小工具目录，含经典组件的现代化改版和第三方组件；检索时仓库已归档 | 无统一开源许可证；各组件需分别核实 |
| [microsoft/Windows-classic-samples](https://github.com/microsoft/Windows-classic-samples) | [`upstream/Windows-classic-samples/`](../upstream/Windows-classic-samples/) | 微软官方 SDK：6 个 Gadget 示例及一个 C++ `IDesktopGadget` 示例；仅检出 Sidebar 相关部分和根目录文件 | 根目录为 [MIT](../upstream/Windows-classic-samples/LICENSE)；仍需保留适用声明 |
| [strobejb/supercalc](https://github.com/strobejb/supercalc) | [`upstream/supercalc/`](../upstream/supercalc/) | Windows 7 第三方程序员计算器 7Calc，HTML/JavaScript 完整源码；不是微软内置计算器；检索时仓库已归档 | [MIT](../upstream/supercalc/LICENCE.TXT)，适合研究可合法复用的实现 |

精确提交、分支、源码统计和检出方式见 [`sources.json`](../sources.json)。所有仓库都使用浅克隆，保留各自独立的 `.git`，没有修改上游文件。微软示例仓库额外使用部分克隆和稀疏检出，避免下载整套无关 Windows 示例。

### Vista 合集中的 14 个小工具

CPU 仪表、计算器、日历、时钟、联系人、货币、便笺、图片拼图、回收站、RSS、幻灯片、股票、计时器、天气。

这是社区整理/续作，并不保证与 Windows 安装介质中的原版逐文件一致。上游 README 已标注货币、股票、天气的服务停用；本次未逐一测试旧网络端点。

### Rectify11 合集的实际源码目录

[`upstream/Rectify11-Gadgets/GPInstallerBuilder/Files64/Gadgets/`](../upstream/Rectify11-Gadgets/GPInstallerBuilder/Files64/Gadgets/)

其中包含 Clock、Calendar、CPU、数字时钟、天气、电池、磁盘、网络监视器等。仓库还携带 Windows 安装打包材料/二进制文件；它们不是 Ubuntu 移植所需的运行时。

### 微软官方示例的实际目录

[`upstream/Windows-classic-samples/Samples/Win7Samples/winui/sidebar/`](../upstream/Windows-classic-samples/Samples/Win7Samples/winui/sidebar/)

包含 `sdk_helloworld.gadget`、`sdk_settings.gadget`、`sdk_docked.gadget`、`sdk_flyout.gadget`、`sdk_graphicsapi.gadget`、`sdk_systemdebug.gadget`。它们说明旧平台的设置、停靠、弹出面板、图形和调试接口，**不是微软公开了全部内置小工具或 Sidebar 运行时源码**。

## 2. 建议从哪些文件开始看

| 功能 | 主要入口 | 后续重写重点 |
| --- | --- | --- |
| 时钟 | [`Clock.Gadget/en-US/clock.html`](../upstream/VistaGadgets_v2.0/Clock.Gadget/en-US/clock.html) 及同目录 `js/`、`css/`、`images/` | 时间/时区、指针旋转、外观切换 |
| 日历 | [`Calendar.Gadget/en-US/calendar.html`](../upstream/VistaGadgets_v2.0/Calendar.Gadget/en-US/calendar.html) | 月份布局、日期计算、展开/折叠 |
| CPU / 内存 | [`CPU.Gadget/en-US/cpu.html`](../upstream/VistaGadgets_v2.0/CPU.Gadget/en-US/cpu.html) | 用 Linux 指标替代 `System.Machine`，重新绘制仪表 |
| 便笺 | [`Notes.Gadget/en-US/notes.html`](../upstream/VistaGadgets_v2.0/Notes.Gadget/en-US/notes.html) | 文本编辑、持久化、颜色/大小设置 |
| 天气 | [`Weather.Gadget/en-US/weather.html`](../upstream/VistaGadgets_v2.0/Weather.Gadget/en-US/weather.html) | 替换 ActiveX 和失效服务，不适合作为第一个组件 |
| 7Calc | [`supercalc.html`](../upstream/supercalc/supercalc.html)、[`src/parser.js`](../upstream/supercalc/src/parser.js) | 解析/计算逻辑与旧 Gadget 宿主接口分离；复用时保留 MIT 声明 |

部分旧文件采用 UTF-16 编码，且 Linux 文件路径区分大小写。迁移到新项目时需统一处理，不要在上游目录直接批量替换。

## 3. 授权边界：有源码不等于可自由移植发布

- 两个经典合集没有统一的开源许可证。已实际查看 Vista 与 Rectify11 的时钟源文件：其中保留微软版权，并明确限制用于其他 UI 元素或产品组件。这不仅是 GitHub 没有识别到许可证的问题。
- 因此，不能默认将这些代码、图片、图标、字体直接复制到一个公开发布的新项目中，也不能给整个合集自行套用 MIT 许可证。
- 建议将经典合集用于历史、功能与交互分析；发布版使用独立编写的实现和自制/明确授权的素材。如要直接复用现有代码或素材，应先核实相应授权。
- 官方 SDK 示例和 7Calc 提供明确的 MIT 授权，可作为代码层面的参考；需保留版权及许可声明，并检查实际复用文件适用的其他条件。SDK 的 MIT 许可不覆盖另外两个仓库的微软内置组件。

## 4. 针对当前 Ubuntu 的移植建议

本次实际检测到：**Ubuntu 26.04.1 LTS、GNOME Shell 50.1、Wayland 会话**。

这些 Gadget 主要采用 HTML/CSS/JavaScript，但依赖旧 Windows Sidebar、IE DOM 和 Windows 系统接口，不是换个后缀就能在 Linux 或现代浏览器运行的网页。

### 宿主方案

- **目标是像原版一样贴在桌面层：优先评估 GNOME Shell 扩展。** 使用 GJS 与 GNOME 原生绘制/控件重写 UI；不直接运行旧 Gadget HTML。需要针对 GNOME 50 验证扩展接口和桌面层行为。
- **目标是先得到独立、可拖动的小组件窗口：Python + PySide6 / Qt Quick 是另一条路线。** 更容易独立调试，但 Wayland 下普通客户端不能依靠通用接口自行决定全局窗口位置或强制置底；独立浮窗不等于真正的桌面层小工具。
- 以当前需求而言，不建议先装 Wine 或执行仓库附带的 Windows Sidebar 安装程序来代替原生重写。

### 已在源码中确认的依赖与替换方向

| 旧接口 / 技术 | Ubuntu 上的替换方向 |
| --- | --- |
| `System.Gadget.Settings`、设置页回调 | GSettings，或应用自己的 `$XDG_CONFIG_HOME` 配置 |
| `System.Gadget.onDock/onUndock`、Flyout | 新宿主的布局、展开状态、弹出面板 |
| `System.Time.*` | GLib / 系统时区接口或现代日期时间库 |
| `System.Machine.CPUs`、内存接口 | `/proc/stat`、`/proc/meminfo`，或 Python `psutil`；CPU 使用率需按采样间隔计算 |
| `System.Shell.*`、Windows 路径 | Gio、桌面门户、D-Bus 等有边界的本地接口 |
| `<g:background>`、`<g:image>` | 原生绘制或新 UI 中的图层、SVG/Canvas 等；不能直接保留旧宿主标签 |
| `DXImageTransform.Microsoft.*`、`attachEvent` | 现代动画/事件系统，或原生 UI 动画 |
| 天气的 `ActiveXObject("wlsrvc.WLServices")` | 重新实现网络请求、位置设置、错误状态与缓存；选择仍可用且允许使用的 HTTPS 天气服务 |

### 推荐实施顺序

1. 确定桌面层扩展还是独立窗口；建立不加载旧脚本的最小宿主。
2. 先独立重写 **时钟、日历、CPU/内存仪表**，验证刷新、拖动、缩放、多显示器和状态保存。
3. 再做便笺、图片幻灯片、计算器等离线组件。
4. 最后处理天气、RSS 等联网组件及权限、缓存、异常状态。
5. 确认使用的代码和素材授权后，再做打包、自启动及安装/卸载流程。

目前没有 Ubuntu 运行测试结果，因为尚未实现移植版；已完成的验证是仓库来源、实际源文件、清洁工作区和 Git 对象连通性检查。

## 5. 在另一个空目录复现克隆

```bash
mkdir -p upstream

git clone --depth 1 --no-tags https://github.com/PF94/VistaGadgets_v2.0.git upstream/VistaGadgets_v2.0
git clone --depth 1 --no-tags https://github.com/Rectify11/Gadgets.git upstream/Rectify11-Gadgets
git clone --depth 1 --no-tags https://github.com/strobejb/supercalc.git upstream/supercalc

git clone --depth 1 --filter=blob:none --sparse --no-tags \
  https://github.com/microsoft/Windows-classic-samples.git upstream/Windows-classic-samples
git -C upstream/Windows-classic-samples sparse-checkout set Samples/Win7Samples/winui/sidebar
```

上述命令获取执行时的分支最新版本；本次实际下载的精确提交以 `sources.json` 为准。后续实现建议放在独立的新目录中，保留 `upstream/` 作为未修改的来源参考。
