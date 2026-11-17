/**
 * 宿主侧验证：不启动 DSH，直接把 apply() 跑起来，
 * 用一个假 ctx / 假 webServer 检查它到底注册了什么、注入了什么。
 *
 * 这补的是一个真实盲区：之前只验证了「脚本本身的语法」，
 * 从没验证过「宿主拿到的注入表里有没有这个脚本、路由返回的是不是合法 JS」。
 *
 * 用法：node scripts/verify-host.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mod = await import('file:///' + path.join(root, 'index.js').replace(/\\/g, '/'));

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
};

// ── 假 ctx ────────────────────────────────────────────────────────
const handlers = new Map();
const routes = new Map();
const effects = [];

const fakeWebServer = {
  register(route, tag) {
    if (!route || !route.path) throw new Error('bad route');
    routes.set(route.path, route.handler);
    void tag;
    return () => routes.delete(route.path);
  },
};

const ctx = {
  on(event, handler) {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(handler);
  },
  inject(names, cb) {
    if (names.includes('webServer')) cb(ctx);
  },
  get(name) {
    return name === 'webServer' ? fakeWebServer : undefined;
  },
  effect(fn) {
    effects.push(fn());
  },
  logger: { warn() {}, info() {} },
};

console.log('== apply() 是否跑得起来 ==');
let applied = true;
try {
  mod.apply(ctx, {});
} catch (error) {
  applied = false;
  check('apply() 不抛异常', false, String(error && error.message ? error.message : error));
}
if (!applied) {
  console.log('\n1 项未通过');
  process.exit(1);
}
check('apply() 不抛异常', true);

console.log('\n== 注入表内容 ==');
check('订阅了 webserver/index-inject', handlers.has('webserver/index-inject'));
const table = [];
for (const handler of handlers.get('webserver/index-inject') || []) handler(table, {});
const kinds = table.map((row) => row.kind + (row.placement ? ':' + row.placement : ''));
check('有 style 行（侧栏样式）', table.some((row) => row.kind === 'style'));
check('有 tuner.css 的 link 行', table.some((row) => row.kind === 'html' && String(row.html).includes('/sidebar-tuner/tuner.css')));
check('有 head 里的开关脚本', table.some((row) => row.kind === 'script' && row.placement === 'head'));
check('有 canary 探针脚本', table.some((row) => row.kind === 'script' && String(row.text).includes("stage:'canary'")));
check('面板脚本走外部路由', table.some((row) => row.kind === 'script-src' && row.src === '/sidebar-tuner/ui.js'), kinds.join(' / '));
check('悬停脚本走外部路由', table.some((row) => row.kind === 'script-src' && row.src === '/sidebar-tuner/tip.js'));
const uiRow = table.find((row) => row.kind === 'script-src' && row.src === '/sidebar-tuner/ui.js');
check('面板脚本挂在 body', Boolean(uiRow && uiRow.placement === 'body'));

console.log('\n== 路由 ==');
check('注册了 /sidebar-tuner/ui.js', routes.has('/sidebar-tuner/ui.js'));
check('注册了 /sidebar-tuner/tip.js', routes.has('/sidebar-tuner/tip.js'));
check('注册了 /sidebar-tuner/state', routes.has('/sidebar-tuner/state'));
check('注册了 /sidebar-tuner/probe', routes.has('/sidebar-tuner/probe'));
check('注册了 /sidebar-tuner/tuner.css', routes.has('/sidebar-tuner/tuner.css'));
check('注册了 /sidebar-tuner/fonts（本机字体清单）', routes.has('/sidebar-tuner/fonts'));

const serve = async (routePath) => {
  const handler = routes.get(routePath);
  const captured = { headers: null, body: '' };
  const response = {
    writeHead(code, headers) { captured.code = code; captured.headers = headers || {}; },
    end(body) { captured.body = String(body || ''); },
  };
  await handler({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, response);
  return captured;
};

console.log('\n== 路由返回的内容 ==');
for (const [routePath, label] of [['/sidebar-tuner/ui.js', '面板脚本'], ['/sidebar-tuner/tip.js', '悬停脚本']]) {
  const res = await serve(routePath);
  check(`${label} 返回 200`, res.code === 200, String(res.code));
  check(`${label} content-type 是 JS`, String(res.headers['content-type'] || '').includes('application/javascript'), res.headers['content-type']);
  check(`${label} 内容非空`, res.body.length > 500, res.body.length + ' 字节');
  // 真正跑一次能不能解析：用 new Function 做作用域解析
  let parseOk = true;
  try { new Function(res.body); } catch (error) { parseOk = false; check(`${label} 可被 JS 解析`, false, String(error.message).split('\n')[0]); }
  if (parseOk) check(`${label} 可被 JS 解析`, true);
  check(`${label} 不含 </script`, !res.body.includes('</script'));
}

console.log('\n== 本机字体清单 ==');
{
  const res = await serve('/sidebar-tuner/fonts');
  check('返回 200', res.code === 200, String(res.code));
  check('content-type 是 JSON', String(res.headers['content-type'] || '').includes('application/json'), res.headers['content-type']);
  let data = null;
  try { data = JSON.parse(res.body); } catch { /* 下面报错 */ }
  check('能解析成 JSON', Boolean(data));
  if (data) {
    check('ok 为 true', data.ok === true, data.error || '');
    check('字族数量 > 50', Number(data.count) > 50, String(data.count));
    const probe = ['Inter', 'HarmonyOS Sans SC'];
    for (const name of probe) {
      const hit = (data.fonts || []).some((font) => String(font).toLowerCase() === name.toLowerCase());
      check('清单含 ' + name, hit);
    }
    check('没有乱码项', !(data.fonts || []).some((font) => /[\uFFFD]/.test(String(font))));
  }
}

console.log('\n' + (failed === 0 ? '全部通过' : failed + ' 项未通过'));
process.exit(failed === 0 ? 0 : 1);
