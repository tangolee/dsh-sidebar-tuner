#!/usr/bin/env node
/**
 * 查这个插件在三个环节的上架状态：npm registry、awesome 精选列表条目、DSH 插件市场索引。
 *
 *   node scripts/check-listing.mjs            人看的表格
 *   node scripts/check-listing.mjs --json     机器读的 JSON
 *   node scripts/check-listing.mjs --wait     索引里没有时，顺带报索引快照时间（默认就报）
 *
 * 零依赖，只用 Node 18+ 自带的 fetch。退出码：全绿 0，有缺项 1，网络/解析出错 2。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = new Set(process.argv.slice(2));
const asJson = argv.has('--json');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const localVersion = pkg.version;

/** `git+https://github.com/tangolee/dsh-sidebar-tuner.git` → { owner, repo } */
function repoOf(manifest) {
  const raw = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  if (!raw) return null;
  const match = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:#.*)?$/.exec(raw.trim());
  return match ? { owner: match[1], repo: match[2] } : null;
}

const UPSTREAM_OWNER = 'awesome-dsh-plugin';
const UPSTREAM_REPO = 'awesome-dsh-plugin';
const MARKET_INDEXES = [
  'https://dshmarket.com/index.json',
  'https://awesome-dsh-plugin.com/index.json',
];

const timeoutMs = 40_000;
const withTimeout = (promise) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('请求超时')), timeoutMs)),
  ]);

/** 取回文本与响应头；404 不算异常，交给调用方判断 */
async function grab(url, { json = false } = {}) {
  const response = await withTimeout(fetch(url, { redirect: 'follow', headers: { 'user-agent': 'dsh-sidebar-tuner-listing-check' } }));
  const body = response.ok ? (json ? await response.json() : await response.text()) : null;
  return { status: response.status, ok: response.ok, body, lastModified: response.headers.get('last-modified') };
}

function localize(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

async function checkNpm(name, version) {
  const url = `https://registry.npmjs.org/${name.replace('/', '%2f')}`;
  const { status, body } = await grab(url, { json: true });
  if (status === 404) return { ok: false, detail: 'registry 上还没有这个包名' };
  if (!body) return { ok: false, detail: `registry 返回 HTTP ${status}` };

  const latest = body['dist-tags']?.latest ?? null;
  const published = latest ? body.time?.[latest] ?? null : null;
  const versions = Object.keys(body.versions ?? {});
  return {
    ok: latest === version,
    latest,
    publishedAt: localize(published),
    publishedRaw: published,
    versionCount: versions.length,
    hasLocalVersion: versions.includes(version),
    detail:
      latest === version
        ? `latest 就是 ${version}`
        : versions.includes(version)
          ? `本地版本 ${version} 已发布，但 latest 指向 ${latest}`
          : `registry 上没有 ${version}，latest 是 ${latest}`,
  };
}

async function checkUpstream(owner, repo) {
  const slug = `${owner}__${repo}`;
  const entryUrl = `https://raw.githubusercontent.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/main/data/plugins/${slug}.yml`;
  const pageUrl = `https://awesome-dsh-plugin.com/p/${owner}/${repo}/`;

  const [entry, page] = await Promise.all([grab(entryUrl), grab(pageUrl)]);
  return {
    ok: entry.ok && page.ok,
    entry: { url: entryUrl, status: entry.status },
    page: { url: pageUrl, status: page.status },
    detail: entry.ok
      ? page.ok
        ? '条目在库，详情页可访问'
        : '条目在库，但详情页打不开'
      : '条目不在库里（没投稿、投稿未合并，或被撤下）',
  };
}

async function checkMarket(name) {
  const wanted = name.toLowerCase();
  const results = [];
  for (const url of MARKET_INDEXES) {
    const { status, body, lastModified } = await grab(url, { json: true });
    if (!body?.plugins) {
      results.push({ url, ok: false, status, snapshot: localize(lastModified), detail: `索引拉取失败（HTTP ${status}）` });
      continue;
    }
    const hit = body.plugins.find((plugin) => String(plugin.name).toLowerCase() === wanted);
    const newest = body.plugins.reduce((acc, plugin) => {
      const stamp = Math.max(...(plugin.versions ?? []).map((v) => v.publishTimestamp ?? 0), 0);
      return stamp > acc ? stamp : acc;
    }, 0);
    results.push({
      url,
      ok: Boolean(hit),
      status,
      snapshot: localize(lastModified),
      entryCount: body.plugins.length,
      newestEntry: newest ? localize(new Date(newest * 1000).toISOString()) : null,
      version: hit ? (hit.versions?.at(-1)?.version ?? null) : null,
      detail: hit ? `已收录（版本 ${hit.versions?.at(-1)?.version ?? '未知'}）` : '索引里还没有这一条',
    });
  }
  return { ok: results.some((item) => item.ok), indexes: results };
}

function line(label, status, text) {
  const mark = status === true ? '✓' : status === false ? '✗' : '·';
  return `  ${mark} ${label.padEnd(12)}${text}`;
}

async function main() {
  const target = repoOf(pkg) ?? { owner: 'tangolee', repo: pkg.name };

  const [npm, upstream, market] = await Promise.all([
    checkNpm(pkg.name, localVersion),
    checkUpstream(target.owner, target.repo),
    checkMarket(pkg.name),
  ]);

  if (asJson) {
    const payload = {
      package: pkg.name,
      localVersion,
      npm,
      upstream,
      market,
      ok: npm.ok && upstream.ok && market.ok,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(payload.ok ? 0 : 1);
  }

  console.log(`\n${pkg.name}@${localVersion}  上架状态（查于 ${localize(new Date().toISOString())}）\n`);
  console.log(line('npm', npm.ok, npm.detail + (npm.publishedAt ? `，发布于 ${npm.publishedAt}` : '')));
  console.log(line('精选列表', upstream.ok, upstream.detail));
  for (const item of market.indexes) {
    const host = new URL(item.url).host;
    console.log(
      line(
        '市场索引',
        item.ok,
        `${host}：${item.detail}` +
          (item.snapshot ? `｜快照 ${item.snapshot}` : '') +
          (item.newestEntry ? `｜最新条目 ${item.newestEntry}` : ''),
      ),
    );
  }

  if (!market.ok) {
    console.log('\n  市场索引是定时快照，落后上游一两天属正常，不用重复投稿。');
  }
  const ok = npm.ok && upstream.ok && market.ok;
  console.log(ok ? '\n  全部就位。\n' : '\n  还有缺项，见上。\n');
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error('  检查失败：' + (error?.message ?? error));
  process.exit(2);
});
