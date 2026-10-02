# 原有 2.3 功能验证记录

> 最新字体与排版改动及其回归结果见 [字体排版验证](typography-verification.md)。

> 本页保留原有功能的历史验证快照。2026-09-13 新增的启动地区检测、境内外数据源切换及最新基线回归，见 [地区切换验证记录](network-region-verification.md)。

- 验证环境：GNOME Shell 50.1，Ubuntu 26.04.1，独立 Wayland / D-Bus 会话。
- 测试目录：`build/shell-test.SyHB6W`。
- GNOME 集成断言：**85 项通过**；GTK 设置窗口断言：**9 项通过**。
- 原素材：**672 个文件**逐一核对 SHA-256，与导入快照一致。
- 实际渲染：默认便笺截图中 **13055/13055 个不透明纸张像素与原 PNG 完全相同**。这仅证明该皮肤的像素保持，不扩大为整个 Windows Sidebar 像素级一致声明。
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

功能验收：**268 项运行时断言通过**（包含多主题重复项）；另有 49 项 Node 纯逻辑测试、5 项私有 DING 菜单缓存/旧版迁移测试和隔离安装/卸载测试。

新截图：[橱窗](gadget-shelf.png) · [组件选项](puzzle-options.png) · [大尺寸经典](classic-large.png) · [Fluent](fluent-large.png) · [桌面右键菜单](desktop-context-menu.png) · [天气](weather-large.png) · [真实文件拖放](trash-file-drop.png)。

## 范围与保留说明

图片来源是已克隆社区仓库的历史快照，未比对 Windows 安装介质。Segoe UI/Segoe Print 在本机不可用，动态字体存在后备差异；Ubuntu 管理按钮和 GTK 设置窗口不是原版 Windows Sidebar。不得将这些限制隐藏为“完全一样”。

隔离 GNOME 日志仍含 Clutter 输入焦点断言警告，记录已保留；未把它描述为零警告。 实际交互断言的覆盖范围以 JSON 为准。未在这个测试中执行系统回收站清空、注销真实桌面或访问用户私人相册。
