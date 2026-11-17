/**
 * Host half of dsh-sidebar-tuner.
 *
 * Everything is host-side: the stylesheet and the settings UI both reach the
 * page through the webserver's structured index injection table, so there is
 * no Client module to enumerate and nothing to keep in sync across processes.
 *
 *   cordis.patch.yml config
 *      + <plugin>/override.json      ← written by the settings panel
 *      = merged config → buildCss()
 *          ├─ inline <style> row            (first paint)
 *          ├─ <link> to /sidebar-tuner/tuner.css   (hot reload, edit live.css)
 *          └─ settings panel script (gear button in the sidebar)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCss, DEFAULTS } from './css.js';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const OVERRIDE_PATH = path.join(PLUGIN_DIR, 'override.json');
const LIVE_PATH = path.join(PLUGIN_DIR, 'live.css');

function resolveHome(ctx) {
  try {
    const fromCtx = ctx?.get?.('dshHome');
    if (typeof fromCtx === 'string' && fromCtx) return fromCtx;
  } catch { /* ignore */ }
  const env = process.env.DSH_HOME;
  if (typeof env === 'string' && env) return env;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.dsh');
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function writeProbe(home, payload) {
  const dir = path.join(home, 'sidebar-tuner');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, 'probe.jsonl'),
    `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`,
    'utf8',
  );
}

function readOverride() {
  try {
    if (!fs.existsSync(OVERRIDE_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(OVERRIDE_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeOverride(patch) {
  const next = { ...readOverride(), ...patch };
  fs.writeFileSync(OVERRIDE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

/**
 * Settings panel: a gear button in the bottom-left corner plus a floating
 * panel. Vanilla DOM, own styles, appended to <body> so the sidebar layout
 * rules never touch it. Must not contain the literal `</script`.
 */
const UI_SCRIPT = `(() => {
  if (window.__dstUI) return;
  window.__dstUI = true;

  const ZH_FONTS = ['HarmonyOS Sans SC','Microsoft YaHei','PingFang SC','Noto Sans SC','Source Han Sans SC','Sarasa Gothic SC','LXGW WenKai','DengXian','SimSun','SimHei','KaiTi','FangSong','Microsoft JhengHei'];
  // 同一套 Inter 在系统里可能是三个家族名：静态 Inter、光学尺寸版 Inter Display、
  // 可变版 Inter Variable。三者字距与笔画都不同，所以分别列出由用户挑。
  const EN_FONTS = ['Inter','Inter Display','Inter Variable','Segoe UI','Segoe UI Variable','SF Pro Text','Helvetica Neue','Arial','Roboto','Geist','JetBrains Mono','Maple Mono NF CN','Cascadia Code','Consolas','Fira Code'];
  const MONO_FONTS = ['JetBrains Mono','Maple Mono NF CN','Cascadia Code','Fira Code','Consolas','SF Mono','Source Code Pro','IBM Plex Mono','Roboto Mono','ui-monospace','monospace'];
  const FALLBACKS = ['system-ui','sans-serif','serif','monospace'];
  const NUM_FIELDS = [
    { key: 'fontSize',   label: '字号 px（0=关）', min: 0, max: 32, step: 1,
      hint: '侧栏文字统一成这个大小；0 = 关闭。' },
    { key: 'fontScale',  label: '整列缩放（1=关）', min: 0.7, max: 1.6, step: 0.02,
      hint: '整体放大缩小，保留层级；1 = 原样。' },
    { key: 'lineHeight', label: '行高（0=关）', min: 0, max: 3, step: 0.05,
      hint: '行高倍数，1.5 ≈ 字号的 1.5 倍。' },
    { key: 'rowGap',     label: '行距 px（0=关）', min: 0, max: 24, step: 1,
      hint: '每条上下再补的空白。' },
  ];
  // 图标列宽属于布局，跟折叠开关放一起，不塞进排版里
  const LAYOUT_NUMS = [
    { key: 'railWidth',  label: '图标列宽 px', min: 40, max: 96, step: 2,
      hint: '图标列宽度，40–96。' },
  ];
  const BOOL_FIELDS = [
    { key: 'compactLayout', label: '图标列+会话列并排',
      hint: '左图标列 + 右会话列；不勾＝原布局。' },
    { key: 'collapsedRail', label: '折叠时保留图标栏',
      hint: '折叠后仍留一列图标。' },
    { key: 'pushContent',   label: '折叠时推挤内容列',
      hint: '折叠时把内容右推，不覆盖。' },
    { key: 'railTooltips',  label: '图标悬停显示名称',
      hint: '鼠标停上去浮出图标名字。' },
  ];
  // 「不改字体的区域」的可勾选项。选择器是给 CSS 用的，勾选框是给人用的。
  const KEEP_PRESETS = [
    { selector: '[data-slot="sidebar.footer.action"]', label: '侧栏底部卡片（计费、配额这类插件）' },
    { selector: '[class*="_footArea"]', label: '整个侧栏底部（连设置入口一起）' },
  ];

  // 入口图标：取自 Lucide（ISC，https://lucide.dev），按 24 网格原样内联，
  // 只把 stroke-width 调到 1.8，跟侧栏邻居的线宽对齐。用哪一枚由 railIcon 决定。
  const RAIL_ICONS = {
    palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/>'
      + '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>'
      + '<circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
    sliders: '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/>'
      + '<path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
    swatch: '<path d="M11 17a4 4 0 0 1-8 0V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2Z"/>'
      + '<path d="M16.7 13H19a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7"/><path d="M7 17h.01"/>'
      + '<path d="m11 8 2.3-2.3a2.4 2.4 0 0 1 3.404.004L18.6 7.6a2.4 2.4 0 0 1 .026 3.434L9.9 19.8"/>',
    brush: '<path d="m14.622 17.897-10.68-2.913"/>'
      + '<path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/>'
      + '<path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/>',
  };
  const ICON_NAMES = ['palette', 'sliders', 'swatch', 'brush'];
  const svgOf = (name) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"'
    + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + (RAIL_ICONS[name] || RAIL_ICONS.palette) + '</svg>';
  const ICON_NAME = RAIL_ICONS[window.__dstIcon] ? window.__dstIcon : 'sliders';

  const el = (tag, props) => {
    const node = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === 'style') Object.assign(node.style, props[k]);
      else if (k === 'text') node.textContent = props[k];
      else if (k === 'html') node.innerHTML = props[k];
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), props[k]);
      else node.setAttribute(k, props[k]);
    }
    return node;
  };

  // 判断本机有没有这个字体。
  // 不能用 document.fonts.check()：它只认 @font-face 声明的字体，系统字体
  // 一律返回 true（以前就是这样，下拉里全是「装了」）。改成 canvas 量宽度：
  // 同一段文字分别用「候选字体 + 通用族」和「通用族」渲染，宽度不同才算装了。
  const GENERIC_NAMES = ['system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
    'ui-monospace', 'ui-sans-serif', 'ui-serif', 'ui-rounded', 'emoji', 'math'];
  const fontCache = {};
  let probeCtx = null;
  const available = (name) => {
    const key = String(name || '').trim();
    if (!key) return false;
    if (GENERIC_NAMES.indexOf(key.toLowerCase()) >= 0) return true;
    if (Object.prototype.hasOwnProperty.call(fontCache, key)) return fontCache[key];
    let ok = false;
    try {
      if (!probeCtx) probeCtx = document.createElement('canvas').getContext('2d');
      const probe = 'mmmmmmmmmmlli WWWQ@#0123';
      for (const base of ['monospace', 'sans-serif', 'serif']) {
        probeCtx.font = '72px ' + base;
        const before = probeCtx.measureText(probe).width;
        probeCtx.font = '72px "' + key + '", ' + base;
        const after = probeCtx.measureText(probe).width;
        if (Math.abs(after - before) > 0.5) { ok = true; break; }
      }
    } catch (e) { /* 量不了就当没装 */ }
    fontCache[key] = ok;
    return ok;
  };

  // ── 图标列里的入口按钮 ────────────────────────────────────────
  const railBtn = el('div', {
    id: 'dst-rail-entry',
    title: '侧栏外观设置',
    'data-dst-label': '侧栏设置',
    html: svgOf(ICON_NAME),
    style: {
      width: '40px', height: '32px', flex: 'none', display: 'flex',
      alignItems: 'center', justifyContent: 'center', gap: '0',
      cursor: 'pointer', color: 'inherit',
      marginTop: '4px', boxSizing: 'border-box',
      // 和 panelEntry 一致：圆角 + 两侧透明内描边（DSH 的高亮是画在这个内缩区域上的）
      borderRadius: 'var(--dsw-radius-md, 8px)',
      borderLeft: 'var(--dsh-sidebar-paint-inset, 3px) solid transparent',
      borderRight: 'var(--dsh-sidebar-paint-inset, 3px) solid transparent',
      backgroundClip: 'padding-box',
      backgroundColor: 'transparent',
    },
  });
  // 非并排布局时补一个中文名，和旁边带文字的入口对齐。
  // 字号用 inherit：panelTitle 本身没写 font-size，继承 .root 的那一级，
  // 写死 12px 会比邻居小一号。
  const railLabel = el('span', {
    text: '侧栏设置',
    style: {
      whiteSpace: 'nowrap', fontSize: 'inherit', lineHeight: 'inherit',
      marginLeft: '6px',
      display: 'none', overflow: 'hidden', textOverflow: 'ellipsis',
    },
  });
  railBtn.appendChild(railLabel);
  // 悬浮高亮：用 DSH 自己的交互底色变量，和邻居完全同色
  const HOVER_BG = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16))';
  railBtn.addEventListener('mouseenter', () => {
    railBtn.style.backgroundColor = HOVER_BG;
  });
  railBtn.addEventListener('mouseleave', () => {
    railBtn.style.backgroundColor = 'transparent';
  });

  // 紧凑（图标列 + 会话列并排）时只显示图标；否则图标 + 文字
  // 每秒都会跑，所以只在布局态或字号真的变了时才写内联样式，
  // 否则 getComputedStyle + 写样式会让整页每秒强制重排一次。
  let lastSyncKey = '';
  let syncTick = 0;
  const syncLabel = (force) => {
    const compact = document.documentElement.hasAttribute('data-dst-compact');
    syncTick += 1;
    if (!force && syncTick % 10 !== 0) {
      const key = compact ? 'compact' : 'full';
      if (key === lastSyncKey) return;
    }
    lastSyncKey = compact ? 'compact' : 'full';
    railLabel.style.display = compact ? 'none' : '';
    // 直接对齐邻居的 computed 字号，主题/缩放下也不会走样
    if (!compact) {
      const sibling = document.querySelector('[class*="_panelTitle"]')
        || document.querySelector('[class*="_panelRow"]');
      if (sibling) {
        const cs = getComputedStyle(sibling);
        railLabel.style.fontSize = cs.fontSize;
        railLabel.style.lineHeight = cs.lineHeight;
        railLabel.style.letterSpacing = cs.letterSpacing;
        railLabel.style.fontWeight = cs.fontWeight;
      }
    }
    railBtn.style.width = compact ? '40px' : '100%';
    railBtn.style.justifyContent = compact ? 'center' : 'flex-start';
    railBtn.style.paddingLeft = compact ? '0' : '10px';
    railBtn.style.paddingRight = compact ? '0' : '10px';
    railBtn.style.marginTop = compact ? '4px' : '2px';
    railBtn.title = compact ? '侧栏设置' : '';
  };

  const attachRail = () => {
    const nav = document.querySelector('[class*="_panelList"]');
    if (nav && railBtn.parentElement !== nav) nav.appendChild(railBtn);
    syncLabel(false);
  };
  attachRail();
  setInterval(attachRail, 1000);

  // ── 面板 ────────────────────────────────────────────────────
  const panel = el('div', {
    style: {
      position: 'fixed', left: '64px', bottom: '12px', width: '324px',
      maxHeight: '76vh', overflowY: 'auto', padding: '14px', borderRadius: '12px',
      border: '1px solid rgba(127,127,127,.3)', background: 'var(--dsw-alias-bg-base, #fff)',
      color: 'inherit', fontSize: '12px', lineHeight: '1.5', zIndex: '9999',
      display: 'none', boxShadow: '0 10px 30px rgba(0,0,0,.18)', fontFamily: 'inherit',
    },
  });
  const header = el('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '8px', marginBottom: '10px',
    },
  });
  header.appendChild(el('div', {
    text: '侧栏外观',
    style: { fontSize: '13px', fontWeight: '600' },
  }));
  const closeBtn = el('button', {
    text: '×',
    title: '关闭（Esc）',
    onclick: () => { panel.style.display = 'none'; },
    style: {
      flex: 'none', width: '22px', height: '22px', padding: '0', lineHeight: '1',
      borderRadius: '6px', border: '1px solid rgba(127,127,127,.35)',
      background: 'transparent', color: 'inherit', cursor: 'pointer',
      fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
  });
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16))';
  });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // 适配声明：面板顶上常驻一行。DSH 的侧栏/内容列是样式锚点，版本一变就可能
  // 对不上，所以这里既报「测过哪个版本」，也顺手自检锚点还在不在。
  const DSH_TESTED = '0.2.2-rc.3';
  const compatLine = el('div', {
    style: { marginBottom: '8px', fontSize: '10px', lineHeight: '1.4', color: 'var(--dsw-alias-label-tertiary, #888)' },
  });
  const compatCheck = () => {
    const has = (sel) => !!document.querySelector(sel);
    const missing = [];
    if (!has('[class*="_sidebarCol"]')) missing.push('侧栏');
    if (!has('[class*="_panelList"]')) missing.push('图标列');
    if (!has('[class*="_centerCol"]')) missing.push('对话区');
    const boot = window.__DSH_BOOT__ || {};
    const version = String(boot.version || boot.buildVersion || boot.appVersion || '');
    if (missing.length > 0) {
      compatLine.style.color = 'var(--dsw-alias-label-warning, #c47f00)';
      compatLine.textContent = '⚠ 没找到' + missing.join('、') + '锚点，当前 DSH 版本可能未适配（本插件测到 ' + DSH_TESTED + '）';
    } else {
      compatLine.style.color = 'var(--dsw-alias-label-tertiary, #888)';
      compatLine.textContent = (version ? 'DSH ' + version + ' · ' : '') + '已适配（测到 ' + DSH_TESTED + '，兼容 0.2.x）';
    }
  };
  compatLine.textContent = '已适配（测到 ' + DSH_TESTED + '，兼容 0.2.x）';
  panel.appendChild(compatLine);
  setTimeout(compatCheck, 3000);
  setInterval(compatCheck, 30000);

  const inputStyle = {
    flex: '1 1 auto', minWidth: '0', padding: '3px 6px', borderRadius: '6px',
    border: '1px solid rgba(127,127,127,.35)', background: 'transparent',
    color: 'inherit', fontSize: '12px',
  };
  // 每个字段两行：上面「标签 + 控件」，下面一句人话说明。
  // 面板里全是 px、倍数和选择器，不解释一下没人知道改的是什么。
  const fieldOf = (label, hint) => {
    const wrap = el('div', { style: { marginBottom: '9px' } });
    const row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
    row.appendChild(el('label', {
      text: label,
      style: { flex: '0 0 108px', color: 'var(--dsw-alias-label-secondary, #666)' },
    }));
    wrap.appendChild(row);
    // 说明行总是建出来：字体下拉那几项要在运行时把「已装 8/13」写进去
    const hintNode = el('div', {
      text: hint || '',
      style: { marginTop: '2px', fontSize: '10px', lineHeight: '1.4', color: 'var(--dsw-alias-label-tertiary, #888)' },
    });
    wrap.appendChild(hintNode);
    return { wrap, row, hint: hintNode };
  };

  // 分组：标题可点，点一下收起/展开。顺序按「改东西的顺序」排：
  // 侧栏字体 → 侧栏排版 → 侧栏布局 → 入口图标 → 对话区字体 → 高级。
  // 默认只把「高级」收起来，别的都展开。
  let sectionCount = 0;
  const sectionOf = (title, opts) => {
    const first = sectionCount === 0;
    sectionCount += 1;
    let open = !(opts && opts.collapsed);
    const wrap = el('div', { style: { margin: '0' } });
    const head = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
        margin: first ? '0 0 2px' : '10px 0 2px',
        paddingTop: first ? '0' : '8px',
        borderTop: first ? '0' : '1px solid rgba(127,127,127,.18)',
        fontSize: '11px', fontWeight: '600', letterSpacing: '.02em',
        color: 'var(--dsw-alias-label-secondary, #666)',
        userSelect: 'none',
      },
    });
    const arrow = el('span', { style: { width: '10px', flex: 'none', opacity: '.7' } });
    head.appendChild(arrow);
    head.appendChild(el('span', { text: title }));
    const body = el('div', { style: { paddingTop: '4px' } });
    const sync = () => {
      arrow.textContent = open ? '▾' : '▸';
      body.style.display = open ? '' : 'none';
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    head.setAttribute('role', 'button');
    head.setAttribute('data-dst-section', title);
    wrap.setAttribute('data-dst-group', title);
    head.addEventListener('click', () => { open = !open; sync(); });
    head.addEventListener('mouseenter', () => { head.style.color = 'var(--dsw-alias-label-primary, #333)'; });
    head.addEventListener('mouseleave', () => { head.style.color = 'var(--dsw-alias-label-secondary, #666)'; });
    sync();
    wrap.appendChild(head);
    wrap.appendChild(body);
    panel.appendChild(wrap);
    return { wrap, head, body };
  };

  // 装了的打勾加粗，没装的标「未安装」并压成灰斜体：原生下拉只认一部分
  // option 样式，所以文字上也标出来，颜色被忽略时照样能分辨。
  const fontCount = (list) => '已装 ' + list.filter((name) => available(name)).length + '/' + list.length + '，灰字＝没装。';
  const buildSelect = (list, current) => {
    const sel = el('select', { style: inputStyle });
    sel.appendChild(el('option', { value: '', text: '（不指定）' }));
    const ordered = list.slice();
    if (current && ordered.indexOf(current) < 0) ordered.unshift(current);
    for (const name of ordered) {
      const ok = available(name);
      const opt = el('option', { value: name, text: ok ? '✓ ' + name : name + '（未安装）' });
      if (ok) {
        opt.style.fontWeight = '600';
        opt.style.color = 'var(--dsw-alias-label-primary, inherit)';
      } else {
        opt.style.color = 'var(--dsw-alias-label-tertiary, #999)';
        opt.style.fontStyle = 'italic';
      }
      sel.appendChild(opt);
    }
    sel.value = current || '';
    return sel;
  };

  // 配置里可能存着预置列表里没有的字体（yml 手写的），回填时补一条并同样标注
  const setSelectValue = (sel, name) => {
    const value = name || '';
    if (!value) { sel.value = ''; return; }
    const exists = Array.prototype.some.call(sel.options, (opt) => opt.value === value);
    if (!exists) {
      const ok = available(value);
      const opt = el('option', { value, text: ok ? '✓ ' + value : value + '（未安装）' });
      if (ok) {
        opt.style.fontWeight = '600';
      } else {
        opt.style.color = 'var(--dsw-alias-label-tertiary, #999)';
        opt.style.fontStyle = 'italic';
      }
      sel.appendChild(opt);
    }
    sel.value = value;
  };

  // ── 侧栏字体 ────────────────────────────────────────────────
  const secFont = sectionOf('侧栏字体');
  const zhField = fieldOf('中文字体', '');
  const zhSelect = buildSelect(ZH_FONTS, '');
  zhField.row.appendChild(zhSelect);
  secFont.body.appendChild(zhField.wrap);

  const enField = fieldOf('英文字体', '');
  const enSelect = buildSelect(EN_FONTS, '');
  enField.row.appendChild(enSelect);
  secFont.body.appendChild(enField.wrap);

  const fbField = fieldOf('回退字体', '没装时依次回退。');
  const fbWrap = el('div', { style: { flex: '1 1 auto', display: 'flex', flexWrap: 'wrap', gap: '8px' } });
  const fbBoxes = {};
  for (const name of FALLBACKS) {
    const wrap = el('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '3px', cursor: 'pointer' } });
    const box = el('input', { type: 'checkbox' });
    box.style.margin = '0';
    wrap.appendChild(box);
    wrap.appendChild(el('span', { text: name }));
    fbWrap.appendChild(wrap);
    fbBoxes[name] = box;
  }
  fbField.row.appendChild(fbWrap);
  secFont.body.appendChild(fbField.wrap);

  // ── 侧栏排版与布局 ──────────────────────────────────────────
  const secType = sectionOf('侧栏排版');
  const numInputs = {};
  for (const f of NUM_FIELDS) {
    const field = fieldOf(f.label, f.hint);
    const input = el('input', { type: 'number', style: inputStyle });
    input.min = f.min; input.max = f.max; input.step = f.step;
    field.row.appendChild(input);
    numInputs[f.key] = input;
    secType.body.appendChild(field.wrap);
  }

  const secLayout = sectionOf('侧栏布局');
  const boolInputs = {};
  const FLAG_OF = { compactLayout: 'compact', collapsedRail: 'rail', pushContent: 'push', railTooltips: 'tip' };
  for (const f of BOOL_FIELDS) {
    const field = fieldOf(f.label, f.hint);
    const box = el('input', { type: 'checkbox' });
    box.style.flex = '0 0 auto';
    box.style.margin = '0';
    // 勾选即刻生效：只增删 <html> 上的属性，不重算 CSS
    box.addEventListener('change', () => {
      if (window.__dstSetFlag) window.__dstSetFlag(FLAG_OF[f.key], box.checked);
      status.textContent = (box.checked ? '已开启' : '已关闭') + '（尚未保存）';
    });
    field.row.appendChild(box);
    boolInputs[f.key] = box;
    secLayout.body.appendChild(field.wrap);
  }
  for (const f of LAYOUT_NUMS) {
    const field = fieldOf(f.label, f.hint);
    const input = el('input', { type: 'number', style: inputStyle });
    input.min = f.min; input.max = f.max; input.step = f.step;
    field.row.appendChild(input);
    numInputs[f.key] = input;
    secLayout.body.appendChild(field.wrap);
  }

  // ── 入口图标 ────────────────────────────────────────────────
  const secIcon = sectionOf('入口图标');
  const iconField = fieldOf('图标样式', '来自 Lucide，换完点保存。');
  const ICON_LABELS = { palette: '调色板', sliders: '滑杆', swatch: '色卡', brush: '画笔' };
  const iconSelect = el('select', { style: inputStyle });
  for (const name of ICON_NAMES) {
    iconSelect.appendChild(el('option', { value: name, text: ICON_LABELS[name] || name }));
  }
  iconSelect.addEventListener('change', () => {
    railBtn.innerHTML = svgOf(iconSelect.value);
    railBtn.appendChild(railLabel);
    syncLabel();
    status.textContent = '图标已换（尚未保存）';
  });
  iconField.row.appendChild(iconSelect);
  secIcon.body.appendChild(iconField.wrap);

  // ── 对话区字体 ──────────────────────────────────────────────
  const secContent = sectionOf('对话区字体');
  const cZhField = fieldOf('中文字体', '');
  const contentZhSelect = buildSelect(ZH_FONTS, '');
  cZhField.row.appendChild(contentZhSelect);
  secContent.body.appendChild(cZhField.wrap);

  const cEnField = fieldOf('英文字体', '');
  const contentEnSelect = buildSelect(EN_FONTS, '');
  cEnField.row.appendChild(contentEnSelect);
  secContent.body.appendChild(cEnField.wrap);

  const cFbField = fieldOf('回退字体', '没装时依次回退。');
  const contentFbWrap = el('div', { style: { flex: '1 1 auto', display: 'flex', flexWrap: 'wrap', gap: '8px' } });
  const contentFbBoxes = {};
  for (const name of FALLBACKS) {
    const wrap = el('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '3px', cursor: 'pointer' } });
    const box = el('input', { type: 'checkbox' });
    box.style.margin = '0';
    wrap.appendChild(box);
    wrap.appendChild(el('span', { text: name }));
    contentFbWrap.appendChild(wrap);
    contentFbBoxes[name] = box;
  }
  cFbField.row.appendChild(contentFbWrap);
  secContent.body.appendChild(cFbField.wrap);

  const cSizeField = fieldOf('字号 px（0=跟随）', '0 = 用 DSH 的字号设置。');
  const contentSizeInput = el('input', { type: 'number', style: inputStyle });
  contentSizeInput.min = 0; contentSizeInput.max = 28; contentSizeInput.step = 1;
  cSizeField.row.appendChild(contentSizeInput);
  secContent.body.appendChild(cSizeField.wrap);

  const cLhField = fieldOf('行高（0=关）', '倍数，0 = 用 DSH 换算。');
  const contentLhInput = el('input', { type: 'number', style: inputStyle });
  contentLhInput.min = 0; contentLhInput.max = 2.4; contentLhInput.step = 0.05;
  cLhField.row.appendChild(contentLhInput);
  secContent.body.appendChild(cLhField.wrap);

  const cCodeField = fieldOf('代码字体', '');
  const contentCodeSelect = buildSelect(MONO_FONTS, '');
  cCodeField.row.appendChild(contentCodeSelect);
  secContent.body.appendChild(cCodeField.wrap);

  const cCodeSizeField = fieldOf('代码字号 px', '0 = 用 DSH 的代码字号。');
  const contentCodeSizeInput = el('input', { type: 'number', style: inputStyle });
  contentCodeSizeInput.min = 0; contentCodeSizeInput.max = 20; contentCodeSizeInput.step = 1;
  cCodeSizeField.row.appendChild(contentCodeSizeInput);
  secContent.body.appendChild(cCodeSizeField.wrap);

  // 五个字体下拉共用一句动态说明：本机装了哪些，一眼就能数出来
  zhField.hint.textContent = fontCount(ZH_FONTS);
  enField.hint.textContent = fontCount(EN_FONTS);
  cZhField.hint.textContent = fontCount(ZH_FONTS) + ' 只作用于对话区。';
  cEnField.hint.textContent = fontCount(EN_FONTS);
  cCodeField.hint.textContent = fontCount(MONO_FONTS) + ' 代码块与行内代码。';

  // ── 高级 ────────────────────────────────────────────────────
  const secAdvanced = sectionOf('高级：不改字体的区域', { collapsed: true });
  const keepField = fieldOf('勾选保护', '勾上的位置保持原字号。');
  const keepBoxes = {};
  const keepPanel = el('div', { style: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: '4px' } });
  for (const preset of KEEP_PRESETS) {
    const wrap = el('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } });
    const box = el('input', { type: 'checkbox' });
    box.style.margin = '0';
    wrap.appendChild(box);
    wrap.appendChild(el('span', { text: preset.label }));
    keepPanel.appendChild(wrap);
    keepBoxes[preset.selector] = box;
  }
  keepField.row.appendChild(keepPanel);
  secAdvanced.body.appendChild(keepField.wrap);

  const customField = fieldOf('其它区域', '没列到的插件填选择器。');
  const customInput = el('input', { type: 'text', placeholder: '（可选）', style: inputStyle });
  customField.row.appendChild(customInput);
  secAdvanced.body.appendChild(customField.wrap);

  const status = el('div', {
    style: { marginTop: '8px', minHeight: '16px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)' },
  });
  const applyCss = (text) => {
    if (!text) return;
    let tag = document.getElementById('dst-live');
    if (!tag) { tag = document.createElement('style'); tag.id = 'dst-live'; document.head.appendChild(tag); }
    tag.textContent = text;
  };

  /**
   * 自动同步：桌面端是 dsh-app:// 壳，Ctrl+R 并不保证重载，
   * 所以这里每 1.5 秒拉一次 /sidebar-tuner/tuner.css，
   * 内容变了就写进 #dst-live —— 改 live.css 后无需刷新或重启。
   */
  let lastCss = '';
  const pull = async () => {
    // 窗口在后台/最小化时没必要继续轮询，省掉一整条请求链路
    if (document.visibilityState !== 'visible') return;
    try {
      const res = await fetch('/sidebar-tuner/tuner.css?t=' + Date.now(), { cache: 'no-store' });
      const text = await res.text();
      if (text && text !== lastCss) { lastCss = text; applyCss(text); }
    } catch { /* 宿主不可达时静默跳过 */ }
  };
  pull();
  setInterval(pull, 1500);

  const fill = (state) => {
    setSelectValue(zhSelect, state.fontFamilyZh);
    setSelectValue(enSelect, state.fontFamilyEn);
    const fbs = Array.isArray(state.fontFallbacks) ? state.fontFallbacks : [];
    for (const name of FALLBACKS) fbBoxes[name].checked = fbs.indexOf(name) >= 0;
    for (const f of NUM_FIELDS.concat(LAYOUT_NUMS)) {
      const v = state[f.key];
      numInputs[f.key].value = v === undefined || v === null ? '' : String(v);
    }
    for (const f of BOOL_FIELDS) {
      const on = state[f.key] !== false;
      boolInputs[f.key].checked = on;
      if (window.__dstSetFlag) window.__dstSetFlag(FLAG_OF[f.key], on);
    }
    const keepNow = Array.isArray(state.fontExclude)
      ? state.fontExclude.map((item) => String(item).trim()).filter(Boolean)
      : [];
    for (const preset of KEEP_PRESETS) {
      keepBoxes[preset.selector].checked = keepNow.indexOf(preset.selector) >= 0;
    }
    customInput.value = keepNow
      .filter((item) => !KEEP_PRESETS.some((preset) => preset.selector === item))
      .join(', ');
    iconSelect.value = ICON_NAMES.indexOf(state.railIcon) >= 0 ? state.railIcon : 'sliders';
    setSelectValue(contentZhSelect, state.contentFontZh);
    setSelectValue(contentEnSelect, state.contentFontEn);
    const contentFbs = Array.isArray(state.contentFontFallbacks) ? state.contentFontFallbacks : [];
    for (const name of FALLBACKS) contentFbBoxes[name].checked = contentFbs.indexOf(name) >= 0;
    contentSizeInput.value = state.contentFontSize ? String(state.contentFontSize) : '';
    contentLhInput.value = state.contentLineHeight ? String(state.contentLineHeight) : '';
    setSelectValue(contentCodeSelect, state.contentCodeFont);
    contentCodeSizeInput.value = state.contentCodeFontSize ? String(state.contentCodeFontSize) : '';
  };

  const collect = () => {
    const out = {
      fontFamilyZh: zhSelect.value,
      fontFamilyEn: enSelect.value,
      fontFallbacks: FALLBACKS.filter((name) => fbBoxes[name].checked),
    };
    for (const f of NUM_FIELDS.concat(LAYOUT_NUMS)) {
      const raw = numInputs[f.key].value;
      out[f.key] = raw === '' ? 0 : Number(raw);
    }
    for (const f of BOOL_FIELDS) out[f.key] = boolInputs[f.key].checked;
    const keepOut = KEEP_PRESETS
      .filter((preset) => keepBoxes[preset.selector].checked)
      .map((preset) => preset.selector);
    const extra = customInput.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    for (const item of extra) {
      if (keepOut.indexOf(item) < 0) keepOut.push(item);
    }
    out.fontExclude = keepOut;
    out.railIcon = iconSelect.value;
    out.contentFontZh = contentZhSelect.value;
    out.contentFontEn = contentEnSelect.value;
    out.contentFontFallbacks = FALLBACKS.filter((name) => contentFbBoxes[name].checked);
    out.contentFontSize = contentSizeInput.value === '' ? 0 : Number(contentSizeInput.value);
    out.contentLineHeight = contentLhInput.value === '' ? 0 : Number(contentLhInput.value);
    out.contentCodeFont = contentCodeSelect.value;
    out.contentCodeFontSize = contentCodeSizeInput.value === '' ? 0 : Number(contentCodeSizeInput.value);
    return out;
  };

  const post = (body) => fetch('/sidebar-tuner/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  }).then((r) => r.json());

  const save = async () => {
    status.textContent = '保存中…';
    try {
      const res = await post(collect());
      if (res && res.ok) { applyCss(res.css); status.textContent = '已应用并保存到 override.json'; }
      else status.textContent = '保存失败：' + (res && res.error ? res.error : '未知错误');
    } catch (e) { status.textContent = '保存失败：' + e.message; }
  };

  const reset = async () => {
    status.textContent = '恢复默认…';
    try {
      const res = await post({ __reset: true });
      if (res && res.ok) { fill(res.config || {}); applyCss(res.css); status.textContent = '已恢复默认'; }
    } catch (e) { status.textContent = '失败：' + e.message; }
  };

  const actions = el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } });
  const mkBtn = (text, handler) => el('button', {
    text,
    onclick: handler,
    style: {
      flex: '1 1 0', padding: '6px 8px', borderRadius: '7px', cursor: 'pointer',
      border: '1px solid rgba(127,127,127,.35)', background: 'transparent',
      color: 'inherit', fontSize: '12px',
    },
  });
  actions.appendChild(mkBtn('应用并保存', save));
  actions.appendChild(mkBtn('恢复默认', reset));
  panel.appendChild(actions);
  panel.appendChild(status);

  railBtn.addEventListener('click', async () => {
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    if (open) return;
    try {
      const res = await fetch('/sidebar-tuner/state', { cache: 'no-store' }).then((r) => r.json());
      fill((res && res.config) || {});
      compatCheck();
      status.textContent = '';
    } catch (e) { status.textContent = '读取配置失败：' + e.message; }
  });

  document.body.appendChild(panel);

  // Esc 关闭；点击面板外部也关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.style.display !== 'none') panel.style.display = 'none';
  });
  document.addEventListener('mousedown', (e) => {
    if (panel.style.display === 'none') return;
    if (panel.contains(e.target) || railBtn.contains(e.target)) return;
    panel.style.display = 'none';
  });
})();`;

export function apply(ctx, config) {
  const merged = { ...DEFAULTS, ...(config || {}), ...readOverride() };
  const css = buildCss(merged);
  const home = resolveHome(ctx);
  const debugOn = merged.debugDump === true;

  /** 三个布尔开关在页面里落到 <html> 的特性属性上，切换即生效。 */
  const flagScript = `(() => {
  const d = document.documentElement;
  window.__dstSetFlag = function (key, on) {
    if (on) d.setAttribute('data-dst-' + key, '1');
    else d.removeAttribute('data-dst-' + key);
  };
  __dstSetFlag('compact', ${merged.compactLayout !== false});
  __dstSetFlag('rail', ${merged.collapsedRail !== false});
  __dstSetFlag('push', ${merged.pushContent !== false});
  __dstSetFlag('tip', ${merged.railTooltips !== false});
  window.__dstIcon = ${JSON.stringify(String(merged.railIcon || 'sliders'))};
})();`;

  // 用最新配置重建并落盘 live.css（热加载路由与页面 link 都读它）
  try {
    fs.writeFileSync(LIVE_PATH, css, 'utf8');
  } catch { /* 写不了就退回内联样式 */ }

  // ── 主通道：样式 + 热加载 link + 设置面板 ─────────────────────────
  try {
    ctx.on('webserver/index-inject', (table) => {
      if (!Array.isArray(table)) return;
      if (css.trim()) {
        table.push({ kind: 'style', text: css });
        table.push({
          kind: 'html',
          placement: 'head',
          html: '<link rel="stylesheet" href="/sidebar-tuner/tuner.css">',
        });
      }
      // 开关属性必须在 head 里先落地，避免首帧闪一下未生效的布局。
      // 它与设置面板无关，面板关掉时（settingsUi: false）照样要注入。
      table.push({ kind: 'script', placement: 'head', text: flagScript });
      if (merged.settingsUi !== false) {
        table.push({ kind: 'script', placement: 'body', text: UI_SCRIPT });
      }
      // 悬停提示是独立的一小段脚本，开设置面板与否都能用
      if (merged.railTooltips !== false) {
        table.push({ kind: 'script', placement: 'body', text: TIP_SCRIPT });
      }
      if (debugOn) {
        table.push({ kind: 'script', placement: 'body', text: DEBUG_DUMP_SCRIPT });
      }
    });
  } catch (error) {
    console.warn('[dsh-sidebar-tuner] index 注入订阅失败：', error?.message || error);
  }

  // ── 路由 ──────────────────────────────────────────────────────────
  try {
    ctx.inject(['webServer'], (host) => {
      const webServer = host.get('webServer');
      if (!webServer || typeof webServer.register !== 'function') return;

      host.effect(() => webServer.register({
        kind: 'exact',
        path: '/sidebar-tuner/tuner.css',
        handler: async (_request, response) => {
          // 优先读插件目录下的 live.css：改完只需要刷新页面即可验证
          let body = css;
          try {
            if (fs.existsSync(LIVE_PATH)) body = fs.readFileSync(LIVE_PATH, 'utf8');
          } catch { /* 读不到就用启动时生成的值 */ }
          response.writeHead(200, {
            'content-type': 'text/css; charset=utf-8',
            'cache-control': 'no-store',
          });
          response.end(body);
        },
      }, 'dsh-sidebar-tuner live stylesheet'));

      host.effect(() => webServer.register({
        kind: 'exact',
        path: '/sidebar-tuner/state',
        handler: async (request, response) => {
          const reply = (code, payload) => {
            response.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            });
            response.end(JSON.stringify(payload));
          };
          if (!isLoopback(request?.socket?.remoteAddress)) return reply(403, { ok: false, error: 'loopback only' });

          const current = { ...DEFAULTS, ...(config || {}), ...readOverride() };
          if (request.method === 'GET') return reply(200, { ok: true, config: current });
          if (request.method !== 'POST') return reply(405, { ok: false, error: 'GET or POST only' });

          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          let body;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8').slice(0, 32 * 1024));
          } catch {
            return reply(400, { ok: false, error: 'bad json' });
          }

          try {
            if (body && body.__reset === true) {
              if (fs.existsSync(OVERRIDE_PATH)) fs.rmSync(OVERRIDE_PATH);
              const next = { ...DEFAULTS, ...(config || {}) };
              const nextCss = buildCss(next);
              fs.writeFileSync(LIVE_PATH, nextCss, 'utf8');
              return reply(200, { ok: true, config: next, css: nextCss });
            }
            const patch = {};
            for (const key of Object.keys(DEFAULTS)) {
              if (key in body) patch[key] = body[key];
            }
            const saved = writeOverride(patch);
            const next = { ...DEFAULTS, ...(config || {}), ...saved };
            const nextCss = buildCss(next);
            fs.writeFileSync(LIVE_PATH, nextCss, 'utf8');
            return reply(200, { ok: true, config: next, css: nextCss });
          } catch (error) {
            return reply(500, { ok: false, error: String(error?.message || error) });
          }
        },
      }, 'dsh-sidebar-tuner settings state'));

      host.effect(() => webServer.register({
        kind: 'exact',
        path: '/sidebar-tuner/probe',
        handler: async (request, response) => {
          const reply = (code, payload) => {
            response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            response.end(JSON.stringify(payload));
          };
          if (!isLoopback(request?.socket?.remoteAddress)) return reply(403, { ok: false, error: 'loopback only' });
          if (request.method !== 'POST') return reply(405, { ok: false, error: 'POST only' });
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          try {
            writeProbe(home, JSON.parse(Buffer.concat(chunks).toString('utf8').slice(0, 64 * 1024)));
          } catch (error) {
            return reply(400, { ok: false, error: String(error?.message || error) });
          }
          return reply(200, { ok: true });
        },
      }, 'dsh-sidebar-tuner diagnostic probe'));
    });
  } catch (error) {
    console.warn('[dsh-sidebar-tuner] 路由注册失败：', error?.message || error);
  }
}

/**
 * Icon-rail hover tips.
 *
 * In the two-column layout (and in the folded rail) the sidebar hides every
 * entry's label with `display:none`, leaving bare icons. This script reads the
 * hidden label back out of the DOM and paints it as its own floating bubble, so
 * the name shows on hover without touching the host's React tree.
 *
 * Delegated on `_panelList`, so a re-render of the entries does not unbind it.
 * The bubble node is `#dst-tip`; its look lives in css.js so live.css can tune
 * it without a reload. Must not contain the literal `</script`.
 */
const TIP_SCRIPT = `(() => {
  if (window.__dstTip) return;
  window.__dstTip = true;

  const TIP_ID = 'dst-tip';
  const RAIL = '[class*="_panelList"]';
  const TITLE = '[class*="_panelTitle"]';
  const FLAG = 'data-dst-tip';
  const BOUND = '__dstTipBound';

  let tip = null;
  let titleHost = null;
  let titleText = '';

  const ensureTip = () => {
    if (tip && tip.isConnected) return tip;
    tip = document.getElementById(TIP_ID);
    if (!tip) {
      tip = document.createElement('div');
      tip.id = TIP_ID;
      tip.setAttribute('role', 'presentation');
      document.body.appendChild(tip);
    }
    return tip;
  };

  const restoreTitle = () => {
    if (!titleHost) return;
    try { titleHost.setAttribute('title', titleText); } catch (e) {}
    titleHost = null;
    titleText = '';
  };

  const hide = () => {
    restoreTitle();
    if (tip) tip.removeAttribute('data-show');
  };

  const squeeze = (value) => String(value || '').replace(/\\s+/g, ' ').trim();

  const labelOf = (node) => {
    const own2 = squeeze(node.getAttribute('data-dst-label'));
    if (own2) return own2;
    const titleEl = node.querySelector(TITLE);
    const fromTitle = titleEl ? squeeze(titleEl.textContent) : '';
    if (fromTitle) return fromTitle;
    const own = squeeze(node.getAttribute('aria-label') || node.getAttribute('title'));
    if (own) return own;
    const inner = node.querySelector('[aria-label], [title]');
    if (inner) return squeeze(inner.getAttribute('aria-label') || inner.getAttribute('title'));
    return '';
  };

  const isVisible = (node) => {
    if (!node) return false;
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return node.getClientRects().length > 0;
  };

  const show = (item) => {
    if (!document.documentElement.hasAttribute(FLAG)) return hide();
    // 名称本来就在屏幕上（非并排布局）时不再弹一次
    if (isVisible(item.querySelector(TITLE))) return hide();
    const text = labelOf(item);
    if (!text) return hide();

    const node = ensureTip();
    if (node.textContent !== text) node.textContent = text;
    node.setAttribute('data-show', '1');

    const box = item.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    let left = box.right + 10;
    if (left + w > innerWidth - 8) left = box.left - w - 10;
    if (left < 8) left = Math.min(Math.max(8, innerWidth - w - 8), box.left);
    let top = box.top + box.height / 2 - h / 2;
    top = Math.max(8, Math.min(innerHeight - h - 8, top));
    node.style.left = Math.round(Math.max(8, left)) + 'px';
    node.style.top = Math.round(top) + 'px';

    // 原生 title 会延迟弹出，和自绘气泡打架；悬停期间先摘掉，移开再装回
    if (!titleHost) {
      const holder = item.hasAttribute('title') ? item : item.querySelector('[title]');
      if (holder) {
        titleHost = holder;
        titleText = holder.getAttribute('title') || '';
        holder.removeAttribute('title');
      }
    }
  };

  const bind = () => {
    const rail = document.querySelector(RAIL);
    if (!rail || rail[BOUND]) return;
    rail[BOUND] = true;
    rail.addEventListener('mouseover', (event) => {
      const target = event.target;
      if (!target || !target.tagName) return;
      let node = target;
      while (node && node.parentElement && node.parentElement !== rail) node = node.parentElement;
      if (!node || node.parentElement !== rail) return;
      if (node.id === TIP_ID) return;
      show(node);
    });
    rail.addEventListener('mouseleave', hide);
    rail.addEventListener('mouseout', (event) => {
      if (!event.relatedTarget) hide();
    });
  };

  bind();
  setInterval(() => {
    bind();
    if (tip && tip.getAttribute('data-show') && !document.documentElement.hasAttribute(FLAG)) hide();
  }, 1000);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
})();`;

const DEBUG_DUMP_SCRIPT = `(() => {
  const send = (payload) => {
    try {
      fetch('/sidebar-tuner/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch {}
  };
  const round = (n) => Math.round(n);
  const colEl = () => document.querySelector('[class*="_sidebarCol"]');
  const colWidth = () => {
    const el = colEl();
    return el ? round(el.getBoundingClientRect().width) : -1;
  };
  const state = () => (colWidth() >= 0 && colWidth() < 120 ? 'collapsed' : 'expanded');
  const collect = () => {
    const col = colEl();
    const frame = document.querySelector('[class*="_frame"]');
    const out = {
      viewport: { w: innerWidth, h: innerHeight },
      colWidth: colWidth(),
      state: state(),
      attrCollapsed: !!document.querySelector('[data-sidebar-collapsed]'),
      frameAttrs: frame ? [...frame.attributes].map((a) => a.name + '=' + a.value).join(' ') : '',
      nodes: [],
    };
    if (!col) return out;
    let count = 0;
    const walk = (el, depth) => {
      if (!el || depth > 6 || count > 140) return;
      for (const child of el.children) {
        if (count++ > 140) return;
        const cs = getComputedStyle(child);
        const r = child.getBoundingClientRect();
        out.nodes.push({
          d: depth,
          tag: child.tagName.toLowerCase(),
          cls: String(child.className || '').slice(0, 100),
          slot: child.getAttribute('data-slot') || '',
          disp: cs.display, pos: cs.position, ovf: cs.overflow,
          w: round(r.width), h: round(r.height), x: round(r.left), y: round(r.top),
          text: (child.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30),
        });
        walk(child, depth + 1);
      }
    };
    walk(col, 0);
    return out;
  };
  let lastState = null;
  let lastFull = 0;
  let ended = 0;
  const t0 = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - t0 > 600000 || ++ended > 400) { clearInterval(timer); return; }
    const s = state();
    const now = Date.now();
    if (s !== lastState) { lastState = s; send({ debug: 'state-change:' + s, ...collect() }); lastFull = now; return; }
    if (now - lastFull > 20000) { send({ debug: 'heartbeat', ...collect() }); lastFull = now; }
  }, 1500);
})();`;







