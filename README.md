# dsh-sidebar-tuner

> DSH 桌面端的左侧栏定制插件：三段式字体、字号、行高、行距、图标列 + 会话列并排，带可视化设置面板。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.1.0-green.svg)](CHANGELOG.md)
[![platform](https://img.shields.io/badge/platform-DSH%20desktop-4B6EF5.svg)](#安装)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

纯宿主侧实现：样式通过 DSH 的 `webserver/index-inject` 写进页面 `<head>`，**不修改任何其它插件的文件、DOM 或代码**。

---

## 特性

| | |
|---|---|
| **三段式字体** | 中文字体 + 英文字体 + 回退项，下拉选择，自动检测本机是否安装 |
| **字号 / 行高 / 行距** | 四个独立旋钮，可按需组合，也可整列等比缩放 |
| **图标列 + 会话列并排** | 类 Codex 的两栏侧栏，会话树完整渲染 |
| **可视化设置面板** | 侧栏图标列里的调色板入口，改完即时生效并持久化 |
| **零侵入** | 只做样式注入与自己的 DOM，不碰别的插件 |
| **可自检** | 内置只回环的诊断路由，把真实 DOM 结构回传到本地文件 |

## 界面

<p align="center">
  <img src="docs/layout.svg" alt="侧栏布局示意：56px 图标列 + 会话列 + 内容列" width="720">
</p>

| 区域 | 宽度 | 说明 |
|---|---|---|
| 图标列 | `railWidth`（默认 56px） | 插件入口 / 插件市场 / 技能 / 自动化任务 / 上下文洞察 / 任务看板 / Purge / 更多，末尾是调色板入口 |
| 会话列 | 侧栏宽度 − 图标列 | 新会话按钮 + 工作区分组 + 会话列表，由 `ui-workspace` 渲染 |
| 内容列 | 剩余 | 对话区，本插件不介入 |

侧栏总宽仍由 DSH 控制（可拖拽分隔条），图标列固定，会话列自动吃掉剩下的宽度。

## 安装

### 从 GitHub 安装

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"

# 仓库为 public，无需额外授权
pnpm add "github:tangolee/dsh-sidebar-tuner"
```

然后把包名登记进 profile 的 bundle 列表 —— 打开同目录 `package.json`，在 `dsh.profile.bundles` 数组里追加一项：

```json
"dsh.profile.bundles": [
  "...",
  "dsh-sidebar-tuner"
]
```

**完全退出 DSH（含托盘）再打开**。宿主模块在启动时载入内存，改动磁盘文件对运行中的进程无效。

### 本地开发安装

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add "dsh-sidebar-tuner@link:D:/Develop/gitrepository/dsh-sidebar-tuner"
```

`link:` 指向源码目录，改完重启即可生效；也可以在设置面板里改配置，不必重启。

### 卸载

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm remove dsh-sidebar-tuner
```

并从 `dsh.profile.bundles` 里删掉 `dsh-sidebar-tuner` 一行。**注意**：`link:` 安装时 `pnpm remove` 只删链接，不会删源码目录；但某些工具的 `--uninstall` 会穿透 junction 删掉目标，卸载前建议先备份源码目录。

## 配置

配置写在 `profiles/<profile>/cordis.patch.yml` 的 `sidebar-tuner` 段，也可以在设置面板里改（面板写入插件目录下的 `override.json`，**优先级高于 yml**）。

完整带注释的示例见 [`examples/cordis.patch.example.yml`](examples/cordis.patch.example.yml)。

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `fontFamily` | string | `''` | 原始字体栈，非空时压过下面三项 |
| `fontFamilyZh` | string | `''` | 中文字体名 |
| `fontFamilyEn` | string | `''` | 英文字体名 |
| `fontFallbacks` | string[] | `[system-ui, sans-serif]` | 回退项，按序追加到栈尾 |
| `fontSize` | number | `0` | 扁平字号 px，`0` = 关闭（抹平层级） |
| `fontScale` | number | `1` | 整列等比缩放，`1` = 关闭（保留层级） |
| `lineHeight` | number | `0` | 行高倍数，`0` = 关闭 |
| `rowGap` | number | `0` | 行距 px，`0` = 关闭 |
| `compactLayout` | boolean | `true` | 图标列 + 会话列并排 |
| `collapsedRail` | boolean | `false` | 折叠时保留图标栏 |
| `pushContent` | boolean | `true` | 折叠时推挤内容列（`false` = 覆盖） |
| `railWidth` | number | `56` | 图标列宽 px |
| `settingsUi` | boolean | `true` | 注入调色板入口与设置面板 |
| `debugDump` | boolean | `false` | 回传侧栏真实 DOM 结构到 `~/.dsh/sidebar-tuner/probe.jsonl` |

### 字体栈生成规则

```
font-family: "<中文字体>", "<英文字体>", system-ui, sans-serif;
```

- 只填回退项、没选具名字体时**完全不改写字体**（避免意外覆盖原样）
- generic 家族（`system-ui` / `sans-serif` 等）不加引号，含空格的具体字体名自动加引号
- 末尾强制补一个 generic，防止字体缺失时掉到衬线
- `fontFamily` 非空时直接用它，跳过上面三段

## 设置面板

点图标列末尾的调色板入口，弹出浮层表单：

| 分组 | 控件 |
|---|---|
| 字体 | **中文字体**（下拉）· **英文字体**（下拉）· **回退**（`system-ui` / `sans-serif` / `serif` / `monospace` 复选） |
| 排版 | **字号 px**（0 = 关）· **整列缩放**（1 = 关）· **行高**（0 = 关）· **行距 px**（0 = 关） |
| 布局 | **图标列宽 px** · **图标列 + 会话列并排** · **折叠时保留图标栏** · **折叠时推挤内容列** |
| 底部 | `应用并保存` · `恢复默认` · 右上角 `×` 关闭 |

- 关闭方式：右上角 `×`、按 `Esc`、点击面板外部
- 字体下拉用 `document.fonts.check()` 实测，未安装的标「· 未检测」
- 布尔开关**勾选即生效**（增删 `<html>` 上的特性属性，不重算 CSS）
- 数字项点「应用并保存」后生效：写入 `override.json` → 直接替换页面里的 `#dst-live`，**无需刷新、无需重启**

## 为什么需要它

DSH 的字号有三条互不相通的线：

| 线 | 变量 / 写法 | 是否跟随「设置 → 外观 → 字号」 |
|---|---|---|
| 内容线 | `--dsh-content-font-size` → `--dsh-content-font-delta` → `calc()` | ✅ 跟随 |
| 设计系统 token | `--dsw-font-xs-13: 13px/20px` | ❌ 写死 px |
| 组件内联 | 侧栏 `ui-workspace` 直接 `font-size:12px/13px/14px` | ❌ 写死 px |

左侧栏全在第三条线上，所以设置里的字号改不到它，只能从页面样式覆盖。

## 工作原理

```
cordis.patch.yml 的 config
      + <插件目录>/override.json      ← 设置面板写入
      = 合并后 config → buildCss()
          ├─ <style> 内联行                      首屏
          ├─ <link> → /sidebar-tuner/tuner.css   页面每 1.5s 轮询，改 live.css 自动生效
          └─ 设置面板脚本（图标列里的调色板入口）
```

四条与稳定性直接相关的设计决策，都是踩坑后的结论：

1. **不依赖客户端模块。** 早期版本走 `dsh.client` + `ctx.styles.insert`，但客户端模块要经过「清单枚举 → 投递 → materialize」三道关，都不在插件控制内，实测出现宿主行 `active` 而浏览器端从未执行。改走宿主侧 `index-inject` 后链路只剩两段。
2. **布尔开关走 `<html>` 特性属性**（`data-dst-compact` / `data-dst-rail` / `data-dst-push`）。页面里同时存在内联 `<style>`、`<link>`、`#dst-live` 三份样式来源，重新生成 CSS 只会「加」不会「删」，关掉开关时旧规则依然在；属性开关增删即生效。
3. **选择器按可读后缀 + 固定 id 匹配**，不绑死 CSS-module 哈希前缀；入口用 `#dst-rail-entry` 而不是 `div:last-child`，避免 React 插入兄弟节点后失配。
4. **改 `live.css` 由页面自动轮询生效。** DSH 桌面端是 `dsh-app://` 自定义协议壳，`Ctrl+R` 不保证重载，所以不把「刷新页面」当验证手段。

## 已知限制

- **折叠态不渲染会话树。** `@deepseek-ai/dsh-client-ui-workspace` 按 `wide` 这个 React prop 二选一渲染，折叠时 `wide: false` 走 `GAkraW_rail` 分支，列表子树根本不创建 —— CSS 无法把未渲染的节点变出来。所以本插件改为在**展开态**重排成「图标列 + 会话列」，折叠此时表示「全部收起」。
- **折叠时计费件不显示。** 交回 DSH 原生行为（原生会隐藏整个 `footArea`）。
- **DSH 升级后可能需要微调选择器。** 规则都基于 `[class*="_后缀"]` 与 `data-*` 属性，但 DSH 若改动侧栏内部结构，`css.js` 需要跟着调。
- **只影响左侧栏。** 右侧栏与对话区不受影响（这是刻意的）。

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 装了但完全没变化 | 宿主模块未重载 | 完全退出 DSH（含托盘）再打开 |
| 改了 `live.css` 看不到效果 | 轮询脚本还是旧版本 | 重启一次，之后 1.5s 内自动生效 |
| 折叠后没有会话列表 | 见「已知限制」 | 用展开态的两栏布局，或关掉 `compactLayout` |
| 字体没变 | 选中的字体本机没装 | 下拉里标「· 未检测」的就是没装的 |
| 字号看起来比邻居小 | 自定义节点未继承 | 本版用固定 id `#dst-rail-entry` + `font-size: inherit`，正常 |
| 想确认插件是否在跑 | 用诊断路由 | 见下方「开发」 |

## 开发

```powershell
# 语法检查
node --check index.js
node --check css.js

# 直接看生成的 CSS
node -e "import('./css.js').then(m => console.log(m.buildCss({ fontFamilyZh: 'HarmonyOS Sans SC', lineHeight: 1.55, collapsedRail: true })))"

# 诊断：确认宿主路由可达（换成实际 GUI 端口）
Invoke-WebRequest "http://127.0.0.1:<GUI端口>/sidebar-tuner/tuner.css" -UseBasicParsing

# 诊断：开启 debugDump 后，采集侧栏真实 DOM 结构
Invoke-WebRequest "http://127.0.0.1:<GUI端口>/sidebar-tuner/probe" -Method POST `
  -Body '{"ping":1}' -ContentType application/json -UseBasicParsing
# 记录落在 %USERPROFILE%\.dsh\sidebar-tuner\probe.jsonl
```

### 目录结构

```
index.js           宿主半边：路由、index 注入、设置面板脚本
css.js             纯函数 CSS 构建器（无 DOM、无 Node 依赖，可单测）
cordis.patch.yml   bundle 补丁与默认配置
examples/          可直接套用的配置示例
CHANGELOG.md       版本与设计决策记录
override.json      设置面板写入的运行态（gitignore）
live.css           热加载样式表（gitignore）
```

### 提交约定

```powershell
git add -A
git commit -m "feat: ..."     # feat / fix / docs / chore
git tag v0.1.1                # 与 package.json 的 version 同步
git push --tags
```

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

[MIT](LICENSE) © 2026 tangolee
