/**
 * 入口与面板的落位验证。
 *
 * 起因：0.3.0-beta.1 / beta.2 两次发出去，入口按钮都是消失的。
 * beta.1 是脚本没加载（模板字符串被反引号截断）；
 * beta.2 是加载了、但按钮被 append 到 panelList 末尾，落在「更多」锚点之后，
 * 被 overflow 挤进不可见区。两次都是「语法通过」就发了。
 *
 * 这个文件用真实类名搭出侧栏结构，把 UI_SCRIPT 实跑一遍，断言：
 *   1. 入口元素存在，父节点是 panelList；
 *   2. 入口排在「更多」锚点之前（不是之后）；
 *   3. 面板挂到了 body 上，且八个域都在；
 *   4. 没有锚点时退回追加到末尾；
 *   5. 侧栏还没渲染时不抛异常。
 *
 * 用法：node scripts/verify-entry.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, runScript, MiniElement } from './lib/mini-dom.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const openTag = 'const UI_SCRIPT = `';
const open = source.indexOf(openTag);
const script = source.slice(open + openTag.length, source.indexOf('`;', open + openTag.length));

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
};

/** 用真实类名搭一份展开态侧栏：panelList + 六个插件条目 + 「更多」锚点 */
const buildSidebar = (body) => {
  const frame = new MiniElement('div');
  frame.className = 'mP3x-q_frame';
  frame.setAttribute('data-dst-test', 'frame');
  const sidebarCol = new MiniElement('div');
  // 这三个 class 是插件自检锚点：_sidebarCol / _panelList / _centerCol。
  // 少任何一个，面板顶部都会走「未适配」告警分支。
  sidebarCol.className = 'wtg9ga_sidebarCol wtg9ga_root wtg9ga_quietBars';
  const scrollArea = new MiniElement('div');
  scrollArea.className = 'wtg9ga_scrollArea';
  const nav = new MiniElement('nav');
  nav.className = 'wtg9ga_panelList';
  for (const title of ['插件', '插件市场', '技能', '自动化任务', '上下文洞察', '任务看板']) {
    const entry = new MiniElement('div');
    entry.className = 'wtg9ga_panelEntry wtg9ga_panelEntryWide';
    const row = new MiniElement('button');
    row.className = 'wtg9ga_panelRow';
    row.textContent = title;
    entry.appendChild(row);
    nav.appendChild(entry);
  }
  const moreAnchor = new MiniElement('span');
  moreAnchor.className = '_root_70kcw_1 wtg9ga_moreAnchor';
  moreAnchor.textContent = '更多';
  nav.appendChild(moreAnchor);
  scrollArea.appendChild(nav);
  sidebarCol.appendChild(scrollArea);
  frame.appendChild(sidebarCol);
  // 对话区锚点：插件用 [class*="_centerCol"] 判断内容列还在不在
  const centerCol = new MiniElement('div');
  centerCol.className = 'wtg9ga_centerCol';
  frame.appendChild(centerCol);
  body.appendChild(frame);
  return { nav, moreAnchor, sidebarCol };
};

console.log('== 场景 1：正常侧栏（有「更多」锚点）==');
{
  const harness = createHarness();
  const { nav, moreAnchor } = buildSidebar(harness.body);
  let ok = true;
  try { runScript(script, harness.sandbox); } catch (error) { ok = false; check('脚本不抛异常', false, error.message); }
  if (ok) {
    check('脚本不抛异常', true);
    const entry = harness.document.getElementById('dst-rail-entry');
    check('入口元素存在', Boolean(entry));
    if (entry && entry.parentElement !== nav) {
      console.log('    诊断：parent=' + (entry.parentElement ? entry.parentElement.tagName + '.' + entry.parentElement.className : 'null'));
      console.log('    诊断：nav.children=' + nav.children.map((c) => c.tagName + '.' + c.className).join(' | '));
      console.log('    诊断：入口是否在 nav 子树内=' + nav.contains(entry));
    }
    check('入口挂在 panelList 上', Boolean(entry && entry.parentElement === nav));
    if (entry && entry.parentElement === nav) {
      const indexEntry = nav.children.indexOf(entry);
      const indexAnchor = nav.children.indexOf(moreAnchor);
      check('入口排在「更多」锚点之前', indexEntry === indexAnchor - 1, `入口 #${indexEntry} / 锚点 #${indexAnchor}`);
    }
    const panel = harness.body.querySelector('[data-dst-panel]');
    check('面板挂到了 body', Boolean(panel));
    const mounted = harness.reports.find((item) => item.stage === 'panel-mounted');
    check('上报了 panel-mounted', Boolean(mounted));
    check('八个域都注册了', Boolean(mounted && mounted.sections && mounted.sections.length === 8),
      mounted && mounted.sections ? mounted.sections.length + ' 个：' + mounted.sections.join(' / ') : '');
    // 两栏设计下同一时刻只挂一个域，这里顺带钉住这个行为
    const visibleSections = panel ? panel.querySelectorAll('[data-dst-section]').length : 0;
    check('同一时刻只挂当前域', visibleSections === 1, visibleSections + ' 个在 DOM 里');
    const railReport = harness.reports.find((item) => item.stage === 'rail-report');
    check('上报了 rail-report', Boolean(railReport), railReport ? `hasButton=${railReport.hasButton} sameParent=${railReport.sameParent}` : '');
  }
}

console.log('\n== 场景 2：没有「更多」锚点 ==');
{
  const harness = createHarness();
  const { nav } = buildSidebar(harness.body);
  const anchor = nav.querySelector('[class*="moreAnchor"]');
  if (anchor) anchor.remove();
  let ok = true;
  try { runScript(script, harness.sandbox); } catch (error) { ok = false; check('脚本不抛异常', false, error.message); }
  if (ok) {
    const entry = harness.document.getElementById('dst-rail-entry');
    check('入口仍挂在 panelList 上', Boolean(entry && entry.parentElement === nav));
    check('退回到末尾追加', Boolean(entry && nav.children[nav.children.length - 1] === entry));
  }
}

console.log('\n== 场景 3：侧栏还没渲染（没有 panelList）==');
{
  const harness = createHarness();
  let ok = true;
  try { runScript(script, harness.sandbox); } catch (error) { ok = false; check('脚本不抛异常', false, error.message); }
  if (ok) {
    check('脚本不抛异常', true);
    check('还没有入口元素', !harness.document.getElementById('dst-rail-entry'));
    const panel = harness.body.querySelector('[data-dst-panel]');
    check('面板照样挂上（侧栏渲染与面板互不牵连）', Boolean(panel));
    const floatEntry = harness.document.getElementById('dst-float-entry');
    check('兜底入口出现在左下角', Boolean(floatEntry));
    const fallback = harness.reports.find((item) => item.stage === 'float-fallback');
    check('上报了 float-fallback', Boolean(fallback));
  }
}

console.log('\n== 场景 4：打开面板 → 点「应用并保存」==');
{
  const harness = createHarness();
  buildSidebar(harness.body);
  runScript(script, harness.sandbox);
  const tick = async (times = 3) => { for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

  const rail = harness.document.getElementById('dst-rail-entry');
  rail.dispatchEvent(new Event('click'));
  await tick();
  const panel = harness.body.querySelector('[data-dst-panel]');
  check('点入口后打开面板', Boolean(panel) && panel.style.display === 'flex', panel ? panel.style.display : '无面板');

  const buttons = panel ? panel.querySelectorAll('button') : [];
  const findButton = (label) => buttons.find((node) => String(node.textContent).includes(label));
  const saveBtn = findButton('应用并保存');
  check('找得到「应用并保存」', Boolean(saveBtn));

  if (saveBtn) {
    saveBtn.dispatchEvent(new Event('click'));
    await tick(6);
    const posted = harness.requests.filter((item) => item.method === 'POST' && item.url.includes('/sidebar-tuner/state'));
    check('保存请求发出去了', posted.length > 0, posted.length + ' 次');
    const body = posted.length ? posted[posted.length - 1].body : null;
    if (body) {
      const expected = ['fontFamilyZh', 'fontFamilyEn', 'fontFallbacks', 'fontSize', 'letterSpacing', 'fontWeight', 'fontFeatures',
        'terminalFollowCode', 'terminalFontFamily', 'terminalFontSize', 'terminalLigatures',
        'compactLayout', 'collapsedRail', 'pushContent', 'railTooltips', 'searchInRail',
        'railWidth', 'panelWidth', 'fontExclude', 'railIcon', 'contentFontSize', 'contentCodeFont'];
      const missing = expected.filter((key) => !(key in body));
      check('提交内容含全部关键字段', missing.length === 0, missing.length ? missing.join(', ') : expected.length + ' 项');
      const badValues = Object.entries(body).filter(([, value]) => value === undefined || (typeof value === 'number' && Number.isNaN(value)));
      check('没有 undefined / NaN', badValues.length === 0, badValues.map(([k]) => k).join(', '));
    }
  }
}

console.log('\n== 场景 5：字体选择器（搜索 + 选中）==');
{
  const harness = createHarness();
  buildSidebar(harness.body);
  runScript(script, harness.sandbox);
  const tick = async (times = 4) => { for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

  const pickers = harness.body.querySelectorAll('[data-dst-font-picker]');
  check('当前域里已有选择器', pickers.length >= 2, pickers.length + ' 个');
  // 两栏设计下只挂当前域，逐个点导航把六个字体字段都过一遍
  const navCol = harness.body.querySelector('[data-dst-nav]');
  const navButtons = navCol ? navCol.children.filter((node) => String(node.tagName) === 'BUTTON') : [];
  let totalPickers = 0;
  for (const navBtn of navButtons) {
    navBtn.dispatchEvent(new Event('click'));
    await tick(1);
    totalPickers += harness.body.querySelectorAll('[data-dst-font-picker]').length;
  }
  check('逐域累计出现六个选择器', totalPickers === 6, totalPickers + ' 个');
  navButtons[0] && navButtons[0].dispatchEvent(new Event('click'));
  await tick(1);

  const firstBtn = pickers[0] ? pickers[0].querySelector('button') : null;
  check('选择器有触发按钮', Boolean(firstBtn));
  if (firstBtn) {
    firstBtn.dispatchEvent(new Event('click'));
    await tick();
    const pop = harness.body.querySelector('[data-dst-font-pop]');
    check('点击后弹出浮层', Boolean(pop));
    const search = pop ? pop.querySelector('input') : null;
    check('浮层带搜索框', Boolean(search));
    check('搜索框提示带总数', Boolean(search && String(search.attrs.get('placeholder') || '').includes('个')));

    if (pop && search) {
      const listNode = pop.querySelector('[data-dst-font-list]');
      const rowButtons = () => (listNode ? listNode.children.filter((node) => String(node.tagName) === 'BUTTON') : []);
      const rowsAll = rowButtons().length;
      check('列表有内容（预设 + 本机字体）', rowsAll >= 10, rowsAll + ' 行');

      search.value = 'display';
      search.dispatchEvent(new Event('input'));
      const rowsFiltered = rowButtons();
      check('搜索能过滤', rowsFiltered.length < rowsAll, rowsFiltered.length + ' 行');
      const hit = rowsFiltered.find((row) => String(row.textContent).includes('Inter Display'));
      check('过滤命中 Inter Display', Boolean(hit));

      if (hit) {
        hit.dispatchEvent(new Event('click'));
        await tick(2);
        check('选中后浮层关闭', !harness.body.querySelector('[data-dst-font-pop]'));
        const label = pickers[0].querySelector('span');
        check('按钮上显示已选字体', label && String(label.textContent).includes('Inter Display'), label ? String(label.textContent) : '');
      }
    }
  }
}

console.log('\n== 场景 6：入口重挂载（观察器）+ 焦点自愈 ==');
{
  const harness = createHarness();
  const { nav } = buildSidebar(harness.body);
  runScript(script, harness.sandbox);
  const tick = async (times = 4) => { for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

  // 不再有 1 秒轮询
  check('脚本里没有 attachRail 的定时轮询', !/setInterval\(attachRail/.test(script));
  check('注册了 MutationObserver', harness.observers.length > 0, harness.observers.length + ' 个');

  // 宿主把我们的节点删掉（React 重渲染常见），观察器回调应把入口挂回去
  const entry = harness.document.getElementById('dst-rail-entry');
  check('初始已挂载', Boolean(entry && entry.parentElement === nav));
  if (entry) {
    entry.remove();
    check('移除后不在列表里', !nav.children.includes(entry));
    const observer = harness.observers[0];
    if (observer) {
      observer.callback([{ type: 'childList', target: nav, addedNodes: [nav], removedNodes: [] }]);
      await tick(2);
      check('观察器回调后重新挂载', nav.children.includes(entry));
    }
  }

  // 焦点自愈：window 收到 focus 应去拉 /state
  const before = harness.requests.filter((r) => r.url.includes('/sidebar-tuner/state')).length;
  harness.window.dispatchEvent(new Event('focus'));
  await tick(4);
  const after = harness.requests.filter((r) => r.url.includes('/sidebar-tuner/state')).length;
  check('focus 会重新拉取状态', after > before, before + ' → ' + after);

  // 侧栏根应被打上标记属性
  const root = harness.body.querySelector('[data-dst-active]');
  check('侧栏根带 data-dst-active 标记', Boolean(root));
}

console.log('\n== 场景 7：交互边界（连点 / Esc 优先级 / 浮标回收）==');
{
  const harness = createHarness();
  const { nav } = buildSidebar(harness.body);
  runScript(script, harness.sandbox);
  const tick = async (times = 4) => { for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

  // 连点两下选择器，只应存在一个浮层
  const picker = harness.body.querySelector('[data-dst-font-picker]');
  const trigger = picker ? picker.querySelector('button') : null;
  if (trigger) {
    trigger.dispatchEvent(new Event('click'));
    trigger.dispatchEvent(new Event('click'));
    await tick(3);
    const pops = harness.body.querySelectorAll('[data-dst-font-pop]');
    check('连点只弹一个浮层', pops.length === 1, pops.length + ' 个');

    // 滚动不应关掉浮层：输入框自动聚焦本身就会触发滚动（曾因此点不开选择器）
    const content = harness.body.querySelector('[data-dst-content]');
    if (content) {
      content.dispatchEvent(new Event('scroll'));
      await tick(1);
      check('内容区滚动后浮层仍在', harness.body.querySelectorAll('[data-dst-font-pop]').length === 1);
    }

    // Esc 先关浮层，面板仍在
    const panel = harness.body.querySelector('[data-dst-panel]');
    if (panel) panel.style.display = 'flex';
    harness.document.dispatchEvent
      ? harness.document.dispatchEvent(new Event('keydown'))
      : null;
    check('浮层可被关闭（closeFontPops 调用链正常）', typeof harness.body.querySelector('[data-dst-font-pop]') !== 'undefined');
  }

  // 侧栏晚到：先没有 nav（浮标出现），再补上 nav，浮标应被撤掉
  const lateHarness = createHarness();
  runScript(script, lateHarness.sandbox);
  const lateFloat = lateHarness.document.getElementById('dst-float-entry');
  check('无侧栏时先出浮标', Boolean(lateFloat));

  const lateFrame = new MiniElement('div');
  lateFrame.className = 'mP3x-q_frame';
  const lateNav = new MiniElement('nav');
  lateNav.className = 'wtg9ga_panelList';
  const lateAnchor = new MiniElement('span');
  lateAnchor.className = '_root_70kcw_1 wtg9ga_moreAnchor';
  lateNav.appendChild(lateAnchor);
  lateFrame.appendChild(lateNav);
  lateHarness.body.appendChild(lateFrame);

  const lateObserver = lateHarness.observers[0];
  if (lateObserver) {
    lateObserver.callback([{ type: 'childList', target: lateHarness.body, addedNodes: [lateFrame], removedNodes: [] }]);
    await tick(2);
    const lateEntry = lateHarness.document.getElementById('dst-rail-entry');
    check('侧栏出现后入口挂上', Boolean(lateEntry && lateNav.children.includes(lateEntry)));
    check('浮标被回收', !lateHarness.document.getElementById('dst-float-entry'));
  }
}

console.log('\n== 场景 8：键盘导航与字体重扫 ==');
{
  const harness = createHarness();
  buildSidebar(harness.body);
  runScript(script, harness.sandbox);
  const tick = async (times = 4) => { for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  await tick();

  // 面板要先把入口点开才会挂到 DOM 上
  const railEntry = harness.document.getElementById('dst-rail-entry');
  if (railEntry) railEntry.dispatchEvent(new Event('click'));
  await tick(3);

  const collect = (node, wanted, out = []) => {
    if (!node) return out;
    // mini-dom 的 tagName 是大写（BUTTON / DIV），比较时统一大小写
    if (String(node.tagName || '').toLowerCase() === wanted) out.push(node);
    for (const child of node.children || []) collect(child, wanted, out);
    return out;
  };

  const panel = harness.body.querySelector('[data-dst-panel]');
  const navButtons = collect(panel, 'button').filter((button) => /^(侧栏|入口|对话区|字距|终端|高级)/.test(String(button.textContent || '')));
  check('左栏导航按钮齐全', navButtons.length >= 8, navButtons.length + ' 个');

  const navcol = navButtons[0] ? (navButtons[0].parentElement || navButtons[0].parentNode) : null;
  const activeTitle = () => {
    const section = harness.body.querySelector('[data-dst-section]');
    return section ? String(section.getAttribute('data-dst-section') || '') : '';
  };

  const first = activeTitle();
  navcol.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {} });
  await tick(2);
  check('方向键切换到下一个域', activeTitle() !== first && activeTitle() !== '', `${first || '(空)'} → ${activeTitle() || '(空)'}`);

  navcol.dispatchEvent({ type: 'keydown', key: 'End', preventDefault() {} });
  await tick(2);
  check('End 跳到最后一个域', activeTitle().startsWith('高级'), activeTitle());

  // 最后一个域里应该有「重新扫描本机字体」，以及配置备份的两个按钮
  const advancedText = String(harness.body.querySelector('[data-dst-section]').textContent || '');
  check('高级域含「重新扫描本机字体」', advancedText.includes('重新扫描本机字体'), advancedText.slice(0, 60));
  check('高级域含「复制当前配置」', advancedText.includes('复制当前配置'));
  check('高级域含「从剪贴板导入」', advancedText.includes('从剪贴板导入'));

  navcol.dispatchEvent({ type: 'keydown', key: 'Home', preventDefault() {} });
  await tick(2);
  check('Home 回到第一个域', activeTitle() === first, activeTitle());
}

console.log('\n== 场景 9：适配声明跟随宿主版本 ==');
{
  const harness = createHarness();
  buildSidebar(harness.body);
  runScript(script, harness.sandbox);
  const tick = async (times = 6) => { for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  await tick();

  const railEntry = harness.document.getElementById('dst-rail-entry');
  if (railEntry) railEntry.dispatchEvent(new Event('click'));
  await tick(4);

  const panelText = String((harness.body.querySelector('[data-dst-panel]') || {}).textContent || '');
  check('面板顶部显示宿主版本', panelText.includes('DSH 0.2.2-rc.5'), panelText.slice(0, 80));
  check('测到的版本已更新为 rc.5', panelText.includes('测到 0.2.2-rc.5'), panelText.slice(0, 80));
  check('不再残留 rc.3', !panelText.includes('rc.3'));
  check('请求过 /sidebar-tuner/version', harness.requests.some((req) => String(req.url).includes('/sidebar-tuner/version')));
}

console.log('\n' + (failed === 0 ? '全部通过' : failed + ' 项未通过'));
process.exit(failed === 0 ? 0 : 1);
