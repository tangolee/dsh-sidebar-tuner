# dsh-sidebar-tuner

给 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）桌面端用的**左侧栏定制插件**。

- 字体族：中文字体 / 英文字体 / 回退项三段式，下拉选择，自动检测本机是否安装
- 字号、整列缩放、行高、行距
- 图标列 + 会话列**并排**布局（类 Codex）
- 侧栏图标列里带一个调色板入口，点开是**可视化设置面板**，改完即时生效并持久化

纯宿主侧实现：样式通过 webserver 的 `index-inject` 写进页面 `<head>`，**不改动任何其它插件的文件、DOM 或代码**。

## 安装

### 从 GitHub 安装（推荐）

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
cd $profile

# 私有仓库需要先 gh auth login，或用带 token 的 URL
pnpm add "github:tangolee/dsh-sidebar-tuner"
```

然后把包名登记进 profile 的 bundle 列表 —— 打开 `package.json`，在 `dsh.profile.bundles` 数组里追加一项：

```json
"dsh.profile.bundles": [
  "...",
  "dsh-sidebar-tuner"
]
```

完全退出 DSH 再打开即可。

### 本地开发安装

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add "dsh-sidebar-tuner@link:D:/Develop/gitrepository/dsh-sidebar-tuner"
```

`link:` 装的是源码目录，改完只需重启 DSH（或等页面轮询到新 CSS）。

## 配置

所有配置都在 `profiles/<profile>/cordis.patch.yml` 的 `sidebar-tuner` 段，也可以在设置面板里改（面板写入 `override.json`，优先级高于 yml）。

| 键 | 说明 | 默认 |
|---|---|---|
| `fontFamily` | 原始字体栈，非空时压过下面三段式 | `''` |
| `fontFamilyZh` | 中文字体名 | `''` |
| `fontFamilyEn` | 英文字体名 | `''` |
| `fontFallbacks` | 回退项数组，如 `[system-ui, sans-serif]` | `[system-ui, sans-serif]` |
| `fontSize` | 扁平字号 px，`0` = 关闭 | `0` |
| `fontScale` | 整列缩放，`1` = 关闭 | `1` |
| `lineHeight` | 行高倍数，`0` = 关闭 | `0` |
| `rowGap` | 行距 px，`0` = 关闭 | `0` |
| `compactLayout` | 图标列 + 会话列并排 | `true` |
| `collapsedRail` | 折叠时保留图标栏 | `false` |
| `railWidth` | 图标列宽 px | `56` |
| `pushContent` | 折叠时推挤内容列 | `true` |
| `settingsUi` | 注入调色板入口与设置面板 | `true` |
| `debugDump` | 把侧栏真实 DOM 结构回传到 `~/.dsh/sidebar-tuner/probe.jsonl` | `false` |

字体栈生成规则：

```
font-family: "<中文字体>", "<英文字体>", system-ui, sans-serif;
```

- 只填回退项、没选具名字体时**完全不改写字体**
- 末尾强制补一个 generic，避免字体缺失时掉到衬线
- 面板里的下拉会用 `document.fonts.check()` 实测，没装的字体标「· 未检测」

## 为什么需要它

DSH 的字号有三条互不相通的线：

| 线 | 变量 / 写法 | 是否跟随「设置 → 外观 → 字号」 |
|---|---|---|
| 内容线 | `--dsh-content-font-size` → `--dsh-content-font-delta` → `calc()` | ✅ |
| 设计系统 token | `--dsw-font-xs-13: 13px/20px` 等 | ❌ 写死 px |
| 组件内联 | 侧栏 `ui-workspace` 直接 `font-size:12px/13px/14px` | ❌ 写死 px |

所以设置里的字号改不到左栏，只能从页面样式覆盖。

## 实现要点

```
cordis.patch.yml 的 config
      + <插件目录>/override.json      ← 设置面板写入
      = 合并后 config → buildCss()
          ├─ <style> 内联行                    首屏
          ├─ <link> → /sidebar-tuner/tuner.css 热加载（页面每 1.5s 轮询）
          └─ 设置面板脚本（图标列里的调色板入口）
```

四条与稳定性相关的设计：

1. **不依赖客户端模块。** 早期版本走 `dsh.client` + `ctx.styles.insert`，但客户端模块的清单与 materialize 时机不在插件控制内，实测出现「宿主行 active、浏览器里没跑」的空转。改为宿主侧 `index-inject` 后链路只剩两段。
2. **布尔开关走 `<html>` 特性属性**（`data-dst-compact` / `data-dst-rail` / `data-dst-push`），不靠"重新生成 CSS"——页面里同时存在内联 `<style>`、`<link>`、`#dst-live` 三份样式来源，重新生成只会"加"不会"删"，关掉开关时旧规则依然在。属性开关增删即生效。
3. **选择器按可读后缀 + 固定 id 匹配**，不绑死 CSS-module 哈希前缀；入口按钮用 `#dst-rail-entry` 而不是 `div:last-child`，避免 React 插入兄弟节点后失配。
4. **改 `live.css` 后页面自动轮询生效**（1.5s），桌面端 `dsh-app://` 壳不保证 `Ctrl+R` 重载，所以不把刷新当解法。

## 已知限制

- **折叠态不渲染会话树**：`@deepseek-ai/dsh-client-ui-workspace` 按 `wide` 这个 React prop 二选一渲染，折叠时 `wide: false` 走 `GAkraW_rail` 分支，**列表子树根本不创建**，CSS 无法把未渲染的节点变出来。所以本插件改为在**展开态**把侧栏重排成「图标列 + 会话列」；折叠按钮此时表示"全部收起"。
- **DSH 升级后可能需要微调选择器**：所有选择器都基于 `[class*="_后缀"]` 与 `data-*` 属性，但 DSH 若改动侧栏内部结构，`css.js` 里的规则需要跟着调。
- **折叠时计费件不显示**：交回 DSH 原生行为（折叠即隐藏整个 `footArea`）。

## 目录结构

```
index.js           宿主半边：路由、index 注入、设置面板脚本
css.js             纯函数 CSS 构建器（无 DOM / 无 Node 依赖，可单测）
cordis.patch.yml   bundle 补丁与默认配置
override.json      设置面板写入的运行态（已 gitignore）
live.css           热加载样式表（已 gitignore）
```

## 开发

```powershell
# 语法检查
node --check index.js
node --check css.js

# 生成 CSS 看看结果
node -e "import('./css.js').then(m=>console.log(m.buildCss({fontFamilyZh:'HarmonyOS Sans SC',lineHeight:1.55,collapsedRail:true})))"

# 诊断回传（开启 debugDump 后）
Invoke-WebRequest -Uri "http://127.0.0.1:<GUI端口>/sidebar-tuner/probe" -Method POST `
  -Body '{"ping":1}' -ContentType 'application/json' -UseBasicParsing
# 记录落到 %USERPROFILE%\.dsh\sidebar-tuner\probe.jsonl
```

## License

MIT
