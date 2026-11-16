#!/usr/bin/env node
/**
 * Trends World — MCP server (stdio, zero dependencies)
 *
 * 让 AI agent 直接查询「今天某国在搜什么」，不用自己抓网页。
 *
 * 用法（在 agent 的 MCP 配置里）：
 *   {
 *     "mcpServers": {
 *       "trends-world": { "command": "node", "args": ["/path/to/trends-mcp.mjs"] }
 *     }
 *   }
 *
 * 数据来自公开静态接口，自带 10 分钟内存缓存。
 * 可用 TRENDS_BASE 覆盖数据源（默认 https://trends-world.pages.dev）。
 *
 * 手动调试：
 *   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp/trends-mcp.mjs
 */
import process from 'node:process';
import readline from 'node:readline';

const BASE = (process.env.TRENDS_BASE || 'https://trends-world.pages.dev').replace(/\/$/, '');
const VERSION = '1.0.0';
const PROTOCOL = '2024-11-05';
const TTL_MS = 10 * 60 * 1000;

/* ---------------- 数据获取（带缓存） ---------------- */

const cache = new Map();

async function getJson(pathname) {
  const hit = cache.get(pathname);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const res = await fetch(`${BASE}${pathname}`, {
    headers: { accept: 'application/json', 'user-agent': `trends-world-mcp/${VERSION}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}`);
  const value = await res.json();
  cache.set(pathname, { at: Date.now(), value });
  return value;
}

/** 国家列表（176 条） */
const countries = () => getJson('/data/countries.json');
/** 每国 Top1 */
const board = () => getJson('/data/board.json');
/** 跨国故事聚类 */
const pulse = () => getJson('/data/global.json');
/** 快照元信息 */
const meta = () => getJson('/data/meta.json');
/** 单国完整热榜 */
const detail = (iso) => getJson(`/data/details/${iso.toUpperCase()}.json`);

/* ---------------- 工具实现 ---------------- */

function resolveCountry(list, input) {
  const q = String(input || '').trim();
  if (!q) throw new Error('country is required (ISO code, English or Chinese name)');
  const lower = q.toLowerCase();

  const exact = list.find(
    (c) =>
      c.iso.toLowerCase() === lower ||
      c.iso3?.toLowerCase() === lower ||
      c.nameEn?.toLowerCase() === lower ||
      c.nameZh === q ||
      c.nameZhShort === q,
  );
  if (exact) return exact;

  const partial = list.filter(
    (c) =>
      c.nameEn?.toLowerCase().includes(lower) ||
      c.nameZh?.includes(q) ||
      c.nameZhShort?.includes(q) ||
      c.nameLocal?.toLowerCase().includes(lower),
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `"${q}" matches ${partial.length} places: ${partial
        .slice(0, 8)
        .map((c) => `${c.iso} ${c.nameEn}`)
        .join(', ')}${partial.length > 8 ? ', …' : ''}. Use an ISO code.`,
    );
  }
  throw new Error(`No country matched "${q}". Use search_countries to find the ISO code.`);
}

function fmtTopics(topics, limit = 10) {
  return topics
    .slice(0, limit)
    .map((t) => {
      const traffic = t.traffic ? ` · ${t.traffic} searches` : '';
      const src = t.sourceLabel ? ` · ${t.sourceLabel}` : '';
      return `${t.rank}. ${t.title}${traffic}${src}\n   ${t.url}`;
    })
    .join('\n');
}

async function toolTrending({ country, limit }) {
  const [list] = await Promise.all([countries()]);
  const c = resolveCountry(list, country);
  const d = await detail(c.iso);
  const topics = d.topics || [];
  if (!topics.length) {
    return `${c.nameEn} (${c.iso}) has no topics in the current snapshot.`;
  }
  const updated = new Date(d.updatedAt || Date.now()).toISOString().replace('T', ' ').slice(0, 16);
  const n = Math.min(Number(limit) || 10, topics.length);
  return [
    `# Top trending topics in ${c.nameEn} (${c.iso})`,
    `Snapshot: ${updated} UTC · source: ${d.source || topics[0]?.sourceLabel || 'unknown'} · showing ${n} of ${topics.length}`,
    '',
    fmtTopics(topics, n),
    '',
    `Page: ${BASE}/country/${c.iso.toLowerCase()}/`,
  ].join('\n');
}

async function toolPulse() {
  const p = await pulse();
  const clusters = p.clusters || [];
  if (!clusters.length) return 'No cross-border stories in the current snapshot.';
  const updated = new Date(p.generatedAt || Date.now()).toISOString().replace('T', ' ').slice(0, 16);
  const body = clusters
    .map(
      (c) =>
        `- ${c.title} — #1 in ${c.count} countries (${(c.countries || []).join(', ')})\n  ${BASE}/topic/${c.slug}/`,
    )
    .join('\n');
  return `# Stories trending in several countries\nSnapshot: ${updated} UTC · ${clusters.length} stories\n\n${body}`;
}

async function toolSearch({ query }) {
  const [list, b] = await Promise.all([countries(), board()]);
  const q = String(query || '').trim().toLowerCase();
  if (!q) throw new Error('query is required');

  const topByIso = new Map((b.countries || []).map((r) => [r.iso, r.top]));
  const hits = list
    .filter(
      (c) =>
        c.iso.toLowerCase().includes(q) ||
        c.nameEn?.toLowerCase().includes(q) ||
        c.nameZh?.includes(query) ||
        c.nameZhShort?.includes(query),
    )
    .slice(0, 25);

  if (!hits.length) return `No country matched "${query}".`;
  const rows = hits.map((c) => {
    const top = topByIso.get(c.iso);
    return `- ${c.iso} · ${c.nameEn} · ${c.nameZhShort || c.nameZh}${top ? ` → ${top.title}` : ' → no data'}`;
  });
  return `${hits.length} match(es) for "${query}":\n\n${rows.join('\n')}`;
}

async function toolSnapshot() {
  const [m, b] = await Promise.all([meta(), board()]);
  const rows = (b.countries || []).filter((r) => r.top);
  const updated = new Date(m.generatedAt || Date.now()).toISOString().replace('T', ' ').slice(0, 16);
  const sources = Object.entries(m.sources || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
  return [
    '# Trends World — current snapshot',
    `Generated: ${updated} UTC · crawl took ${m.tookSeconds}s`,
    `Coverage: ${rows.length} of ${m.requested} places have data${m.failed?.length ? ` · failed: ${m.failed.join(', ')}` : ' · no failures'}`,
    `Sources: ${sources}`,
    '',
    'Endpoints: /data/countries.json, /data/board.json, /data/details/<ISO>.json, /data/global.json, /data/meta.json',
    `Site: ${BASE}/`,
  ].join('\n');
}

/* ---------------- MCP 协议 ---------------- */

const TOOLS = [
  {
    name: 'trending_by_country',
    description:
      "Get the top trending topics for one country or region right now. Returns ranked topics with search volume, source and a link to the original article. Use an ISO 3166-1 alpha-2 code (JP, US, BR) or a name (Japan, 日本).",
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 code, or English/Chinese country name' },
        limit: { type: 'number', description: 'How many topics to return (default 10, max 20)' },
      },
      required: ['country'],
    },
  },
  {
    name: 'global_pulse',
    description:
      'List the stories that are simultaneously the #1 trending topic in more than one country. Useful for spotting events with international reach.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_countries',
    description:
      'Find country ISO codes by name, and see what each one is currently trending on. Use this when you do not know the exact code.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Country name or partial name' } },
      required: ['query'],
    },
  },
  {
    name: 'snapshot_status',
    description:
      'Check how fresh the data is: generation time, coverage out of 176 places, source distribution and any failures. Call this first if freshness matters.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const HANDLERS = {
  trending_by_country: toolTrending,
  global_pulse: toolPulse,
  search_countries: toolSearch,
  snapshot_status: toolSnapshot,
};

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'trends-world', version: VERSION },
        instructions:
          `Daily trending topics for 176 countries and regions, from ${BASE}. ` +
          'Call snapshot_status first if you need to know how fresh the data is.',
      },
    };
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const fn = HANDLERS[name];
    if (!fn) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } };
    }
    try {
      const text = await fn(params?.arguments || {});
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true },
      };
    }
  }

  if (method?.startsWith('notifications/')) return null;

  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const res = await handle(msg);
  if (res) send(res);
});
