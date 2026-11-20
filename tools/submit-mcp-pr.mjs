#!/usr/bin/env node
/**
 * 向 punkpeye/awesome-mcp-servers 提交一行 PR。
 *
 *   node tools/submit-mcp-pr.mjs            # 只检查：打印 token 权限、分类标题、插入位置
 *   node tools/submit-mcp-pr.mjs --apply    # 真的 fork + 提交 + 开 PR
 *
 * 需要本机 git 凭据（wincred 里的 github token）。
 */
import { execFileSync } from 'node:child_process';

const OWNER = 'punkpeye';
const REPO = 'awesome-mcp-servers';
const BASE = 'main';
const APPLY = process.argv.includes('--apply');

const CATEGORY_RE = /name="search"|Search & Data Extraction/i; // 目标分类：搜索与数据抽取

const ENTRY =
  '- [kioolfranrip-glitch/trend-radar](https://github.com/kioolfranrip-glitch/trend-radar) 📇 🏠 - ' +
  'What 176 countries and regions are searching for right now, as static JSON. ' +
  'Four read-only tools: trending by country, cross-border stories, country search, snapshot freshness. ' +
  'Install: `node mcp/trends-mcp.mjs`.';

const PR_TITLE = 'Add trends-world MCP server (176 countries, daily trending topics)';

const PR_BODY = `Adds \`trends-world\`, a zero-dependency MCP server for daily trending topics.

**What it exposes**

| Tool | Arguments | Returns |
| --- | --- | --- |
| \`trending_by_country\` | \`country\`, \`limit\` | Ranked topics with search-volume bucket, source and original article URL |
| \`global_pulse\` | – | Stories that are #1 in several countries at once |
| \`search_countries\` | \`query\` | Matching countries and their current top topic |
| \`snapshot_status\` | – | Generation time, coverage out of 176, source mix, failures |

**Why it fits the list**

- 176 countries and regions — broader coverage than most trend servers
- Every entry links to the article that reported it; the server only indexes
- No API key, no auth, no rate limit: data is static JSON, refreshed every three hours
- Zero dependencies, stdio transport, \`node mcp/trends-mcp.mjs\` is the whole install
- Docs at https://trends-world.pages.dev/api/ and a machine-readable summary at
  https://trends-world.pages.dev/llms.txt

**Note on the badge**

Other entries carry a Glama score badge; this repo is not indexed there yet, so the
entry has none. Happy to add it once it is.

**Notes on the data**

- \`google-trends\` measures search interest, \`bing-news\` measures news interest; the
  output labels the source so the two are never mixed
- Search-volume values are source-side buckets (\`200+\`), not measurements`;

/* ---------------- helpers ---------------- */

function token() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error('取不到 GitHub 凭据（wincred 里没有）');
  return m[1].trim();
}

const TOKEN = token();

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `token ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'trends-world-submit',
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${json?.message || text.slice(0, 200)}`);
  }
  return json;
}

/* ---------------- 1. 身份与权限 ---------------- */

const me = await api('/user');
console.log(`登录为: ${me.login} (id ${me.id})`);

/* ---------------- 2. 抓 README，定位分类与插入点 ---------------- */

const raw = await (await fetch(`https://raw.githubusercontent.com/${OWNER}/${REPO}/${BASE}/README.md`)).text();
const lines = raw.split('\n');
console.log(`README: ${lines.length} 行`);

const headings = lines
  .map((l, i) => ({ l, i }))
  .filter(({ l }) => /^#{2,3}\s/.test(l))
  .filter(({ l }) => CATEGORY_RE.test(l));
console.log('匹配「search/data」的标题:');
for (const h of headings) console.log(`  ${h.i}: ${h.l.trim()}`);

if (!headings.length) {
  console.error('没找到目标分类，停止');
  process.exit(1);
}
const cat = headings[0];
console.log(`\n选用分类: ${cat.l.trim()} (line ${cat.i})`);

// 打印该分类前 3 条真实条目，用来核对格式
let shown = 0;
for (let i = cat.i + 1; i < lines.length && shown < 3; i += 1) {
  if (/^##\s/.test(lines[i])) break;
  if (/^-\s+\[/.test(lines[i])) {
    console.log(`  样例: ${lines[i]}`);
    shown += 1;
  }
}

// 该分类下的第一个二级标题（作为区块结束）
let end = lines.length;
for (let i = cat.i + 1; i < lines.length; i += 1) {
  if (/^##\s/.test(lines[i])) {
    end = i;
    break;
  }
}

// 找字母序插入点：只比较以 "- [" 开头的条目
const isEntry = (l) => /^-\s+\[/.test(l);
const nameOf = (l) => {
  const m = l.match(/^-\s+\[([^\]]+)\]/);
  return (m ? m[1] : '').toLowerCase();
};
const target = nameOf(ENTRY);

let insertAt = -1;
for (let i = cat.i + 1; i < end; i += 1) {
  if (!isEntry(lines[i])) continue;
  if (nameOf(lines[i]) > target) {
    insertAt = i;
    break;
  }
}
if (insertAt === -1) {
  // 没有更大的，插到该分类最后一个条目之后
  for (let i = end - 1; i > cat.i; i -= 1) {
    if (isEntry(lines[i])) {
      insertAt = i + 1;
      break;
    }
  }
}
if (insertAt === -1) {
  console.error('分类里没有条目，无法确定插入位置');
  process.exit(1);
}

console.log('\n插入位置前后：');
for (let i = Math.max(0, insertAt - 2); i < Math.min(lines.length, insertAt + 2); i += 1) {
  console.log(`  ${i === insertAt ? '>>> ' : '    '}${lines[i].slice(0, 120)}`);
}
console.log(`\n新增行:\n  ${ENTRY}`);

if (!APPLY) {
  console.log('\n（检查模式，未提交。加 --apply 执行）');
  process.exit(0);
}

/* ---------------- 3. fork ---------------- */

console.log('\n正在 fork…');
let fork = null;
try {
  fork = await api(`/repos/${OWNER}/${REPO}/forks`, { method: 'POST', body: '{}' });
} catch (err) {
  console.log(`fork 失败（可能已存在）: ${err.message}`);
}
const forkOwner = me.login;
// fork 可能还没就绪，轮询几次
for (let attempt = 0; attempt < 12; attempt += 1) {
  try {
    await api(`/repos/${forkOwner}/${REPO}`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 4000));
  }
}
console.log(`fork: ${forkOwner}/${REPO}`);

/* ---------------- 4. 建分支 + 改 README + 开 PR ---------------- */

const branch = 'add-trends-world-mcp';
const baseRef = await api(`/repos/${forkOwner}/${REPO}/git/ref/heads/${BASE}`);
const baseSha = baseRef.object.sha;

// 分支已存在就复用，否则新建
try {
  await api(`/repos/${forkOwner}/${REPO}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });
  console.log(`分支已创建: ${branch}`);
} catch (err) {
  console.log(`分支可能已存在，继续: ${err.message}`);
}

const next = [...lines];
next.splice(insertAt, 0, ENTRY);
const newContent = next.join('\n');

const fileMeta = await api(`/repos/${forkOwner}/${REPO}/contents/README.md?ref=${branch}`);
const put = await api(`/repos/${forkOwner}/${REPO}/contents/README.md`, {
  method: 'PUT',
  body: JSON.stringify({
    message: 'Add trends-world MCP server',
    content: Buffer.from(newContent, 'utf8').toString('base64'),
    sha: fileMeta.sha,
    branch,
  }),
});
console.log(`已提交: ${put.commit.sha.slice(0, 7)}`);

const pr = await api(`/repos/${OWNER}/${REPO}/pulls`, {
  method: 'POST',
  body: JSON.stringify({
    title: PR_TITLE,
    head: `${forkOwner}:${branch}`,
    base: BASE,
    body: PR_BODY,
  }),
});

console.log(`\n✅ PR 已创建: ${pr.html_url}`);
