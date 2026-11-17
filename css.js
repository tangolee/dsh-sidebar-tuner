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
  railTooltips: true,
  // 图标列入口用哪一枚图标：palette / sliders / swatch / brush（都来自 Lucide）
  railIcon: 'sliders',
  // 内容区（对话）字体。空 / 0 表示跟随 DSH 自己的「设置 → 外观」。
  contentFont: '',
  contentFontZh: '',
  contentFontEn: '',
  contentFontFallbacks: ['system-ui', 'sans-serif'],
  contentFontSize: 0,
  contentLineHeight: 0,
  // 内容区的等宽字体（代码块 / 行内代码）。空 = 跟随 DSH 的代码字体设置。
  contentCodeFont: '',
  contentCodeFontSize: 0,
  // ── 0.3.0 新增：字距 / 字重 / OpenType 特性（侧栏与对话共用一套取值）──
  // letterSpacing 单位 em，0 = 不改；fontWeight 0 = 不改（用 DSH 自己的字重）
  letterSpacing: 0,
  fontWeight: 0,
  // 支持的 OpenType 特性：calt / case / tnum / ss01 / cv11
  fontFeatures: [],
  // ── 0.3.0 新增：终端（xterm）──────
  // 终端字体族：空 = 跟随代码字体；只作用于终端容器，不动全局 --ds-font-family-code
  terminalFontFamily: '',
  // 终端字号 px，0 = 关闭（xterm 内部硬编码 13，改动有度量错位风险，默认关）
  terminalFontSize: 0,
  // 终端字距 px（xterm 的 letterSpacing 选项，同样只在创建时读）
  terminalLetterSpacing: 0,
  // 终端连字（font-feature-settings: calt/liga）
  terminalLigatures: false,
  // 跟随代码字体：勾上时忽略 terminalFontFamily
  terminalFollowCode: true,
  // 不跟字体/行高/缩放走的区域。默认是侧栏底部的动作槽：
  // 计费卡片按自己的像素排版，跟着放大缩小只会挤成一团。
  fontExclude: ['[data-slot="sidebar.footer.action"]'],
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
 *   2. 否则 = 英文字体 + 中文字体 + 回退项，末尾保证有 generic
 *
 * 英文一定要排在中文前面。浏览器是逐字形回退的：中文字体（思源黑体、苹方、
 * 微软雅黑……）基本都带一套拉丁字形，中文排前面时英文也会被它命中，
 * 选的英文字体就永远轮不到。反过来英文字体没有中日韩字形，
 * 中文自然落到后面的中文字体上，两边各管各的。
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
  push(c.fontFamilyEn);
  push(c.fontFamilyZh);
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

/** fontExclude 既接受数组，也接受逗号分隔的字符串（面板里的输入框）。 */
function normalizeExcludes(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,，]/);
  return list.map((item) => String(item || '').trim()).filter(Boolean);
}

/**
 * 把「不跟字体缩放走」的区域变成 :not(...) 链。
 *
 * `:not(A *)` 排除 A 里面的一切，`:not(A)` 再排除 A 自己。
 * 这是 Selectors Level 4 的复杂选择器写法，Chromium 88 / Firefox 84 起支持；
 * 不写就退化成原来的「整列通吃」行为。
 */
function exclusionChain(selectorList) {
  const list = normalizeExcludes(selectorList);
  if (!list.length) return '';
  return list.map((item) => `:not(${item}):not(${item} *)`).join('');
}

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
  tip: 'data-dst-tip',
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
  // 排除区（默认：侧栏底部动作槽里的计费卡片）不吃字体规则
  const keep = exclusionChain(c.fontExclude);
  if (stack) rules.push(`${COL}${keep}, ${COL} *${keep}{font-family:${stack} !important}`);

  // ── 2. 整列等比缩放（保留层级） ────────────────────────────────────
  const scale = num(c.fontScale, 1, 0.7, 1.6);
  if (scale !== 1) {
    rules.push(`${COL}{overflow:visible !important}`);
    rules.push(`${COL} > *{zoom:${scale} !important}`);
    // zoom 是沿树累乘的，给排除区补一个倒数就能把外层的放大抵消掉。
    // 实测（Chromium 157）：1.2 的外层 + 0.8333 的内层，100px 量回 99.98px。
    const keepRoots = normalizeExcludes(c.fontExclude).join(',');
    if (keepRoots) rules.push(`${keepRoots}{zoom:${(1 / scale).toFixed(4)} !important}`);
  }

  // ── 3. 扁平字号 ────────────────────────────────────────────────────
  const size = num(c.fontSize, 0, 0, 32);
  if (size > 0) rules.push(`${COL}${keep}, ${COL} *${keep}{font-size:${size}px !important}`);

  // ── 4. 行高 ────────────────────────────────────────────────────────
  const lineHeight = num(c.lineHeight, 0, 0, 3);
  if (lineHeight > 0) rules.push(`${COL} *${keep}{line-height:${lineHeight} !important}`);

  // ── 5. 行距 ────────────────────────────────────────────────────────
  const gap = num(c.rowGap, 0, 0, 24);
  if (gap > 0) {
    const rows = ['_row', '_entry', '_item', '_sessionRow', '_panelRow', '_label', '_title']
      .map((suffix) => `${COL} [class*="${suffix}"]${keep}`)
      .join(',\n');
    rules.push(`${rows}{margin-block:${gap}px !important}`);
  }

  // ── 5.2 字距 / 字重 / OpenType 特性 ────────────────────────────────
  // 三项合并成一条规则，避免同一选择器重复三次把样式表撑大。
  const tracking = num(c.letterSpacing, 0, -0.05, 0.08);
  const weight = num(c.fontWeight, 0, 0, 900);
  const featureList = (Array.isArray(c.fontFeatures) ? c.fontFeatures : String(c.fontFeatures || '').split(','))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (tracking !== 0 || weight > 0 || featureList.length > 0) {
    const decl = [];
    if (tracking !== 0) decl.push(`letter-spacing:${tracking}em`);
    if (weight > 0) decl.push(`font-weight:${weight}`);
    if (featureList.length > 0) {
      decl.push(`font-feature-settings:${featureList.map((name) => `"${name}" 1`).join(', ')}`);
    }
    rules.push(`${COL}${keep}, ${COL} *${keep}{${decl.join(';')} !important}`);
  }

  // ── 5.5 「侧栏设置」入口：悬浮高亮 + 文字字号 ─────────────────────
  // 该入口由 UI 脚本插进 nav，带固定 id，因此不受插入位置影响。
  // 位置选择器（div:last-child）只在临时兜底时使用。
  rules.push(`[data-dst-active] #dst-rail-entry{
  border-radius:var(--dsw-radius-md, 8px) !important;
  border-left:var(--dsh-sidebar-paint-inset, 3px) solid transparent !important;
  border-right:var(--dsh-sidebar-paint-inset, 3px) solid transparent !important;
  background-clip:padding-box !important;
  transition:background-color .12s ease;
}`);
  rules.push(`[data-dst-active] #dst-rail-entry:hover{
  background-color:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16)) !important;
}`);
  rules.push(`[data-dst-active] #dst-rail-entry > span{
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

  // ── 8. 图标列悬停提示 ──────────────────────────────────────────────
  // 图标列只留图标时（并排或折叠），名称在 DOM 里被 display:none 掉了，
  // 这里把名字做成自绘气泡，鼠标停在哪一项就显示哪一项的名称。
  // 气泡节点由 UI 脚本创建（#dst-tip），样式放在 CSS 里以便热加载调整。
  // 开关同样走 <html> 属性：html[data-dst-tip] 不存在时气泡永远不显示。
  const tipZ = num(c.zIndex, 30, 1, 900);
  rules.push(`#dst-tip{
  position:fixed !important;
  left:0; top:0;
  display:none;
  max-width:280px;
  padding:4px 9px;
  border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3));
  background:var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #2b2b2b));
  color:var(--dsw-alias-label-primary, inherit);
  font-family:${stack || 'inherit'};
  font-size:12px;
  line-height:1.4;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  box-shadow:0 6px 18px rgba(0,0,0,.22);
  pointer-events:none !important;
  z-index:${tipZ + 20};
}`);
  rules.push(`html[data-dst-tip] #dst-tip[data-show]{display:block !important}`);

  // ── 9. 内容区（对话）字体 ─────────────────────────────────────────
  // DSH 把内容字号拆成一串派生变量（size / delta / secondary），而且都在
  // :root 上就算完了；所以在内容列上覆盖时必须四件套一起给，否则字变大了
  // 行高还按 14px 的 delta 算，行会挤在一起。
  // 0 表示「跟随 DSH」，所以先按 0 兜住再判断，不要一上来就夹到区间下限
  const contentSizeRaw = num(c.contentFontSize, 0, 0, 28);
  const contentSize = contentSizeRaw > 0 ? num(contentSizeRaw, 14, 10, 28) : 0;
  if (contentSize > 0) {
    rules.push(`${CENTER}{
  --dst-content-size:${contentSize}px;
  --dsh-content-font-size:var(--dst-content-size);
  --dsh-content-font-delta:calc(var(--dst-content-size) - 14px);
  --dsh-content-font-size-secondary:min(calc(var(--dst-content-size) - 1px), max(13px, calc(var(--dst-content-size) - 2px)));
  --dsh-content-font-delta-secondary:calc(var(--dsh-content-font-size-secondary) - 13px);
}`);
  }

  const contentStack = buildStack({
    fontFamily: c.contentFont,
    fontFamilyZh: c.contentFontZh,
    fontFamilyEn: c.contentFontEn,
    fontFallbacks: c.contentFontFallbacks,
  });
  if (contentStack) {
    // 代码块、行内代码、终端、输入框保留各自的等宽字体
    const skipCode = ':not(pre):not(pre *):not(code):not(kbd):not(samp):not(textarea)';
    rules.push(`${CENTER}${skipCode}, ${CENTER} *${skipCode}{font-family:${contentStack} !important}`);
    rules.push(`${CENTER}{--dsw-font-family:${contentStack} !important}`);
  }

  const contentLhRaw = num(c.contentLineHeight, 0, 0, 2.4);
  const contentLh = contentLhRaw > 0 ? num(contentLhRaw, 1.5, 1.1, 2.4) : 0;
  if (contentLh > 0) {
    const blocks = ['p', 'li', 'blockquote', 'dd', 'dt', 'td', 'th']
      .map((tag) => `${CENTER} ${tag}`)
      .join(', ');
    rules.push(`${blocks}{line-height:${contentLh} !important}`);
  }

  // 代码：DSH 用 --ds-font-family-code（注意是 ds 不是 dsh）和 --dsh-code-font-size，
  // 两者同样在 :root 就解析成了具体值，所以既要给变量，也要直接落到 pre/code 上。
  const rawCodeFont = String(c.contentCodeFont || '').trim();
  const codeStack = rawCodeFont
    ? (rawCodeFont.includes(',')
      ? rawCodeFont
      : buildStack({ fontFamilyZh: rawCodeFont, fontFallbacks: ['ui-monospace', 'monospace'] }))
    : '';
  if (codeStack) {
    rules.push(`${CENTER}{--dsh-font-family-code:${codeStack} !important; --ds-font-family-code:${codeStack} !important}`);
    rules.push(`${CENTER} pre, ${CENTER} pre *, ${CENTER} code, ${CENTER} code *, ${CENTER} kbd, ${CENTER} samp{
  font-family:${codeStack} !important;
}`);
  }

  const codeSizeRaw = num(c.contentCodeFontSize, 0, 0, 20);
  const codeSize = codeSizeRaw > 0 ? num(codeSizeRaw, 11, 10, 20) : 0;
  if (codeSize > 0) {
    rules.push(`${CENTER}{
  --dsh-code-font-size:${codeSize}px;
  --dsh-code-font-delta:calc(${codeSize}px - 11px);
}`);
    rules.push(`${CENTER} pre, ${CENTER} pre *, ${CENTER} code, ${CENTER} kbd, ${CENTER} samp{
  font-size:${codeSize}px !important;
}`);
  }


  // ── 10. 终端（xterm）字体 ──────────────────────────────────────────
  // better-sidebar 的 xterm 只在创建时读一次「容器的计算样式」：
  //   new Terminal({ fontFamily: getComputedStyle(node).fontFamily, fontSize: 13 })
  // 所以这里只影响终端容器，不碰全局 --ds-font-family-code（那会连带改代码块）。
  // 约束：已打开的终端不会重读，必须关掉该标签重新打开才生效。
  const termFont = c.terminalFollowCode === false ? quoteFamily(c.terminalFontFamily) : '';
  if (termFont && !GENERIC.has(termFont.replace(/"/g, '').toLowerCase())) {
    rules.push(`:root{--dst-terminal-font:${termFont}}`);
    rules.push(`div:has(> .xterm){font-family:var(--dst-terminal-font) !important}`);
    rules.push(`div:has(> .xterm) .xterm{font-family:var(--dst-terminal-font) !important}`);
  }
  // 以下三项都是「实验性」：xterm 内部尺寸缓存创建时就算好了，改了会有错位风险。
  const termSize = num(c.terminalFontSize, 0, 0, 20);
  if (termSize > 0) rules.push(`.xterm{font-size:${termSize}px !important}`);
  const termTracking = num(c.terminalLetterSpacing, 0, 0, 4);
  if (termTracking > 0) rules.push(`.xterm .xterm-rows{letter-spacing:${termTracking}px !important}`);
  if (c.terminalLigatures === true) {
    rules.push(`.xterm{font-feature-settings:"calt" 1, "liga" 1 !important}`);
  }
  // ── 11. 设置面板自身的度量 ─────────────────────────────────────────
  // 面板的排版参数放在这里（而不是写死在注入脚本里）：
  // 这一段随 live.css 热加载，改完 1.5 秒内生效，不用重启 DSH。
  rules.push(`[data-dst-panel]{
  --dst-panel-w:720px;
  --dst-panel-h:560px;
  --dst-pad:22px;
  --dst-nav-w:168px;
  --dst-nav-gap:3px;
  --dst-nav-pad-y:9px;
  --dst-row-gap:18px;
  --dst-label-w:140px;
  --dst-body-fs:13px;
  --dst-hint-fs:11px;
  --dst-hint-gap:5px;
  --dst-content-pad:22px;
  --dst-panel-radius:14px;
}`);

  return rules.join('\n');
}

