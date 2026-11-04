/**
 * 每日数据报表
 *
 *   node tools/report.mjs                 生成今天（最近 7 天）的报表
 *   node tools/report.mjs --days=1        只看最近 1 天
 *
 * 两路数据：
 *   1. 站点健康（不需要鉴权）—— 读线上的 /data/meta.json，确认抓取流水线还活着
 *   2. 访问数据（需要 Cloudflare 分析权限）—— GraphQL 查询 RUM 数据集
 *
 * Token 解析顺序：环境变量 CF_API_TOKEN → wrangler 本地登录态
 * 需要的权限：Account · Account Analytics · Read
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '19db9b8776a704f37f5eb32afc05cb42';
const SITE_TAG = process.env.CF_SITE_TAG || '26ce21d686214feb8954d106b995082f';
const SITE_URL = process.env.SITE_URL || 'https://trends-world.pages.dev';
const DAYS = Math.max(1, Math.min(30, Number(argOf('days', '7'))));
const OUT_DIR = path.join(ROOT, 'reports');

/* ---------------- token ---------------- */

function resolveToken() {
  if (process.env.CF_API_TOKEN) return { token: process.env.CF_API_TOKEN, source: 'env:CF_API_TOKEN' };
  // wrangler 本地登录态（只在开发者机器上存在，CI 里必须用 env）
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'xdg.config', '.wrangler', 'config', 'default.toml'),
    path.join(os.homedir(), '.wrangler', 'config', 'default.toml'),
    path.join(os.homedir(), '.config', '.wrangler', 'config', 'default.toml'),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const m = text.match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return { token: m[1], source: `wrangler:${path.basename(path.dirname(file))}` };
    } catch { /* 尝试下一个 */ }
  }
  return null;
}

/* ---------------- 数据源 ---------------- */

async function fetchSiteHealth() {
  try {
    const res = await fetch(`${SITE_URL}/data/meta.json?t=${Date.now()}`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const meta = await res.json();
    return {
      ok: true,
      generatedAt: meta.generatedAt,
      withData: meta.withData,
      requested: meta.requested,
      failed: meta.failed || [],
      kept: meta.keptFromPreviousRun || [],
      sources: meta.sources || {},
      tookSeconds: meta.tookSeconds,
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}


const QUERY = `query($a:String!,$s:Time!,$u:Time!,$tag:String!){
  viewer { accounts(filter:{accountTag:$a}) {
    byDay: rumPageloadEventsAdaptiveGroups(limit:100, filter:{datetime_geq:$s, datetime_leq:$u, siteTag:$tag}, orderBy:[date_ASC]) {
      count sum { visits } dimensions { date }
    }
    byPath: rumPageloadEventsAdaptiveGroups(limit:10, filter:{datetime_geq:$s, datetime_leq:$u, siteTag:$tag}, orderBy:[count_DESC]) {
      count sum { visits } dimensions { requestPath }
    }
    byCountry: rumPageloadEventsAdaptiveGroups(limit:10, filter:{datetime_geq:$s, datetime_leq:$u, siteTag:$tag}, orderBy:[count_DESC]) {
      count sum { visits } dimensions { countryName }
    }
    byReferer: rumPageloadEventsAdaptiveGroups(limit:10, filter:{datetime_geq:$s, datetime_leq:$u, siteTag:$tag}, orderBy:[count_DESC]) {
      count sum { visits } dimensions { refererHost }
    }
  } }
}`;

/** Cloudflare GraphQL 有分钟级预算，撞上了等一会儿再试 */
async function fetchAnalytics(token, attempt = 0) {
  const until = new Date();
  const since = new Date(until.getTime() - DAYS * 86400_000);
  const vars = { a: ACCOUNT_ID, s: since.toISOString(), u: until.toISOString(), tag: SITE_TAG };

  let account;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: vars }),
    });
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
    account = json?.data?.viewer?.accounts?.[0];
    if (!account) throw new Error('账号无数据或权限不足');
  } catch (err) {
    const msg = String(err.message || err);
    if (/rate limiter budget|try again after/i.test(msg) && attempt < 2) {
      const waitMs = 65_000 * (attempt + 1);
      process.stderr.write(`rate limited, retrying in ${Math.round(waitMs / 1000)}s…
`);
      await new Promise((r) => setTimeout(r, waitMs));
      return fetchAnalytics(token, attempt + 1);
    }
    throw err;
  }

  return {
    since,
    until,
    series: account.byDay || [],
    paths: account.byPath || [],
    countries: account.byCountry || [],
    referrers: account.byReferer || [],
  };
}

/* ---------------- 渲染 ---------------- */

const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
const ago = (ts) => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

function render({ health, traffic, tokenInfo }) {
  const now = new Date();
  const L = [];
  L.push(`# Trends World — ${now.toISOString().slice(0, 10)}`);
  L.push('');
  L.push(`Generated ${now.toISOString().replace('T', ' ').slice(0, 19)} UTC · window: last ${DAYS} day(s)`);
  L.push('');

  // 站点健康
  L.push('## Pipeline health');
  L.push('');
  if (health.ok) {
    const fresh = health.generatedAt ? ago(health.generatedAt) : 'unknown';
    L.push(`- Snapshot: **${health.withData}/${health.requested}** countries with data — generated ${fresh}`);
    if (health.tookSeconds) L.push(`- Crawl took ${health.tookSeconds}s`);
    const src = Object.entries(health.sources).map(([k, v]) => `${k} ${v}`).join(' · ');
    if (src) L.push(`- Sources: ${src}`);
    if (health.failed?.length) L.push(`- ⚠️ No data: ${health.failed.join(', ')}`);
    if (health.kept?.length) L.push(`- ♻️ Reused previous run: ${health.kept.join(', ')}`);
    if (health.generatedAt && Date.now() - health.generatedAt > 5 * 3600_000) {
      L.push(`- ⚠️ **Snapshot older than 5h — scheduled sync may be failing**`);
    }
  } else {
    L.push(`- ⚠️ Could not read site health: ${health.error}`);
  }
  L.push('');

  // 流量
  L.push(`## Traffic (last ${DAYS} day${DAYS > 1 ? 's' : ''})`);
  L.push('');
  if (traffic) {
    const pv = traffic.series.reduce((s, r) => s + r.count, 0);
    const visits = traffic.series.reduce((s, r) => s + (r.sum?.visits || 0), 0);
    L.push(`- **${fmtInt(pv)} page views** · **${fmtInt(visits)} visits** · ${(pv / Math.max(visits, 1)).toFixed(1)} pages per visit`);
    L.push('');
    if (traffic.series.length > 1) {
      L.push('| date | page views | visits |');
      L.push('| --- | ---: | ---: |');
      for (const row of traffic.series) {
        L.push(`| ${row.dimensions.date} | ${fmtInt(row.count)} | ${fmtInt(row.sum?.visits)} |`);
      }
      L.push('');
    }
    const table = (title, rows, key) => {
      const list = rows.filter((r) => r.dimensions?.[key]).slice(0, 8);
      if (!list.length) return;
      L.push(`**${title}**`);
      L.push('');
      L.push('| value | page views | visits |');
      L.push('| --- | ---: | ---: |');
      for (const r of list) {
        const v = String(r.dimensions[key]) || '(direct)';
        L.push(`| ${v.length > 60 ? v.slice(0, 57) + '…' : v} | ${fmtInt(r.count)} | ${fmtInt(r.sum?.visits)} |`);
      }
      L.push('');
    };
    table('Top pages', traffic.paths, 'requestPath');
    table('Top countries', traffic.countries, 'countryName');
    table('Top referrers', traffic.referrers, 'refererHost');
  } else {
    L.push(`- Analytics unavailable: ${tokenInfo.error || 'no token'}`);
  }
  return L.join('\n');
}

/* ---------------- main ---------------- */

const tokenInfo = resolveToken();
process.stderr.write(`token: ${tokenInfo ? tokenInfo.source : '(none)'}\n`);

const health = await fetchSiteHealth();
let traffic = null;
if (tokenInfo) {
  try {
    traffic = await fetchAnalytics(tokenInfo.token);
  } catch (err) {
    traffic = null;
    tokenInfo.error = String(err.message || err);
    process.stderr.write(`analytics failed: ${tokenInfo.error}\n`);
  }
}

const report = render({ health, traffic, tokenInfo });
fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, `${new Date().toISOString().slice(0, 10)}.md`);
fs.writeFileSync(outFile, report + '\n');
console.log(report);
process.stderr.write(`\nwritten: ${path.relative(ROOT, outFile)}\n`);

// 只有「站点数据本身挂了」才让 CI 报红；分析权限缺失/限流只在报告里标注
if (!health.ok) process.exit(1);
