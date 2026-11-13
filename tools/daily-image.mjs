/**
 * 每日快照图：把当天的 TOP3 跨国故事 + 世界地图渲染成一张 1200×630 的 PNG。
 *
 *   node tools/daily-image.mjs
 *
 * 为什么这么做：
 *   - 站点本身是静态的，没有浏览器环境；这张图只在构建期生成一次
 *   - 不引入 npm 依赖：Playwright 只用来「装浏览器二进制」，
 *     脚本直接 spawn chrome --headless --screenshot
 *
 * 产出：
 *   public/daily/YYYY-MM-DD.png
 *   public/daily/index.json   （最近 30 天，供页面列出历史快照）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'daily');
const TMP = path.join(os.tmpdir(), `trends-daily-${process.pid}.html`);
const W = 1200;
const H = 630;
const MAP_W = 1000;
const MAP_H = 500;

const readJson = (f, fb = null) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return fb;
  }
};

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const project = (lon, lat) => [((lon + 180) / 360) * MAP_W, ((90 - lat) / 180) * MAP_H];
const ringToPath = (ring) =>
  ring.map(([lon, lat], i) => `${i ? 'L' : 'M'}${project(lon, lat).map((n) => n.toFixed(1)).join(' ')}`).join('') + 'Z';

/** 找一个可用的 headless Chrome */
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;

  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  ];

  // Playwright 装下来的浏览器（CI 里用这个）
  const pwCache = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    for (const dir of fs.readdirSync(pwCache)) {
      if (!dir.startsWith('chromium-')) continue;
      for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome-win/chrome.exe']) {
        const p = path.join(pwCache, dir, rel);
        if (fs.existsSync(p)) candidates.unshift(p);
      }
    }
  } catch {
    /* 没有缓存目录就跳过 */
  }

  return candidates.find((p) => fs.existsSync(p)) || null;
}

/* ---------------- 卡片 HTML ---------------- */

function buildHtml({ clusters, board, geo, stamp, dateLabel }) {
  // 每个簇一种色，最多 3 个（当天 TOP3）
  const PALETTE = ['#c1402a', '#c0802c', '#1f5a47'];
  const top = clusters.slice(0, 3);
  const colorOf = new Map();
  top.forEach((c, i) => (c.countries || []).forEach((iso) => colorOf.set(iso, PALETTE[i])));
  const covered = new Set(colorOf.keys());
  // 全量覆盖数（图表里的 lead 文案用），不只是 TOP3
  const allCovered = new Set();
  for (const c of clusters) for (const iso of c.countries || []) allCovered.add(iso);

  const featurePath = (geom) => {
    if (!geom) return '';
    if (geom.type === 'Polygon') return geom.coordinates.map(ringToPath).join('');
    if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p.map(ringToPath).join('')).join('');
    return '';
  };

  const groups = new Map();
  for (const f of geo.features || []) {
    const d = featurePath(f.geometry);
    if (!d) continue;
    const iso = f.properties?.iso;
    const idx = colorOf.has(iso) ? top.findIndex((c) => c.countries.includes(iso)) : -1;
    if (!groups.has(idx)) groups.set(idx, []);
    groups.get(idx).push(d);
  }

  const landPaths = [...groups.entries()]
    .map(([idx, ds]) => {
      const fill = idx === -1 ? '#d8cfbb' : PALETTE[idx];
      const stroke = idx === -1 ? '#c3b9a3' : '#ffffff';
      const width = idx === -1 ? 0.5 : 0.9;
      return `<path d="${ds.join('')}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" fill-rule="evenodd"/>`;
    })
    .join('\n      ');

  const stories = top
    .map(
      (c, i) => `        <li>
          <span class="n" style="color:${PALETTE[i]}">${c.count}</span>
          <span class="t">${esc(c.title).slice(0, 64)}</span>
        </li>`,
    )
    .join('\n');

  const withData = (board.countries || []).filter((b) => b.top).length;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  body{background:#f7f4ed;color:#171410;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
       padding:44px 54px 30px;display:flex;flex-direction:column;position:relative}
  .serif{font-family:"Iowan Old Style",Palatino,Georgia,"Songti SC",serif}
  .top{display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:12px}
  .mark{width:40px;height:40px;border-radius:4px;background:#171410;color:#f7f4ed;display:grid;place-items:center;font-size:21px}
  .bname{font-size:22px;font-weight:600;letter-spacing:-.2px}
  .bsub{font-size:12px;color:#6e6659;margin-top:2px}
  .date{font-size:13px;color:#6e6659;letter-spacing:.04em}
  .main{display:flex;gap:26px;flex:1;min-height:0;margin-top:20px}
  .left{flex:0 0 520px;display:flex;flex-direction:column;min-width:0}
  .right{flex:1;display:grid;place-items:center;min-width:0}
  h1{font-size:32px;line-height:1.16;letter-spacing:-.7px;font-weight:600}
  .lead{margin-top:10px;font-size:14px;color:#6e6659;line-height:1.5}
  ul{list-style:none;margin-top:18px}
  li{display:flex;gap:14px;align-items:baseline;padding:12px 0;border-bottom:1px solid rgba(23,20,16,.12)}
  li:last-child{border-bottom:none}
  .n{flex:0 0 34px;text-align:right;font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}
  .t{flex:1;font-size:15px;line-height:1.35;overflow-wrap:anywhere}
  .map{width:100%;max-height:420px}
  .foot{margin-top:auto;display:flex;justify-content:space-between;align-items:center;
        border-top:1px solid rgba(23,20,16,.3);padding-top:13px;font-size:13px;color:#6e6659}
  .url{font-weight:650;color:#171410;font-size:15px}
</style></head>
<body>
  <div class="top">
    <div class="brand">
      <div class="mark">🌍</div>
      <div><div class="bname serif">Trends World</div><div class="bsub">Daily top trends · one click to the source</div></div>
    </div>
    <div class="date">${esc(stamp)}</div>
  </div>

  <div class="main">
    <div class="left">
  <h1 class="serif">Today the same story trended in several countries</h1>
  <p class="lead">${allCovered.size} of ${withData} places shared their top topic with at least one other country. The numbers are how many countries each story reached.</p>

  <ul>
${stories}
  </ul>
    </div>
    <div class="right">
      <div class="map">
        <svg viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block">
          <rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" rx="8" fill="#e8efec"/>
          <g>
          ${landPaths}
          </g>
        </svg>
      </div>
    </div>
  </div>

  <div class="foot">
    <span class="url">trends-world.pages.dev</span>
    <span>176 countries and regions · Google Trends, Bing News, Wikipedia, Baidu</span>
  </div>
</body></html>`;
}

/* ---------------- main ---------------- */

const pulse = readJson(path.join(ROOT, 'public', 'data', 'global.json'), null);
const board = readJson(path.join(ROOT, 'public', 'data', 'board.json'), { countries: [] });
const geo = readJson(path.join(ROOT, 'public', 'world.geo.json'), { features: [] });

if (!pulse?.clusters?.length) {
  console.log('每日快照图：没有 Global Pulse 数据，跳过');
  process.exit(0);
}

const chrome = findChrome();
if (!chrome) {
  console.log('每日快照图：找不到 Chrome/Chromium，跳过（站点其余部分不受影响）');
  process.exit(0);
}

const at = pulse.generatedAt || Date.now();
const dateKey = new Date(at).toISOString().slice(0, 10);
const stamp = new Date(at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

fs.writeFileSync(TMP, buildHtml({ clusters: pulse.clusters, board, geo, stamp, dateLabel: dateKey }));

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPng = path.join(OUT_DIR, `${dateKey}.png`);

try {
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${W},${H}`,
      `--screenshot=${outPng}`,
      `file:///${TMP.replace(/\\/g, '/')}`,
    ],
    { stdio: 'pipe', timeout: 120_000 },
  );
} catch (err) {
  console.error('每日快照图：Chrome 渲染失败，跳过 —', String(err.message || err).split('\n')[0]);
  fs.rmSync(TMP, { force: true });
  process.exit(0);
}
fs.rmSync(TMP, { force: true });

// 维护最近 30 天的索引
const indexPath = path.join(OUT_DIR, 'index.json');
const index = readJson(indexPath, { days: [] });
const entry = {
  date: dateKey,
  file: `/daily/${dateKey}.png`,
  stamp,
  stories: pulse.clusters.slice(0, 3).map((c) => ({ title: c.title, count: c.count, slug: c.slug })),
};
index.days = [entry, ...(index.days || []).filter((d) => d.date !== dateKey)]
  .sort((a, b) => (a.date < b.date ? 1 : -1))
  .slice(0, 30);
fs.writeFileSync(indexPath, JSON.stringify(index, null, 0));

// 稳定入口：/daily/latest.png，前端不用算日期
fs.copyFileSync(outPng, path.join(OUT_DIR, 'latest.png'));

const kb = Math.round(fs.statSync(outPng).size / 1024);
console.log(`每日快照图：${path.relative(ROOT, outPng)}（${kb} KB，浏览器 ${path.basename(chrome)}）`);
