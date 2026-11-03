/**
 * 抓取调度器：优先级队列 + 串行节流 + 磁盘缓存 + 限流退避
 *
 * 背景（实测）：Google Trends 对突发并发请求会返回 302 -> /sorry/ 验证码页，
 * 因此这里所有外部请求都串行、带随机间隔，命中缓存直接返回，未命中先入队。
 *
 * 对外能力：
 *   get(country, {force, wait})  wait=false 时立刻返回缓存或 null 并排入队列
 *   prefetch(list, priority)     预热队列
 *   status()                    队列长度 / 限流状态 / 最近日志
 */
import fs from 'node:fs';
import path from 'node:path';
import { proxyFetch, detectProxy } from './proxy-agent.mjs';
import { UA, parseTrendsRss, parseBaiduHot, parseWikiTop, parseBingNews } from './sources.mjs';

const TTL_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 260;
const JITTER_MS = 220;
const WORKER_COUNT = 3;
const RATE_LIMIT_COOLDOWN = 8 * 60 * 1000;
const REQUEST_TIMEOUT = 25_000;

export class TrendStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.cacheDir = path.join(rootDir, 'data', 'cache');
    fs.mkdirSync(this.cacheDir, { recursive: true });

    this.memo = new Map();          // iso -> { at, iso, source, topics, errors }
    this.jobs = new Map();          // iso -> { promise, resolve, reject }
    this.queue = [];                // 待抓取任务
    this.queued = new Set();
    this.running = false;
    this.lastRequestAt = 0;
    this.blockedUntil = new Map();
    this.consecutiveFailures = new Map();
    this.sweep = { startedAt: null, finishedAt: null, total: 0, done: 0 };
    this.stats = { ok: 0, fail: 0, rateLimited: 0, requests: 0, startedAt: Date.now() };
    this.log = [];
  }

  proxy() {
    return detectProxy();
  }

  note(msg) {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
    this.log.unshift(line);
    if (this.log.length > 120) this.log.pop();
    console.log(line);
  }

  cachePath(iso) {
    return path.join(this.cacheDir, `${iso.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  readDisk(iso) {
    try {
      return JSON.parse(fs.readFileSync(this.cachePath(iso), 'utf8'));
    } catch {
      return null;
    }
  }

  writeDisk(iso, record) {
    const file = this.cachePath(iso);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record));
    fs.renameSync(tmp, file);
  }

  /** 返回仍在新窗口内的缓存记录，否则 null */
  fresh(iso) {
    const memo = this.memo.get(iso);
    if (memo && Date.now() - memo.at < TTL_MS) return memo;
    const disk = this.readDisk(iso);
    if (disk && Date.now() - disk.at < TTL_MS) {
      this.memo.set(iso, disk);
      return disk;
    }
    return null;
  }

  /** 旧数据也留着，抓取失败时可作降级展示 */
  stale(iso) {
    return this.memo.get(iso) || this.readDisk(iso);
  }

  async get(country, { force = false, wait = true } = {}) {
    if (!force) {
      const hit = this.fresh(country.iso);
      if (hit) return { ...hit, cached: true };
    }
    const job = this.jobFor(country, wait ? 'high' : 'low');
    if (!wait) return force ? job.promise : null;
    return job.promise;
  }

  jobFor(country, priority = 'high') {
    const existing = this.jobs.get(country.iso);
    if (existing) return existing;

    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    const job = { promise, resolve, reject, country, priority };
    this.jobs.set(country.iso, job);
    promise.finally(() => this.jobs.delete(country.iso)).catch(() => {});
    this.enqueue(job);
    return job;
  }

  enqueue(job) {
    if (this.queued.has(job.country.iso)) return;
    this.queued.add(job.country.iso);
    if (job.priority === 'high') this.queue.unshift(job);
    else this.queue.push(job);
    this.pump();
  }

  /** 预热：不关心结果，只把数据写进缓存 */
  prefetch(countries, priority = 'low') {
    for (const c of countries) {
      if (this.fresh(c.iso) || this.jobs.has(c.iso) || this.queued.has(c.iso)) continue;
      const job = {
        country: c,
        priority,
        promise: Promise.resolve(null),
        resolve: () => {},
        reject: () => {},
      };
      this.enqueue(job);
    }
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    const WORKERS = 3;
    const worker = async () => {
      while (this.queue.length) {
        const job = this.queue.shift();
        this.queued.delete(job.country.iso);
        try {
          const record = await this.fetchCountry(job.country);
          this.memo.set(job.country.iso, record);
          this.writeDisk(job.country.iso, record);
          this.stats.ok += 1;
          this.sweep.done += 1;
          job.resolve({ ...record, cached: false });
        } catch (err) {
          this.stats.fail += 1;
          this.sweep.done += 1;
          this.note(`✗ ${job.country.iso} ${String(err.message || err).slice(0, 200)}`);
          const old = this.stale(job.country.iso);
          if (old) {
            job.resolve({ ...old, stale: true, cached: true, error: String(err.message || err) });
          } else {
            job.reject(
              Object.assign(new Error(String(err.message || err)), {
                payload: { at: Date.now(), iso: job.country.iso, source: null, topics: [], error: String(err.message || err) },
                country: job.country,
              }),
            );
          }
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: WORKERS }, worker));
    } finally {
      this.running = false;
      // 竞态修复：worker 退出与新任务入队可能交错，补一次检查
      if (this.queue.length) this.pump();
    }
  }

  /** 全局节流：所有 worker 共享「最近一次请求时间」，保证整体请求速率有上限 */
  async throttle() {
    const gap = MIN_GAP_MS + Math.random() * JITTER_MS;
    const wait = this.lastRequestAt + gap - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
    this.stats.requests += 1;
  }

  async fetchCountry(country) {
    const errors = [];
    let topics = [];
    let source = null;

    // 1) Google Trends（覆盖 120+ 国家/地区）
    if (country.google && !this.isBlocked('google')) {
      try {
        const xml = await this.getText(`https://trends.google.com/trending/rss?geo=${country.iso}`, 'google');
        topics = parseTrendsRss(xml);
        if (topics.length) source = 'google-trends';
        else errors.push('google: 空结果');
      } catch (err) {
        errors.push(`google: ${err.message || err}`);
      }
    } else if (country.google) {
      errors.push('google: 限流冷却中');
    }

    // 2) 百度热搜（补充中国大陆，Google 不提供 CN）
    if (country.baidu && topics.length === 0) {
      try {
        const json = await this.getJson('https://top.baidu.com/api/board?platform=wise&tab=realtime', 'baidu');
        const baidu = parseBaiduHot(json);
        if (baidu.length) {
          topics = mergeUnique(baidu, topics).slice(0, 20);
          source = 'baidu';
        }
      } catch (err) {
        errors.push(`baidu: ${err.message || err}`);
      }
    }

    // 3) 维基百科浏览量兜底（仅对有统计数据的国家有意义）
    if (!topics.length && !this.isBlocked('wikipedia') && country.wiki !== false) {
      try {
        const json = await this.getJson(wikiUrl(country.iso), 'wikipedia');
        const wiki = parseWikiTop(json);
        if (wiki.length) { topics = wiki; source = 'wikipedia'; }
        else errors.push('wikipedia: 空结果');
      } catch (err) {
        errors.push(`wikipedia: ${err.message || err}`);
      }
    }

    // 4) Bing 新闻兜底（覆盖 Google / Wikipedia 都没有的小国）
    if (!topics.length && !this.isBlocked('bing')) {
      try {
        const html = await this.getText(bingUrl(country), 'bing');
        const news = parseBingNews(html, country.nameEn || country.nameZhShort);
        if (news.length) { topics = news; source = 'bing-news'; }
        else errors.push('bing: 空结果');
      } catch (err) {
        errors.push(`bing: ${err.message || err}`);
      }
    }

    if (!topics.length) throw new Error(errors.join(' | ') || '所有数据源均无结果');
    return { at: Date.now(), iso: country.iso, source, topics, errors };
  }

  isBlocked(source) {
    return Date.now() < (this.blockedUntil.get(source) || 0);
  }

  block(source, reason) {
    this.blockedUntil.set(source, Date.now() + RATE_LIMIT_COOLDOWN);
    this.stats.rateLimited += 1;
    this.note(`⚠ 限流冷却 ${source} ${RATE_LIMIT_COOLDOWN / 60000} 分钟：${reason}`);
  }

  /**
   * 取文本。Google 的 302 是「间歇性」的（同一代理下 US 302 而 JP 200），
   * 因此单次 302/429 只做快速重试；超时/网络错误直接放弃交给下一个数据源，
   * 避免 25s 超时 × 4 次重试把整个队列拖死。
   */
  async getText(url, source, { retries = 2 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(400 + attempt * 500 + Math.random() * 400);
      await this.throttle();
      let res;
      try {
        res = await proxyFetch(url, { headers: headersFor(source), timeout: REQUEST_TIMEOUT }, this.proxy());
      } catch (err) {
        // 网络层错误（超时/连接失败）重试一次就放弃
        if (attempt >= 1) throw err;
        lastErr = err;
        continue;
      }
      if (res.status === 302 || res.status === 429) {
        lastErr = new Error(`限流 HTTP ${res.status}`);
        this.consecutiveFailures.set(source, (this.consecutiveFailures.get(source) || 0) + 1);
        const n = this.consecutiveFailures.get(source);
        if (n >= 5) { this.block(source, `连续 ${n} 次 HTTP ${res.status}`); }
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (res.status === 404) throw lastErr; // 该国无数据，没有重试价值
        continue;
      }
      const text = await res.text();
      if (/google\.com\/sorry|unusual traffic|detected unusual traffic/i.test(text)) {
        lastErr = new Error('触发验证码页');
        this.consecutiveFailures.set(source, (this.consecutiveFailures.get(source) || 0) + 1);
        const n = this.consecutiveFailures.get(source);
        if (n >= 3) this.block(source, `连续 ${n} 次验证码页`);
        continue;
      }
      this.consecutiveFailures.set(source, 0);
      this.blockedUntil.delete(source);
      return text;
    }
    throw lastErr || new Error('请求失败');
  }

  async getJson(url, source) {
    return JSON.parse(await this.getText(url, source));
  }

  status() {
    const blocked = {};
    for (const [k, v] of this.blockedUntil) {
      const left = Math.round((v - Date.now()) / 1000);
      if (left > 0) blocked[k] = left;
    }
    return {
      ...this.stats,
      uptimeSec: Math.round((Date.now() - this.stats.startedAt) / 1000),
      queue: this.queue.length,
      inFlight: this.jobs.size,
      blocked,
      sweep: { ...this.sweep },
      proxy: (() => {
        const p = this.proxy();
        return p ? { host: p.host, port: p.port, source: p.source } : null;
      })(),
      log: this.log.slice(0, 12),
    };
  }
}

function headersFor(source) {
  if (source === 'wikipedia') {
    // Wikimedia 要求可识别的 UA，否则会被限流
    return {
      'user-agent': 'TrendsWorld/1.0 (https://github.com/trends-world; trends-world@example.com) nodejs',
      'accept-language': 'en;q=0.9',
      accept: 'application/json',
    };
  }
  const base = { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' };
  if (source === 'google') {
    return { ...base, accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8' };
  }
  if (source === 'baidu') {
    return { ...base, referer: 'https://top.baidu.com/board?tab=realtime' };
  }
  if (source === 'bing') {
    return { ...base, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' };
  }
  return base;
}

function bingUrl(country) {
  const q = `${country.nameEn} news`;
  return `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&form=NWRFSH&qft=sortbydate%3d%221%22`;
}

function wikiUrl(iso) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 2); // 维基统计约滞后 1~2 天
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/top-per-country/${iso}/all-access/${y}/${m}/${day}`;
}

function mergeUnique(primary, secondary) {
  const seen = new Set(primary.map((t) => t.title.toLowerCase()));
  const out = [...primary];
  for (const t of secondary) {
    const k = t.title.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.map((t, i) => ({ ...t, rank: i + 1 }));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
