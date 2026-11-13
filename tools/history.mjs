/**
 * 每日快照历史
 *
 * 国家页原本只是「当天 Top10 列表」，对搜索引擎来说是一个每天替换内容的目录页。
 * 存下最近 7 天的快照后，页面可以显示「新进榜 / 上升 / 下降」和近期榜首变化，
 * 从"列表"变成"有历史的数据页"。
 *
 * 存放位置：data/cache/history/<ISO>.json
 *   —— data/cache 是整个 CI 里被 actions/cache 缓存的目录，跨运行累积；
 *      历史只用于构建期渲染，不需要部署到站点。
 */
import fs from 'node:fs';
import path from 'node:path';

export const MAX_DAYS = 7;

const isoDate = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

function historyPath(cacheDir, iso) {
  return path.join(cacheDir, 'history', `${iso}.json`);
}

/** 读取某国历史（按日期升序） */
export function readHistory(cacheDir, iso) {
  try {
    const raw = JSON.parse(fs.readFileSync(historyPath(cacheDir, iso), 'utf8'));
    const days = Array.isArray(raw?.days) ? raw.days : [];
    return days
      .filter((d) => d && d.date && Array.isArray(d.topics))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  } catch {
    return [];
  }
}

/**
 * 追加/覆盖某一天的快照，并只保留最近 MAX_DAYS 天。
 * 同一天重复运行（CI 每 3 小时一次）时覆盖当天，不会重复累积。
 */
export function appendHistory({ cacheDir, iso, topics, source, at = Date.now() }) {
  if (!Array.isArray(topics) || !topics.length) return readHistory(cacheDir, iso);

  const date = isoDate(at);
  const entry = {
    date,
    source: source || null,
    topics: topics.map((t) => ({
      title: t.title,
      rank: t.rank,
      traffic: t.traffic || null,
    })),
  };

  const days = readHistory(cacheDir, iso).filter((d) => d.date !== date);
  days.push(entry);
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  const kept = days.slice(-MAX_DAYS);

  const file = historyPath(cacheDir, iso);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ iso, days: kept }));
  return kept;
}

/**
 * 比较今天与上一个有记录的日子，给每个话题算出变化。
 * @returns {Map<string, {status:'new'|'up'|'down'|'same', delta:number}>}
 */
export function diffTopics(today, days) {
  const out = new Map();
  const todayDate = days.length ? days[days.length - 1].date : null;
  const previous = [...days].reverse().find((d) => d.date !== todayDate);
  const prevRank = new Map();
  if (previous) {
    for (const t of previous.topics) prevRank.set(normalize(t.title), Number(t.rank) || 0);
  }
  for (const t of today) {
    const key = normalize(t.title);
    const before = prevRank.get(key);
    const now = Number(t.rank) || 0;
    if (!before) {
      out.set(key, { status: 'new', delta: 0, previous: null });
    } else if (now < before) {
      out.set(key, { status: 'up', delta: before - now, previous: before });
    } else if (now > before) {
      out.set(key, { status: 'down', delta: now - before, previous: before });
    } else {
      out.set(key, { status: 'same', delta: 0, previous: before });
    }
  }
  return out;
}

/** 归一化标题，用于跨天比对（大小写/标点差异不算变化） */
export function normalize(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 每天榜首话题，供页面写「近期榜首」 */
export function dailyLeaders(days) {
  return days
    .map((d) => {
      const top = d.topics.find((t) => Number(t.rank) === 1) || d.topics[0];
      return top ? { date: d.date, title: top.title, traffic: top.traffic } : null;
    })
    .filter(Boolean);
}
