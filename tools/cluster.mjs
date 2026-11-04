/**
 * Global Pulse —— 跨国家话题聚类
 *
 * 目的：找出「同一件事同时上了多个国家的热榜」。
 * 这是数据里最有故事性的信号，但被"逐个国家列清单"的界面埋没了。
 *
 * 做法（刻意保持简单，可解释、可调试）：
 *   1. 归一化标题 → 去掉标点、小写、拆 token
 *   2. 丢掉通用停用词（vs / fc / de / 直播…）和只有 1 个 token 的泛话题（"weather"）
 *   3. 用 token 集合的 Jaccard 相似度做贪心聚类
 *   4. 只保留覆盖 ≥2 个国家的话题簇
 */

/** 泛词：出现频率高但没有信息量，留着会把几十个国家糊成一团 */
const STOPWORDS = new Set([
  'vs', 'v', 'vs.', 'x', 'the', 'and', 'of', 'in', 'to', 'for', 'on', 'at', 'by', 'with',
  'fc', 'cf', 'sc', 'club', 'city', 'united', 'today', 'tomorrow', 'tonight', 'now',
  'de', 'la', 'el', 'le', 'du', 'des', 'der', 'die', 'das', 'los', 'las', 'il', 'un', 'une',
  'и', 'в', 'на', 'по', 'с', 'со',
  'news', 'update', 'updates', 'live', 'video', 'videos',
]);

/** 单 token 话题里的通用词：这类词同时上多国榜单毫无信息量 */
const GENERIC = new Set([
  'weather', 'sports', 'sport', 'lottery', 'lotto', 'news', 'results', 'result',
  'score', 'scores', 'live', 'tv', 'film', 'movie', 'music', 'game', 'match',
  'traffic', 'horoscope', 'poll', 'الطقس', 'погода', 'laululahing',
  'contrat', 'jugador', 'police', 'полиција', 'geisterfahrer',
]);

/** 归一化：小写、标点换空格、压缩空白 */
function normalize(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(word) {
  // 极轻量词干化：只处理复数，避免 elections/election 这种同一件事被拆成两簇
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function tokensOf(title) {
  const parts = normalize(title).split(' ').filter(Boolean);
  const out = new Set();
  for (const p of parts) {
    if (p.length < 2) continue;
    if (STOPWORDS.has(p)) continue;
    out.add(stem(p));
  }
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** "12,000+" / "1.2K" / "300+" → 数字，用于排序时加权 */
function parseTraffic(value) {
  const m = String(value || '').match(/([\d.]+)\s*([KMB]?)/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === 'K') return n * 1e3;
  if (unit === 'M') return n * 1e6;
  if (unit === 'B') return n * 1e9;
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {Array<{iso:string, nameEn:string, nameZhShort:string, source:string, topic:object}>} rows
 * @param {{threshold?:number, minCountries?:number, limit?:number}} opts
 */
const normKey = (title) => normalize(title).replace(/\s+/g, ' ').trim();

export function buildPulse(rows, opts = {}) {
  const threshold = opts.threshold ?? 0.55;
  const minCountries = opts.minCountries ?? 2;
  const limit = opts.limit ?? 10;
  // 这些短语同时出现在多国榜单里，通常只是同一个泛词的本地化变体，不构成跨国新闻
  const NOISE = /^(radio online|online radio|democratic party|radio|online|live score|table|standings)$/;

  const multi = [];
  const single = [];
  for (const row of rows) {
    const topic = row.topic;
    if (!topic?.title) continue;
    const tokens = tokensOf(topic.title);
    const item = { row, tokens, traffic: parseTraffic(topic.traffic), norm: normalize(topic.title) };
    if (tokens.size >= 2) multi.push(item);
    else if (tokens.size === 1) {
      const [only] = tokens;
      // 单 token 只在「非通用词」时才考虑，且只能精确同名或作为已有簇的子集加入
      if (!GENERIC.has(only)) single.push({ ...item, singleToken: only });
    }
  }

  // 先按热度降序，让最热的那条成为每个簇的代表标题
  multi.sort((a, b) => b.traffic - a.traffic);
  single.sort((a, b) => b.traffic - a.traffic);
  const candidates = multi;

  const clusters = [];
  for (const cand of candidates) {
    let best = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = jaccard(cand.tokens, cluster.tokens);
      if (score > bestScore) {
        bestScore = score;
        best = cluster;
      }
    }
    if (best && bestScore >= threshold) {
      best.members.push(cand);
      best.countries.add(cand.row.iso);
      // 用「更短但更完整」的标题当代表：短标题更可能是原始查询词
      if (cand.norm.length < best.norm.length) {
        best.title = cand.row.topic.title;
        best.norm = cand.norm;
      }
    } else {
      clusters.push({
        title: cand.row.topic.title,
        norm: cand.norm,
        tokens: cand.tokens,
        members: [cand],
        countries: new Set([cand.row.iso]),
      });
    }
  }

  // —— 第二轮：单 token 话题并入 ——
  // 规则：优先并进"包含该 token"的最热簇；否则单独累积，够 minCountries 才输出
  const singleBuckets = new Map();
  const alive = clusters.filter((c) => c.members.length > 0);
  for (const item of single) {
    const host = alive
      .filter((c) => c.tokens.has(item.singleToken))
      .sort((a, b) => b.countries.size - a.countries.size)[0];
    if (host) {
      host.members.push(item);
      host.countries.add(item.row.iso);
      continue;
    }
    if (!singleBuckets.has(item.singleToken)) {
      singleBuckets.set(item.singleToken, {
        title: item.row.topic.title,
        norm: item.norm,
        tokens: new Set([item.singleToken]),
        members: [],
        countries: new Set(),
      });
    }
    const bucket = singleBuckets.get(item.singleToken);
    bucket.members.push(item);
    bucket.countries.add(item.row.iso);
  }
  for (const bucket of singleBuckets.values()) {
    if (bucket.countries.size >= minCountries) clusters.push(bucket);
  }

  const out = clusters
    .filter((c) => c.countries.size >= minCountries && !NOISE.test(normKey(c.title)))
    .map((c) => {
      const countries = [...c.countries];
      const sources = {};
      let traffic = 0;
      for (const m of c.members) {
        sources[m.row.source || 'unknown'] = (sources[m.row.source || 'unknown'] || 0) + 1;
        traffic += m.traffic;
      }
      // 引用的原文链接：取簇内热度最高那条的 url
      const lead = c.members.find((m) => m.row.topic.url) || c.members[0];
      return {
        title: c.title,
        countries,
        count: countries.length,
        traffic,
        trafficLabel: lead.row.topic.traffic || '',
        url: lead.row.topic.url || '',
        source: lead.row.source || null,
        sources,
        names: c.members.map((m) => m.row.nameEn).filter(Boolean).slice(0, 40),
      };
    })
    .sort((a, b) => b.count - a.count || b.traffic - a.traffic)
    .slice(0, limit);

  return {
    generatedAt: Date.now(),
    scanned: rows.length,
    clustered: candidates.length,
    stories: out.length,
    clusters: out,
  };
}
