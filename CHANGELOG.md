# 更新日志

版本号与 `package.json` 的 `version` 对应；每次改动请同步 bump 并打 tag。

## 0.6.1

- 抽出 `css.js`，CSS 构建变成可单测的纯函数（无 DOM、无 Node 依赖）
- 状态接口 `/sidebar-tuner/state` 同时返回配置与生成结果，设置面板一次往返即完成应用
- 修正折叠态 `pushContent` 与 `collapsedRail` 的选择器作用域

## 0.6.0

- **页面自动同步样式表**：注入脚本每 1.5 秒拉一次 `/sidebar-tuner/tuner.css`，内容变化即写入 `#dst-live`
  - 起因：DSH 桌面端是 `dsh-app://` 自定义协议壳，`Ctrl+R` 不保证重载，把「刷新页面」当验证手段是错的
- 宿主启动时把当前配置写入 `live.css`，磁盘与运行时状态保持一致

## 0.5.7 – 0.5.9

- 图标列入口改用固定 id `#dst-rail-entry`，不再依赖 `div:last-child` 的位置选择器
  - 起因：React 在该节点之后插入兄弟节点时，位置选择器失配，字号与悬浮高亮会一起失效
- 悬浮高亮对齐 DSH 的 `panelEntry`：`--dsw-radius-md` 圆角 + `--dsh-sidebar-paint-inset` 内缩描边 + `background-clip: padding-box`
- 修掉 `html[data-dst-rail] html[data-windows-titlebar]` 这类后代选择器（两个属性都在同一个 `<html>` 上，永远不匹配）

## 0.5.4 – 0.5.6

- 入口按钮在非并排布局下显示中文名「侧栏设置」，字号与邻居一致（`font-size: inherit` + 读取邻居 computed 值）
- 增加关闭方式：右上角 `×`、`Esc`、点击面板外部

## 0.5.0 – 0.5.3

- 设置面板：图标列里的调色板入口 + 浮层表单
- 字体族拆成「中文 / 英文 / 回退」三段式，下拉项用 `document.fonts.check()` 实测，未安装标「· 未检测」
- 布尔开关改走 `<html>` 特性属性（`data-dst-compact` / `data-dst-rail` / `data-dst-push`）
  - 起因：页面里同时存在内联 `<style>`、`<link>`、`#dst-live` 三份样式来源，重新生成 CSS 只会「加」不会「删」，关掉开关时旧规则依然生效

## 0.3.0 – 0.4.0

- **放弃「折叠态显示会话」路线**：`@deepseek-ai/dsh-client-ui-workspace` 按 `wide` 这个 React prop 二选一渲染，折叠时走 `GAkraW_rail` 分支，列表子树根本不创建，CSS 无法把未渲染的节点变出来
- 改为在展开态把侧栏重排成「图标列 56px + 会话列」，`wide` 永远为 `true`
- 撤销对计费件的接管：折叠时交回 DSH 原生行为（原生就是隐藏整个 `footArea`）

## 0.2.0

- **架构转向**：从「客户端模块 + `ctx.styles.insert`」改为「宿主侧 `webserver/index-inject`」
  - 起因：客户端模块要经过「清单枚举 → 投递 → materialize」三道关，都不在插件控制内，实测出现宿主行 `active` 但浏览器端从未执行

## 0.1.0 – 0.1.2

- 首版：行高、行距、字号、整列缩放
- 折叠态图标栏雏形
- 诊断路由 `/sidebar-tuner/probe`（只回环、只 POST），把侧栏真实 DOM 结构回传到 `~/.dsh/sidebar-tuner/probe.jsonl`
