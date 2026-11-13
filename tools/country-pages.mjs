/**
 * 生成 20 个国家的真路由静态页 + sitemap.xml
 *
 *   node tools/country-pages.mjs
 *
 * 为什么要做这个：站点原本只有 1 个可被收录的 URL（176 个国家全在 #/XX 里）。
 * 这些页面把「某国今天在搜什么」变成纯 HTML 文本，Google 不执行 JS 也能读到，
 * 才有机会命中 "what is trending in japan" 这类长尾查询。
 *
 * 刻意只做 20 个：先验证有没有搜索需求，再决定要不要铺满 176 个。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHistory, diffTopics, dailyLeaders, normalize } from './history.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(PUBLIC, 'data');
const SITE = process.env.SITE_URL || 'https://trends-world.pages.dev';
const CACHE_DIR = path.join(ROOT, 'data', 'cache');

/** 先验证这 20 个（覆盖主要语言区 + 搜索体量大的市场） */
export const TARGETS = [
  'US', 'JP', 'GB', 'DE', 'FR', 'IN', 'BR', 'RU', 'KR', 'CA',
  'AU', 'MX', 'ID', 'TR', 'SA', 'IT', 'ES', 'NL', 'AR', 'ZA',
];

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const fmtDate = (ms) =>
  ms
    ? new Date(ms).toLocaleString('en-GB', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }) + ' UTC'
    : '';

/** 每个国家的数据来源不同，说明文字必须跟着变——这既诚实，也让每页内容真的不一样 */
const sourceNote = (source, name) => {
  switch (source) {
    case 'google-trends':
      return `Ranked by search interest, using Google Trends' daily trends feed for ${name}.`;
    case 'baidu':
      return `Ranked by Baidu's hot-search list, which reflects what readers on mainland Chinese search infrastructure are looking up today.`;
    case 'wikipedia':
      return `Google Trends does not publish a daily feed for ${name}, so this page ranks the most-viewed Wikipedia articles about the region instead.`;
    case 'bing-news':
      return `Google Trends does not publish a daily feed for ${name}, so this page ranks the most-read ${name} news stories of the day from Bing News instead. Search interest and news attention are not the same thing — treat this as "what people are reading", not "what people are typing".`;
    default:
      return `Topics associated with ${name} in the latest snapshot.`;
  }
};

/** 变化标记：新进榜 / 上升 / 下降 */
function deltaBadge(d) {
  if (!d) return '';
  if (d.status === 'new') return '<span class="delta d-new">NEW</span>';
  if (d.status === 'up') return `<span class="delta d-up">▲${d.delta}</span>`;
  if (d.status === 'down') return `<span class="delta d-down">▼${d.delta}</span>`;
  return '';
}

function pageHtml({ iso, country, topics, updatedAt, source, sourceLabel, related, pulse, days }) {
  const name = country?.nameEn || iso;
  const slug = iso.toLowerCase();
  const canonical = `${SITE}/country/${slug}/`;
  const title = `What's Trending in ${name} Right Now — Trends World`;
  const description = topics.length
    ? `The ${topics.length} most-${source === 'bing-news' ? 'read' : 'searched'} topics in ${name} today, with links to the original sources. Updated every 3 hours.`
    : `Daily trending topics for ${name}, updated every 3 hours.`;

  // 用前三条拼一个真正属于这个国家的问题答案（避免 20 个页面共用同一段文案）
  const topThree = topics.slice(0, 3).map((t) => t.title).filter(Boolean);

  // 只有存在更早一天时才显示变化标记，否则整屏都是 NEW 反而误导
  const canDiff = (days?.length || 0) >= 2;
  const diffs = canDiff ? diffTopics(topics, days) : new Map();
  const leaders = canDiff ? dailyLeaders(days).slice(-7) : [];

  const listHtml = topics
    .map(
      (t) => `        <li class="topic">
          <span class="rank">${t.rank}</span>
          <div class="topic-body">
            <a class="topic-title" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.title)}</a>
            <div class="topic-meta">
              ${t.traffic ? `<span class="traffic">${esc(t.traffic)} searches</span>` : ''}
              <span class="src">${esc(t.sourceLabel || sourceLabel || '')}</span>
              ${deltaBadge(diffs.get(normalize(t.title)))}
            </div>
          </div>
        </li>`,
    )
    .join('\n');

  const relatedHtml = related
    .map((r) => `<a href="/country/${r.iso.toLowerCase()}/">${esc(r.name)}</a>`)
    .join(' · ');

  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Trends World', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: name, item: canonical },
        ],
      },
      {
        '@type': 'ItemList',
        name: `Trending topics in ${name}`,
        numberOfItems: topics.length,
        itemListElement: topics.slice(0, 10).map((t, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: t.title,
          ...(t.url ? { url: t.url } : {}),
        })),
      },
      ...(topThree.length
        ? [
            {
              '@type': 'FAQPage',
              mainEntity: [
                {
                  '@type': 'Question',
                  name: `What is trending in ${name} right now?`,
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: `As of ${fmtDate(updatedAt)}, the top topics in ${name} are: ${topThree.join(', ')}.`,
                  },
                },
                {
                  '@type': 'Question',
                  name: `How often is this page updated?`,
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: `Every 3 hours. The snapshot on this page was generated on ${fmtDate(updatedAt)}.`,
                  },
                },
              ],
            },
          ]
        : []),
    ],
  });

  const pulseHtml = pulse
    ? `<section class="card">
        <h2>Trending in several countries at once</h2>
        <p>${esc(pulse.title)} is currently trending in ${pulse.count} places, including ${esc(name)}. <a href="/">See the full world map →</a></p>
      </section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${canonical}" />
<meta name="theme-color" content="#080b16" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Trends World" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${SITE}/og-light.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${SITE}/og-light.png" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌍</text></svg>" />
<script type="application/ld+json">${jsonld}</script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#f7f4ed;--panel:#ffffff;--line:rgba(23,20,16,.13);--text:#171410;--muted:#6e6659;--dim:#9b9284;--accent:#c1402a;--ink:#171410;--serif:"Iowan Old Style",Palatino,Georgia,"Songti SC",serif}
  body{background:var(--bg);min-height:100vh;color:var(--text);
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.6}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  .wrap{max-width:820px;margin:0 auto;padding:28px 20px 60px}
  .top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--line-strong);margin-bottom:26px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:17px;color:var(--text)}
  .brand span.mark{width:30px;height:30px;border-radius:4px;background:var(--ink);color:#f7f4ed;display:grid;place-items:center;font-size:15px}
  .top nav{display:flex;gap:14px;font-size:13.5px;color:var(--muted)}
  .crumb{font-size:12px;color:var(--dim);margin-bottom:10px;letter-spacing:.02em}
  h1{font-family:var(--serif);font-size:clamp(26px,4.2vw,38px);line-height:1.16;letter-spacing:-.6px;font-weight:600}
  .stamp{margin-top:10px;font-size:13px;color:var(--muted)}
  .stamp .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#2e7d5b;margin-right:6px;vertical-align:middle}
  .note{margin-top:16px;font-size:14.5px;color:var(--muted)}
  ol.topics{list-style:none;margin:24px 0 0;display:flex;flex-direction:column;gap:10px}
  .topic{display:flex;gap:13px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:4px;padding:13px 15px}
  .rank{flex:0 0 26px;height:26px;border-radius:2px;display:grid;place-items:center;font-size:12.5px;font-weight:700;font-family:var(--serif);
        color:var(--muted);background:transparent;border:1px solid var(--line)}
  .topic:nth-child(1) .rank{color:#fff;background:#c1402a;border-color:#c1402a}
  .topic:nth-child(2) .rank{color:#fff;background:#c0802c;border-color:#c0802c}
  .topic:nth-child(3) .rank{color:#fff;background:#171410;border-color:#171410}
  .topic-body{min-width:0;flex:1}
  .topic-title{font-weight:600;font-size:15.5px;color:var(--text);overflow-wrap:anywhere}
  .topic-meta{margin-top:5px;display:flex;gap:10px;flex-wrap:wrap;font-size:11.5px;color:var(--dim)}
  .traffic{color:#1f5a47;font-variant-numeric:tabular-nums}
  section.card{margin-top:30px;padding:18px;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:0;background:#fff}
  section.card h2{font-family:var(--serif);font-size:16px;margin-bottom:8px;font-weight:600}
  .delta{font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:2px;border:1px solid currentColor;line-height:1.35}
  .d-new{color:#c1402a}
  .d-up{color:#1f5a47}
  .d-down{color:#6e6659}
  .leaders{list-style:none;margin-top:6px}
  .leaders li{display:flex;gap:12px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--line);font-size:13.5px}
  .leaders li:last-child{border-bottom:none}
  .leaders time{flex:0 0 88px;color:var(--dim);font-size:11.5px;font-variant-numeric:tabular-nums}
  .leaders span{flex:1;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis}
  .leaders em{font-style:normal;color:var(--dim);font-size:11.5px}
  section.card p{font-size:14px;color:var(--muted)}
  .related{margin-top:30px;font-size:13.5px;color:var(--muted);line-height:2}
  footer{margin-top:38px;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px;color:var(--dim);display:flex;gap:14px;flex-wrap:wrap}
  @media(max-width:520px){.top nav{display:none}.topic{padding:11px 12px}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="brand" href="/"><span class="mark">🌍</span> Trends World</a>
    <nav><a href="/">World map</a><a href="/countries/">All countries</a><a href="/about/">About</a><a href="/feed.xml">RSS</a></nav>
  </header>

  <main>
    <p class="crumb"><a href="/">World map</a> / ${esc(country?.continent || 'World')} / ${esc(name)}</p>
    <h1>What's trending in ${esc(name)} right now</h1>
    <p class="stamp"><span class="dot"></span><time datetime="${updatedAt ? new Date(updatedAt).toISOString() : ''}">${esc(fmtDate(updatedAt))}</time> · ${topics.length} topics · source: ${esc(sourceLabel || source || '—')}</p>
    <p class="note">${esc(sourceNote(source, name))}</p>

${topics.length ? `    <ol class="topics">\n${listHtml}\n    </ol>` : '    <p class="note">No snapshot for this country yet. Check back after the next sync.</p>'}

${pulseHtml}

${leaders.length ? `    <section class="card">
      <h2>The top topic on previous days</h2>
      <ul class="leaders">
${leaders.map((l) => `        <li><time datetime="${l.date}">${l.date}</time><span>${esc(l.title)}</span>${l.traffic ? `<em>${esc(l.traffic)}</em>` : ''}</li>`).join('\n')}
      </ul>
    </section>
` : ''}
    <section class="card">
      <h2>How this snapshot is built</h2>
      <p>Every three hours an automated job collects the day's top topic for ${esc(name)} and 175 other countries and regions, then publishes the result as static files. Nothing here is estimated or hand-written: the list above is exactly what the source returned on ${esc(fmtDate(updatedAt))}, and every row links to the original article or result page.</p>
    </section>

    <p class="related"><strong>Other countries:</strong><br />${relatedHtml}</p>
  </main>

  <footer>
    <a href="/">World map</a><a href="/about/">About</a><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/security/">Security</a>
    <span>Content rights belong to the original sources.</span>
  </footer>
</div>
</body>
</html>
`;
}

function buildSitemap(entries) {
  const urls = entries
    .map(
      (e) => `  <url>\n    <loc>${SITE}${e.path}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}



/* ---------------- 全量国家索引页 /countries/ ---------------- */

function buildCountriesIndex({ countries, boardByIso, targets }) {
  const rows = [...countries]
    .sort((a, b) => (a.nameEn || '').localeCompare(b.nameEn || ''))
    .map((c) => {
      const row = boardByIso.get(c.iso);
      const top = row?.top;
      const hasPage = targets.includes(c.iso);
      const href = hasPage ? `/country/${c.iso.toLowerCase()}/` : `/#/${c.iso}`;
      const source = top?.sourceLabel || '';
      return `      <li>
        <a class="c" href="${href}">${esc(c.nameEn || c.iso)}</a>
        <span class="t">${top?.title ? esc(top.title) : '<em>no data</em>'}</span>
        <span class="s">${esc(source)}</span>
      </li>`;
    })
    .join('\n');

  const withData = countries.filter((c) => boardByIso.get(c.iso)?.top).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>What's trending in every country — Trends World</title>
<meta name="description" content="Today's top topic for ${countries.length} countries and regions, in one plain list. ${withData} have data right now. Updated every 3 hours." />
<link rel="canonical" href="${SITE}/countries/" />
<meta name="theme-color" content="#080b16" />
<meta property="og:type" content="website" />
<meta property="og:title" content="What's trending in every country — Trends World" />
<meta property="og:description" content="Today's top topic for ${countries.length} countries and regions." />
<meta property="og:url" content="${SITE}/countries/" />
<meta property="og:image" content="${SITE}/og-light.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="alternate" type="application/atom+xml" title="Trends World" href="${SITE}/feed.xml" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌍</text></svg>" />
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--paper:#f7f4ed;--ink:#171410;--muted:#6e6659;--dim:#9b9284;--line:rgba(23,20,16,.13);--accent:#c1402a;
        --serif:"Iowan Old Style",Palatino,Georgia,"Songti SC",serif}
  body{background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.6}
  a{color:inherit;text-decoration:none}
  .wrap{max-width:900px;margin:0 auto;padding:30px 20px 60px}
  .top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--line);margin-bottom:26px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:17px}
  .mark{width:30px;height:30px;border-radius:4px;background:var(--ink);color:var(--paper);display:grid;place-items:center;font-size:15px}
  nav{display:flex;gap:14px;font-size:13px;color:var(--muted)}
  h1{font-family:var(--serif);font-size:clamp(24px,4vw,34px);line-height:1.18;font-weight:600;letter-spacing:-.5px}
  .lead{margin-top:10px;color:var(--muted);font-size:14.5px}
  ul{list-style:none;margin-top:22px}
  li{display:flex;gap:14px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--line)}
  .c{flex:0 0 210px;font-weight:600;font-size:14px}
  .c:hover{color:var(--accent)}
  .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:#2b2620}
  .t em{color:var(--dim);font-style:normal}
  .s{flex:0 0 110px;text-align:right;font-size:11.5px;color:var(--dim)}
  footer{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);font-size:12.5px;color:var(--dim);display:flex;gap:14px;flex-wrap:wrap}
  @media(max-width:620px){li{flex-wrap:wrap;gap:4px}.c{flex:1 0 100%}.s{display:none}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="brand" href="/"><span class="mark">🌍</span> Trends World</a>
    <nav><a href="/">World map</a><a href="/about/">About</a><a href="/feed.xml">RSS</a></nav>
  </header>
  <main>
    <h1>What's trending in every country</h1>
    <p class="lead">Today's top topic for ${countries.length} countries and regions — ${withData} have data in the current snapshot. Every row links to the country's page or its place on the map.</p>
    <ul>
${rows}
    </ul>
  </main>
  <footer>
    <a href="/">World map</a><a href="/countries/">All countries</a><a href="/about/">About</a><a href="/privacy/">Privacy</a><a href="/feed.xml">RSS</a>
    <span>Content rights belong to the original sources.</span>
  </footer>
</div>
</body>
</html>
`;
}

/* ---------------- Atom feed ---------------- */

function buildFeed({ clusters, generatedAt, countries }) {
  const updated = new Date(generatedAt || Date.now()).toISOString();
  const items = (clusters || []).slice(0, 12).map((c) => {
    const names = c.countries.slice(0, 6).map((iso) => iso).join(', ');
    const summary = `Trending as the #1 topic in ${c.count} ${c.count === 1 ? 'country' : 'countries'} (${names}${c.countries.length > 6 ? ', …' : ''}).`;
    const link = c.url || `${SITE}/`;
    return `  <entry>
    <title>${esc(c.title)}</title>
    <link href="${esc(link)}"/>
    <id>${SITE}/pulse/${encodeURIComponent(c.title).slice(0, 80)}</id>
    <updated>${updated}</updated>
    <summary>${esc(summary)}</summary>
  </entry>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Trends World — stories trending in several countries</title>
  <subtitle>The same topic topping the search list in more than one country, refreshed every 3 hours.</subtitle>
  <link href="${SITE}/feed.xml" rel="self"/>
  <link href="${SITE}/"/>
  <id>${SITE}/</id>
  <updated>${updated}</updated>
  <author><name>Trends World</name></author>
${items}
</feed>
`;
}

/* ---------------- main ---------------- */

const countries = readJson(path.join(DATA, 'countries.json'), []);
const board = readJson(path.join(DATA, 'board.json'), { countries: [] });
const pulse = readJson(path.join(DATA, 'global.json'), null);
const byIso = new Map(countries.map((c) => [c.iso, c]));
const updatedAt = board.generatedAt || Date.now();
const lastmod = new Date(updatedAt).toISOString().slice(0, 10);

const targets = process.argv.includes('--all') ? countries.map((c) => c.iso) : TARGETS;
const written = [];

for (const iso of targets) {
  const detail = readJson(path.join(DATA, 'details', `${iso}.json`), null);
  const country = byIso.get(iso);
  if (!country) continue;
  const topics = Array.isArray(detail?.topics) ? detail.topics : [];
  const source = detail?.source || null;
  const sourceLabel = topics[0]?.sourceLabel || (source === 'google-trends' ? 'Google Trends' : source);

  // 相关国家：同大洲优先，补足 8 个，用于站内互链
  const sameContinent = countries.filter((c) => c.iso !== iso && c.continent === country.continent && targets.includes(c.iso));
  const others = countries.filter((c) => c.iso !== iso && targets.includes(c.iso) && !sameContinent.includes(c));
  const related = [...sameContinent, ...others]
    .slice(0, 8)
    .map((c) => ({ iso: c.iso, name: c.nameEn }));

  const days = readHistory(CACHE_DIR, iso);

  const story =
    pulse?.clusters?.find((cl) => cl.countries?.includes(iso)) || null;

  const html = pageHtml({
    iso,
    country,
    topics,
    updatedAt: detail?.updatedAt || updatedAt,
    source,
    sourceLabel,
    related,
    pulse: story ? { title: story.title, count: story.count } : null,
    days,
  });

  const dir = path.join(PUBLIC, 'country', iso.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  written.push({ iso, path: `/country/${iso.toLowerCase()}/`, lastmod, changefreq: 'daily', priority: '0.8' });
}

// sitemap：主页 + 说明页 + 国家页，保证与实际生成的文件一致
const entries = [
  { path: '/', lastmod, changefreq: 'hourly', priority: '1.0' },
  { path: '/countries/', lastmod, changefreq: 'daily', priority: '0.9' },
  { path: '/about/', lastmod, changefreq: 'monthly', priority: '0.6' },
  { path: '/security/', lastmod, changefreq: 'yearly', priority: '0.3' },
  { path: '/privacy/', lastmod, changefreq: 'yearly', priority: '0.3' },
  { path: '/terms/', lastmod, changefreq: 'yearly', priority: '0.3' },
  ...written,
];
fs.writeFileSync(path.join(PUBLIC, 'sitemap.xml'), buildSitemap(entries));

// 全量国家索引页（176 行纯 HTML 内链）
const boardByIso = new Map((board?.countries || []).map((b) => [b.iso, b]));
const indexDir = path.join(PUBLIC, 'countries');
fs.mkdirSync(indexDir, { recursive: true });
fs.writeFileSync(
  path.join(indexDir, 'index.html'),
  buildCountriesIndex({ countries, boardByIso, targets }),
);

// Atom feed
fs.writeFileSync(
  path.join(PUBLIC, 'feed.xml'),
  buildFeed({ clusters: pulse?.clusters || [], generatedAt: updatedAt, countries }),
);
console.log('附带产物：/countries/index.html、/feed.xml');

console.log(`国家页：生成 ${written.length} 个（${written.map((w) => w.iso).join(', ')}）`);
console.log(`sitemap.xml：${entries.length} 条 URL，lastmod ${lastmod}`);
