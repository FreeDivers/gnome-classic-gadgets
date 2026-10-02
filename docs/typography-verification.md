# 组件字体与排版

本次调整针对桌面组件里的文字，不更换原版皮肤图片，也不改系统字体设置。经典和 Fluent 两套皮肤、大尺寸和小尺寸都进行了检查。

## 各组件的调整

| 组件 | 调整内容 |
|---|---|
| 时钟 | 经典表盘铭牌使用 Noto Serif，现代表盘与 Fluent 使用 Ubuntu Sans；名称颜色按表盘明暗选择，避免深底深字。 |
| 日历 | 日期使用轻字重的大数字；星期、月份和月历格子分别设置字号，避免主次不分。 |
| CPU / 内存 | 使用等宽数字特性，留出 `100%` 的宽度和高度；保留玻璃下文字的对比度。 |
| 便笺 | 经典用 Noto Serif / Noto Serif CJK SC，Fluent 用 Ubuntu Sans / Noto Sans CJK SC；正文增加行距，大尺寸提高字号，继续支持编辑和滚动。 |
| 天气 | 温度读数突出，城市、天气描述、三日预报与来源标注分级；预报文字在深色背景上更清楚。 |
| 幻灯片 | 没有可见正文。保留原版图片控制按钮，不额外加文字遮住照片。 |
| 计算器 | 输入表达式与结果分行，结果更醒目；数字键、运算符和较长的 `1/x` 分别设定字号。长结果适度缩小，但不改写数值。 |
| 计时器 | 曲面数字改用系统可用的 DejaVu Serif / DejaVu Sans，保留原有金属背景、遮罩及圆弧排列。 |
| 拼图 | 步数与完成状态提高到可读的字号，并放入底部文字区域。 |
| RSS | 长短标题均左对齐，中文和英文统一行距；底部入口不再压到皮肤阴影上。 |
| 货币 | 货币代码、输入金额、换算结果和日期分级；大尺寸提高读数字号，保留完整精度与右对齐。 |
| 股票 | 名称、价格、涨跌幅分级；大尺寸把市场状态放在涨跌幅下方，避免状态文字挤占数字。 |
| 联系人 | 搜索提示改为可读的深色；姓名与联系方式区分字重、颜色，状态文字放回纸张内部。 |
| 回收站 | 容量、项目数和操作文字分别处理，保留经典悬停文字与 Fluent 常显信息的差异。 |

正文不再指定缺失的 Segoe UI、Calibri、Constantia 或 Segoe Print。字体列表明确包含 Noto / Ubuntu / DejaVu 和中文后备；系统没有其中一种字体时，由 Pango 继续选择后备字体，不下载字体文件。GTK 选项和偏好设置仍跟随系统原生字体。

## 预览

- [经典小尺寸](typography-classic-small.png)
- [经典展开尺寸](typography-classic-large.png)
- [Fluent 小尺寸](typography-fluent-small.png)
- [Fluent 展开尺寸](typography-fluent-large.png)

图册直接裁切真实 GNOME 截图，不重新绘制组件文字。小尺寸图册把截图放大 1.5 倍，展开尺寸图册保留原截图尺寸；这只是文档排版，不改变组件的实际尺寸。图中的天气、汇率和新闻为固定的排版样本，不能当作实时数据。

## 实现要点

- `extension/stylesheet.css` 设置字体、字号、字重、颜色和对齐。GNOME St 接受的是一个带引号的 Pango 字体列表，不是浏览器的多个 CSS 字体字符串。
- `extension/lib/typography.js` 处理数字字形、行距和长数值适配。增加 Pango 属性时保留 St 已设置的前景色、透明度等属性，主题或行情颜色变化后仍会更新。
- 字号适配以组件的内容框为边界，实际测量字体 hinting 后的宽度，而不是只按比例估算。只缩小过长读数；短读数恢复正常字号。最低字号不足以容纳时允许省略显示，但不改动原文本，并保留完整的无障碍名称。
- 长名称使用省略号，RSS 正文与便笺换行；不靠无限缩小字号塞下所有文字。
- 修改只发生在组件内。两套素材的 925 个文件保持原始哈希，未更改用户的字体配置、便笺或联系人。

## 验证结果

环境：Ubuntu 26.04.1 LTS、GNOME Shell 50.1、GJS 1.88.0、Pango 1.57.0、Node 22.22.1。所有桌面测试使用隔离 Wayland / D-Bus 会话，没有替换用户正在运行的桌面。

| 验证 | 结果 | 证据 |
|---|---|---|
| `npm test` | 82 项通过，含字体宽度取整、缩小边界和恢复字号的纯逻辑测试 | `build/typography-unit.log` |
| `npm run test:typography` | 107 项运行时断言通过；测量 418 个实际 Pango 文本布局，保存 8 张全组件截图 | `build/smoke/typography/` |
| `python3 scripts/check.py` | 47 个 JS 模块、GSettings schema、672 个经典素材和 253 个 Fluent 素材通过核验 | `build/typography-check.log` |
| `npm run test:shell` | 85 项基线断言通过；其 GTK 偏好设置子测试 9 项通过 | `build/shell-test.nEMfLb/artifacts/` |
| `npm run test:options` | 33 项通过，包含真实 GTK 控件、浅深色、编辑与保存 | `build/smoke/native-options/` |
| `npm run test:network` | 120 项地区路由 / 组件测试和 13 项传输层检查通过 | `build/smoke/network-region/`、`build/network/platform.json` |
| `python3 scripts/test-install.py` | 9 项隔离安装、重装、备份、卸载和打包检查通过 | `build/typography-install.log` |

字体测试检查了中英文混排、常用姓名、负温度、百分比、金额、日期、24 个计算器按键及 4 个记忆键；这些样本没有缺字、意外省略或超出分配高度的文字。另行测试了长数字缩小及恢复、长城市名省略、数字改色、所有时钟表盘的文字明暗，以及 0.75 倍 / 1.5 倍组件缩放。Cairo 绘制的计时器不计入 Pango 布局数量，其数字外观通过截图检查，交互由基线测试覆盖。

第一次真实联网基线遇到东方财富主动断开连接，日志保留在 `build/typography-baseline-first.log`；完成的重跑已取得四类真实网络数据。没有用排版样本替代基线联网结果。

隔离会话仍有既有的 Clutter 输入焦点、portal 和退出时警告。最终字体测试没有字体解析错误或进程崩溃，测试脚本也会拒绝这类日志。开发过程曾发现测试代码读取 Clutter 字体描述时的所有权问题，最终使用 StThemeNode 的字体描述，已通过后续测试。这里不作“任意字体、任意缩放均像素一致”的保证；字体包、显示器缩放和系统抗锯齿设置仍会影响渲染。

## 复现与安装

```bash
npm run test:typography
python3 scripts/render-typography.py   # 从测试截图生成上述图册
```

安装包已更新到 `dist/classic-gadgets@qinyan.local.shell-extension.zip`，同目录提供 SHA-256。测试安装只使用临时目录，没有覆盖用户实际安装的扩展。

```bash
python3 scripts/install.py
```

若旧版扩展已加载，安装后需要保存工作、注销并重新登录，以清除 GNOME Shell 的模块缓存。脚本不会自动注销。

完整断言、源码和测试脚本哈希、Pango 测量结果、图册及安装包校验值见 [typography-verification.json](typography-verification.json)。记录生成时已将测试会话中的扩展副本和安装包逐文件与当前 `extension/` 核对。
