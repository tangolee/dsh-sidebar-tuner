# 更新日志

版本号与 `package.json` 的 `version` 对应。改动后请同步 bump 并打 tag。

## 0.1.0 — 首个公开版本

### 功能

- **三段式字体**：中文字体 + 英文字体 + 回退项，下拉选择，用 `document.fonts.check()` 实测本机是否安装
- **排版旋钮**：扁平字号、整列等比缩放、行高、行距，可任意组合
- **图标列 + 会话列并排**：类 Codex 的两栏侧栏，会话树完整渲染
- **可视化设置面板**：侧栏图标列里的调色板入口，改完即时生效并写入 `override.json`
- **诊断路由**：`/sidebar-tuner/probe`（只回环、只 POST）把侧栏真实 DOM 结构回传到 `~/.dsh/sidebar-tuner/probe.jsonl`

### 设计决策

这些结论都来自实际踩坑，不是预设的架构偏好。

1. **不走客户端模块。**
   最初用 `dsh.client` + `ctx.styles.insert`，但客户端模块要经过「清单枚举 → 投递 → materialize」三道关，全都不在插件控制内。实测出现宿主行 `active`、浏览器端从未执行的空转。
   改为宿主侧 `webserver/index-inject` 直接往 `<head>` 注入 `<style>`，链路只剩两段。

2. **布尔开关走 `<html>` 特性属性。**
   `data-dst-compact` / `data-dst-rail` / `data-dst-push`。
   页面里同时存在内联 `<style>`、`<link>`、`#dst-live` 三份样式来源，重新生成 CSS 只会「加」不会「删」，关掉开关时旧规则依然生效；属性开关增删即生效。

3. **选择器按可读后缀 + 固定 id。**
   `[class*="_sidebarCol"]` 这类后缀匹配不绑死 CSS-module 哈希前缀；入口按钮用 `#dst-rail-entry` 而不是 `div:last-child`，避免 React 插入兄弟节点后失配。

4. **样式表由页面轮询同步。**
   注入脚本每 1.5 秒拉一次 `/sidebar-tuner/tuner.css`，内容变化即写入 `#dst-live`。
   起因：DSH 桌面端是 `dsh-app://` 自定义协议壳，`Ctrl+R` 不保证重载，把「刷新页面」当验证手段是错的。

5. **不在折叠态硬凑会话树。**
   `@deepseek-ai/dsh-client-ui-workspace` 按 `wide` 这个 React prop 二选一渲染，折叠时 `wide: false` 走 `GAkraW_rail` 分支，列表子树根本不创建 —— CSS 无法把未渲染的节点变出来。
   所以改为在展开态重排成「图标列 + 会话列」，`wide` 永远为 `true`。

### 已知限制

见 [README 的「已知限制」](README.md#已知限制) 一节。
