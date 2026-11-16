/**
 * CSS builder shared by the host half and the offline tests.
 *
 * Kept free of any DOM / Node import so it can be unit-tested in a bare node
 * process. All selectors use the readable suffix of DSH's CSS-module class
 * names (`_sidebarCol`, `_panelList`, ...) plus the attributes the Host UI
 * already sets (`data-sidebar-collapsed`, `data-windows-titlebar`), so a DSH
 * upgrade that changes the short hash prefix does not break them.
 */

export const DEFAULTS = Object.freeze({
  fontFamily: '',
  fontFamilyZh: '',
  fontFamilyEn: '',
  fontFallbacks: ['system-ui', 'sans-serif'],
  fontSize: 0,
  fontScale: 1,
  lineHeight: 0,
  rowGap: 0,
  compactLayout: true,
  collapsedRail: false,
  settingsUi: true,
  railWidth: 56,
  panelWidth: 232,
  searchInRail: true,
  pushContent: true,
  zIndex: 30,
});

const GENERIC = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  'emoji', 'math', 'fangsong',
]);

/** 把一个字体名转成合法的 CSS 字体项：generic 不引号，含空格要引号。 */
function quoteFamily(name) {
  const s = String(name || '').replace(/[";{}<>]/g, '').trim();
  if (!s) return '';
  if (GENERIC.has(s.toLowerCase())) return s;
  return /\s/.test(s) ? `"${s}"` : s;
}

/**
 * 组装字体栈：
 *   1. fontFamily 非空 → 直接当原始栈用（高级覆盖）
 *   2. 否则 = 中文字体 + 英文字体 + 回退项，末尾保证有 generic
 */
function buildStack(c) {
  if (c.fontFamily) return String(c.fontFamily).replace(/[;{}<>]/g, '').trim();
  // 只有回退项、没有任何具名字体时不动字体，避免默认就改写侧栏字体
  if (!c.fontFamilyZh && !c.fontFamilyEn) return '';
  const list = [];
  const push = (name) => {
    const q = quoteFamily(name);
    if (q && !list.includes(q)) list.push(q);
  };
  push(c.fontFamilyZh);
  push(c.fontFamilyEn);
  const fallbacks = Array.isArray(c.fontFallbacks)
    ? c.fontFallbacks
    : String(c.fontFallbacks || '').split(',');
  for (const item of fallbacks) push(item);
  if (!list.some((item) => GENERIC.has(item.toLowerCase()))) list.push('sans-serif');
  return list.join(', ');
}

const COL = '[class*="_sidebarCol"]';
const CENTER = '[class*="_centerCol"]';
const FOLDED = '[data-sidebar-collapsed]';
// 展开态（未折叠）的侧栏：内部重排成「图标列 + 会话列」用这个前缀
const BASE_EXPANDED = `[class*="_frame"]:not(${FOLDED})`;

/**
 * 三个布尔开关走 <html> 上的特性属性，而不是「重新生成 CSS」。
 *
 * 页面里同时存在三份样式来源（启动注入的 <style>、tuner.css 链接、运行时的
 * #dst-live），重新生成只会「加」不会「删」，所以关掉开关时旧规则依然在。
 * 改成属性开关后：面板一勾一取消只是增删 html 上的属性，规则立刻生效或失效。
 */
export const FLAG = Object.freeze({
  compact: 'data-dst-compact',
  rail: 'data-dst-rail',
  push: 'data-dst-push',
});
const F_COMPACT = 'html[data-dst-compact]';
const F_RAIL = 'html[data-dst-rail]';
const F_PUSH = 'html[data-dst-push]';
const EXPANDED = `${F_COMPACT} ${BASE_EXPANDED}`;

function num(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function buildCss(input) {
  const c = { ...DEFAULTS, ...(input || {}) };
  const rules = [];

  // ── 1. 字体族（中文 + 英文 + 回退） ────────────────────────────────
  const stack = buildStack(c);
  if (stack) rules.push(`${COL}, ${COL} *{font-family:${stack} !important}`);

  // ── 2. 整列等比缩放（保留层级） ────────────────────────────────────
  const scale = num(c.fontScale, 1, 0.7, 1.6);
  if (scale !== 1) {
    rules.push(`${COL}{overflow:visible !important}`);
    rules.push(`${COL} > *{zoom:${scale} !important}`);
  }

  // ── 3. 扁平字号 ────────────────────────────────────────────────────
  const size = num(c.fontSize, 0, 0, 32);
  if (size > 0) rules.push(`${COL}, ${COL} *{font-size:${size}px !important}`);

  // ── 4. 行高 ────────────────────────────────────────────────────────
  const lineHeight = num(c.lineHeight, 0, 0, 3);
  if (lineHeight > 0) rules.push(`${COL} *{line-height:${lineHeight} !important}`);

  // ── 5. 行距 ────────────────────────────────────────────────────────
  const gap = num(c.rowGap, 0, 0, 24);
  if (gap > 0) {
    const rows = ['_row', '_entry', '_item', '_sessionRow', '_panelRow', '_label', '_title']
      .map((suffix) => `${COL} [class*="${suffix}"]`)
      .join(',\n');
    rules.push(`${rows}{margin-block:${gap}px !important}`);
  }

  // ── 5.5 「侧栏设置」入口：悬浮高亮 + 文字字号 ─────────────────────
  // 该入口由 UI 脚本插进 nav，带固定 id，因此不受插入位置影响。
  // 位置选择器（div:last-child）只在临时兜底时使用。
  rules.push(`#dst-rail-entry{
  border-radius:var(--dsw-radius-md, 8px) !important;
  border-left:var(--dsh-sidebar-paint-inset, 3px) solid transparent !important;
  border-right:var(--dsh-sidebar-paint-inset, 3px) solid transparent !important;
  background-clip:padding-box !important;
  transition:background-color .12s ease;
}`);
  rules.push(`#dst-rail-entry:hover{
  background-color:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16)) !important;
}`);
  rules.push(`#dst-rail-entry > span{
  font-size:inherit !important;
  line-height:inherit !important;
  letter-spacing:inherit !important;
  font-weight:inherit !important;
  margin-left:var(--dsh-sidebar-label-gap, 6px) !important;
}`);
  // 兜底：还没拿到 id 的旧按钮（nav > div > span 只会命中我们的入口，
  // 面板条目是 div > button > span，不会被误伤）
  rules.push(`[class*="_panelList"] > div > span{
  font-size:inherit !important;
  line-height:inherit !important;
  letter-spacing:inherit !important;
  font-weight:inherit !important;
  margin-left:var(--dsh-sidebar-label-gap, 6px) !important;
}`);

  // ── 6. 展开态：内部重排成「左图标列 + 右会话列」（Codex 风格） ──────
  // 关键：不折叠，就不会触发 ui-workspace 的 rail 模式，
  // 会话树始终按 wide=true 正常渲染。
  // 始终生成；由 html[data-dst-compact] 决定是否生效
  if (true) {
    const railW = num(c.railWidth, 56, 40, 96);
    rules.push(`${EXPANDED} ${COL} [class*="_scrollArea"]{
  display:grid !important;
  grid-template-columns:${railW}px minmax(0, 1fr) !important;
  grid-template-rows:minmax(0, 1fr) !important;
  align-items:stretch !important;
  column-gap:0 !important;
  width:100% !important;
  height:100% !important;
}`);
    rules.push(`${EXPANDED} ${COL} [class*="_panelList"]{
  grid-column:1 !important;
  grid-row:1 !important;
  width:${railW}px !important;
  min-width:${railW}px !important;
  padding:6px 4px !important;
  box-sizing:border-box;
  align-items:center !important;
  align-content:start !important;
  overflow-x:hidden !important;
  overflow-y:auto !important;
}`);
    rules.push(`${EXPANDED} ${COL} [class*="_panelEntry"]{
  width:${railW - 16}px !important;
  min-width:${railW - 16}px !important;
  justify-content:center !important;
}`);
    rules.push(`${EXPANDED} ${COL} [class*="_panelRow"]{
  justify-content:center !important;
  padding-inline:0 !important;
}`);
    rules.push(`${EXPANDED} ${COL} [class*="_panelTitle"],
${EXPANDED} ${COL} [class*="_panelUnpin"]{display:none !important}`);
    // GAkraW_root 自带 flex:none，这里让它撑满整列
    rules.push(`${EXPANDED} ${COL} [class*="_regionArea"] > * > *{
  flex:1 1 auto !important;
  max-height:none !important;
  min-height:0 !important;
}`);
    rules.push(`${EXPANDED} ${COL} [class*="_regionArea"]{
  grid-column:2 !important;
  grid-row:1 !important;
  align-self:stretch !important;
  min-width:0 !important;
  width:auto !important;
  height:auto !important;
  max-height:none !important;
  overflow:hidden !important;
  display:flex !important;
}`);
  }

  // ── 7. 折叠态：图标栏 + 计费浮卡（会话树在此时不渲染，见 README） ──
  // 始终生成；由 html[data-dst-rail] 决定是否生效
  if (true) {
    const rail = num(c.railWidth, 56, 40, 96);
    const panel = num(c.panelWidth, 232, 180, 420);
    const z = num(c.zIndex, 30, 1, 900);
    const top = 'var(--dsh-windows-titlebar-height, 40px)';
    const surface = 'var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, Canvas))';
    const border = '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.28))';
    // 两个属性都在同一个 <html> 上，必须写成连续属性选择器，
    // 不能用后代组合子（html 里没有第二个 html）
    const win = `html[data-dst-rail][data-windows-titlebar] ${FOLDED}`;

    // 图标栏顶部要给搜索留一个位置，否则第一个图标会被压住
    const searchOn = c.searchInRail !== false;
    const searchTop = 6;
    const searchHeight = 30;
    const railPadTop = searchOn ? searchTop + searchHeight + 6 : 6;
    // 搜索控件的候选选择器：archive-manager / 原生 ui-workspace / 通用搜索框
    const SEARCH_BASE = [
      '[class*="dsham_searchField"]',
      '[class*="_searchField"]',
      '[class*="_searchBox"]',
      '[class*="_searchInput"]',
      '[class*="_search"] input[type="search"]',
    ];
    // 每个选择器都要单独带作用域前缀，否则多行列表只有第一行生效
    const scopedSearch = (extra = '') => SEARCH_BASE.map((sel) => `${win} ${sel}${extra}`).join(',\n');

    rules.push(`${win} [class*="_panelList"]{
  display:flex !important;
  flex-direction:column !important;
  align-items:center !important;
  gap:2px !important;
  position:fixed !important;
  left:0; top:${top}; bottom:0;
  width:${rail}px !important;
  padding:${railPadTop}px 4px 6px !important;
  box-sizing:border-box;
  overflow:hidden !important;
  background:${surface};
  border-right:${border};
  z-index:${z + 1};
}`);

    // 搜索上移：仅折叠态需要（该状态下会随会话列一并隐藏，保留代码便于后续切换）
    if (false && searchOn) {
      rules.push(`${scopedSearch()}{
  position:fixed !important;
  left:4px; top:calc(${top} + ${searchTop}px);
  width:${rail - 8}px !important;
  height:${searchHeight}px !important;
  padding:0 6px !important;
  box-sizing:border-box;
  z-index:${z + 3};
  transition:width .16s ease, left .16s ease;
}`);
      rules.push(`${scopedSearch(':focus')},
${scopedSearch(':focus-within')}{
  left:${rail + 6}px !important;
  width:${panel - 12}px !important;
}`);
    }

    // 关键：.regionArea 被 .scrollRegion > .scrollArea 两层滚动容器包着。
    // 只要祖先带有 transform / overflow 形成的容纳块，其 position:fixed 就会被
    // 重新锚到那个 0 宽容器里、整块不可见。这里先把这两层容器中性化。
    rules.push(`${win} [class*="_scrollRegion"],
${win} [class*="_scrollArea"]{
  position:static !important;
  transform:none !important;
  filter:none !important;
  contain:none !important;
  overflow:visible !important;
  height:auto !important;
  max-height:none !important;
  width:auto !important;
}`);
    rules.push(`${win} [class*="_scrollFade"]{display:none !important}`);

    rules.push(`${win} [class*="_panelTitle"],
${win} [class*="_panelUnpin"],
${win} [class*="_newSessionLabel"],
${win} [class*="_newSessionShortcut"]{display:none !important}`);

    rules.push(`${win} [class*="_panelRow"],
${win} [class*="_panelEntry"]{
  justify-content:center !important;
  padding-inline:0 !important;
  width:${rail - 16}px !important;
  min-width:${rail - 16}px !important;
}`);

    // 折叠态下 ui-workspace 走 rail 分支、不渲染会话树，
    // 与其摆一个空面板，不如直接收起来，只留图标栏 + 计费浮卡。
    rules.push(`${win} [class*="_regionArea"]{display:none !important}`);

    rules.push(`${win} [class*="_newSessionRow"]{
  display:flex !important;
  position:fixed !important;
  left:${rail}px; top:calc(${top} + 6px);
  width:${panel}px !important;
  padding:0 8px !important;
  box-sizing:border-box;
  z-index:${z + 2};
}`);

    // 始终生成；由 html[data-dst-push] 决定是否生效
    rules.push(`html[data-dst-rail][data-dst-push][data-windows-titlebar] ${FOLDED} ${CENTER}{margin-left:${rail}px !important}`);

    // 计费件等底部区域：折叠时交回 DSH 自己处理（它本来就会把整个 footArea
    // 隐藏）。曾经在这里把 footerActions 强行改成浮动卡片，但计费卡内部是按
    // 整栏宽度 264px 排版的，塞进 232px 的浮层只会压成碎片叠在图标列上，
    // 所以这里不再接管，native 行为就是「折叠后不显示」。

    rules.push(`${win} ${COL}{overflow:visible !important}`);
  }

  return rules.join('\n');
}
