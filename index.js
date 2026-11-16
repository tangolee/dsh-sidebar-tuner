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
  const EN_FONTS = ['Segoe UI','Segoe UI Variable','Inter','SF Pro Text','Helvetica Neue','Arial','Roboto','Geist','JetBrains Mono','Maple Mono NF CN','Cascadia Code','Consolas','Fira Code'];
  const FALLBACKS = ['system-ui','sans-serif','serif','monospace'];
  const NUM_FIELDS = [
    { key: 'fontSize',   label: '字号 px（0=关）', min: 0, max: 32, step: 1 },
    { key: 'fontScale',  label: '整列缩放（1=关）', min: 0.7, max: 1.6, step: 0.02 },
    { key: 'lineHeight', label: '行高（0=关）', min: 0, max: 3, step: 0.05 },
    { key: 'rowGap',     label: '行距 px（0=关）', min: 0, max: 24, step: 1 },
    { key: 'railWidth',  label: '图标列宽 px', min: 40, max: 96, step: 2 },
  ];
  const BOOL_FIELDS = [
    { key: 'compactLayout', label: '图标列 + 会话列并排' },
    { key: 'collapsedRail', label: '折叠时保留图标栏' },
    { key: 'pushContent',   label: '折叠时推挤内容列' },
  ];

  const PALETTE_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"'
    + ' stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M8 1.7a6.3 6.3 0 1 0 0 12.6c.95 0 1.45-.72 1.45-1.45 0-.5-.22-.82-.5-1.12-.2-.25-.4-.5-.4-.93 0-.62.5-1.12 1.12-1.12h1.08A3.25 3.25 0 0 0 14 6.18C14 3.7 11.3 1.7 8 1.7Z"/>'
    + '<circle cx="5.1" cy="5.7" r=".9"/><circle cx="8.3" cy="4.6" r=".9"/><circle cx="4.5" cy="9" r=".9"/>'
    + '</svg>';

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

  const available = (name) => {
    try { return document.fonts.check('12px "' + name + '"'); } catch (e) { return false; }
  };

  // ── 图标列里的入口按钮 ────────────────────────────────────────
  const railBtn = el('div', {
    id: 'dst-rail-entry',
    title: '侧栏外观设置',
    html: PALETTE_SVG,
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
  const syncLabel = () => {
    const compact = document.documentElement.hasAttribute('data-dst-compact');
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
    syncLabel();
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

  const inputStyle = {
    flex: '1 1 auto', minWidth: '0', padding: '3px 6px', borderRadius: '6px',
    border: '1px solid rgba(127,127,127,.35)', background: 'transparent',
    color: 'inherit', fontSize: '12px',
  };
  const rowOf = (label) => {
    const row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' } });
    row.appendChild(el('label', {
      text: label,
      style: { flex: '0 0 122px', color: 'var(--dsw-alias-label-secondary, #666)' },
    }));
    return row;
  };

  const buildSelect = (list, current) => {
    const sel = el('select', { style: inputStyle });
    sel.appendChild(el('option', { value: '', text: '（不指定）' }));
    const ordered = list.slice();
    if (current && ordered.indexOf(current) < 0) ordered.unshift(current);
    for (const name of ordered) {
      const opt = el('option', { value: name, text: available(name) ? name : name + ' · 未检测' });
      sel.appendChild(opt);
    }
    sel.value = current || '';
    return sel;
  };

  const zhRow = rowOf('中文字体');
  const zhSelect = buildSelect(ZH_FONTS, '');
  zhRow.appendChild(zhSelect);
  panel.appendChild(zhRow);

  const enRow = rowOf('英文字体');
  const enSelect = buildSelect(EN_FONTS, '');
  enRow.appendChild(enSelect);
  panel.appendChild(enRow);

  const fbRow = rowOf('回退');
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
  fbRow.appendChild(fbWrap);
  panel.appendChild(fbRow);

  const numInputs = {};
  for (const f of NUM_FIELDS) {
    const row = rowOf(f.label);
    const input = el('input', { type: 'number', style: inputStyle });
    input.min = f.min; input.max = f.max; input.step = f.step;
    row.appendChild(input);
    numInputs[f.key] = input;
    panel.appendChild(row);
  }

  const boolInputs = {};
  const FLAG_OF = { compactLayout: 'compact', collapsedRail: 'rail', pushContent: 'push' };
  for (const f of BOOL_FIELDS) {
    const row = rowOf(f.label);
    const box = el('input', { type: 'checkbox' });
    box.style.flex = '0 0 auto';
    box.style.margin = '0';
    // 勾选即刻生效：只增删 <html> 上的属性，不重算 CSS
    box.addEventListener('change', () => {
      if (window.__dstSetFlag) window.__dstSetFlag(FLAG_OF[f.key], box.checked);
      status.textContent = (box.checked ? '已开启' : '已关闭') + '（尚未保存）';
    });
    row.appendChild(box);
    boolInputs[f.key] = box;
    panel.appendChild(row);
  }

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
    try {
      const res = await fetch('/sidebar-tuner/tuner.css?t=' + Date.now(), { cache: 'no-store' });
      const text = await res.text();
      if (text && text !== lastCss) { lastCss = text; applyCss(text); }
    } catch { /* 宿主不可达时静默跳过 */ }
  };
  pull();
  setInterval(pull, 1500);

  const fill = (state) => {
    zhSelect.value = state.fontFamilyZh || '';
    enSelect.value = state.fontFamilyEn || '';
    const fbs = Array.isArray(state.fontFallbacks) ? state.fontFallbacks : [];
    for (const name of FALLBACKS) fbBoxes[name].checked = fbs.indexOf(name) >= 0;
    for (const f of NUM_FIELDS) {
      const v = state[f.key];
      numInputs[f.key].value = v === undefined || v === null ? '' : String(v);
    }
    for (const f of BOOL_FIELDS) {
      const on = state[f.key] !== false;
      boolInputs[f.key].checked = on;
      if (window.__dstSetFlag) window.__dstSetFlag(FLAG_OF[f.key], on);
    }
  };

  const collect = () => {
    const out = {
      fontFamilyZh: zhSelect.value,
      fontFamilyEn: enSelect.value,
      fontFallbacks: FALLBACKS.filter((name) => fbBoxes[name].checked),
    };
    for (const f of NUM_FIELDS) {
      const raw = numInputs[f.key].value;
      out[f.key] = raw === '' ? 0 : Number(raw);
    }
    for (const f of BOOL_FIELDS) out[f.key] = boolInputs[f.key].checked;
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
      if (merged.settingsUi !== false) {
        // 开关属性必须在 head 里就先落地，避免首帧闪一下未生效的布局
        table.push({ kind: 'script', placement: 'head', text: flagScript });
        table.push({ kind: 'script', placement: 'body', text: UI_SCRIPT });
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
