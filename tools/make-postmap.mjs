/**
 * 生成 r/MapPorn 用的地图图（不是分享卡片，是能独立看懂的一张图）
 *
 *   DEBUG_BOX=1 node tools/make-postmap.mjs   # 带洋红定位框，用于确定裁切范围
 *   node tools/make-postmap.mjs               # 出干净的图
 *
 * 讲的故事：同一件事正在几十个国家同时上榜。这是数据里最有传播力的信号。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1000;
const H = 520;
const project = (lon, lat) => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];

const readJson = (f, fb = null) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return fb;
  }
};

const PALETTE = ['#ff5a6e', '#ffb23a', '#5b8dff', '#35d39a', '#c56bff', '#34c8d9'];
const MUTED_FILL = 'rgba(120, 150, 210, 0.13)';
const MUTED_STROKE = 'rgba(130, 165, 220, 0.35)';

const geo = readJson(path.join(ROOT, 'public', 'world.geo.json'), { features: [] });
const pulse = readJson(path.join(ROOT, 'public', 'data', 'global.json'), { clusters: [] });
const clusters = (pulse.clusters || []).slice(0, 6);

/** iso → 簇下标（同一簇的国家同色） */
const colorOf = new Map();
clusters.forEach((c, i) => {
  for (const iso of c.countries || []) if (!colorOf.has(iso)) colorOf.set(iso, i);
});

const ringToPath = (ring) =>
  ring
    .map(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join('') + 'Z';

const featurePath = (geom) => {
  if (!geom) return '';
  if (geom.type === 'Polygon') return geom.coordinates.map(ringToPath).join('');
  if (geom.type === 'MultiPolygon')
    return geom.coordinates.map((p) => p.map(ringToPath).join('')).join('');
  return '';
};

// 按颜色分组，减少 DOM 节点
const groups = new Map();
for (const f of geo.features) {
  const d = featurePath(f.geometry);
  if (!d) continue;
  const iso = f.properties?.iso;
  const idx = colorOf.has(iso) ? colorOf.get(iso) : -1;
  const key = idx;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(d);
}

const landPaths = [...groups.entries()]
  .map(([key, ds]) => {
    const fill = key === -1 ? MUTED_FILL : PALETTE[key] + 'cc';
    const stroke = key === -1 ? MUTED_STROKE : '#0a0f1c';
    const width = key === -1 ? 0.6 : 0.9;
    return `<path d="${ds.join('')}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" fill-rule="evenodd"/>`;
  })
  .join('\n      ');

const graticule = [
  ...[...Array(5)].map(
    (_, i) => `<line x1="0" y1="${(i + 1) * (H / 6)}" x2="${W}" y2="${(i + 1) * (H / 6)}"/>`,
  ),
  ...[...Array(9)].map(
    (_, i) => `<line x1="${(i + 1) * (W / 10)}" y1="0" x2="${(i + 1) * (W / 10)}" y2="${H}"/>`,
  ),
].join('');

const top = clusters[0];
const headline = top
  ? `One story is the #1 search in ${top.count} countries`
  : 'What every country is searching for right now';

const legend = clusters
  .map(
    (c, i) => `<li><span class="sw" style="background:${PALETTE[i]}"></span>
      <span class="lt">${c.title.replace(/</g, '&lt;').slice(0, 46)}</span>
      <span class="lc">${c.count}</span></li>`,
  )
  .join('\n      ');

const totalCovered = clusters.reduce((n, c) => n + c.count, 0);
const stamp = new Date(pulse.generatedAt || Date.now()).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const debug = process.env.DEBUG_BOX === '1';

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>Trends World map</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html{background:#05070e}
  html,body{width:1240px;height:760px;overflow:hidden}
  body{
    ${debug ? 'box-shadow:inset 0 0 0 4px #ff00ff;' : ''}
    background:radial-gradient(90% 80% at 50% 0%,#0f1930 0%,#080b16 58%,#04060c 100%);
    color:#e9eefb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    padding:32px 40px 24px;display:flex;flex-direction:column;position:relative}
  .top{display:flex;align-items:flex-end;justify-content:space-between;gap:30px}
  .kicker{font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;color:#6f7f9e;font-weight:600}
  h1{font-size:38px;line-height:1.08;letter-spacing:-1.6px;font-weight:780;margin-top:14px;max-width:1080px}
  .sub{margin-top:10px;font-size:14.5px;color:#9fb0cd;max-width:900px;line-height:1.45}
  .stamp{font-size:12px;color:#5f6c86;text-align:right;white-space:nowrap;padding-bottom:6px}
  .map{margin-top:16px;flex:1;min-height:0;display:grid;place-items:center}
  .map svg{width:100%;height:auto;max-height:470px}
  .grat line{stroke:#7aa8ff;stroke-opacity:.06;stroke-width:1}
  .legend{display:flex;gap:20px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid rgba(120,145,190,.18)}
  .legend ul{list-style:none;display:flex;gap:22px;flex-wrap:wrap}
  .legend li{display:flex;align-items:center;gap:7px;font-size:12.5px}
  .sw{width:11px;height:11px;border-radius:4px;flex:0 0 auto}
  .lt{color:#c6d2e8;font-weight:600;max-width:215px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .lc{color:#7f8cab;font-variant-numeric:tabular-nums}
  .foot{margin-top:10px;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#5f6c86}
  .foot b{color:#9fb0cd;font-weight:600}
  .src{font-size:11.5px;max-width:900px}
</style></head>
<body>
  <div class="top">
    <div>
      <div class="kicker">Trends World · daily snapshot</div>
      <h1>${headline}</h1>
      <p class="sub">The single most-searched topic in each country, coloured by story —
        ${totalCovered} of 176 places are currently looking up something that other countries are looking up too.</p>
    </div>
    <div class="stamp">${stamp}</div>
  </div>

  <div class="map">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <g class="grat">${graticule}</g>
      <g>
      ${landPaths}
      </g>
    </svg>
  </div>

  <div class="legend">
    <ul>
      ${legend}
    </ul>
  </div>

  <div class="foot">
    <span class="src">Top topic per country from <b>Google Trends</b> daily feeds, with <b>Bing News</b>, <b>Wikipedia</b> and <b>Baidu</b> where Google publishes nothing. Grey = a topic unique to that country.</span>
    <span><b>trends-world.pages.dev</b></span>
  </div>
</body></html>
`;

const out = path.join(ROOT, 'public', '_postmap.html');
fs.writeFileSync(out, html);
console.log(`写出 ${path.relative(ROOT, out)} · ${clusters.length} 个簇 · ${colorOf.size} 国上色 · debug=${debug}`);
