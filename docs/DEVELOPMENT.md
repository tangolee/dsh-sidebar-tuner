# 开发说明

给要改这个插件的人看的。只想装来用的话，看 [README](../README.md) 就够了。

## 目录结构

```
index.js           宿主半边：路由、页面 <head> 注入、设置面板脚本
css.js             纯函数 CSS 构建器（无 DOM、无 Node 依赖，可以单测）
cordis.patch.yml   bundle 补丁与默认配置
examples/          可直接套用的配置示例
docs/              界面示意与本文档
override.json      设置面板写入的运行态（gitignore）
live.css           热加载样式表（gitignore）
```

## 工作原理

```
cordis.patch.yml 的 config
      + <插件目录>/override.json      ← 设置面板写入
      = 合并后的 config → buildCss()
          ├─ <style> 内联行                        首屏就有
          ├─ <link> → /sidebar-tuner/tuner.css     页面每 1.5 秒轮询，改 live.css 自动生效
          └─ 设置面板脚本（图标列里的调色板入口）
```

## 四条经过踩坑的设计决策

1. **不走客户端模块。** 早期版本用 `dsh.client` + `ctx.styles.insert`，但客户端模块要过「清单枚举 → 投递 → materialize」三道关，都不在插件手里，实测出现过宿主侧显示 `active`、浏览器端从未执行的空转。改走宿主侧 `webserver/index-inject` 直接往 `<head>` 注入 `<style>`，链路只剩两段。
2. **布尔开关走 `<html>` 上的特性属性**（`data-dst-compact` / `data-dst-rail` / `data-dst-push`）。页面里同时存在内联 `<style>`、`<link>`、`#dst-live` 三份样式来源，重新生成 CSS 只会「加」不会「删」，关掉开关时旧规则还在；增删属性是即时生效的。
3. **选择器按可读后缀加固定 id**（`[class*="_sidebarCol"]`、`#dst-rail-entry`），不绑 CSS-module 的哈希前缀，也不用 `div:last-child` 这种会被 React 兄弟节点打断的写法。
4. **`live.css` 由页面自动轮询。** DSH 桌面端是 `dsh-app://` 自定义协议壳，`Ctrl+R` 不保证重载，所以不把「刷新页面」当验证手段。

折叠态不渲染会话树也是同理：`@deepseek-ai/dsh-client-ui-workspace` 按 `wide` 这个 React prop 二选一，折叠时列表子树根本不创建，CSS 无法把没渲染的节点变出来。

## 本地开发

```powershell
# 语法检查
node --check index.js
node --check css.js

# 直接看生成的 CSS
node -e "import('./css.js').then(m => console.log(m.buildCss({ fontFamilyZh: 'HarmonyOS Sans SC', lineHeight: 1.55, collapsedRail: true })))"

# 探活：确认宿主路由可达（换成实际 GUI 端口）
Invoke-WebRequest "http://127.0.0.1:<GUI端口>/sidebar-tuner/tuner.css" -UseBasicParsing
```

改 `index.js`、`css.js`、`cordis.patch.yml` 必须完全退出 DSH（含托盘）重启；只改 `live.css` 的话页面 1.5 秒内自己更新。

## 适配声明与版本范围

package.json 的 ngines.dsh 是 DSH **真正执行**的判据：插件管理器用 `@deepseek-ai/dsh-app-boot` 里的 `evaluatePluginCompatibility()` 读它（semver，且带 `includePrerelease`），不满足就拒装/拒启用；`dsh.compatibility` 只是给插件市场看的元数据，宿主不读。两个都写，但以 `engines.dsh` 为准。

- 声明范围：`>=0.2.0-rc.1 <0.3.0-0`；实测 `0.2.2-rc.3`。
- 页面自检：面板顶部按样式锚点（`_sidebarCol` / `_panelList` / `_centerCol`）判断，缺一个就变黄；`window.__DSH_BOOT__.version` 读得到就顺带显示版本，读不到只报「已适配」。宿主不向插件暴露版本，所以没有宿主侧握手。
- 改完范围一定要用 DSH 自己的判定跑一遍，别肉眼比 semver：

\\\js
const { evaluatePluginCompatibility } = await import('file:///…/DSH/resources/app/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js');
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const host of ['0.2.0-rc.1', '0.2.2-rc.3', '0.3.0-beta.1']) {
  const issue = evaluatePluginCompatibility(manifest, {}, host);
  console.log(host, issue === undefined ? 'OK' : issue.requirements);
}
\\\

## 判断本机装了哪些字体

面板要在下拉里标出「✓ 已装」和「（未安装）」。别用 `document.fonts.check()` —— 它只认 `@font-face` 声明过的字体，**系统字体一律返回 true**，结果就是所有字体都显示成「装了」。

现在的做法是用 canvas 量宽度：

```js
for (const base of ['monospace', 'sans-serif', 'serif']) {
  ctx.font = `72px ${base}`;              const before = ctx.measureText(probe).width;
  ctx.font = `72px "${name}", ${base}`;   const after  = ctx.measureText(probe).width;
  if (Math.abs(after - before) > 0.5) return true;   // 有差异＝候选字体确实参与了渲染
}
```

三个通用族任一个出现宽度差异就算是装了，结果按字体名缓存在 `fontCache` 里。通用族（`system-ui`、`monospace` 等）直接当作可用。这个办法不需要 `queryLocalFonts()`（有用户授权门槛），也不受浏览器字体枚举限制。

## 字体栈为什么英文在前

`buildStack()` 拼的是「英文字体 → 中文字体 → 回退」。看着反直觉，但这是唯一能让两者各管一段的排法：浏览器**按字形**逐个回退，而中文字体几乎都带完整的拉丁字形。把中文排前面时，`A`、`b`、`1` 都能在中文字体里找到，英文字体永远轮不到——面板里选了也白选。

反过来英文字体没有中日韩字形，中文会自动落到后面的中文字体上。实测（Chromium，同一句 `AVATAR Wavy Quick brown fox 0123`）：

| 栈 | 宽度 | 结论 |
|---|---|---|
| `"HarmonyOS Sans SC", "Inter"` | 263.38 px | 等于只用中文字体的宽度，Inter 没被用上 |
| `"Inter", "HarmonyOS Sans SC"` | 274.63 px | 等于只用英文字体的宽度，Inter 生效 |

中文文本在两种顺序下宽度一致（差 0.2px，来自空格字形），说明换顺序没有把中文带歪。

## 内容区字体为什么不能只改一个变量

DSH 的内容排版不是「一个 font-size」，而是一条派生链（见 `@deepseek-ai/dsh-client-ui-theme/src/styles/gradient-shadow-text.css`）：

```css
--dsh-content-font-size: 14px;                    /* 设置 → 外观 → 字号 写在这里 */
--dsh-content-font-delta: calc(var(--…size) - 14px);
--dsh-content-font-size-secondary: min(calc(var(--…size) - 1px), max(13px, calc(var(--…size) - 2px)));
--dsh-content-font-delta-secondary: calc(var(--…size-secondary) - 13px);
```

正文、标题、表格、工具行、图标尺寸、间距全在用 `calc(Npx + var(--dsh-content-font-delta))`。这些变量在 `:root` 上就算成了具体值，**在子元素上只改 `--dsh-content-font-size` 不会带动 delta**，结果是字变大了、行高还是 14px 的档位。

所以内容列上要四件套一起写（`css.js` 第 9 段），delta 用 `calc()` 现算，让整条链在内容列重新求值：

```css
[class*="_centerCol"]{
  --dst-content-size: 18px;
  --dsh-content-font-size: var(--dst-content-size);
  --dsh-content-font-delta: calc(var(--dst-content-size) - 14px);
  --dsh-content-font-size-secondary: min(calc(var(--dst-content-size) - 1px), max(13px, calc(var(--dst-content-size) - 2px)));
  --dsh-content-font-delta-secondary: calc(var(--dsh-content-font-size-secondary) - 13px);
}
```

字体族同理：`--dsw-font-family` 和 markdown 的 `--dsw-font-markdown-*` 令牌也在 `:root` 解析过，所以除了给 `--dsw-font-family`，还要直接对内容列下 `font-family` 规则（`!important` 压过模块里的 `font:` 简写），并用 `:not(pre):not(code):not(kbd):not(samp):not(textarea)` 把等宽的地方摘出去。

一个坑：`num(value, fallback, min, max)` 会把 0 夹到区间下限，所以「0 表示关闭」的字段要先按 `min=0` 兜住再判断，否则 `contentFontSize: 0` 会变成 10px 写进 CSS（这个 bug 就是靠假 DOM 跑出来的：不配内容字号时正文被压成 10px）。

代码那块单独说一句：字体变量是 `--ds-font-family-code`（`ds`，不是 `dsh`），字号是 `--dsh-code-font-size` 加派生的 `--dsh-code-font-delta`（`calc(size - 11px)`），默认 11px、范围 10–16。markdown 的 `--dsw-font-markdown-code-block` 这类令牌同样在 `:root` 就拼好了，所以除了给变量，还要直接对 `[class*="_centerCol"] pre / code / kbd / samp` 下 `font-family` 和 `font-size`。

## 图标

入口图标不画，直接从 [Lucide](https://lucide.dev)（ISC）取：`lucide-static` v1.73.0 的 `palette` / `sliders-horizontal` / `swatch-book` / `paintbrush`，路径原样内联进 `RAIL_ICONS`，只把 `stroke-width` 调成 1.8（24 网格在 16px 下约 1.2px 线宽，跟 DSH 侧栏邻居对齐）。渲染用 `currentColor` + `fill="none"`，所以主题切换、hover 变色都不用额外处理。

图标必须内联：不要改成 <img src>、<use href> 或任何 CDN 地址，否则断网/内网环境下面就掉图。

加一枚图标就是往 RAIL_ICONS 里加一条 `名字: '<path …/>'`，再把名字放进 `ICON_NAMES` 并在面板的 `ICON_LABELS` 里给个中文名。换库要连 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) 一起改。

## 图标悬停提示

图标列只留图标时，`css.js` 把每一项的 `[class*="_panelTitle"]` 藏掉，名字还在 DOM 里但看不见。提示气泡就是把这行文字读回来再画一次。

- **脚本**：`index.js` 的 `TIP_SCRIPT`，独立注入（`settingsUi: false` 也有）。
- **绑定**：事件委托挂在 `[class*="_panelList"]` 上，React 重渲染替换子节点也不会掉；每次事件从 `event.target` 往上找到 rail 的直接子元素再取名字。
- **取名顺序**：`data-dst-label`（我们自己那个入口）→ 子节点里的 `_panelTitle` 文本 → `aria-label` / `title` → 子元素里的第一个 `aria-label` / `title`。
- **不重复弹**：标题节点还在屏幕上（非并排布局）时直接不显示。
- **原生 title 会让位**：悬停期间把持有者的 `title` 摘掉，移开再装回，避免两套气泡重叠。
- **样式**：气泡节点 `#dst-tip` 的样式在 `css.js` 第 8 段，改 `live.css` 即可热调。
- **开关**：`html[data-dst-tip]` 不存在时气泡永不显示，面板勾选只是增删这个属性。

## 把某块区域排除在字体缩放之外

侧栏底部动作槽里挂着计费卡片这类第三方控件，它们按自己的像素排版，跟着放大只会挤成一团。`fontExclude`（默认 `['[data-slot="sidebar.footer.action"]']`）就是这块的开关，两条路子并用：

- **字体 / 字号 / 行高 / 行距**：规则后缀拼成 `:not(A):not(A *)`，A 自己和 A 里面的一切都不命中。`A *` 是 Selectors Level 4 的复杂选择器写法（Chromium 88 / Firefox 84 起支持），写错了整条规则会被浏览器丢弃，所以改这里要连着验。
- **整列缩放**：`zoom` 沿树累乘，直接给 `A{zoom:1/scale}` 就能把外层的放大抵消掉。实测 Chromium 157：外层 1.2 + 内层 0.8333，100px 量回 99.98px。

验证办法：造一个假侧栏（`x_sidebarCol` / `x_panelList` / `x_regionArea` / `data-slot="sidebar.footer.action"`），套上 `buildCss({ fontSize: 17, fontScale: 1.2 })`，量三处 `getComputedStyle().fontSize` 和一个固定 100px 盒子的宽度。默认配置下应该是：会话列 17px、计费卡片 12px（它自己的）、盒宽 99.98；把 `fontExclude` 改成 `[]` 后计费卡片会变成 17px、盒宽 120。

面板那边「不改字体的区域」两个勾选项对应 `KEEP_PRESETS` 里的两条选择器：回填时看 `fontExclude` 是否包含该选择器，剩下的选择器写进「其它区域」输入框；保存时勾选项 + 输入框合并回 `fontExclude`。所以手写 yml 和面板改的是同一个键，不会各存一份。

## 排侧栏真实 DOM

把 `debugDump` 打开，然后：

```powershell
Invoke-WebRequest "http://127.0.0.1:<GUI端口>/sidebar-tuner/probe" -Method POST `
  -Body '{"ping":1}' -ContentType application/json -UseBasicParsing
```

结构写到 `%USERPROFILE%\.dsh\sidebar-tuner\probe.jsonl`。排查完记得把 `debugDump` 关掉。

## 两台电脑怎么同步

源码只走 GitHub 一份，两边各自 `link:` 安装，路径可以不同（README 里的 `<你的源码目录>` 就是留这个位置）。

- 开工前 `git pull --rebase`，收工后 push，不要两边各改同一处再强推。
- `override.json` 和 `live.css` 在 `.gitignore` 里，不会跟着 git 走，换机器要重设或者手动拷 `override.json`。

## 提交约定

```powershell
git add -A
git commit -m "feat: ..."     # feat / fix / docs / chore
git tag v0.1.1                # 与 package.json 的 version 同步
git push --tags
```

版本号三处要对上：`package.json`、`CHANGELOG.md`、git tag。


