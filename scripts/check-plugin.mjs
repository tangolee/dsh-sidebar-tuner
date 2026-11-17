/**
 * 插件自检：能抓住 `node --check` 抓不到的一类错误。
 *
 * 背景：注入到页面的脚本住在模板字符串里。如果那段代码的注释里出现一个反引号，
 * 模板字符串会提前结束，文件依然「语法正确」，但导出会变成一个字符串常量，
 * 宿主加载直接抛 TypeError —— 表现是插件静默消失（没有 CSS、没有入口按钮）。
 *
 * 用法：node scripts/check-plugin.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
};

console.log('== 模块能否被宿主 import ==');
let mod;
try {
  mod = await import('file:///' + path.join(root, 'index.js').replace(/\\/g, '/'));
  check('index.js 可载入', true);
  check('导出 apply', typeof mod.apply === 'function');
} catch (error) {
  check('index.js 可载入', false, String(error && error.message ? error.message : error).split('\n')[0]);
}

console.log('\n== 注入脚本完整性 ==');
const OPEN = 'const UI_SCRIPT = `';
const open = source.indexOf(OPEN);
check('找到 UI_SCRIPT 起点', open >= 0);
if (open >= 0) {
  const bodyStart = open + OPEN.length;
  // 结束标记必须是「反引号 + 分号 + 换行」，中间的孤立反引号一律视为事故
  const close = source.indexOf('`;', bodyStart);
  check('找到 UI_SCRIPT 终点', close > 0);
  if (close > 0) {
    const body = source.slice(bodyStart, close);
    const stray = body.split('`').length - 1;
    check('脚本体内无反引号', stray === 0, stray > 0 ? `发现 ${stray} 个` : '');
    check('脚本体长度合理', body.length > 20000, body.length + ' 字节');
    // new Function 能对非模块代码做一次真正的作用域解析
    let parsed = true;
    try {
      // eslint-disable-next-line no-new-func
      new Function(body);
    } catch (error) {
      parsed = false;
      check('脚本体语法正确', false, String(error.message).split('\n')[0]);
    }
    if (parsed) check('脚本体语法正确', true);
  }
}

console.log('\n== 配置与样式生成 ==');
try {
  const css = await import('file:///' + path.join(root, 'css.js').replace(/\\/g, '/'));
  const keys = Object.keys(css.DEFAULTS);
  check('css.js 导出 DEFAULTS/buildCss', Boolean(css.DEFAULTS) && typeof css.buildCss === 'function');
  check('默认配置可生成 CSS', css.buildCss({ ...css.DEFAULTS }).length > 100);
  check('默认配置不产生字距规则', !/letter-spacing:\s*-/.test(css.buildCss({ ...css.DEFAULTS })));
  check('字距可生成', /letter-spacing:-0\.011em/.test(css.buildCss({ ...css.DEFAULTS, letterSpacing: -0.011 })));
  check('终端字体可生成', /--dst-terminal-font/.test(css.buildCss({ ...css.DEFAULTS, terminalFollowCode: false, terminalFontFamily: 'Maple Mono NF CN' })));
  check('终端跟随代码字体时不覆盖', !/--dst-terminal-font/.test(css.buildCss({ ...css.DEFAULTS, terminalFollowCode: true, terminalFontFamily: 'X' })));
  const newKeys = ['letterSpacing', 'fontWeight', 'fontFeatures', 'terminalFollowCode', 'terminalFontFamily', 'terminalFontSize', 'terminalLetterSpacing', 'terminalLigatures'];
  const missing = newKeys.filter((key) => !keys.includes(key));
  check('DEFAULTS 含 0.3.0 新增键', missing.length === 0, missing.join(', '));
  const yaml = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8');
  const yamlMissing = newKeys.filter((key) => !yaml.includes(key + ':'));
  check('cordis.patch.yml 含新增键', yamlMissing.length === 0, yamlMissing.join(', '));
} catch (error) {
  check('css.js 检查', false, error.message);
}

console.log('\n' + (failed === 0 ? '全部通过' : failed + ' 项未通过'));
process.exit(failed === 0 ? 0 : 1);
