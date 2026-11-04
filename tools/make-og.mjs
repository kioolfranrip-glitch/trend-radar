/**
 * 生成分享卡片（og:image）用的 HTML
 *
 *   node tools/make-og.mjs            → 写出 public/_og-card.html
 *
 * 地图由 Node 直接生成内联 SVG（等距圆柱投影，与站点主地图同一份 GeoJSON），
 * 不依赖浏览器里的 fetch，避免截图时图还没画出来。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1000;
const H = 500;
const project = (lon, lat) => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];

const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'world.geo.json'), 'utf8'));

const ringToPath = (ring) =>
  ring
    .map(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join('') + 'Z';

let d = '';
for (const feature of geo.features) {
  const geom = feature.geometry;
  if (!geom) continue;
  if (geom.type === 'Polygon') d += geom.coordinates.map(ringToPath).join('');
  else if (geom.type === 'MultiPolygon')
    d += geom.coordinates.map((poly) => poly.map(ringToPath).join('')).join('');
}

const mapSvg = `<svg class="mapsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <defs>
    <linearGradient id="landfill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2f6bd8" stop-opacity="0.30"/>
      <stop offset="55%" stop-color="#5b8dff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#8b5bff" stop-opacity="0.10"/>
    </linearGradient>
  </defs>
  <g>
    <path d="${d}" fill="url(#landfill)" stroke="#7aa8ff" stroke-opacity="0.55" stroke-width="0.7" stroke-linejoin="round"/>
  </g>
  ${[...Array(7)].map((_, i) => `<line x1="0" y1="${(i + 1) * (H / 8)}" x2="${W}" y2="${(i + 1) * (H / 8)}" stroke="#7aa8ff" stroke-opacity="0.07" stroke-width="0.8"/>`).join('')}
  ${[...Array(9)].map((_, i) => `<line x1="${(i + 1) * (W / 10)}" y1="0" x2="${(i + 1) * (W / 10)}" y2="${H}" stroke="#7aa8ff" stroke-opacity="0.07" stroke-width="0.8"/>`).join('')}
</svg>`;

const template = fs.readFileSync(path.join(ROOT, 'tools', 'og-card.html'), 'utf8');
if (!template.includes('<!--MAP-->')) throw new Error('模板里缺少 <!--MAP--> 占位符');
const html = template.replace('<!--MAP-->', mapSvg);

fs.writeFileSync(path.join(ROOT, 'public', '_og-card.html'), html);
console.log(`内联地图 ${(d.length / 1024).toFixed(0)}KB · 写出 public/_og-card.html`);
