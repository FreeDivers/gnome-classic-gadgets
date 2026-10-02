# 素材来源与许可

本项目使用 Windows Vista / 7 时代的小工具皮肤，保留原版设计。

- `extension/assets/original/`：取自 `PF94/VistaGadgets_v2.0` 的历史图片，保留原路径与文件字节，**不适用本项目 MIT 许可证**。版权仍归 Microsoft 及相应原作者。
- 来源提交：`052da8efccb3b0813469fbc10eceeb52fb100a70`（2020 年社区导入快照）。后续提交 `9e2780a` 改动了拼图背景，并将 `Garden.jpg` 换成占位图，因此本项目使用此前的快照。
- `extension/assets/original-assets.json`：记录每个原文件的来源、大小和 SHA-256。可运行 `python3 scripts/import-original-assets.py --check` 核对。
- `extension/lib/`、`extension/extension.js`、`extension/prefs.js` 等 Ubuntu 适配代码使用 MIT 许可。程序不执行上游的 ActiveX、VBScript、Windows 安装器或旧 JavaScript。
- 原版背景、表盘、指针、光泽、边框、拼图照片和便笺纸张不重新绘制或改色。时间、日期、Linux 指标和输入控件由 Ubuntu 渲染。蛋形计时器的 VML 数字路径转换为 Cairo 文字路径，金属外壳与遮罩仍使用原 PNG。

**来源验证范围**：图片已与该社区仓库的历史快照逐字节核对，尚未与正版 Windows 安装介质逐文件比对。仓库包含 Vista Beta 中被移除的组件，不全是 Windows 7 最终版内置组件。

仓库可公开访问或克隆，不代表允许再分发其中的素材。含皮肤的 ZIP 是为用户本机使用生成的安装包，不是可自由再发布的 MIT 软件包。本项目不授予微软素材新的许可。公开分发、商用或再授权前，请先核实相关权利。

本机未检测到 Segoe UI / Segoe Print 字体，动态文字使用系统后备字体，字形和字体度量可能与 Windows 略有区别。PNG 内已有的刻度、标记等不受影响。

## 可选 Fluent 皮肤

`extension/assets/fluent/` 从本地 `upstream/Rectify11-Gadgets` 提取，来源为
[Rectify11/Gadgets](https://github.com/Rectify11/Gadgets) 的固定提交
`a06af838755e71a75e5e9c4305046fb28721e743`。只导入时钟、日历、CPU、拼图、幻灯片、货币、回收站的 253 个图片文件，不运行 Windows 安装器或上游代码。

清单和逐文件 SHA-256 位于 `extension/assets/fluent-assets.json`，可用
`python3 scripts/import-fluent-assets.py --check` 核验。这些文件包含修改后的微软素材，原作者及 Rectify11 仍保留相关权利，**不属于本项目 MIT 许可，也不在此授予再发布许可**。主题切换直接使用原文件，不重绘经典素材来替代。

DING 菜单集成会在本机复制已安装的第三方扩展，并保留其原许可证（GPL）。本项目发布包不捆绑 DING 源码副本；菜单补丁脚本及原创插入段属于本项目适配代码。
