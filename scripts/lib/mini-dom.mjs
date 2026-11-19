/**
 * 极简 DOM 垫片：只实现注入脚本真正用到的那部分 API。
 *
 * 目的不是通用性，而是让「入口按钮有没有插进 panelList、插在什么位置」
 * 这类问题能在本机断言，不必发版后靠人肉重启去看。
 *
 * 选择器只支持脚本里实际出现的形态：tag / #id / .class / [attr] / [attr=v] / [attr*=v]。
 */

const parseCompound = (selector) => {
  const source = selector.trim();
  const parts = { tag: '', id: '', classes: [], attrs: [] };
  let rest = source;
  const tagMatch = rest.match(/^[a-zA-Z][\w-]*/);
  if (tagMatch) {
    parts.tag = tagMatch[0].toUpperCase();
    rest = rest.slice(tagMatch[0].length);
  }
  const tokenRe = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([*^$]?=)["']?([^"'\]]*)["']?)?\]/g;
  let match;
  while ((match = tokenRe.exec(rest)) !== null) {
    if (match[1]) parts.id = match[1];
    else if (match[2]) parts.classes.push(match[2]);
    else if (match[3]) parts.attrs.push({ name: match[3], op: match[4] || '', value: match[5] || '' });
  }
  return parts;
};

export class MiniElement {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.attrs = new Map();
    this._text = '';
    this._listeners = new Map();
    this.title = '';
    this.value = '';
    this.checked = false;
    this.className = '';
    this.id = '';
  }

  get classList() {
    const self = this;
    return {
      add(...names) { self.className = [self.className, ...names].filter(Boolean).join(' '); },
      remove(...names) { self.className = self.className.split(/\s+/).filter((c) => c && !names.includes(c)).join(' '); },
      contains(name) { return self.className.split(/\s+/).includes(name); },
      toggle(name) { if (this.contains(name)) this.remove(name); else this.add(name); },
    };
  }

  setAttribute(name, value) { this.attrs.set(name, String(value)); if (name === 'class') this.className = String(value); if (name === 'id') this.id = String(value); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }

  appendChild(child) { return this.insertBefore(child, null); }

  insertBefore(child, reference) {
    if (child.parentElement) child.parentElement.removeChild(child);
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index >= 0) this.children.splice(index, 0, child);
    else this.children.push(child);
    child.parentElement = this;
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    child.parentElement = null;
    return child;
  }

  remove() { if (this.parentElement) this.parentElement.removeChild(this); }

  // 真实 DOM 的 textContent 会拼接所有后代文本，桩也必须一样，
  // 否则「按行文本查找元素」这类断言会永远找不到东西。
  get textContent() {
    if (this.children.length === 0) return this._text;
    const joined = this.children.map((child) => child.textContent).join('');
    return joined || this._text;
  }
  set textContent(value) { this._text = String(value); if (value === '') this.children = []; }

  get innerHTML() { return this._text; }
  set innerHTML(value) { this._text = String(value); }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const list = this._listeners.get(type) || [];
    this._listeners.set(type, list.filter((item) => item !== handler));
  }

  dispatchEvent(event) {
    const list = this._listeners.get(event.type) || [];
    for (const handler of list) handler.call(this, event);
    return true;
  }

  matches(selector) {
    const parts = parseCompound(selector);
    if (parts.tag && this.tagName !== parts.tag) return false;
    if (parts.id && this.id !== parts.id) return false;
    for (const name of parts.classes) if (!this.className.split(/\s+/).includes(name)) return false;
    for (const attr of parts.attrs) {
      const actual = attr.name === 'class' ? this.className
        : attr.name === 'id' ? this.id
          : this.attrs.get(attr.name);
      if (actual === undefined || actual === null) return false;
      // 注意：parseCompound 捕获到的运算符带等号（'*=' / '=' / '^=' …），
      // 早期版本按 '*' 比较，导致 [class*=x] 匹配任何元素——测试垫片自己先错了。
      if (attr.op === '*=' && !String(actual).includes(attr.value)) return false;
      if (attr.op === '=' && String(actual) !== attr.value) return false;
      if (attr.op === '^=' && !String(actual).startsWith(attr.value)) return false;
      if (attr.op === '$=' && !String(actual).endsWith(attr.value)) return false;
      if (!attr.op && !String(actual)) return false;
    }
    return true;
  }

  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  getBoundingClientRect() { return { width: 200, height: 36, top: 0, left: 0, right: 200, bottom: 36 }; }
  focus() {}
  blur() {}
  cloneNode() { const node = new MiniElement(this.tagName); node.className = this.className; return node; }
  get firstChild() { return this.children[0] || null; }
  get offsetWidth() { return 200; }
}

class MiniCanvas extends MiniElement {
  constructor() { super('canvas'); }
  getContext() {
    return {
      font: '',
      measureText(text) { return { width: 10 + String(text).length }; },
      fillText() {},
      clearRect() {},
      save() {},
      restore() {},
    };
  }
  set width(value) { this._width = value; }
  get width() { return this._width || 100; }
  set height(value) { this._height = value; }
  get height() { return this._height || 30; }
}

const computedStyle = () => ({
  fontSize: '13px',
  lineHeight: '20px',
  letterSpacing: 'normal',
  fontWeight: '400',
  fontFamily: '"HarmonyOS Sans SC", sans-serif',
  display: 'flex',
  getPropertyValue: () => '',
});

export function createHarness() {
  const html = new MiniElement('html');
  const head = new MiniElement('head');
  const body = new MiniElement('body');
  html.appendChild(head);
  html.appendChild(body);

  const document = {
    documentElement: html,
    head,
    body,
    visibilityState: 'visible',
    baseURI: 'http://localhost/',
    fonts: { check: () => true, load: async () => [], ready: Promise.resolve() },
    createElement(tag) { return String(tag).toLowerCase() === 'canvas' ? new MiniCanvas() : new MiniElement(tag); },
    createTextNode(text) { const node = new MiniElement('#text'); node.textContent = text; return node; },
    getElementById(id) { return html.querySelector('#' + id); },
    querySelector(selector) { return html.querySelector(selector); },
    querySelectorAll(selector) { return html.querySelectorAll(selector); },
    addEventListener() {},
    removeEventListener() {},
  };

  const reports = [];
  const observers = [];
  const requests = [];
  const windowListeners = new Map();
  const window = {
    __dstSetFlag() {},
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    removeEventListener() {},
    dispatchEvent(event) {
      const list = windowListeners.get(event.type) || [];
      for (const handler of list) handler(event);
      return true;
    },
    getComputedStyle: computedStyle,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { href: 'http://localhost/' },
    innerWidth: 1280,
    innerHeight: 832,
    requestAnimationFrame: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    setInterval: () => 0,
    clearInterval: () => {},
  };

  const fetchStub = async (url, options) => {
    const target = String(url);
    let parsed = null;
    if (options && options.body) {
      try { parsed = JSON.parse(options.body); } catch { parsed = { raw: options.body }; }
      reports.push(parsed);
    }
    requests.push({ url: target, method: (options && options.method) || 'GET', body: parsed });
    // 宿主字体清单：给测试一组可预测的数据
    if (target.includes('/sidebar-tuner/fonts')) {
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          ok: true,
          count: 3,
          fonts: ['Inter', 'Inter Display', '测试用字体 TestFont'],
        }),
      };
    }
    // 宿主自报版本：面板顶部「已适配」那行要用它，别让它变成空
    if (target.includes('/sidebar-tuner/version')) {
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ ok: true, version: '0.2.2-rc.5', platform: 'win32' }),
      };
    }
    return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true, config: {} }) };
  };

  const sandbox = {
    document,
    window,
    getComputedStyle: computedStyle,
    MutationObserver: class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() {}
    takeRecords() { return []; }
  },
    fetch: fetchStub,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    cancelAnimationFrame: () => {},
    console,
    URL,
    Event: class { constructor(type) { this.type = type; } },
    navigator: { userAgent: 'node-harness' },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };

  return { html, head, body, document, window, sandbox, reports, requests, observers };
}

export const runScript = (body, sandbox) => {
  const names = Object.keys(sandbox);
  const fn = new Function(...names, body);
  fn(...names.map((name) => sandbox[name]));
};
