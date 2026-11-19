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
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCss, DEFAULTS } from './css.js';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 本插件版本号：面板顶部那行要显示它，省得对着 package.json 确认 */
const PLUGIN_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'package.json'), 'utf8'));
    return String(pkg.version || '');
  } catch { return ''; }
})();
const OVERRIDE_PATH = path.join(PLUGIN_DIR, 'override.json');
const LIVE_PATH = path.join(PLUGIN_DIR, 'live.css');

/**
 * 从 asar 归档里读一个小文件。DSH 桌面端的宿主代码是 app.asar 打包的，
 * 普通 fs 无法把它当目录读，但 asar 头部是明文 JSON，解析出来就能定位偏移。
 * 拿不到就返回 null，调用方退回别的来源。
 */
function readFromAsar(asarPath, innerPath) {
  try {
    const fd = fs.openSync(asarPath, 'r');
    try {
      const head = Buffer.alloc(16);
      if (fs.readSync(fd, head, 0, 16, 0) < 16) return null;
      // pikchr: [uint32 = 4][uint32 = jsonLen][json...][padding]
      const jsonLen = head.readUInt32LE(12);
      if (!jsonLen || jsonLen > 16 * 1024 * 1024) return null;
      const jsonBuf = Buffer.alloc(jsonLen);
      if (fs.readSync(fd, jsonBuf, 0, jsonLen, 16) < jsonLen) return null;
      const header = JSON.parse(jsonBuf.toString('utf8'));
      const parts = innerPath.split('/').filter(Boolean);
      let node = header;
      for (const part of parts) {
        node = node && node.files ? node.files[part] : null;
        if (!node) return null;
      }
      if (!node || typeof node.offset !== 'string' || typeof node.size !== 'number') return null;
      // 数据区起点按 4 字节对齐，否则偏移会差几个字节，读出来是乱码
      let dataStart = 16 + jsonLen;
      while (dataStart % 4 !== 0) dataStart += 1;
      const body = Buffer.alloc(node.size);
      if (fs.readSync(fd, body, 0, node.size, dataStart + Number(node.offset)) < node.size) return null;
      return body.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * 探测宿主 DSH 版本。顺序：环境变量 → 解包目录的 package.json → app.asar 里的 package.json。
 * 之前只依赖前端的 window.__DSH_BOOT__，0.2.2-rc.5 起那个全局不再提供版本，面板就只能显示硬编码的旧值。
 */
function detectDshVersion() {
  for (const key of ['DSH_VERSION', 'DSH_APP_VERSION', 'npm_package_version']) {
    const value = process.env[key];
    if (typeof value === 'string' && /^\d+\.\d+\.\d+/.test(value)) return value;
  }
  const roots = [];
  try { if (process.resourcesPath) roots.push(process.resourcesPath); } catch { /* 非 Electron 主进程 */ }
  try { roots.push(path.join(path.dirname(process.execPath), 'resources')); } catch { /* ignore */ }
  for (const root of roots) {
    // 1. 解包安装：resources/app/package.json
    try {
      const unpacked = path.join(root, 'app', 'package.json');
      if (fs.existsSync(unpacked)) {
        const version = JSON.parse(fs.readFileSync(unpacked, 'utf8'))?.version;
        if (version) return String(version);
      }
    } catch { /* 换下一个来源 */ }

    // 2. asar 打包（rc.5 起的默认形态）。Electron 把 app.asar 当目录拦截，
    //    所以先按「目录里的文件」直接读——这一步只有在 Electron 里才成，
    //    纯 Node 下会 ENOENT/ENOTDIR，落到下面的手工解析。
    try {
      const inside = path.join(root, 'app.asar', 'package.json');
      const version = JSON.parse(fs.readFileSync(inside, 'utf8'))?.version;
      if (version) return String(version);
    } catch { /* 非 Electron，继续 */ }

    // 3. 手工解析 asar 头部（纯 Node / 测试环境用）
    try {
      const text = readFromAsar(path.join(root, 'app.asar'), 'package.json');
      if (text) {
        const version = JSON.parse(text)?.version;
        if (version) return String(version);
      }
    } catch { /* 换下一个来源 */ }
  }
  return '';
}

/**
 * 把注册表里的「字面名」收敛成「字族名」。
 * 例：Inter SemiBold Italic → Inter；Microsoft YaHei UI Bold → Microsoft YaHei UI
 * 刻意不剥 Display / Variable / Text —— 它们本身就是不同字族（Inter Display 等）。
 */
const FACE_STYLE = /\s*(?:&.*)?$/;
const STYLE_WORDS = /[\s,]+(?:Thin|ExtraLight|UltraLight|SemiLight|DemiLight|Light|Regular|Normal|Book|Roman|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy|Italic|Oblique)\s*$/i;

function familyOfFace(face) {
  let name = String(face || '').replace(/\s*\((?:TrueType|OpenType|All res)\)\s*$/i, '').trim();
  // 注册表里常见 "Arial Bold & Arial Italic" 这种合并项，取前半段
  name = name.split('&')[0].replace(FACE_STYLE, '').trim();
  for (let i = 0; i < 4; i += 1) {
    const next = name.replace(STYLE_WORDS, '').trim();
    if (next === name || !next) break;
    name = next;
  }
  return name;
}

/** 读一个注册表键，返回原始 Buffer；键不存在或 reg 不可用时返回 null。 */
function queryRegistryKey(key) {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', key],
      { windowsHide: true, timeout: 8000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' },
      (error, stdout) => { resolve(error ? null : stdout); },
    );
  });
}

/**
 * 枚举本机已安装字体族。非 Windows 返回空数组，由前端退回预设列表。
 * 走异步 execFile：同步版会把宿主事件循环卡住约 400ms，
 * 期间所有 RPC（工具调用、状态读写、live.css 轮询）一起排队。
 */
async function listSystemFonts() {
  if (process.platform !== 'win32') return [];
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
  ];
  const families = new Map();
  // 中文 Windows 上 reg 的输出是 GBK，直接按 utf8 读会把中文名解成乱码，
  // 所以先拿原始 buffer，再用 GBK 解码（Node 内置 ICU 支持）。
  const decoder = new TextDecoder('gbk', { fatal: false });
  const raws = await Promise.all(keys.map(queryRegistryKey));
  for (const raw of raws) {
    if (!raw || raw.length === 0) continue;
    const text = decoder.decode(raw);
    for (const line of text.split(/\r?\n/)) {
      // 形如：    Inter SemiBold (TrueType)    REG_SZ    Inter-SemiBold.ttf
      const match = line.match(/^\s{4}(.+?)\s{2,}REG_SZ\s{2,}(\S.*)$/);
      if (!match) continue;
      const fileName = match[2].trim();
      // @ 开头的是竖排变体，重复项，跳过
      if (fileName.startsWith('@')) continue;
      const family = familyOfFace(match[1]);
      if (!family || family.length < 2) continue;
      // 丢掉解不出来的怪字符、纯数字开头与竖排残片，避免列表里出现乱码项
      if (/[\uFFFD\u0000-\u001F]/.test(family)) continue;
      if (!/[\p{L}]/u.test(family)) continue;
      families.set(family.toLowerCase(), family);
    }
  }
  return [...families.values()].sort((left, right) => left.localeCompare(right, 'en'));
}

// 字体装完不会马上变，缓存 5 分钟；过期时先回旧的、后台再刷新，请求不等枚举。
const FONT_TTL_MS = 5 * 60_000;
let fontListCache = { at: 0, fonts: [] };
let fontRefresh = null;

function refreshSystemFonts() {
  if (fontRefresh) return fontRefresh;
  fontRefresh = (async () => {
    try {
      const fonts = await listSystemFonts();
      if (fonts.length > 0) fontListCache = { at: Date.now(), fonts };
    } catch { /* 枚举失败就继续用旧列表 */ }
    return fontListCache.fonts;
  })();
  return fontRefresh.finally(() => { fontRefresh = null; });
}

/**
 * 取字体清单。返回值带 cached/stale 两个标记，便于前端与测试区分：
 * 命中缓存、回的是过期旧值（后台正在刷）、还是刚刚枚举出来的。
 */
async function systemFontsCached(options) {
  const force = Boolean(options && options.force);
  const age = Date.now() - fontListCache.at;
  const hasList = fontListCache.fonts.length > 0;
  if (hasList && !force && age < FONT_TTL_MS) {
    return { fonts: fontListCache.fonts, cached: true, stale: false };
  }
  if (hasList && !force) {
    void refreshSystemFonts();
    return { fonts: fontListCache.fonts, cached: true, stale: true };
  }
  const fonts = await refreshSystemFonts();
  return { fonts, cached: false, stale: false };
}

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
  const file = path.join(dir, 'probe.jsonl');
  fs.mkdirSync(dir, { recursive: true });
  // 上限 512KB：超了就只保留最后 200 行再追加，避免长期运行把文件堆成几十兆
  const LIMIT = 512 * 1024;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > LIMIT) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-200);
      fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
    }
  } catch { /* 截断失败不影响本次写入 */ }
  fs.appendFileSync(
    file,
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
    { key: 'panelWidth', label: '会话列宽 px', min: 180, max: 420, step: 4,
      hint: '并排布局里右侧会话列的宽度，180–420。' },
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
      // Windows 上标题栏区域默认是窗口拖动区，会把点击吃掉
      webkitAppRegion: 'no-drag',
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

  /**
   * 入口插在「更多」锚点之前，而不是列表最末。
   * 理由：panelList 是 overflow:auto，宿主自己会在末尾放一个「更多」锚点；
   * 追加在最末时，插件一多，我们的入口就被挤到可视区外，看起来像"按钮消失了"。
   */
  const sidebarRoot = (nav) => document.querySelector('[class*="_sidebarCol"]')
    || (nav && nav.closest('[class*="_root"]'))
    || (nav && nav.parentElement && nav.parentElement.parentElement);
  // 搜索控件的候选选择器：archive-manager / 旧版 ui-workspace / 通用搜索框。
  // DSH 0.2.2-rc.5 的左栏已经没有搜索控件，所以这里按 DOM 实际情况决定要不要占位，
  // 而不是照着配置硬留一块空白。
  const SEARCH_SELECTORS = [
    '[class*="dsham_searchField"]',
    '[class*="_searchField"]',
    '[class*="_searchBox"]',
    '[class*="_searchInput"]',
    '[class*="_search"] input[type="search"]',
  ];
  const syncSearchFlag = () => {
    let found = false;
    for (const selector of SEARCH_SELECTORS) {
      try { if (document.querySelector(selector)) { found = true; break; } } catch { /* 忽略非法选择器 */ }
    }
    const root = document.documentElement;
    if (!root) return;
    if (found) root.setAttribute('data-dst-search', '1');
    else root.removeAttribute('data-dst-search');
  };

  const attachRail = () => {
    const nav = document.querySelector('[class*="_panelList"]');
    if (!nav) return;
    // 标记宿主侧栏根：样式作用域与排查都靠它，卸载时删掉即复原
    const root = sidebarRoot(nav);
    if (root && root.getAttribute('data-dst-active') !== '1') root.setAttribute('data-dst-active', '1');
    try { syncSearchFlag(); } catch { /* 忽略 */ }
    if (railBtn.parentElement === nav) return;
    const anchor = nav.querySelector('[class*="moreAnchor"]');
    if (anchor && anchor.parentElement === nav) nav.insertBefore(railBtn, anchor);
    else nav.appendChild(railBtn);
    // 挂上了就把兜底浮标撤掉，避免两个入口并存
    const floating = document.getElementById('dst-float-entry');
    if (floating && floating.parentElement) floating.remove();
    // 标签跟着邻居字号走；这里失败也不能影响入口本身
    try { syncLabel(false); } catch { /* 忽略 */ }
  };
  attachRail();

  /**
   * 用 MutationObserver 替代 1 秒轮询。
   * 只有宿主真的改了 DOM 才用 rAF 合并检查一次，并且忽略我们自己子树的变动
   * ——否则「我们插节点 → 触发观察器 → 再插」会自己打自己。
   */
  const isOwnNode = (node) => {
    if (!node) return false;
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element || typeof element.closest !== 'function') return false;
    return Boolean(element.closest('#dst-rail-entry, [data-dst-panel], [data-dst-float-entry], [data-dst-font-pop]'));
  };
  let railScheduled = false;
  const scheduleRailCheck = () => {
    if (railScheduled) return;
    railScheduled = true;
    const run = () => { railScheduled = false; attachRail(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  };
  const startObserver = () => {
    if (typeof MutationObserver !== 'function' || !document.body) return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (isOwnNode(record.target)) continue;
        if (record.type === 'childList' && !record.addedNodes.length && !record.removedNodes.length) continue;
        scheduleRailCheck();
        return;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  // 出问题要能自己报上来：桌面端没有控制台可看，只能把错误写回宿主。
  // 上报节流：同类错误 10 秒内只报一次，免得一个渲染循环把 probe.jsonl 刷满
  const reportedAt = new Map();
  const reportError = (payload) => {
    const fingerprint = String((payload && payload.stage) || '') + '|' + String((payload && payload.message) || '');
    const now = Date.now();
    if (now - (reportedAt.get(fingerprint) || 0) < 10_000) return;
    reportedAt.set(fingerprint, now);
    if (reportedAt.size > 50) reportedAt.clear();
    try {
      fetch('/sidebar-tuner/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      }).catch(() => {});
    } catch { /* 宿主不可达就算了，不能因为上报本身再抛一次 */ }
  };
  window.addEventListener('error', (event) => {
    reportError({
      at: new Date().toISOString(),
      stage: 'client-error',
      message: String(event.message || ''),
      line: event.lineno || 0,
      column: event.colno || 0,
      stack: String((event.error && event.error.stack) || '').slice(0, 800),
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason || {};
    reportError({
      at: new Date().toISOString(),
      stage: 'client-rejection',
      message: String(reason.message || reason),
      stack: String(reason.stack || '').slice(0, 800),
    });
  });
  // 挂载后回执一次：入口到底插进去没有、父节点是谁
  setTimeout(() => {
    const nav = document.querySelector('[class*="_panelList"]');
    reportError({
      at: new Date().toISOString(),
      stage: 'rail-report',
      hasNav: Boolean(nav),
      hasButton: Boolean(document.getElementById('dst-rail-entry')),
      sameParent: Boolean(nav && railBtn.parentElement === nav),
      navChildren: nav ? nav.children.length : 0,
      anchorFound: Boolean(nav && nav.querySelector('[class*="moreAnchor"]')),
      panelTableAttached: Boolean(document.querySelector('[data-dst-panel]')),
    });
  }, 3000);

  // ── 面板 ────────────────────────────────────────────────────
  const panel = el('div', {
    'data-dst-panel': '1',
    style: {
      // 尺寸与内距走 CSS 变量：改 live.css 即可热调，不必重启 DSH
      position: 'fixed', left: '64px', bottom: '14px',
      width: 'var(--dst-panel-w, 720px)', height: 'var(--dst-panel-h, 560px)',
      maxWidth: 'calc(100vw - 96px)', maxHeight: 'calc(100vh - 120px)',
      overflow: 'hidden', padding: 'var(--dst-pad, 22px)',
      borderRadius: 'var(--dst-panel-radius, 14px)',
      border: '1px solid rgba(127,127,127,.3)', background: 'var(--dsw-alias-bg-base, #fff)',
      color: 'inherit', fontSize: 'var(--dst-body-fs, 13px)', lineHeight: '1.5', zIndex: '9999',
      display: 'none', flexDirection: 'column', boxSizing: 'border-box',
      boxShadow: '0 16px 40px rgba(0,0,0,.2)', fontFamily: 'inherit',
    },
  });
  const header = el('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '10px', marginBottom: '16px', paddingBottom: '12px',
      borderBottom: '1px solid rgba(127,127,127,.14)',
    },
  });
  header.appendChild(el('div', {
    text: '侧栏样式及字体设置',
    style: { fontSize: 'calc(var(--dst-body-fs, 13px) + 2px)', fontWeight: '600', letterSpacing: '.01em' },
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
  const DSH_TESTED = '0.2.2-rc.5';
  const compatLine = el('div', {
    style: { marginBottom: '8px', fontSize: '10px', lineHeight: '1.4', color: 'var(--dsw-alias-label-tertiary, #888)' },
  });
  // 宿主版本问一次就缓存：前端全局变量从 rc.5 起不再带版本号
  let hostVersion = '';
  const askHostVersion = async () => {
    if (hostVersion) return hostVersion;
    try {
      const res = await fetch('/sidebar-tuner/version', { cache: 'no-store' }).then((r) => r.json());
      hostVersion = String(res && res.version ? res.version : '');
    } catch { hostVersion = ''; }
    return hostVersion;
  };
  const compatCheck = async () => {
    const has = (sel) => !!document.querySelector(sel);
    const missing = [];
    if (!has('[class*="_sidebarCol"]')) missing.push('侧栏');
    if (!has('[class*="_panelList"]')) missing.push('图标列');
    if (!has('[class*="_centerCol"]')) missing.push('对话区');
    const boot = window.__DSH_BOOT__ || {};
    const version = String(boot.version || boot.buildVersion || boot.appVersion || '') || await askHostVersion();
    const self = '插件 ' + ${JSON.stringify(PLUGIN_VERSION || '?')};
    if (missing.length > 0) {
      compatLine.style.color = 'var(--dsw-alias-label-warning, #c47f00)';
      compatLine.textContent = self + ' · ⚠ 没找到' + missing.join('、') + '锚点，当前 DSH 版本可能未适配'
        + (version ? '（检测到 DSH ' + version + '）' : '');
    } else {
      compatLine.style.color = 'var(--dsw-alias-label-tertiary, #888)';
      compatLine.textContent = self + (version
        ? ' · 已适配（检测到 DSH ' + version + '，兼容 0.2.x）'
        : ' · 已适配（未能读到 DSH 版本，兼容 0.2.x）');
    }
  };
  compatLine.textContent = '插件 ' + ${JSON.stringify(PLUGIN_VERSION || '?')} + ' · 已适配（兼容 0.2.x）';
  panel.appendChild(compatLine);
  setTimeout(compatCheck, 3000);
  setInterval(compatCheck, 30000);

  const inputStyle = {
    flex: '1 1 auto', minWidth: '0', padding: '6px 10px', borderRadius: '7px',
    border: '1px solid rgba(127,127,127,.35)', background: 'transparent',
    color: 'inherit', fontSize: 'calc(var(--dst-body-fs, 13px) - 0.5px)',
  };
  // 每个字段两行：上面「标签 + 控件」，下面一句人话说明。
  // 面板里全是 px、倍数和选择器，不解释一下没人知道改的是什么。
  const fieldOf = (label, hint) => {
    const wrap = el('div', { style: { marginBottom: 'var(--dst-row-gap, 18px)' } });
    const row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });
    row.appendChild(el('label', {
      text: label,
      style: {
        flex: '0 0 var(--dst-label-w, 140px)',
        color: 'var(--dsw-alias-label-secondary, #666)',
      },
    }));
    wrap.appendChild(row);
    // 说明行总是建出来：字体下拉那几项要在运行时把「已装 8/13」写进去
    const hintNode = el('div', {
      text: hint || '',
      style: {
        marginTop: 'var(--dst-hint-gap, 5px)',
        fontSize: 'var(--dst-hint-fs, 11px)',
        lineHeight: '1.55',
        color: 'var(--dsw-alias-label-tertiary, #888)',
      },
    });
    wrap.appendChild(hintNode);
    return { wrap, row, hint: hintNode };
  };

  /**
   * 胶囊开关：真身还是一个隐藏的 checkbox，
   * 这样 fill / collect 里读 .checked 的逻辑一行都不用改。
   */
  const PILL_SYNCS = [];
  const pillOf = (box) => {
    const pill = el('span', {
      role: 'switch',
      tabindex: '0',
      'data-dst-pill': '1',
      style: {
        flex: '0 0 auto', width: '36px', height: '20px', borderRadius: '999px',
        position: 'relative', cursor: 'pointer', display: 'inline-block',
        background: 'var(--dsw-alias-interactive-bg, rgba(127,127,127,.28))',
        transition: 'background 160ms cubic-bezier(.2,.8,.2,1)',
        boxSizing: 'border-box', verticalAlign: 'middle',
      },
    });
    const knob = el('span', {
      style: {
        position: 'absolute', top: '2px', left: '2px', width: '16px', height: '16px',
        borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)',
        transition: 'transform 160ms cubic-bezier(.2,.8,.2,1)',
        display: 'block', pointerEvents: 'none',
      },
    });
    pill.appendChild(knob);
    box.style.display = 'none';
    const sync = () => {
      const on = Boolean(box.checked);
      pill.setAttribute('aria-checked', on ? 'true' : 'false');
      pill.style.background = on
        ? 'var(--dsw-alias-brand-primary, #4176e6)'
        : 'var(--dsw-alias-interactive-bg, rgba(127,127,127,.28))';
      knob.style.transform = on ? 'translateX(16px)' : 'none';
    };
    const toggle = () => { box.checked = !box.checked; box.dispatchEvent(new Event('change')); sync(); };
    pill.addEventListener('click', toggle);
    pill.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggle(); }
    });
    box.addEventListener('change', sync);
    PILL_SYNCS.push(sync);
    sync();
    return pill;
  };

  /**
   * 字体选择器：按钮 + 可搜索浮层。
   * 列表 = 预设（置顶）+ 宿主枚举出来的本机全部字族（/sidebar-tuner/fonts）。
   * 每一项用该字体自己渲染样张，右侧标安装状态，所以同名不同观感（Inter / Inter Display）一眼可分。
   */
  let systemFonts = null;
  const loadSystemFonts = async () => {
    if (systemFonts) return systemFonts;
    try {
      const res = await fetch('/sidebar-tuner/fonts', { cache: 'no-store' }).then((r) => r.json());
      systemFonts = Array.isArray(res && res.fonts) ? res.fonts : [];
    } catch { systemFonts = []; }
    return systemFonts;
  };
  // 强制重扫：跳过前端缓存，并让宿主 ?refresh=1 重读注册表
  const rescanFonts = async () => {
    systemFonts = null;
    closeFontPops();
    try {
      const res = await fetch('/sidebar-tuner/fonts?refresh=1', { cache: 'no-store' }).then((r) => r.json());
      systemFonts = Array.isArray(res && res.fonts) ? res.fonts : [];
    } catch { systemFonts = []; }
    return systemFonts.length;
  };
  const closeFontPops = () => {
    activePop = null;
    const nodes = document.querySelectorAll('[data-dst-font-pop]');
    for (let i = 0; i < nodes.length; i += 1) nodes[i].remove();
  };
  // 当前打开的浮层：滚动时重新定位，而不是关掉。
  // 曾经写成“滚动即关”，结果输入框自动聚焦触发的滚动把刚打开的浮层立刻关了。
  let activePop = null;
  const placePop = (pop, trigger) => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(300, Math.min(rect.width + 120, 420));
    pop.style.width = width + 'px';
    pop.style.left = Math.max(8, Math.min(rect.left, (window.innerWidth || 1280) - width - 8)) + 'px';
    pop.style.top = Math.min(rect.bottom + 6, (window.innerHeight || 800) - 340) + 'px';
  };
  const repositionFontPops = () => {
    if (!activePop || !activePop.node.parentElement) return;
    const rect = activePop.trigger.getBoundingClientRect();
    // 触发按钮被滚出可视区就收起来，否则跟着滚动重排位置
    if (rect.bottom < 0 || rect.top > (window.innerHeight || 800)) { closeFontPops(); return; }
    placePop(activePop.node, activePop.trigger);
  };

  // 字体名会进 inline style，先把可能破坏 CSS 的字符去掉
  // 注意：这段在宿主模板字符串里，别在这里写反斜杠——会被宿主提前解释掉。
  const safeFontName = (name) => String(name || '').replace(/["';{}<>]/g, '').trim();

  const buildFontPicker = (presets, initial) => {
    let value = initial || '';
    let opening = false;
    const wrap = el('div', {
      'data-dst-font-picker': '1',
      style: { position: 'relative', flex: '1 1 auto', minWidth: '0' },
    });
    const btn = el('button', {
      type: 'button',
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
        width: '100%', textAlign: 'left', cursor: 'pointer',
        padding: '6px 10px', borderRadius: '7px',
        border: '1px solid rgba(127,127,127,.35)', background: 'transparent',
        color: 'inherit', fontSize: 'calc(var(--dst-body-fs, 13px) - 0.5px)', fontFamily: 'inherit',
      },
    });
    const label = el('span', {
      style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    });
    btn.appendChild(label);
    btn.appendChild(el('span', { text: '▾', style: { opacity: '.55', flex: 'none' } }));
    wrap.appendChild(btn);

    const setValue = (next) => {
      value = next || '';
      label.textContent = value || '（不指定，跟随 DSH）';
      // 已选字体用自身渲染，让按钮上就能看出效果
      label.style.fontFamily = value ? '"' + safeFontName(value) + '", inherit' : 'inherit';
    };
    setValue(value);

    const renderList = (pop, keyword) => {
      const list = pop.querySelector('[data-dst-font-list]');
      list.textContent = '';
      const key = String(keyword || '').trim().toLowerCase();
      const merged = [];
      const seen = new Set();
      const push = (name) => {
        const low = name.toLowerCase();
        if (seen.has(low)) return;
        seen.add(low);
        merged.push(name);
      };
      push('');
      for (const name of presets) push(name);
      for (const name of systemFonts || []) push(name);
      const matched = merged.filter((name) => !key || !name || name.toLowerCase().includes(key));
      const limit = 150;
      const shown = matched.slice(0, limit);
      for (const name of shown) {
        const row = el('button', {
          type: 'button',
          style: {
            display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left',
            padding: '7px 10px', border: '0', background: 'transparent', cursor: 'pointer',
            color: 'inherit', fontSize: '12px', fontFamily: 'inherit',
          },
        });
        row.appendChild(el('span', {
          text: name ? 'Aa 汉字 0123' : '（不指定，跟随 DSH）',
          style: {
            flex: '1 1 auto', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', fontFamily: name ? '"' + safeFontName(name) + '", monospace' : 'inherit',
          },
        }));
        if (name) {
          row.appendChild(el('span', {
            text: name,
            style: { flex: '0 0 auto', fontSize: '10px', opacity: '.6', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }));
          const ok = available(name);
          row.appendChild(el('span', {
            text: ok ? '✓' : '?',
            title: ok ? '已安装' : '未检测到，选中后会回退到下一个字体',
            style: { flex: 'none', fontSize: '11px', opacity: ok ? '.85' : '.4' },
          }));
        }
        row.addEventListener('click', () => { setValue(name); closeFontPops(); });
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16))'; });
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
        list.appendChild(row);
      }
      if (matched.length > shown.length) {
        list.appendChild(el('div', {
          text: '共 ' + matched.length + ' 个，只显示前 ' + shown.length + ' 个；继续输入缩小范围',
          style: { padding: '8px 10px', fontSize: '10px', opacity: '.6' },
        }));
      }
      if (matched.length === 0) {
        list.appendChild(el('div', { text: '没有匹配的字体', style: { padding: '10px', fontSize: '11px', opacity: '.6' } }));
      }
    };

    const openPop = async () => {
      if (opening) return;            // 连点两次时避免挂出两个浮层
      if (document.querySelector('[data-dst-font-pop]')) { closeFontPops(); return; }
      opening = true;
      try {
        closeFontPops();
        await loadSystemFonts();
      const pop = el('div', {
        'data-dst-font-pop': '1',
        style: {
          position: 'fixed', zIndex: '10000',
          background: 'var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #fff))',
          border: '1px solid rgba(127,127,127,.35)', borderRadius: '10px',
          boxShadow: '0 14px 34px rgba(0,0,0,.24)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', maxHeight: '320px', color: 'inherit',
        },
      });
      placePop(pop, btn);
      activePop = { node: pop, trigger: btn };

      const search = el('input', {
        type: 'text',
        placeholder: '搜索本机字体…（共 ' + ((systemFonts || []).length + presets.length) + ' 个）',
        style: {
          margin: '8px', padding: '7px 10px', borderRadius: '7px', fontSize: '12px',
          border: '1px solid rgba(127,127,127,.35)', background: 'transparent',
          color: 'inherit', fontFamily: 'inherit', outline: 'none',
        },
      });
      const list = el('div', {
        'data-dst-font-list': '1',
        style: { overflowY: 'auto', flex: '1 1 auto', paddingBottom: '6px' },
      });
      pop.appendChild(search);
      pop.appendChild(list);
      panel.appendChild(pop);
      renderList(pop, '');
      search.addEventListener('input', () => renderList(pop, search.value));
      search.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.stopPropagation(); closeFontPops(); }
        if (event.key === 'Enter') {
          const first = list.querySelector('button');
          if (first) first.dispatchEvent(new Event('click'));
        }
      });
      setTimeout(() => { try { search.focus(); } catch { /* 忽略 */ } }, 0);
      } finally {
        opening = false;
      }
    };

    btn.addEventListener('click', (event) => { event.stopPropagation(); openPop(); });

    return {
      node: wrap,
      getValue: () => value,
      setValue,
    };
  };

  const SECTIONS = [];

  // summary 要在 fill 之前声明：fill 里会引用它。
  // 用 let + 后续赋值，避免 const 的 TDZ 在调用顺序变化时抛 ReferenceError。
  let summary = null;

  // 分组：内容不再直接堆进面板，而是登记成「域」，
  // 由左侧导航切换（同一时刻只挂一个域的 DOM，所以不需要上下滚动）。
  const sectionOf = (title, opts) => {
    const wrap = el('div', { style: { margin: '0' }, 'data-dst-section': title });
    const body = el('div', { style: { paddingTop: '2px' } });
    wrap.appendChild(body);
    const entry = { title, wrap, body, collapsed: Boolean(opts && opts.collapsed) };
    SECTIONS.push(entry);
    return entry;
  };

  // 装了的打勾，没装的标问号：字体选择器里每一项都靠它标状态。
  const fontCount = (list) => '已装 ' + list.filter((name) => available(name)).length + '/' + list.length + '，问号＝未检测到。';

  // ── 侧栏字体 ────────────────────────────────────────────────
  const secFont = sectionOf('侧栏字体');
  const zhField = fieldOf('中文字体', '');
  const zhSelect = buildFontPicker(ZH_FONTS, '');
  zhField.row.appendChild(zhSelect.node);
  secFont.body.appendChild(zhField.wrap);

  const enField = fieldOf('英文字体', '');
  const enSelect = buildFontPicker(EN_FONTS, '');
  enField.row.appendChild(enSelect.node);
  secFont.body.appendChild(enField.wrap);

  const fbField = fieldOf('回退字体', '没装时依次回退。');
  const fbWrap = el('div', { style: { flex: '1 1 auto', display: 'flex', flexWrap: 'wrap', gap: '10px 14px' } });
  const fbBoxes = {};
  for (const name of FALLBACKS) {
    const box = el('input', { type: 'checkbox' });
    box.style.margin = '0';
    const cell = el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } });
    cell.appendChild(pillOf(box));
    cell.appendChild(el('span', { text: name, style: { fontSize: '11px' } }));
    fbWrap.appendChild(cell);
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
      // 只有落成 <html> 属性的开关能即时生效；数字类与选择类要保存后重算 CSS
      const flag = FLAG_OF[f.key];
      if (flag && window.__dstSetFlag) {
        window.__dstSetFlag(flag, box.checked);
        status.textContent = (box.checked ? '已开启' : '已关闭') + '（尚未保存）';
      } else {
        status.textContent = (box.checked ? '已开启' : '已关闭') + '，点「应用并保存」后生效';
      }
    });
    field.row.appendChild(pillOf(box));
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
  const contentZhSelect = buildFontPicker(ZH_FONTS, '');
  cZhField.row.appendChild(contentZhSelect.node);
  secContent.body.appendChild(cZhField.wrap);

  const cEnField = fieldOf('英文字体', '');
  const contentEnSelect = buildFontPicker(EN_FONTS, '');
  cEnField.row.appendChild(contentEnSelect.node);
  secContent.body.appendChild(cEnField.wrap);

  const cFbField = fieldOf('回退字体', '没装时依次回退。');
  const contentFbWrap = el('div', { style: { flex: '1 1 auto', display: 'flex', flexWrap: 'wrap', gap: '10px 14px' } });
  const contentFbBoxes = {};
  for (const name of FALLBACKS) {
    const box = el('input', { type: 'checkbox' });
    box.style.margin = '0';
    const cell = el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } });
    cell.appendChild(pillOf(box));
    cell.appendChild(el('span', { text: name, style: { fontSize: '11px' } }));
    contentFbWrap.appendChild(cell);
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
  const contentCodeSelect = buildFontPicker(MONO_FONTS, '');
  cCodeField.row.appendChild(contentCodeSelect.node);
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

  // ── 字距与字形（0.3.0 新增）────────────────────────────────
  const secGlyph = sectionOf('字距与字形');
  const glyphNums = {};
  const GLYPH_NUMS = [
    { key: 'letterSpacing', label: '字距 em', min: -0.05, max: 0.08, step: 0.005,
      hint: '0 = 不改。负值更紧（Inter 官方建议 -0.011em），正值更松。' },
    { key: 'fontWeight', label: '字重', min: 0, max: 900, step: 50,
      hint: '0 = 用 DSH 自己的字重。450 这类中间值需要可变字体（Inter Variable）。' },
  ];
  for (const f of GLYPH_NUMS) {
    const field = fieldOf(f.label, f.hint);
    const input = el('input', { type: 'number', style: inputStyle });
    input.min = f.min; input.max = f.max; input.step = f.step;
    field.row.appendChild(input);
    glyphNums[f.key] = input;
    secGlyph.body.appendChild(field.wrap);
  }
  const FEATURES = [
    { name: 'calt', label: 'calt 上下文替代', hint: '箭头、连写旁边会自动换字形' },
    { name: 'case', label: 'case 标点对齐', hint: '全大写时括号与连字符上移到视觉中线' },
    { name: 'tnum', label: 'tnum 等宽数字', hint: '数字占同样宽度，列表里的序号不再跳动' },
    { name: 'ss01', label: 'ss01 风格集 1', hint: 'Inter 的替代字形集，视字体而定' },
    { name: 'cv11', label: 'cv11 单层 a', hint: '把双层 a 换成单层，部分人更易读' },
  ];
  const featureBoxes = {};
  const featField = fieldOf('OpenType 特性', '逐个开，互不冲突。字体不支持时无变化。');
  const featWrap = el('div', { style: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: '8px' } });
  for (const item of FEATURES) {
    const box = el('input', { type: 'checkbox' });
    box.style.margin = '0';
    const cell = el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } });
    cell.appendChild(pillOf(box));
    cell.appendChild(el('span', { text: item.label, style: { fontSize: '11px', fontWeight: '500' } }));
    cell.appendChild(el('span', { text: item.hint, style: { fontSize: '10px', color: 'var(--dsw-alias-label-tertiary, #888)' } }));
    featWrap.appendChild(cell);
    featureBoxes[item.name] = box;
  }
  featField.row.appendChild(featWrap);
  secGlyph.body.appendChild(featField.wrap);

  // ── 终端（0.3.0 新增）──────────────────────────────────────
  const secTerm = sectionOf('终端');
  const termFollowBox = el('input', { type: 'checkbox' });
  const termField = fieldOf('跟随代码字体', '勾上时终端用「对话区 → 代码字体」，下面的字体选择失效。');
  termField.row.appendChild(pillOf(termFollowBox));
  secTerm.body.appendChild(termField.wrap);

  const termFontField = fieldOf('终端字体', '只作用于终端，不影响代码块。');
  const termFontSelect = buildFontPicker(MONO_FONTS, '');
  termFontField.row.appendChild(termFontSelect.node);
  secTerm.body.appendChild(termFontField.wrap);

  const termNums = {};
  const TERM_NUMS = [
    { key: 'terminalFontSize', label: '终端字号 px', min: 0, max: 20, step: 1,
      hint: '实验项：xterm 内部写死 13px，改了字号可能让选区错位，0 = 关闭。' },
    { key: 'terminalLetterSpacing', label: '终端字距 px', min: 0, max: 4, step: 0.5,
      hint: '实验项：同样只在终端新建时读取，0 = 关闭。' },
  ];
  for (const f of TERM_NUMS) {
    const field = fieldOf(f.label, f.hint);
    const input = el('input', { type: 'number', style: inputStyle });
    input.min = f.min; input.max = f.max; input.step = f.step;
    field.row.appendChild(input);
    termNums[f.key] = input;
    secTerm.body.appendChild(field.wrap);
  }
  const termLigField = fieldOf('连字', '把 -> 、=> 连成箭头。字体不支持时无变化。');
  const termLigBox = el('input', { type: 'checkbox' });
  termLigField.row.appendChild(pillOf(termLigBox));
  secTerm.body.appendChild(termLigField.wrap);

  const termNote = el('div', {
    text: '⚠ 字体族改动只对「新打开的终端」生效。已开的标签请关闭后重新打开 —— xterm 只在创建时读一次容器字体。',
    style: {
      marginTop: '4px', fontSize: '10px', lineHeight: '1.5',
      color: 'var(--dsw-alias-label-tertiary, #888)',
    },
  });
  secTerm.body.appendChild(termNote);
  termFontField.hint.textContent = fontCount(MONO_FONTS);

  // ── 高级 ────────────────────────────────────────────────────
  const secAdvanced = sectionOf('高级：不改字体的区域', { collapsed: true });
  const keepField = fieldOf('勾选保护', '勾上的位置保持原字号。');
  const keepBoxes = {};
  const keepPanel = el('div', { style: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: '8px' } });
  for (const preset of KEEP_PRESETS) {
    const box = el('input', { type: 'checkbox' });
    box.style.margin = '0';
    const cell = el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } });
    cell.appendChild(pillOf(box));
    cell.appendChild(el('span', { text: preset.label, style: { fontSize: '11px' } }));
    keepPanel.appendChild(cell);
    keepBoxes[preset.selector] = box;
  }
  keepField.row.appendChild(keepPanel);
  secAdvanced.body.appendChild(keepField.wrap);

  const customField = fieldOf('其它区域', '没列到的插件填选择器。');
  const customInput = el('input', { type: 'text', placeholder: '（可选）', style: inputStyle });
  customField.row.appendChild(customInput);
  secAdvanced.body.appendChild(customField.wrap);

  // 装完字体不用重启：清掉前端缓存并让宿主强制重读注册表
  const rescanField = fieldOf('字体清单', '刚装完字体点一下，重新读注册表。');
  const rescanNote = el('span', {
    text: '',
    style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)' },
  });
  const rescanBtn = el('button', {
    type: 'button',
    text: '重新扫描本机字体',
    onclick: async () => {
      if (rescanNote.textContent === '扫描中…') return;
      rescanBtn.disabled = true;
      rescanNote.textContent = '扫描中…';
      const count = await rescanFonts();
      rescanBtn.disabled = false;
      rescanNote.textContent = count
        ? '已重新扫描：' + count + ' 个字体族'
        : '扫描没成功，仍在用上一次的清单';
    },
    style: {
      padding: '5px 10px', borderRadius: 'var(--dsw-radius-md, 8px)', cursor: 'pointer',
      border: '1px solid rgba(127,127,127,.35)', background: 'transparent',
      color: 'inherit', fontSize: '11px', fontFamily: 'inherit',
    },
  });
  rescanField.row.appendChild(rescanBtn);
  rescanField.row.appendChild(rescanNote);
  secAdvanced.body.appendChild(rescanField.wrap);

  // 配置备份：换机器时把 JSON 存下来，粘回去就能还原（也方便贴到群里求助）
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* 退回 execCommand */ }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      if (area.select) area.select();
      const ok = document.execCommand ? document.execCommand('copy') : false;
      area.remove();
      return Boolean(ok);
    } catch { return false; }
  };
  const pastedText = async () => {
    try { return await navigator.clipboard.readText(); } catch { return ''; }
  };

  const ioField = fieldOf('配置备份', '换机器时把 JSON 存下来，粘回去即可还原。');
  const ioNote = el('span', {
    text: '',
    style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)' },
  });
  const ioCopy = el('button', {
    type: 'button',
    text: '复制当前配置',
    onclick: async () => {
      const ok = await copyText(JSON.stringify(collect(), null, 2));
      ioNote.textContent = ok ? '已复制到剪贴板' : '复制没成功，检查一下剪贴板权限';
    },
    style: {
      padding: '5px 10px', borderRadius: 'var(--dsw-radius-md, 8px)', cursor: 'pointer',
      border: '1px solid rgba(127,127,127,.35)', background: 'transparent',
      color: 'inherit', fontSize: '11px', fontFamily: 'inherit',
    },
  });
  const ioPaste = el('button', {
    type: 'button',
    text: '从剪贴板导入',
    onclick: async () => {
      if (ioNote.textContent === '导入中…') return;
      ioPaste.disabled = true;
      ioNote.textContent = '导入中…';
      const text = await pastedText();
      if (!text.trim()) {
        ioPaste.disabled = false;
        ioNote.textContent = '剪贴板是空的，或没有读取权限';
        return;
      }
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* 下面统一报错 */ }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        ioPaste.disabled = false;
        ioNote.textContent = '剪贴板里不是配置对象（要 JSON）';
        return;
      }
      try {
        const res = await post(parsed);
        if (res && res.ok) {
          fill(res.config || {});
          applyCss(res.css);
          ioNote.textContent = '已导入并保存';
        } else {
          ioNote.textContent = '导入失败：' + (res && res.error ? res.error : '未知错误');
        }
      } catch (reason) {
        ioNote.textContent = '导入失败：' + (reason && reason.message ? reason.message : '网络错误');
      } finally {
        ioPaste.disabled = false;
      }
    },
    style: {
      padding: '5px 10px', borderRadius: 'var(--dsw-radius-md, 8px)', cursor: 'pointer',
      border: '1px solid rgba(127,127,127,.35)', background: 'transparent',
      color: 'inherit', fontSize: '11px', fontFamily: 'inherit',
    },
  });
  ioField.row.appendChild(ioCopy);
  ioField.row.appendChild(ioPaste);
  ioField.row.appendChild(ioNote);
  secAdvanced.body.appendChild(ioField.wrap);

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
  // 3 秒一次足够：live.css 是调样式时用的热更新通道，没人会在 1.5 秒内手改两次
  setInterval(pull, 3000);

  const fill = (state) => {
    zhSelect.setValue(state.fontFamilyZh);
    enSelect.setValue(state.fontFamilyEn);
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
    contentZhSelect.setValue(state.contentFontZh);
    contentEnSelect.setValue(state.contentFontEn);
    const contentFbs = Array.isArray(state.contentFontFallbacks) ? state.contentFontFallbacks : [];
    for (const name of FALLBACKS) contentFbBoxes[name].checked = contentFbs.indexOf(name) >= 0;
    contentSizeInput.value = state.contentFontSize ? String(state.contentFontSize) : '';
    contentLhInput.value = state.contentLineHeight ? String(state.contentLineHeight) : '';
    contentCodeSelect.setValue(state.contentCodeFont);
    contentCodeSizeInput.value = state.contentCodeFontSize ? String(state.contentCodeFontSize) : '';

    // 0.3.0 新增域
    glyphNums.letterSpacing.value = state.letterSpacing ? String(state.letterSpacing) : '';
    glyphNums.fontWeight.value = state.fontWeight ? String(state.fontWeight) : '';
    const feats = Array.isArray(state.fontFeatures) ? state.fontFeatures : [];
    for (const item of FEATURES) featureBoxes[item.name].checked = feats.indexOf(item.name) >= 0;
    termFollowBox.checked = state.terminalFollowCode !== false;
    termFontSelect.setValue(state.terminalFontFamily);
    termNums.terminalFontSize.value = state.terminalFontSize ? String(state.terminalFontSize) : '';
    termNums.terminalLetterSpacing.value = state.terminalLetterSpacing ? String(state.terminalLetterSpacing) : '';
    termLigBox.checked = state.terminalLigatures === true;

    // 程序写值不会触发 change，胶囊要手动同步一次
    for (const sync of PILL_SYNCS) sync();

    // 左栏底部的「当前生效」摘要：不切域也能一眼看到关键三项
    if (summary) {
      const zhName = state.fontFamilyZh || '跟随 DSH';
      const enName = state.fontFamilyEn || '跟随 DSH';
      const sizeName = state.fontSize
        ? state.fontSize + 'px'
        : (state.fontScale && state.fontScale !== 1 ? '×' + state.fontScale : '跟随 DSH');
      const termName = state.terminalFollowCode === false
        ? (state.terminalFontFamily || '未指定')
        : '跟随代码字体';
      summary.style.whiteSpace = 'pre-line';
      summary.textContent = '中文 ' + zhName + '\\n西文 ' + enName + '\\n字号 ' + sizeName + '\\n终端 ' + termName;
    }
  };

  /**
   * 主动向宿主要一次状态，用于「窗口重新获得焦点时自愈」。
   * 宿主侧改了 override.json（或在另一个窗口里改过），这里不需要重启就能跟上：
   * 配置变了就回填面板，CSS 变了就换掉 #dst-live。
   */
  let syncing = false;
  let lastSyncAt = 0;
  const syncFromHost = async (options) => {
    const force = Boolean(options && options.force);
    if (syncing) return;
    if (!force && Date.now() - lastSyncAt < 800) return;
    syncing = true;
    lastSyncAt = Date.now();
    try {
      const res = await fetch('/sidebar-tuner/state', { cache: 'no-store' }).then((r) => r.json());
      if (res && res.ok !== false) {
        fill((res && res.config) || {});
        if (res && res.css && res.css !== lastCss) { lastCss = res.css; applyCss(res.css); }
        scheduleRailCheck();
      }
    } catch { /* 宿主不可达时静默，下一次焦点再试 */ } finally {
      syncing = false;
    }
  };

  const collect = () => {
    const out = {
      fontFamilyZh: zhSelect.getValue(),
      fontFamilyEn: enSelect.getValue(),
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
    out.contentFontZh = contentZhSelect.getValue();
    out.contentFontEn = contentEnSelect.getValue();
    out.contentFontFallbacks = FALLBACKS.filter((name) => contentFbBoxes[name].checked);
    out.contentFontSize = contentSizeInput.value === '' ? 0 : Number(contentSizeInput.value);
    out.contentLineHeight = contentLhInput.value === '' ? 0 : Number(contentLhInput.value);
    out.contentCodeFont = contentCodeSelect.getValue();
    out.contentCodeFontSize = contentCodeSizeInput.value === '' ? 0 : Number(contentCodeSizeInput.value);
    // 0.3.0 新增域
    out.letterSpacing = glyphNums.letterSpacing.value === '' ? 0 : Number(glyphNums.letterSpacing.value);
    out.fontWeight = glyphNums.fontWeight.value === '' ? 0 : Number(glyphNums.fontWeight.value);
    out.fontFeatures = FEATURES.filter((item) => featureBoxes[item.name].checked).map((item) => item.name);
    out.terminalFollowCode = termFollowBox.checked;
    out.terminalFontFamily = termFontSelect.getValue();
    out.terminalFontSize = termNums.terminalFontSize.value === '' ? 0 : Number(termNums.terminalFontSize.value);
    out.terminalLetterSpacing = termNums.terminalLetterSpacing.value === '' ? 0 : Number(termNums.terminalLetterSpacing.value);
    out.terminalLigatures = termLigBox.checked;
    return out;
  };

  const post = (body) => fetch('/sidebar-tuner/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  }).then((r) => r.json());

  let busy = false;
  const save = async () => {
    if (busy) return;
    busy = true;
    status.textContent = '保存中…';
    try {
      const res = await post(collect());
      if (res && res.ok) { applyCss(res.css); status.textContent = '已应用并保存到 override.json'; }
      else status.textContent = '保存失败：' + (res && res.error ? res.error : '未知错误');
    } catch (e) { status.textContent = '保存失败：' + e.message; } finally { busy = false; }
  };

  const reset = async () => {
    if (busy) return;
    busy = true;
    status.textContent = '恢复默认…';
    try {
      const res = await post({ __reset: true });
      if (res && res.ok) { fill(res.config || {}); applyCss(res.css); status.textContent = '已恢复默认'; }
    } catch (e) { status.textContent = '失败：' + e.message; } finally { busy = false; }
  };

  const actions = el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } });
  const mkBtn = (text, handler, primary) => el('button', {
    text,
    onclick: handler,
    style: {
      flex: '1 1 0', padding: '6px 8px', borderRadius: '7px', cursor: 'pointer',
      border: primary ? '1px solid transparent' : '1px solid rgba(127,127,127,.35)',
      background: primary ? 'var(--dsw-alias-brand-primary, #4176e6)' : 'transparent',
      color: primary ? '#fff' : 'inherit',
      fontWeight: primary ? '600' : '400',
      fontSize: '12px',
    },
  });
  actions.appendChild(mkBtn('应用并保存', save, true));
  actions.appendChild(mkBtn('恢复默认', reset));

  // ── 两栏工作台：左侧域导航 + 右侧内容 + 底部固定动作条 ─────────
  const workbench = el('div', {
    style: { display: 'flex', flex: '1 1 auto', minHeight: '0', gap: '0', marginTop: '2px' },
  });
  const navcol = el('div', {
    'data-dst-nav': '1',
    style: {
      flex: '0 0 var(--dst-nav-w, 168px)', display: 'flex', flexDirection: 'column',
      gap: 'var(--dst-nav-gap, 3px)',
      padding: '2px 14px 2px 0', overflowY: 'auto',
      borderRight: '1px solid rgba(127,127,127,.18)',
    },
  });
  const content = el('div', {
    'data-dst-content': '1',
    style: {
      flex: '1 1 auto', minWidth: '0', overflowY: 'auto',
      padding: '2px 2px 2px var(--dst-content-pad, 22px)',
    },
  });
  workbench.appendChild(navcol);
  workbench.appendChild(content);

  summary = el('div', {
    style: {
      marginTop: 'auto', paddingTop: '10px', fontSize: '10px', lineHeight: '1.6',
      color: 'var(--dsw-alias-label-tertiary, #888)', borderTop: '1px solid rgba(127,127,127,.14)',
    },
  });

  let activeIndex = 0;
  const navButtons = [];
  // 记住上次停留的分区：天天调的是「侧栏排版」，每次打开都回到第一个太烦
  const SECTION_KEY = 'dst-section-index';
  const rememberSection = (index) => {
    try { localStorage.setItem(SECTION_KEY, String(index)); } catch { /* 无存储就算了 */ }
  };
  const lastSection = () => {
    try {
      const raw = localStorage.getItem(SECTION_KEY);
      const index = Number(raw);
      if (Number.isInteger(index) && index >= 0 && index < SECTIONS.length) return index;
    } catch { /* 无存储就用第一个 */ }
    return 0;
  };
  const showSection = (index) => {
    activeIndex = index;
    rememberSection(index);
    content.textContent = '';
    content.scrollTop = 0;
    content.appendChild(SECTIONS[index].wrap);
    navButtons.forEach((button, i) => {
      const on = i === index;
      button.style.background = on ? 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16))' : 'transparent';
      button.style.color = on ? 'var(--dsw-alias-label-primary, inherit)' : 'var(--dsw-alias-label-secondary, #666)';
      button.style.fontWeight = on ? '600' : '400';
      button.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  };
  SECTIONS.forEach((entry, index) => {
    const button = el('button', {
      text: entry.title,
      style: {
        textAlign: 'left', borderRadius: 'var(--dsw-radius-md, 8px)',
        padding: 'var(--dst-nav-pad-y, 9px) 11px',
        border: '0', background: 'transparent', cursor: 'pointer',
        fontSize: 'var(--dst-body-fs, 13px)',
        color: 'var(--dsw-alias-label-secondary, #666)', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'inherit',
      },
    });
    button.addEventListener('click', () => showSection(index));
    button.addEventListener('mouseenter', () => {
      if (activeIndex !== index) button.style.background = 'var(--dsw-alias-interactive-bg, rgba(127,127,127,.10))';
    });
    button.addEventListener('mouseleave', () => {
      if (activeIndex !== index) button.style.background = 'transparent';
    });
    navButtons.push(button);
    navcol.appendChild(button);
  });
  // 上下键在域之间移动，Home/End 跳到首尾：面板开着时不用去够鼠标
  navcol.addEventListener('keydown', (event) => {
    const total = SECTIONS.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      showSection((activeIndex + 1) % total);
      if (navButtons[activeIndex]) navButtons[activeIndex].focus();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      showSection((activeIndex - 1 + total) % total);
      if (navButtons[activeIndex]) navButtons[activeIndex].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      showSection(0);
      if (navButtons[0]) navButtons[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      showSection(total - 1);
      if (navButtons[total - 1]) navButtons[total - 1].focus();
    }
  });
  navcol.appendChild(summary);

  panel.appendChild(workbench);
  const footer = el('div', {
    style: {
      flex: '0 0 auto', paddingTop: '14px', marginTop: '12px',
      borderTop: '1px solid rgba(127,127,127,.18)',
    },
  });
  footer.appendChild(actions);
  footer.appendChild(status);
  panel.appendChild(footer);
  // 内容区滚动时浮层跟着重排位置（而不是关掉——聚焦输入框本身就会触发滚动）
  content.addEventListener('scroll', () => { repositionFontPops(); });
  showSection(lastSection());

  const togglePanel = async () => {
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'flex';
    if (open) return;
    try {
      const res = await fetch('/sidebar-tuner/state', { cache: 'no-store' }).then((r) => r.json());
      fill((res && res.config) || {});
      compatCheck();
      status.textContent = '';
    } catch (e) { status.textContent = '读取配置失败：' + e.message; }
  };
  railBtn.addEventListener('click', togglePanel);

  document.body.appendChild(panel);
  reportError({ at: new Date().toISOString(), stage: 'panel-mounted', sections: SECTIONS.map((s) => s.title) });

  /**
   * 兜底入口：8 秒内还没挂进 panelList，就在左下角浮一个固定按钮。
   * 宿主侧栏结构一变，入口就可能落空——但面板不该因此变得够不着。
   */
  setTimeout(() => {
    const nav = document.querySelector('[class*="_panelList"]');
    if (nav && railBtn.parentElement === nav) return;
    if (document.getElementById('dst-float-entry')) return;
    const float = el('div', {
      id: 'dst-float-entry',
      title: '侧栏设置（兜底入口：没能挂进图标列）',
      style: {
        position: 'fixed', left: '10px', bottom: '10px', width: '34px', height: '34px',
        borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: '9998', boxSizing: 'border-box',
        background: 'var(--dsw-alias-bg-elevated, rgba(127,127,127,.18))',
        border: '1px solid var(--dsw-alias-separator, rgba(127,127,127,.35))',
        color: 'var(--dsw-alias-label-primary, inherit)',
      },
    });
    float.innerHTML = svgOf(ICON_NAME);
    float.addEventListener('click', togglePanel);
    document.body.appendChild(float);
    reportError({ at: new Date().toISOString(), stage: 'float-fallback', railAttached: false });
  }, 8000);

  // Esc 关闭；点击面板外部也关闭
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // 先关浮层，再关面板：一次 Esc 只做一件事
    if (document.querySelector('[data-dst-font-pop]')) { closeFontPops(); return; }
    if (panel.style.display !== 'none') panel.style.display = 'none';
  });
  document.addEventListener('mousedown', (e) => {
    if (panel.style.display === 'none') return;
    if (panel.contains(e.target) || railBtn.contains(e.target)) return;
    closeFontPops();
    panel.style.display = 'none';
  });

  // 焦点自愈：窗口回到前台时向宿主要一次最新状态（Failsafe，不是轮询）
  window.addEventListener('focus', () => { void syncFromHost(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncFromHost();
  });

  // 观察器接管入口的重新挂载；不再有 1 秒轮询
  startObserver();
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
      // 它是极小的一段，内联足够；同时充当「内联脚本能否执行」的探针。
      table.push({ kind: 'script', placement: 'head', text: flagScript });
      table.push({
        kind: 'script',
        placement: 'head',
        text: `try{fetch('/sidebar-tuner/probe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({at:new Date().toISOString(),stage:'canary',inline:true})}).catch(function(){})}catch(e){}`,
      });
      if (merged.settingsUi !== false) {
        table.push({ kind: 'script-src', placement: 'body', src: '/sidebar-tuner/ui.js' });
      }
      // 悬停提示是独立的一小段脚本，开设置面板与否都能用
      if (merged.railTooltips !== false) {
        table.push({ kind: 'script-src', placement: 'body', src: '/sidebar-tuner/tip.js' });
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

      // 宿主自报版本：面板顶部的「已适配」用它显示当前 DSH 版本。
      // 0.2.2-rc.5 起前端不再提供 window.__DSH_BOOT__.version，只能由宿主读自己的包。
      let versionCache = { at: 0, value: '' };
      const systemVersion = () => {
        const now = Date.now();
        if (versionCache.value && now - versionCache.at < 5 * 60_000) return versionCache.value;
        const value = detectDshVersion();
        if (value) versionCache = { at: now, value };
        return value;
      };

      host.effect(() => webServer.register({
        kind: 'exact',
        path: '/sidebar-tuner/version',
        handler: async (request, response) => {
          const reply = (code, payload) => {
            response.writeHead(code, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            });
            response.end(JSON.stringify(payload));
          };
          if (!isLoopback(request?.socket?.remoteAddress)) return reply(403, { ok: false, error: 'loopback only' });
          const version = systemVersion();
          return reply(200, { ok: Boolean(version), version, platform: process.platform });
        },
      }, 'dsh-sidebar-tuner host version'));

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
            // 归一化：面板之外也能 POST（例如脚本），所以按 DEFAULTS 的类型收一遍，
            // 免得把错误类型写进 override.json，让下次读数崩在奇怪的地方。
            const normalized = {};
            for (const [key, value] of Object.entries(patch)) {
              const template = DEFAULTS[key];
              if (Array.isArray(template)) {
                normalized[key] = Array.isArray(value)
                  ? value.map((item) => String(item).slice(0, 200)).slice(0, 40)
                  : [];
              } else if (typeof template === 'number') {
                const number = Number(value);
                normalized[key] = Number.isFinite(number) ? number : template;
              } else if (typeof template === 'boolean') {
                normalized[key] = value === true || value === 'true' || value === 1;
              } else {
                normalized[key] = String(value ?? '').slice(0, 400);
              }
            }
            const saved = writeOverride(normalized);
            const next = { ...DEFAULTS, ...(config || {}), ...saved };
            const nextCss = buildCss(next);
            fs.writeFileSync(LIVE_PATH, nextCss, 'utf8');
            return reply(200, { ok: true, config: next, css: nextCss });
          } catch (error) {
            return reply(500, { ok: false, error: String(error?.message || error) });
          }
        },
      }, 'dsh-sidebar-tuner settings state'));

      /**
       * 注入用的脚本改走外部路由，不再内联进 index.html。
       *
       * 内联（{kind:'script', text}）有两个隐患：
       *   1. 文本里出现 </script 就会截断页面（有自检拦着，但依赖自检）；
       *   2. 页面上到底有没有执行，宿主侧完全看不见——脚本没跑时没有任何痕迹。
       * 走路由之后，curl 一下就能确认服务端返回的是不是合法 JS，
       * 页面端也会留下正常的 200/404 记录。
       */
      const scriptRoute = (routePath, getText) => host.effect(() => webServer.register({
        kind: 'exact',
        path: routePath,
        handler: async (_request, response) => {
          response.writeHead(200, {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'no-store',
          });
          response.end(getText());
        },
      }, `dsh-sidebar-tuner ${routePath}`));

      scriptRoute('/sidebar-tuner/ui.js', () => UI_SCRIPT);
      scriptRoute('/sidebar-tuner/tip.js', () => TIP_SCRIPT);

      /**
       * 本机字体清单：面板的字体选择器靠它列出整台机器的字体，
       * 不再局限于代码里写死的那十几个预设。
       */
      host.effect(() => webServer.register({
        kind: 'exact',
        path: '/sidebar-tuner/fonts',
        handler: async (request, response) => {
          if (!isLoopback(request?.socket?.remoteAddress)) {
            response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ ok: false, error: 'loopback only', count: 0, fonts: [] }));
            return;
          }
          // ?refresh=1 强制重新枚举（刚装完字体时用得上）
          const force = /[?&]refresh=1\b/.test(String(request?.url || ''));
          let fonts = [];
          let cached = false;
          let stale = false;
          let error = '';
          try {
            const result = await systemFontsCached({ force });
            fonts = result.fonts;
            cached = result.cached;
            stale = result.stale;
          } catch (reason) {
            error = String(reason?.message || reason);
          }
          response.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          response.end(JSON.stringify({
            ok: !error, platform: process.platform, count: fonts.length,
            fonts, cached, stale, error,
          }));
        },
      }, 'dsh-sidebar-tuner fonts'));

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







