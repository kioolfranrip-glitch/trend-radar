/**
 * 数据源层：把 "某国今天最热的话题" 变成统一结构
 *
 * 统一话题结构:
 *   { rank, title, traffic, source, sourceLabel, url, news: [{title, url, source, picture}] }
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* ------------------------------------------------------------------ *
 * 1. Google Trends 每日热搜 RSS（覆盖 120+ 国家/地区，质量最高）
 * ------------------------------------------------------------------ */

function decodeEntities(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** 取出 <tag>...</tag>，ht: 前缀的标签按本地名匹配 */
function tag(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = xml.match(re);
  return m ? decodeEntities(m[1].trim()) : '';
}

function allTags(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1].trim()));
  return out;
}

function allBlocks(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/** 解析 Google Trends 每日热搜 RSS XML -> 话题数组 */
export function parseTrendsRss(xml) {
  const items = allBlocks(xml, 'item');
  const topics = [];
  for (const item of items) {
    const title = tag(item, 'title');
    if (!title) continue;
    const news = allBlocks(item, 'ht:news_item')
      .map((n) => ({
        title: tag(n, 'ht:news_item_title'),
        url: tag(n, 'ht:news_item_url'),
        source: tag(n, 'ht:news_item_source'),
        picture: tag(n, 'ht:news_item_picture'),
      }))
      .filter((n) => n.url);
    const primary = news[0]?.url || searchUrl(title);
    topics.push({
      rank: topics.length + 1,
      title,
      traffic: tag(item, 'ht:approx_traffic') || '',
      source: 'google-trends',
      sourceLabel: 'Google Trends',
      url: primary,
      searchUrl: searchUrl(title),
      picture: tag(item, 'ht:picture') || news[0]?.picture || '',
      pictureSource: tag(item, 'ht:picture_source') || news[0]?.source || '',
      pubDate: tag(item, 'pubDate'),
      news: news.slice(0, 6),
    });
  }
  return topics;
}

function searchUrl(q, geo) {
  const host = geo ? `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en` : `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  return host;
}

/* ------------------------------------------------------------------ *
 * 2. 百度热搜（中国大陆，Google Trends 不提供 CN）
 * ------------------------------------------------------------------ */

export function parseBaiduHot(json) {
  const list = json?.data?.cards?.find((c) => c.component === 'tabTextList')?.content?.[0]?.content || [];
  const topics = [];
  for (const item of list) {
    const title = (item.word || '').trim();
    if (!title) continue;
    topics.push({
      rank: topics.length + 1,
      title,
      traffic: item.hotTag === '1' ? '热' : item.newHotName || '',
      source: 'baidu',
      sourceLabel: 'Baidu',
      url: item.url || `https://m.baidu.com/s?word=${encodeURIComponent(title)}`,
      searchUrl: item.url || `https://m.baidu.com/s?word=${encodeURIComponent(title)}`,
      picture: '',
      news: [],
    });
  }
  return topics;
}

/* ------------------------------------------------------------------ *
 * 3. 维基百科当日浏览量 Top（全球所有国家都有数据，作为兜底）
 * ------------------------------------------------------------------ */

const WIKI_SKIP = new Set([
  'Main_Page', 'Wikipedia:Featured_pictures', 'Special:Search', 'Wikipedia',
  'Wikipedia:Contents', 'Portal:Current_events', 'Wikipedia:Community_portal',
  'Special:CreateAccount', 'Special:Log/block', 'Wikipedia:About',
  'Wikipedia:Contact_us', 'File:Commons-logo.svg', 'Wikipedia:File_Upload_Wizard',
  'Special:CentralLogin/start', 'Special:UserLogin', 'Wikipedia:Featured_pictures/People',
]);

/** 各语言维基的「首页 / 门户 / 特殊页」标题，这些一定不是热门话题 */
const WIKI_SKIP_PATTERNS = [
  /^[A-Za-z]+:.*(Accueil|Portada|Hauptseite|Hoofdpagina|Strona_główna|Pagina_principale|Главная_страница|メインページ|대문|首頁|首页|Pagina_principal|Ana_Sayfa|Baş_Sayfa|Főoldal|Etusivu|Forside|Hovedside|Framsida|Página_principal|Pagina_iniziale|Página_principal)/i,
  /^(Halaman_Utama|Halaman_utama|Laman_Utama|Trang_Chính|Wikipédia:.*|Wikipedia:.*|Wiktionary:.*|Wikinews:.*|Portal:.*|Special:.*|Spesiaal:.*|Speciaal:.*|Spezial:.*|Spesial:.*|Especial:.*|Special:.*|Espesyal:.*|خاص:.*|특수:.*|特別:.*|特別ページ.*)$/,
  /(Search|Recherche|Suche|Busca|Cerca|Búsqueda|Поиск|検索|검색|搜尋|搜索|Zoeken)/i,
  /^(Main_Page|Portada|Hauptseite|Hoofdpagina|Strona_główna|Pagina_principale|Главная_страница|メインページ|대문|首頁|Página_principal|Pagina_principal|Főoldal|Etusivu|Forside|Hovedsiden|Framsida|Ana_Sayfa|Baş_Sayfa|Anasayfa|Pagina_principal|Página_inicial|Pagina_principal|Glavna_stranica|Hlavní_strana|Strona_główna|Pagrindinis_puslapis|Sākumlapa|Pradžia|Головна_сторінка|Басты_бет|Ana_səhifə|Галоўная_старонка|Pagrindinis|Pealeht|Sākumlapa)$/i,
  /^(Wikipedia|Wikipédia|Wikipedia_en_español|Wikipedia_en_português|Wikipedia_in_italiano)$/i,
];

function isWikiJunk(article, title) {
  if (WIKI_SKIP.has(article)) return true;
  if (!title || title.length < 2) return true;
  if (WIKI_SKIP_PATTERNS.some((re) => re.test(article) || re.test(title))) return true;
  if (/^(Special|Spesial|Spezial|Especial|Spesiaal|Speciaal|خاص|특수|特別|特别)[:_]/i.test(article)) return true;
  if (/^Wikipedia:|^Wikipédia:|^Portal:|^File:|^Category:|^Help:|^Talk:/i.test(article)) return true;
  return false;
}

function wikiLang(project = '') {
  return project.replace(/\.(wikipedia|wiktionary|wikinews|wikibooks|wikiquote|wikisource)$/, '') || 'en';
}

export function parseWikiTop(json) {
  const items = json?.items?.[0];
  const articles = items?.articles || [];
  const topics = [];
  for (const a of articles) {
    if (topics.length >= 10) break;
    const raw = a.article || '';
    const title = raw.replace(/_/g, ' ');
    if (isWikiJunk(raw, title)) continue;
    const lang = wikiLang(a.project);
    const views = Number(a.views || 0);
    topics.push({
      rank: topics.length + 1,
      title,
      traffic: views >= 1000 ? `${(views / 1000).toFixed(views >= 10000 ? 0 : 1)}K` : String(views || ''),
      views,
      source: 'wikipedia',
      sourceLabel: 'Wikipedia pageviews',
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(raw)}`,
      searchUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(raw)}`,
      picture: '',
      news: [],
    });
  }
  return topics;
}

/* ------------------------------------------------------------------ *
 * 4. Bing 新闻（Google Trends 不覆盖的小国兜底）
 * ------------------------------------------------------------------ */

export function parseBingNews(html, countryName) {
  const out = [];
  const seen = new Set();
  // 每条结果：<a class="title" ... href="URL" ...>标题</a>
  const re = /<a[^>]*class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 10) {
    const url = decodeEntities(m[1]);
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
    if (!title || title.length < 8 || !/^https?:\/\//.test(url)) continue;
    const key = title.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      rank: out.length + 1,
      title,
      traffic: '',
      source: 'bing-news',
      sourceLabel: `Bing News · ${countryName}`,
      url,
      searchUrl: url,
      picture: '',
      news: [],
    });
  }
  return out;
}

export { UA, decodeEntities };
