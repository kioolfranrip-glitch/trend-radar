/**
 * 抓取 + 导出静态数据（用于 Cloudflare Pages 这类纯静态托管）
 *
 * 用法：
 *   node tools/crawl.mjs                     全量抓取，输出到 public/data
 *   node tools/crawl.mjs --only=US,JP,CN     只抓指定国家（调试用）
 *   node tools/crawl.mjs --jobs=4            并发数（默认 4）
 *   node tools/crawl.mjs --proxy=http://...  指定代理（也可用 HTTPS_PROXY 环境变量）
 *   node tools/crawl.mjs --out=public/data   输出目录
 *
 * 产物：
 *   public/data/countries.json      国家元数据（前端一次性加载）
 *   public/data/board.json          每国 Top1 快照（首屏用，~70KB gzip）
 *   public/data/global.json         Global Pulse：跨国话题聚类
 *   public/data/details/<ISO>.json  某国完整热榜（点开才加载）
 *   public/data/meta.json           生成时间、覆盖率、失败清单
 *
 * 设计：失败不清空。抓取失败时沿用上一次的 details 文件，保证站点永远不会“空白发布”。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrendStore } from '../server/store.mjs';
import { buildPulse } from './cluster.mjs';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const OUT_DIR = path.resolve(ROOT, arg('out', 'public/data'));
const DETAIL_DIR = path.join(OUT_DIR, 'details');
const JOBS = Math.max(1, Number(arg('jobs', '4')));
const ONLY = arg('only');
const proxyArg = argv.find((a) => a.startsWith('--proxy='));
const USE_CACHE_ONLY = argv.includes('--use-cache'); // 只重新导出，不联网

// serve.mjs 通过进程参数读取代理，这里统一注入
if (proxyArg && !process.argv.includes(proxyArg)) process.argv.push(proxyArg);

/* ---------------- 主流程 ---------------- */
const countries = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'countries.json'), 'utf8'));
const targets = ONLY
  ? countries.filter((c) => ONLY.split(',').map((s) => s.trim().toUpperCase()).includes(c.iso))
  : countries;

fs.mkdirSync(DETAIL_DIR, { recursive: true });

const store = new TrendStore(ROOT);
store.note = () => {}; // 静默，只在最后汇总

const started = Date.now();
const results = new Map(); // iso -> record | null
let done = 0;

console.log(`抓取 ${targets.length} 个国家/地区，并发 ${JOBS}…`);

const queue = [...targets];
async function worker(id) {
  while (queue.length) {
    const country = queue.shift();
    try {
      if (USE_CACHE_ONLY) {
        const hit = store.fresh(country.iso) || store.stale(country.iso);
        results.set(country.iso, hit?.topics?.length ? hit : null);
      } else {
        const data = await store.get(country, { wait: true });
        results.set(country.iso, data?.topics?.length ? data : null);
      }
    } catch {
      results.set(country.iso, null);
    }
    done += 1;
    if (done % 20 === 0 || done === targets.length) {
      console.log(`  ${done}/${targets.length}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
  }
}
await Promise.all(Array.from({ length: JOBS }, (_, i) => worker(i)));

/* ---------------- 写出 ---------------- */

/** 来源名统一成界面语言（历史缓存里可能残留旧标签） */
const LABELS = {
  'google-trends': 'Google Trends',
  baidu: 'Baidu',
  wikipedia: 'Wikipedia pageviews',
  'bing-news': 'Bing News',
};

function canonicalLabel(source, fallback, country) {
  const known = LABELS[source];
  if (!known) return fallback || source || 'Unknown';
  // Bing 的标签带国家名，用英文名重建，保证全站文案一致
  if (source === 'bing-news') return `${known} · ${country?.nameEn || country?.nameZhShort || ''}`.trim();
  return known;
}

/** 前端需要的国家字段（其余字段不进产物，控制体积） */
function pickCountry(c) {
  return {
    iso: c.iso,
    iso3: c.iso3,
    nameEn: c.nameEn,
    nameZh: c.nameZh,
    nameZhShort: c.nameZhShort,
    nameLocal: c.nameLocal,
    continent: c.continent,
    lat: c.lat,
    lon: c.lon,
    sources: [c.google ? 'google-trends' : null, 'wikipedia', c.baidu ? 'baidu' : null].filter(Boolean),
  };
}

const board = [];
const sourceCount = {};
const failed = [];
const kept = [];
let withData = 0;

for (const country of targets) {
  const data = results.get(country.iso);
  const detailPath = path.join(DETAIL_DIR, `${country.iso}.json`);

  if (data) {
    const payload = {
      iso: country.iso,
      source: data.source || null,
      updatedAt: data.at || Date.now(),
      // 来源标签统一成界面语言，避免历史缓存里残留旧文案
      topics: data.topics.map((t) => ({ ...t, sourceLabel: canonicalLabel(t.source, t.sourceLabel, country) })),
    };
    fs.writeFileSync(detailPath, JSON.stringify(payload));
    board.push({
      iso: country.iso,
      source: payload.source,
      updatedAt: payload.updatedAt,
      count: payload.topics.length,
      top: payload.topics[0] || null,
    });
    sourceCount[payload.source || 'unknown'] = (sourceCount[payload.source || 'unknown'] || 0) + 1;
    withData += 1;
  } else {
    failed.push(country.iso);
    // 抓取失败：沿用旧文件，页面不至于空白
    if (fs.existsSync(detailPath)) {
      try {
        const old = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
        board.push({
          iso: country.iso,
          source: old.source || null,
          updatedAt: old.updatedAt || 0,
          count: old.topics?.length || 0,
          top: old.topics?.[0] || null,
          stale: true,
        });
        kept.push(country.iso);
        withData += 1;
      } catch {
        board.push({ iso: country.iso, source: null, updatedAt: 0, count: 0, top: null });
      }
    } else {
      board.push({ iso: country.iso, source: null, updatedAt: 0, count: 0, top: null });
    }
  }
}

const meta = {
  generatedAt: Date.now(),
  tookSeconds: Math.round((Date.now() - started) / 1000),
  requested: targets.length,
  withData,
  failed,
  keptFromPreviousRun: kept,
  sources: sourceCount,
};

fs.writeFileSync(path.join(OUT_DIR, 'countries.json'), JSON.stringify(countries.filter((c) => targets.includes(c)).map(pickCountry)));
fs.writeFileSync(path.join(OUT_DIR, 'board.json'), JSON.stringify({ generatedAt: meta.generatedAt, countries: board }));
fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

// Global Pulse：跨国家话题聚类（同一件事同时上了多国热榜）
const pulse = buildPulse(
  board.map((b) => ({ iso: b.iso, nameEn: '', source: b.source, topic: b.top })),
);
fs.writeFileSync(
  path.join(OUT_DIR, 'global.json'),
  JSON.stringify({
    generatedAt: meta.generatedAt,
    totalCountries: targets.length,
    withData,
    stories: pulse.stories,
    clusters: pulse.clusters.map((c) => ({
      title: c.title,
      countries: c.countries,
      count: c.count,
      traffic: c.traffic,
      trafficLabel: c.trafficLabel,
      url: c.url,
      source: c.source,
      sources: c.sources,
    })),
  }),
);

console.log('');
console.log(`完成：${withData}/${targets.length} 有数据，用时 ${meta.tookSeconds}s`);
console.log('来源分布：', JSON.stringify(sourceCount));
console.log(`Global Pulse：${pulse.stories} 条跨国故事（覆盖 ${pulse.clusters.reduce((n, c) => n + c.count, 0)} 个国家）`);
for (const c of pulse.clusters.slice(0, 3)) console.log(`  · ${c.count} 国  ${c.title}`);
if (kept.length) console.log(`沿用旧数据：${kept.length} 个（${kept.join(',')}）`);
if (failed.length) console.log(`无数据：${failed.length} 个（${failed.join(',')}）`);

// 生成 20 个国家真路由页 + sitemap（让 Google 能读到不靠 JS 的静态内容）
try {
  execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'country-pages.mjs')], {
    stdio: 'inherit',
  });
} catch (err) {
  console.error('WARN: 国家页生成失败，继续发布（站点主体不受影响）:', err.message);
}

// 全站一条数据都没有 → 判定为失败，避免把空站发出去
if (withData === 0) {
  console.error('ERROR: 没有抓到任何数据，中止发布');
  process.exit(1);
}
