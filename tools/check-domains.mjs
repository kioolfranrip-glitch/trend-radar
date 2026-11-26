#!/usr/bin/env node
/**
 * 查一批域名的可用性（RDAP，无 whois 依赖）。
 *
 *   node tools/check-domains.mjs                    # 查内置候选列表
 *   node tools/check-domains.mjs foo.com bar.dev    # 查指定的
 *
 * RDAP 返回 404 = 未注册（可买）；200 = 已注册。
 * 只做可用性判断，不查价格、不涉及交易。
 */

const CANDIDATES = [
  // .com：品牌词组合
  'trendsworld.com',
  'worldtrends.com',
  'trends-world.com',
  'trendatlas.com',
  'trendglobe.com',
  'worldpulse.com',
  'globalpulse.com',
  'worldheat.com',
  'dailytrends.com',
  'trendradar.com',
  // 其他后缀：同样的名字换 TLD
  'trends.world',
  'trendatlas.world',
  'worldpulse.world',
  'trendatlas.dev',
  'worldpulse.dev',
  'trendatlas.app',
  'trendsmap.dev',
  'worldpulse.io',
];

const names = process.argv.length > 2 ? process.argv.slice(2) : CANDIDATES;

const BOOTSTRAP = 'https://rdap.org/domain/';

async function check(domain) {
  const ctrl = AbortSignal.timeout(15_000);
  try {
    const res = await fetch(BOOTSTRAP + encodeURIComponent(domain), {
      redirect: 'follow',
      signal: ctrl,
      headers: { accept: 'application/rdap+json', 'user-agent': 'trends-world-domaincheck' },
    });
    if (res.status === 404) return { domain, status: 'available' };
    if (res.status === 200) {
      // 顺带取出到期时间和注册商，方便判断是不是被 park 着卖
      let expires = '';
      try {
        const j = await res.json();
        for (const ev of j.events || []) {
          if (ev.eventAction === 'expiration') expires = ev.eventDate.slice(0, 10);
        }
      } catch {
        /* 拿不到就算了 */
      }
      return { domain, status: 'taken', expires };
    }
    return { domain, status: `http-${res.status}` };
  } catch (err) {
    return { domain, status: `error: ${String(err.message || err).slice(0, 40)}` };
  }
}

const results = [];
for (const name of names) {
  // 串行 + 小延迟，避免被 RDAP 限流
  const r = await check(name);
  results.push(r);
  const icon = r.status === 'available' ? '✅ 可注册' : r.status === 'taken' ? '❌ 已注册' : `⚠️  ${r.status}`;
  console.log(`${icon.padEnd(16)} ${r.domain}${r.expires ? `   (到期 ${r.expires})` : ''}`);
  await new Promise((res) => setTimeout(res, 600));
}

const free = results.filter((r) => r.status === 'available');
console.log(`\n可注册 ${free.length} / ${results.length}`);
if (free.length) console.log('可用：', free.map((r) => r.domain).join(', '));
