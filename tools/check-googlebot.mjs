#!/usr/bin/env node
/**
 * 查 Googlebot 最近有没有回访 Trends World。
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
const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function readToken() {
  const candidates = [
    path.join(os.homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),
    path.join(os.homedir(), '.config/.wrangler/config/default.toml'),
    path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
  ];
  for (const f of candidates) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return { token: m[1], file: f };
    } catch {
      /* 换下一个 */
    }
  }
  return null;
}

const since = process.argv[2] || '2026-11-13';
const sinceIso = `${since}T00:00:00Z`;
const untilIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T00:00:00Z';

const t = readToken();
if (!t) {
  console.error('没找到 wrangler token。先跑一次 `npx wrangler@4 whoami` 刷新登录。');
  process.exit(1);
}

const query = `
query($a:String!,$s:Time!,$u:Time!,$ua:String!){
  viewer{ accounts(filter:{accountTag:$a}){
    rows: httpRequestsAdaptiveGroups(
      limit:50
      filter:{datetime_geq:$s, datetime_leq:$u, clientRequestHTTPHost:"${HOST}", userAgent:"${UA}"}
      orderBy:[count_DESC]
    ){ count dimensions{ clientRequestPath edgeResponseStatus } }
  }}
}`;

const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables: { a: ACCOUNT, s: sinceIso, u: untilIso, ua: UA } }),
  signal: AbortSignal.timeout(30_000),
});

const json = await res.json();
if (json.errors) {
  console.log('Cloudflare 返回错误：');
  for (const e of json.errors) console.log(' -', e.message);
  if (/auth/i.test(json.errors[0]?.message || '')) {
    console.log('\nToken 过期了。跑一次 `npx wrangler@4 whoami` 再重试。');
  }
  process.exit(2);
}

const rows = json.data.viewer.accounts[0].rows;
const total = rows.reduce((s, r) => s + r.count, 0);

console.log(`Googlebot 抓取 ${HOST}：${since} 至今共 ${total} 次\n`);
if (!total) {
  console.log('（0 次 —— 说明 Google 没有回访）');
} else {
  for (const r of rows) {
    console.log(`  ${String(r.count).padStart(4)} 次  ${r.dimensions.edgeResponseStatus}  ${r.dimensions.clientRequestPath}`);
  }
}
