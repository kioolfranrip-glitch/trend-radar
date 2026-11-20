#!/usr/bin/env node
/**
 * 查 Googlebot / Bingbot 最近有没有回访 Trends World，并按天拆分。
 *
 *   node tools/check-googlebot.mjs            # 默认从 2026-11-13 查到现在
 *   node tools/check-googlebot.mjs 2026-11-01 # 自定义起始日期
 *
 * 直连 api.cloudflare.com（不走代理），token 取自 wrangler 的本地配置。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ACCOUNT = '19db9b8776a704f37f5eb32afc05cb42';
const HOST = 'trends-world.pages.dev';
const BOTS = {
  Googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  Bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
};

function readToken() {
  const candidates = [
    path.join(os.homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),
    path.join(os.homedir(), '.config/.wrangler/config/default.toml'),
    path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
  ];
  for (const f of candidates) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } catch {
      /* 换下一个 */
    }
  }
  return null;
}

const since = process.argv[2] || '2026-11-13';
const sinceIso = `${since}T00:00:00Z`;
const untilIso = `${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}T00:00:00Z`;

const token = readToken();
if (!token) {
  console.error('没找到 wrangler token。先跑一次 `npx wrangler@4 whoami` 刷新登录。');
  process.exit(1);
}

async function query(ua, label) {
  const q = `
  query($a:String!,$s:Time!,$u:Time!,$ua:String!){
    viewer{ accounts(filter:{accountTag:$a}){
      byDay: httpRequestsAdaptiveGroups(
        limit:50
        filter:{datetime_geq:$s, datetime_leq:$u, clientRequestHTTPHost:"${HOST}", userAgent:$ua}
      ){ count dimensions{ date clientRequestPath edgeResponseStatus } }
    }}
  }`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, variables: { a: ACCOUNT, s: sinceIso, u: untilIso, ua } }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json();
  if (json.errors) {
    console.log(`${label}: Cloudflare 错误 —`, json.errors[0]?.message);
    if (/auth/i.test(json.errors[0]?.message || '')) {
      console.log('  Token 过期，跑一次 `npx wrangler@4 whoami` 再重试。');
    }
    return null;
  }
  return json.data.viewer.accounts[0].byDay;
}

for (const [label, ua] of Object.entries(BOTS)) {
  const rows = await query(ua, label);
  if (!rows) continue;
  const total = rows.reduce((s, r) => s + r.count, 0);
  console.log(`\n${label}：${since} 至今 ${total} 次`);
  if (!total) {
    console.log('  （0 次）');
    continue;
  }
  const byDay = new Map();
  for (const r of rows) {
    const d = r.dimensions.date;
    byDay.set(d, (byDay.get(d) || 0) + r.count);
  }
  for (const [d, n] of [...byDay.entries()].sort()) console.log(`  ${d}  ${String(n).padStart(4)} 次`);

  const byPath = new Map();
  for (const r of rows) {
    const p = r.dimensions.clientRequestPath || '/';
    byPath.set(p, (byPath.get(p) || 0) + r.count);
  }
  console.log('  路径分布：');
  for (const [p, n] of [...byPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${String(n).padStart(4)}  ${p}`);
  }
}
