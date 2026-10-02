# 启动时按地区选择数据源 · 验证记录

> 本页保留数据源切换完成时的快照。后续字体改动和最新网络路由回归见 [字体排版验证](typography-verification.md)。

验证日期：**2026-09-13**。环境：Ubuntu 26.04.1 LTS / GNOME Shell 50.1 / GJS 1.88.0 / Node 22.22.1。

本次验收目标：启动时检测网络所在地区，中国大陆沿用原有网络数据源；大陆外（包括香港、澳门、台湾）使用适合境外的网络数据源。地区由 IP 粗略定位判断，不从系统语言或时区推断。

## 逐项验收

| 要求 | 实现及当前证据 |
|---|---|
| 启动时检测 | `extension.js` 的 `enable()` 创建共享 `NetworkSources`；每次启用重新查询，已有上次结果也不跳过。真实启动由 IPIP 返回 `CN`；无网络组件时也检测，之后添加的组件复用结果。 |
| 大陆保持原来源 | 天气 / 搜索：中国气象局；按钮触发的 IP 城市：中国天气网；股票 / 汇率：东方财富；默认 RSS：IT之家。当前基线会话四类组件均取得真实数据，不把错误或占位图当作成功。 |
| 大陆外切换来源 | Open-Meteo 天气 / 世界城市搜索、Frankfurter / ECB 汇率、Yahoo Finance 股票、BBC News 默认 RSS；国家代码 / 省区字段中的港澳台均分流到境外。原生测试分别驱动中国、美国、香港、澳门、台湾结果，核对实际请求 URL 与界面来源。 |
| 不抢跑、不阻塞桌面 | 四个在线组件等待同一个地区决策，不先请求大陆再切换；时钟等本地组件立即建立。延迟检测测试验证检测完成前没有业务请求。 |
| 失败与取消 | IPIP → ipwho.is → ipapi.co，每个请求最多 4 秒、不读写 IP 缓存；全部失败沿用上次成功分组，首次失败暂用原有大陆源并显示失败。禁用取消请求；旧启用周期的迟到结果不能覆盖新结果。 |
| 保留用户配置 | 自定义 RSS（含以前保存的 BBC 地址）不改写；IT之家旧默认迁移为自动源，可手动固定。保留选中的城市、货币、证券，并在 Yahoo 请求中转换常见沪深 / 港股 / 东方财富代码。 |
| 全球天气与金融数据正确解析 | WMO 天气代码转换为现有皮肤代码；天气采用所选城市时区；城市搜索保存坐标而非把 GeoNames ID 当气象站。Yahoo 使用上一交易日基准和交易所时区，ECB 显示参考价日期；不静默混用 CNY / CNH。 |
| 透明状态与隐私 | 顶栏菜单、各组件「i」显示地区 / 来源 / 缓存状态；`GetNetworkStatus` 通过实际 D-Bus 调用验证。只持久化大陆 / 境外分组，不保存 IP 原始响应；GJS 测试检查未创建 IP 缓存文件。 |
| 缓存与部署 | 业务缓存按完整 URL 隔离，验证大陆缓存不会被境外源复用。安装、重装、备份、卸载在临时 XDG 目录验证；ZIP CRC、SHA-256 及所有扩展文件与当前源码逐字节比较通过。 |

## 执行结果

| 命令 / 测试 | 结果 | 证据位置 |
|---|---|---|
| `npm test` | **78** 项通过 | `build/region-unit.log` |
| `python3 scripts/check.py` | **45** 个 JS 模块、schema、**672** 个经典素材 / **253** 个 Fluent 素材核验通过 | `build/region-check.log` |
| `npm run test:network`：GJS 传输层生命周期 / 缓存 | **13** 项通过 | `build/network/platform.json` |
| `npm run test:network`：实际 GNOME 启用 / 禁用与各地区路由 | **120** 项通过 | `build/smoke/network-region/result.json` |
| `npm run test:network:live` | **21** 项通过 | `build/smoke/network-live/result.json`、`providers.json` |
| 城市搜索 / 定位 / GTK 选城 / 预报回归 | **8** 项通过 | `build/smoke/network-location/result.json` |
| `bash scripts/test-shell.sh` | **85** 项基线断言通过；其启动的 GTK 偏好设置子测试 **9** 项通过 | `build/shell-test.bmuslA/artifacts/` |
| `python3 scripts/test-install.py` | **9** 项隔离安装 / 打包检查通过 | `build/region-install.log` |

定位回归的完整命令：

```bash
bash scripts/smoke-shell.sh weather --size large \
  --script tests/smoke/scripts/location.js --out build/smoke/network-location
```

安装包：`dist/classic-gadgets@qinyan.local.shell-extension.zip`，旁边的 `.sha256` 文件提供校验值。本次测试没有安装到用户正在运行的扩展目录，也没有注销、重启或替换用户桌面。

## 真实联网与模拟边界

- 实际启动定位在当前网络返回**大陆**；这一路径及大陆四种业务数据均真实联网验证。
- 不能把同一台机器的运行说成在五个地区实地测试。`network-region` 只控制定位 / 业务响应，验证**真实 GNOME 扩展、请求路由、显示、状态与生命周期**。
- `network-live` 先检查未修改的真实启动检测，再**只控制境外地区响应**。之后的 London 天气 / 世界城市搜索、USD→CNY/EUR/JPY、AAPL / 600519.SS / 0700.HK 行情、BBC RSS 和境外 IP 城市查询均通过发布代码的 `Network` / Soup 发起**真实 HTTPS 请求**；不使用样例冒充业务接口成功。
- 手动坐标路径验证包括 Nominatim 不可用时仍能使用坐标的降级行为，不将该路径成功扩大为服务永久可用的保证。
- IP 定位可能受 VPN、代理、分流规则和运营商出口影响；所有外部接口都可能限流或调整。本次数据可用不代表未来或所有网络可用。未知 / 离线情况有明确回退和错误显示。
- 隔离 GNOME 日志保留了 Clutter 输入焦点、portal 及退出时的已有警告；未声称“零警告”。没有修改或访问用户私人便笺、相册或联系人数据。

## 截图与可核验快照

[境外真实数据桌面](network-global-live-desktop.png) · [全球天气城市设置](network-global-live-options.png)

完整断言、各数据源状态、源码 / 测试 / 安装包 / 截图 SHA-256 见 [network-region-verification.json](network-region-verification.json)。记录生成时，三组地区相关 GNOME 测试的安装副本、最新基线安装副本以及 ZIP 均与当前 `extension/` 核对一致；保留原有素材和皮肤。
