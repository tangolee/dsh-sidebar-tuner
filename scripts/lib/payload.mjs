/**
 * 取得「宿主真正下发」的注入内容。
 *
 * 这一点很关键：注入脚本住在 index.js 的模板字符串里，宿主加载时会做一次
 * 模板插值与转义解释。源码里写着 '\n'，下发出去就成了真换行，字符串会断行。
 * 只检查源码原文的测试永远发现不了这类问题——必须拿下发文本。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/lib/payload.mjs → 仓库根
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function collectPayload() {
  const mod = await import('file:///' + path.join(root, 'index.js').replace(/\\/g, '/'));
  const handlers = new Map();
  const routes = new Map();
  const webServer = { register(route) { routes.set(route.path, route.handler); return () => {}; } };
  const ctx = {
    on(event, handler) { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(handler); },
    inject(names, cb) { if (names.includes('webServer')) cb(ctx); },
    get(name) { return name === 'webServer' ? webServer : undefined; },
    effect(fn) { fn(); },
    logger: { warn() {}, info() {} },
  };
  mod.apply(ctx, {});

  const table = [];
  for (const handler of handlers.get('webserver/index-inject') || []) handler(table, {});

  const serve = async (routePath) => {
    const handler = routes.get(routePath);
    if (!handler) return null;
    let body = '';
    let headers = {};
    await handler({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, {
      writeHead(code, value) { headers = value || {}; },
      end(chunk) { body = String(chunk || ''); },
    });
    return { body, headers };
  };

  const ui = await serve('/sidebar-tuner/ui.js');
  const tip = await serve('/sidebar-tuner/tip.js');
  const inlineScripts = table.filter((row) => row.kind === 'script').map((row) => row.text);

  return {
    module: mod,
    table,
    routes,
    uiScript: ui ? ui.body : '',
    tipScript: tip ? tip.body : '',
    inlineScripts,
  };
}
