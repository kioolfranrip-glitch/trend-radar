/* Trends World 前端
 * - 自绘 SVG 世界地图（等距圆柱投影，本地 GeoJSON，无第三方库）
 * - 国家卡片 / 详情面板 / 搜索 / 板块筛选
 * - 所有话题均带外链，点击直达原文
 */

/* 静态数据契约：由 tools/crawl.mjs 生成，Cloudflare Pages 直接托管，无后端 */
const DATA = {
  countries: '/data/countries.json',
  board: '/data/board.json',
  meta: '/data/meta.json',
  pulse: '/data/global.json',
  details: (iso) => `/data/details/${iso}.json`,
};

const CONTINENTS = [
  { key: 'ALL', label: 'All' },
  { key: 'Asia', label: 'Asia' },
  { key: 'Europe', label: 'Europe' },
  { key: 'North America', label: 'North America' },
  { key: 'South America', label: 'South America' },
  { key: 'Africa', label: 'Africa' },
  { key: 'Oceania', label: 'Oceania' },
];

const state = {
  countries: [],
  byIso: new Map(),
  board: new Map(),        // iso -> board row
  continent: 'ALL',
  query: '',
  activeIso: null,
  page: 1,
  pageSize: 24,
  mapReady: false,
  meta: null,
  pulse: null,
  detailTab: 'pulse',
  pulseOpen: null,
  generatedAt: 0,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------------- 工具 ---------------- */

function flagEmoji(iso) {
  if (!iso || iso.length !== 2) return '🏳️';
  const base = 0x1f1e6;
  return String.fromCodePoint(
    ...[...iso.toUpperCase()].map((c) => base + (c.charCodeAt(0) - 65)),
  );
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sourceLabel(src) {
  return (
    {
      'google-trends': 'Google Trends',
      baidu: 'Baidu',
      wikipedia: 'Wikipedia',
      'bing-news': 'Bing News',
    }[src] || src || 'Unknown source'
  );
}

/* ---------------- 地图 ---------------- */

const MAP_W = 1000;
const MAP_H = 480;
const LAT_TOP = 84;
const LAT_BOTTOM = -58;

const projection = {
  project([lon, lat]) {
    const x = ((lon + 180) / 360) * MAP_W;
    const clamped = Math.max(LAT_BOTTOM, Math.min(LAT_TOP, lat));
    const y = ((LAT_TOP - clamped) / (LAT_TOP - LAT_BOTTOM)) * MAP_H;
    return [x, y];
  },
};

function ringToPath(ring) {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = projection.project(ring[i]);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return `${d}Z`;
}

function geometryToPath(geom) {
  if (!geom) return '';
  if (geom.type === 'Polygon') return geom.coordinates.map(ringToPath).join(' ');
  if (geom.type === 'MultiPolygon')
    return geom.coordinates.map((poly) => poly.map(ringToPath).join(' ')).join(' ');
  return '';
}

function drawGraticule() {
  const g = $('#graticule');
  let d = '';
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = projection.project([0, lat]);
    d += `M0,${y}L${MAP_W},${y}`;
  }
  for (let lon = -150; lon <= 150; lon += 30) {
    const [x] = projection.project([lon, 0]);
    d += `M${x},0L${x},${MAP_H}`;
  }
  g.innerHTML = `<path d="${d}" fill="none" stroke="rgba(120,145,190,0.12)" stroke-width="0.6"/>`;
}

async function initMap() {
  drawGraticule();
  const res = await fetch('/world.geo.json');
  const geo = await res.json();
  const land = $('#land');
  const frag = document.createDocumentFragment();

  for (const f of geo.features) {
    const iso = f.properties.iso;
    const d = geometryToPath(f.geometry);
    if (!d) continue;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.dataset.iso = iso;
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${f.properties.nameZh} (${iso})`;
    p.appendChild(title);
    p.addEventListener('mouseenter', (e) => showTip(iso, e));
    p.addEventListener('mousemove', moveTip);
    p.addEventListener('mouseleave', hideTip);
    p.addEventListener('click', () => selectCountry(iso, { scroll: true }));
    frag.appendChild(p);
  }
  land.appendChild(frag);

  // 中国/美国等标签点
  const pins = $('#pins');
  const pinTargets = ['US', 'BR', 'RU', 'CN', 'IN', 'AU', 'ZA', 'GB', 'FR', 'JP', 'DE', 'MX', 'EG', 'ID'];
  const f = document.createDocumentFragment();
  for (const iso of pinTargets) {
    const c = state.byIso.get(iso);
    if (!c || c.lat == null) continue;
    const [x, y] = projection.project([c.lon, c.lat]);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'pin');
    g.dataset.iso = iso;
    g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
    g.innerHTML = `<circle class="halo" r="6"/><circle class="core" r="3.1"/>`;
    g.addEventListener('click', () => selectCountry(iso, { scroll: true }));
    f.appendChild(g);
  }
  pins.appendChild(f);

  state.mapReady = true;
  $('#mapLoading').hidden = true;
  paintMap();
}

function paintMap() {
  if (!state.mapReady) return;
  for (const path of $$('#land path')) {
    const iso = path.dataset.iso;
    const row = state.board.get(iso);
    const has = !!row?.top;
    path.classList.toggle('has-data', has);
    path.classList.toggle('active', iso === state.activeIso);
    path.dataset.heat = has ? String(heatLevel(row)) : '0';
  }
}

/** 把各国最热话题的搜索量粗分成 4 档，用于地图着色 */
function parseTraffic(value) {
  if (!value) return 0;
  const m = String(value).match(/([\d.]+)\s*([KMB万亿]?)/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === 'K' || unit === '千') return n * 1e3;
  if (unit === 'M' || unit === '万') return n * 1e6;
  if (unit === 'B' || unit === '亿') return n * 1e9;
  return n;
}

function heatLevel(row) {
  const raw = row?.top?.traffic || '';
  const n = parseTraffic(raw);
  if (!n) return 1;              // 有数据但没有量化热度（如新闻源）
  if (n >= 2000) return 4;
  if (n >= 500) return 3;
  if (n >= 100) return 2;
  return 1;
}

function showTip(iso, event) {
  const c = state.byIso.get(iso);
  if (!c) return;
  const row = state.board.get(iso);
  const tip = $('#mapTip');
  tip.hidden = false;
  tip.innerHTML = `<b>${c.nameZhShort}</b> <span>· ${c.nameEn}</span><br/>${
    row?.top
      ? `<span>🔥 ${escapeHtml(row.top.title)}</span>`
      : row
        ? '<span>Loading data…</span>'
        : '<span>Click to see what is trending here</span>'
  }`;
  moveTip(event);
}

function moveTip(event) {
  const stage = $('#mapStage');
  const rect = stage.getBoundingClientRect();
  const tip = $('#mapTip');
  if (tip.hidden) return;
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  tip.style.left = `${Math.min(Math.max(x, 90), rect.width - 90)}px`;
  tip.style.top = `${Math.max(y, 60)}px`;
}

function hideTip() {
  $('#mapTip').hidden = true;
}

/* ---------------- 详情面板 ---------------- */

async function loadDetail(iso) {
  const country = state.byIso.get(iso);
  if (!country) return;
  const body = $('#detailBody');
  const empty = $('#detailEmpty');
  empty.hidden = true;
  body.hidden = false;
  body.innerHTML = `<div style="padding:40px;display:flex;gap:10px;align-items:center;justify-content:center;color:var(--muted);font-size:13px"><span class="spinner"></span> Fetching trends for ${country.nameEn}…</div>`;

  try {
    const res = await fetch(`${DATA.details(iso)}?v=${state.generatedAt || 0}`);
    if (!res.ok) throw new Error(res.status === 404 ? 'no data for this region yet' : `HTTP ${res.status}`);
    const payload = await res.json();
    const topics = payload.topics || [];
    if (!topics.length) throw new Error('no data for this region yet');
    renderDetail({ country, source: payload.source, at: payload.updatedAt, topics });
    state.board.set(iso, {
      iso,
      nameZh: country.nameZh,
      top: topics[0],
      count: topics.length,
      source: payload.source,
      updatedAt: payload.updatedAt,
    });
    paintMap();
    updateStat();
  } catch (err) {
    body.innerHTML = `
      <div class="detail-head">
        <div class="detail-title-row">
          <span class="flag">${flagEmoji(iso)}</span>
          <div><h3>${country.nameZh}</h3><p class="detail-sub">${country.nameEn}</p></div>
        </div>
      </div>
      <div style="padding:28px 20px;color:var(--muted);font-size:13px;line-height:1.8">
        Couldn't load data: ${escapeHtml(String(err.message || err))}<br/>
        <button class="btn ghost" style="margin-top:12px" data-action="retry" data-iso="${iso}">Retry</button>
      </div>`;
  }
}

function renderDetail(data) {
  const c = data.country;
  const topics = data.topics || [];
  const body = $('#detailBody');

  const list = topics
    .map((t, i) => {
      const rank = i + 1;
      const traffic = t.traffic ? `<span class="traffic">${escapeHtml(t.traffic)}</span>` : '';
      const news = (t.news || [])
        .slice(0, 3)
        .map(
          (n) =>
            `<li><a href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
              n.source ? `${n.source} · ` : '',
            )}${escapeHtml(n.title || n.url)}</a></li>`,
        )
        .join('');
      return `
      <li class="topic">
        <a class="topic-link" href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer"
           title="Open the source in a new tab">
          <span class="rank ${rank <= 3 ? `r${rank}` : ''}">${rank}</span>
          <span class="topic-main">
            <span class="topic-title">${escapeHtml(t.title)}</span>
            <span class="topic-meta">
              ${traffic}
              <span class="src-badge">${escapeHtml(t.sourceLabel || sourceLabel(t.source))}</span>
              ${t.pictureSource ? `<span>${escapeHtml(t.pictureSource)}</span>` : ''}
            </span>
          </span>
          <svg class="ext" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        ${news ? `<ul class="topic-news">${news}</ul>` : ''}
      </li>`;
    })
    .join('');

  body.innerHTML = `
    <div class="detail-head">
      <div class="detail-title-row">
        <span class="flag">${flagEmoji(c.iso)}</span>
        <div style="min-width:0">
          <h3>${escapeHtml(c.nameZhShort)} — today's trends</h3>
          <p class="detail-sub">
            <span class="tag">${escapeHtml(c.continent)}</span>
            <span>${escapeHtml(c.nameEn)}</span>
          </p>
        </div>
      </div>
      <div class="detail-meta">
        <span>${topics.length} topics</span>
        <span>·</span>
        <span>Source: ${escapeHtml(sourceLabel(data.source))}</span>
        <span>·</span>
        <span>${data.cached ? 'cached' : 'updated'} ${timeAgo(data.at)}</span>
        <button class="icon-btn" data-action="refresh" data-iso="${c.iso}">
          <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Refresh
        </button>
      </div>
    </div>
    <ul class="topic-list">${list}</ul>`;
}

/* ---------------- 卡片区 ---------------- */

function filteredCountries() {
  const q = state.query.trim().toLowerCase();
  return state.countries.filter((c) => {
    if (state.continent !== 'ALL' && c.continent !== state.continent) return false;
    if (!q) return true;
    return (
      c.nameZh.toLowerCase().includes(q) ||
      c.nameZhShort.toLowerCase().includes(q) ||
      c.nameEn.toLowerCase().includes(q) ||
      c.iso.toLowerCase() === q ||
      c.iso3.toLowerCase() === q ||
      (state.board.get(c.iso)?.top?.title || '').toLowerCase().includes(q)
    );
  });
}

function renderCards() {
  const list = filteredCountries();
  const shown = list.slice(0, state.page * state.pageSize);
  const grid = $('#cards');

  $('#cardsTitle').innerHTML = `Today's top trends by country <small>${list.length} countries / regions</small>`;

  if (!shown.length) {
    grid.innerHTML = `<div class="card empty-card"><div class="card-note">No matching country. Try a different keyword.</div></div>`;
    $('#loadMore').hidden = true;
    return;
  }

  const current = new Map($$('.card[data-iso]', grid).map((el) => [el.dataset.iso, el]));
  for (const sk of $$('.card.skeleton', grid)) sk.remove();

  for (const c of shown) {
    const html = cardHtml(c);
    const existing = current.get(c.iso);
    if (existing) {
      if (existing.__sig !== html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const fresh = tmp.firstElementChild;
        fresh.addEventListener('click', () => selectCountry(c.iso, { scroll: false }));
        fresh.addEventListener('keydown', onCardKey(c.iso));
        existing.replaceWith(fresh);
      }
      current.delete(c.iso);
    } else {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const fresh = tmp.firstElementChild;
      fresh.addEventListener('click', () => selectCountry(c.iso, { scroll: false }));
      fresh.addEventListener('keydown', onCardKey(c.iso));
      grid.appendChild(fresh);
    }
  }
  for (const stale of current.values()) stale.remove();

  $('#loadMore').hidden = shown.length >= list.length;
}

function onCardKey(iso) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectCountry(iso, { scroll: false });
    }
  };
}

function cardHtml(c) {
  const row = state.board.get(c.iso);
  const top = row?.top;
  const active = c.iso === state.activeIso ? ' active' : '';
  const live =
    row?.stale || row?.error
      ? '<span class="card-live"><i style="background:var(--warm)"></i>Stale</span>'
      : top
        ? `<span class="card-live"><i></i>${timeAgo(row.updatedAt)}</span>`
        : '<span class="card-live"><i style="background:var(--dim)"></i>Loading</span>';
  return `
      <article class="card${active}" data-iso="${c.iso}" tabindex="0" role="button"
               aria-label="${escapeHtml(c.nameZhShort)} today's trends">
        <div class="card-top">
          <span class="card-flag">${flagEmoji(c.iso)}</span>
          <span class="card-country">${escapeHtml(c.nameZhShort)}</span>
          <span class="card-code">${c.iso}</span>
          ${live}
        </div>
        ${
          top
            ? `<div class="card-topic">${escapeHtml(top.title)}</div>
               <div class="card-foot">
                 ${top.traffic ? `<span class="traffic">${escapeHtml(top.traffic)}</span>` : ''}
                 <span class="src-badge">${escapeHtml(sourceLabel(row.source))}</span>
                 <span class="card-open">View details →</span>
               </div>`
            : `<div class="card-note">${escapeHtml(row?.error ? 'No data available for this country' : "Loading this country's trends…")}</div>
               <div class="card-foot"><span>${(c.sources || []).length || 1} sources</span><span class="card-open">View details →</span></div>`
        }
      </article>`;
}

function renderFilters() {
  $('#filters').innerHTML = CONTINENTS.map(
    (c) => `<button class="filter${state.continent === c.key ? ' on' : ''}" data-key="${c.key}">${c.label}</button>`,
  ).join('');
  for (const btn of $$('.filter')) {
    btn.addEventListener('click', () => {
      state.continent = btn.dataset.key;
      state.page = 1;
      renderFilters();
      renderCards();
    });
  }
}

/* ---------------- 滚动条带 ---------------- */

function renderTicker() {
  const items = [...state.board.values()]
    .filter((r) => r.top)
    .sort((a, b) => parseTraffic(b.top.traffic) - parseTraffic(a.top.traffic))
    .slice(0, 24)
    .map((r) => {
      const c = state.byIso.get(r.iso);
      return `<span class="ticker-item"><span class="ck">▲</span><b>${escapeHtml(
        c?.nameZhShort || r.iso,
      )}</b> ${escapeHtml(r.top.title)}</span>`;
    });
  if (!items.length) return;
  const track = $('#tickerTrack');
  track.innerHTML = items.join('') + items.join('');
}

/** 右侧未选国家时的「全球此刻」：跨国故事 + 按搜索量排序两种视角 */
function pulseItemHtml(c, rank, idx) {
  const open = state.pulseOpen === idx;
  const chips = c.countries
    .slice(0, 8)
    .map((iso) => {
      const cc = state.byIso.get(iso);
      return `<span class="pulse-chip">${flagEmoji(iso)} ${escapeHtml(cc?.nameZhShort || iso)}</span>`;
    })
    .join('');
  const more =
    c.countries.length > 8 ? `<span class="pulse-chip more">+${c.countries.length - 8}</span>` : '';
  const href = c.url || `https://www.google.com/search?q=${encodeURIComponent(c.title)}`;

  // 展开后：完整的国家清单，每个都能跳到该国的详情面板
  const all = open
    ? `<div class="pulse-detail">
        <div class="pulse-all">
          ${c.countries
            .map((iso) => {
              const cc = state.byIso.get(iso);
              const name = escapeHtml(cc?.nameZhShort || iso);
              return `<a class="pulse-pick" href="#/${iso}" title="${name}">${flagEmoji(iso)} ${name}</a>`;
            })
            .join('')}
        </div>
        <div class="pulse-actions">
          <a class="pulse-src" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Open the source ↗</a>
        </div>
      </div>`
    : '';

  return `
      <li class="pulse ${rank <= 3 ? `top${rank}` : ''} ${open ? 'expanded' : ''}">
        <button class="pulse-head" data-action="pulse-toggle" data-idx="${idx}" aria-expanded="${open}">
          <span class="pulse-count"><b>${c.count}</b><small>countries</small></span>
          <span class="pulse-title">${escapeHtml(c.title)}</span>
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="pulse-chips">${chips}${more}</div>
        ${all}
      </li>`;
}

function topItemHtml(r, i) {
  const c = state.byIso.get(r.iso);
  const rank = i + 1;
  return `
      <li class="topic">
        <a class="topic-link" href="${escapeHtml(r.top.url)}" target="_blank" rel="noopener noreferrer">
          <span class="rank ${rank <= 3 ? `r${rank}` : ''}">${rank}</span>
          <span class="topic-main">
            <span class="topic-title">${escapeHtml(r.top.title)}</span>
            <span class="topic-meta">
              <span class="src-badge">${flagEmoji(r.iso)} ${escapeHtml(c?.nameZhShort || r.iso)}</span>
              ${r.top.traffic ? `<span class="traffic">${escapeHtml(r.top.traffic)}</span>` : ''}
              <span>${escapeHtml(sourceLabel(r.source))}</span>
            </span>
          </span>
          <svg class="ext" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
      </li>`;
}

function renderGlobalPulse() {
  const body = $('#detailBody');
  const empty = $('#detailEmpty');
  const rows = [...state.board.values()]
    .filter((r) => r.top)
    .sort((a, b) => parseTraffic(b.top.traffic) - parseTraffic(a.top.traffic));
  if (!rows.length) return;

  empty.hidden = true;
  body.hidden = false;

  const clusters = state.pulse?.clusters || [];
  const tab = state.detailTab;

  const head = `
    <div class="detail-head">
      <div class="detail-title-row">
        <span class="flag">${tab === 'pulse' ? '🌍' : '🔥'}</span>
        <div>
          <h3>${tab === 'pulse' ? 'Global pulse' : 'Right now, worldwide'}</h3>
          <p class="detail-sub">${
            tab === 'pulse'
              ? 'Stories breaking in several countries at once · click to open the source'
              : 'Sorted by search volume · click to open the source'
          }</p>
        </div>
      </div>
      <div class="pulse-tabs" role="tablist">
        <button class="ptab ${tab === 'pulse' ? 'on' : ''}" data-action="tab" data-tab="pulse" ${
          tab === 'pulse' ? 'aria-selected="true"' : 'aria-selected="false"'
        }>Global pulse${clusters.length ? ` <b>${clusters.length}</b>` : ''}</button>
        <button class="ptab ${tab === 'top' ? 'on' : ''}" data-action="tab" data-tab="top" ${
          tab === 'top' ? 'aria-selected="true"' : 'aria-selected="false"'
        }>By search volume</button>
      </div>
    </div>`;

  if (tab === 'top') {
    body.innerHTML = `${head}
      <ul class="topic-list">${rows.slice(0, 12).map(topItemHtml).join('')}</ul>
      <div class="detail-meta detail-meta-foot">
        <span>${rows.length} countries and regions with data</span><span>·</span>
        <span>Click any country on the map to drill in</span>
      </div>`;
    return;
  }

  const covered = clusters.reduce((n, c) => n + c.count, 0);
  const list = clusters.length
    ? `<ul class="pulse-list">${clusters.map((c, i) => pulseItemHtml(c, i + 1, i)).join('')}</ul>`
    : `<p class="pulse-empty">No story is trending in two or more countries right now. Check the
         <button class="linkish" data-action="tab" data-tab="top">country ranking</button> instead.</p>`;

  body.innerHTML = `${head}
    ${list}
    <div class="detail-meta detail-meta-foot">
      <span>${clusters.length} cross-border ${clusters.length === 1 ? 'story' : 'stories'} covering ${covered} of ${rows.length} places</span>
    </div>`;
}

/* ---------------- 交互 ---------------- */

async function selectCountry(iso, { scroll = false } = {}) {
  const c = state.byIso.get(iso);
  if (!c) return;

  // 该地区在当前筛选外时自动切回全部
  if (state.continent !== 'ALL' && c.continent !== state.continent) {
    state.continent = 'ALL';
    renderFilters();
  }
  state.activeIso = iso;
  paintMap();
  renderCards();
  loadDetail(iso);

  // 可分享的深链接
  if (location.hash !== `#/${iso}`) {
    history.replaceState(null, '', `#/${iso}`);
  }

  if (scroll) {
    const card = $(`.card[data-iso="${iso}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else {
      const idx = filteredCountries().findIndex((x) => x.iso === iso);
      if (idx >= 0) {
        state.page = Math.ceil((idx + 1) / state.pageSize);
        renderCards();
        $(`.card[data-iso="${iso}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }
}

/** 从 URL hash 恢复选中的国家，例如 #/JP */
function hashIso() {
  const m = location.hash.match(/^#\/?([A-Za-z]{2})$/);
  return m ? m[1].toUpperCase() : null;
}

/** 加载静态快照：board.json 一次点亮整张地图，不需要逐个请求 */
async function loadData({ silent = false } = {}) {
  try {
    const [boardRes, metaRes, pulseRes] = await Promise.all([
      fetch(DATA.board, { cache: 'no-cache' }),
      fetch(DATA.meta, { cache: 'no-cache' }),
      fetch(DATA.pulse, { cache: 'no-cache' }).catch(() => null),
    ]);
    state.pulse = pulseRes && pulseRes.ok ? await pulseRes.json() : null;
    if (!boardRes.ok) throw new Error(`board.json → HTTP ${boardRes.status}`);
    const board = await boardRes.json();
    state.meta = metaRes.ok ? await metaRes.json() : null;
    state.generatedAt = board.generatedAt || state.meta?.generatedAt || 0;

    state.board.clear();
    for (const row of board.countries || []) state.board.set(row.iso, row);

    renderCards();
    renderTicker();
    paintMap();
    updateStat();
    if (!state.activeIso) renderGlobalPulse();
    return true;
  } catch (err) {
    console.warn('load data failed', err);
    if (!silent) {
      $('#statText').textContent = 'Could not load data';
      $('#stat .dot').className = 'dot bad';
      $('#cards').innerHTML =
        '<div class="card empty-card"><div class="card-note">Data has not been generated yet. Run <code>npm run crawl</code> or wait for the scheduled sync.</div></div>';
      $('#cardsTitle').innerHTML = "Today's top trends by country <small>no snapshot</small>";
    }
    return false;
  }
}

function updateStat() {
  const total = [...state.board.values()].filter((r) => r.top).length;
  const el = $('#statText');
  const dot = $('#stat .dot');
  const q = state.query ? ` (${filteredCountries().length} filtered)` : '';
  el.textContent = `Loaded ${total} countries${q}`;
  dot.className = total ? 'dot live' : 'dot warn';
  renderMapFoot();
}

function renderMapFoot() {
  const rows = [...state.board.values()].filter((r) => r.top);
  const counts = {};
  for (const r of rows) counts[r.source] = (counts[r.source] || 0) + 1;
  const latest = state.generatedAt || rows.reduce((m, r) => Math.max(m, r.updatedAt || 0), 0);
  const parts = ['google-trends', 'bing-news', 'baidu', 'wikipedia']
    .filter((k) => counts[k])
    .map((k) => `<span class="src-chip"><i class="src-dot s-${k.replace(/[^a-z]/g, '')}"></i>${sourceLabel(k)} <b>${counts[k]}</b></span>`)
    .join('');
  $('#mapFoot').innerHTML = `
    <div class="foot-row">${parts}</div>
    <div class="foot-note">${rows.length} countries and regions · last synced ${latest ? timeAgo(latest) : '—'} · synced by CI</div>`;
}

/* ---------------- 启动 ---------------- */

async function boot() {
  const res = await fetch(DATA.countries, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`countries.json → HTTP ${res.status}`);
  const list = await res.json();
  state.countries = Array.isArray(list) ? list : list.countries || [];
  state.byIso = new Map(state.countries.map((c) => [c.iso, c]));

  renderFilters();
  updateStat();
  await initMap();
  renderCards();

  const deep = hashIso();
  if (deep && state.byIso.has(deep)) {
    selectCountry(deep, { scroll: false });
  }
  loadData();

  window.addEventListener('hashchange', () => {
    const iso = hashIso();
    if (iso && iso !== state.activeIso && state.byIso.has(iso)) selectCountry(iso, { scroll: false });
  });

  $('#loadMore').addEventListener('click', () => {
    state.page += 1;
    renderCards();
  });

  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    state.page = 1;
    renderCards();
  });

  $('#refreshAll').addEventListener('click', async () => {
    const btn = $('#refreshAll');
    if (btn.classList.contains('spinning')) return;
    btn.classList.add('spinning');

    await loadData({ silent: true });
    if (state.activeIso) loadDetail(state.activeIso);
    btn.classList.remove('spinning');
  });

  for (const chip of $$('[data-jump]')) {
    chip.addEventListener('click', () => selectCountry(chip.dataset.jump, { scroll: true }));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('#search')) {
      e.preventDefault();
      $('#search').focus();
    }
  });

  const stamp = state.generatedAt || Date.now();
  $('#footTime').textContent = `Updated ${new Date(stamp).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`;

  // 自动刷新看板（每 10 分钟，静默读取服务端最新缓存）
  setInterval(() => {
    if (document.hidden) return;
    loadData({ silent: true });
  }, 60 * 60 * 1000);
}

window.__tw = {
  refresh: (iso) => loadDetail(iso),
  retry: (iso) => loadDetail(iso),
};

// 详情面板内的按钮用事件委托（CSP 禁止内联 onclick）
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'pulse-toggle') {
    const idx = Number(btn.dataset.idx);
    state.pulseOpen = state.pulseOpen === idx ? null : idx;
    renderGlobalPulse();
    return;
  }
  if (btn.dataset.action === 'tab') {
    state.detailTab = btn.dataset.tab === 'top' ? 'top' : 'pulse';
    state.pulseOpen = null;
    renderGlobalPulse();
    return;
  }
  const iso = btn.dataset.iso;
  if (!iso) return;
  if (btn.dataset.action === 'refresh') window.__tw.refresh(iso);
  if (btn.dataset.action === 'retry') window.__tw.retry(iso);
});

boot().catch((err) => {
  console.error(err);
  $('#statText').textContent = 'No data snapshot yet';
  $('#stat .dot').className = 'dot warn';
  const grid = $('#cards');
  if (grid) {
    grid.innerHTML =
      '<div class="card empty-card"><div class="card-note">' +
      'This build has no data yet. Run <code>npm run crawl</code> locally, or wait for the scheduled sync to finish.' +
      '</div></div>';
  }
  const title = $('#cardsTitle');
  if (title) title.innerHTML = "Today's top trends by country <small>no snapshot</small>";
  const loading = $('#mapLoading');
  if (loading) loading.hidden = true;
});

// 开发期可见错误：任何未捕获异常都显示在顶栏，便于排查
window.addEventListener('error', (e) => {
  const el = document.querySelector('#statText');
  if (el) el.textContent = `Script error: ${e.message}`;
  const dot = document.querySelector('#stat .dot');
  if (dot) dot.className = 'dot bad';
});
window.addEventListener('unhandledrejection', (e) => {
  const el = document.querySelector('#statText');
  if (el) el.textContent = `Async error: ${e.reason?.message || e.reason}`;
  const dot = document.querySelector('#stat .dot');
  if (dot) dot.className = 'dot bad';
});
