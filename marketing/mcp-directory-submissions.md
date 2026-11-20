# MCP 目录提交包

目标：给 trends-world 拿几个**真实外链**。不是推广，是把「开放数据 + MCP 服务器」这件事登记到用户会去找它的地方。

> 截止 2026-11-20 的核实结果：Smithery 已于 10 月 31 日关闭托管与 CLI（并入 Arcade），
> 只剩目录页；因此下面的排序把「不需要 npm 包」的渠道放前面。

---

## 一、awesome-mcp-servers（首选，30 分钟）

仓库：https://github.com/punkpeye/awesome-mcp-servers

**为什么先做这个**：它是 MCP 领域流量最大的列表，一条 PR = 一个高权重站的真实外链，且要求你有公开 GitHub 仓库——我们正好有。

### 提交的改动

在 `README.md` 对应分类下**按字母序**插入一行（`T` 开头，位置靠后）：

```markdown
- [trends-world](https://github.com/kioolfranrip-glitch/trend-radar) 📇 🏠 - What 176 countries and regions are searching for right now, as static JSON. Four read-only tools: trending by country, cross-border stories, country search, snapshot freshness.
```

分类建议：**🔎 Search & Data Extraction**（如果列表里叫 `Search` 或 `Data`，就近放）。
**提交前请核对 README 顶部的图例**——本项目是 JavaScript + 本地 stdio，应为 `📇`（JS/TS）+ `🏠`（本地）。

### PR 标题

```
Add trends-world MCP server (176 countries, daily trending topics)
```

> 该仓库的 CONTRIBUTING 里有一条：如果由自动化 agent 提交，在标题末尾加 `🤖🤖🤖` 可以走快速合并。
> 我们是人工提交，**不加**。

### PR 描述

```markdown
Adds `trends-world`, a zero-dependency MCP server for daily trending topics.

**What it exposes**

| Tool | Arguments | Returns |
| --- | --- | --- |
| `trending_by_country` | `country`, `limit` | Ranked topics with search-volume bucket, source and original article URL |
| `global_pulse` | – | Stories that are #1 in several countries at once |
| `search_countries` | `query` | Matching countries and their current top topic |
| `snapshot_status` | – | Generation time, coverage out of 176, source mix, failures |

**Why it belongs here**

- 176 countries and regions — broader coverage than most trend servers
- Every entry links to the article that reported it; the server only indexes
- No API key, no auth, no rate limit: data is static JSON, refreshed every three hours
- Zero dependencies, stdio transport, `node mcp/trends-mcp.mjs` is the whole install
- Documentation at https://trends-world.pages.dev/api/ and a machine-readable
  summary at https://trends-world.pages.dev/llms.txt

**Notes**

- `google-trends` measures search interest, `bing-news` measures news interest;
  the tool output labels the source so the two are not mixed
- Search-volume values are source-side buckets (`200+`), not measurements
```

---

## 二、官方 MCP Registry（权威性最高，需要 npm 包）

注册表：https://registry.modelcontextprotocol.io

官方注册表只接受**已发布到 npm/PyPI 的包**或**远程 HTTP 端点**，不认裸 GitHub 仓库。所以要先把服务器发到 npm。

### 步骤

```bash
# 1. 登录 npm（一次性）
npm login

# 2. 在仓库里加 package.json（MCP 服务器单独发布）
```

`mcp/package.json`：

```json
{
  "name": "trends-world-mcp",
  "version": "1.0.0",
  "description": "Daily trending topics for 176 countries and regions, as MCP tools",
  "type": "module",
  "bin": { "trends-world-mcp": "./trends-mcp.mjs" },
  "files": ["trends-mcp.mjs"],
  "engines": { "node": ">=20" },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/kioolfranrip-glitch/trend-radar.git",
    "directory": "mcp"
  }
}
```

```bash
cd mcp && npm publish --access public

# 3. 用官方发布工具登记
#    macOS/Linux: brew install mcp-publisher
#    Windows: 从 registry 仓库 releases 下载 mcp-publisher.exe
mcp-publisher init      # 生成 server.json，按提示填
mcp-publisher publish   # 走 GitHub OAuth
```

`server.json` 大致长这样：

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json",
  "name": "io.github.kioolfranrip-glitch/trend-radar",
  "description": "Daily trending topics for 176 countries and regions",
  "version": "1.0.0",
  "repository": {
    "url": "https://github.com/kioolfranrip-glitch/trend-radar",
    "source": "github"
  },
  "packages": [
    {
      "registryType": "npm",
      "registryBaseUrl": "https://registry.npmjs.org",
      "identifier": "trends-world-mcp",
      "version": "1.0.0",
      "transport": { "type": "stdio" }
    }
  ]
}
```

**这一步的代价**：需要一个 npm 账号，而且要接受「包名公开占用」。如果你不想发 npm，跳过这一步——awesome 列表那条已经能拿到主要收益。

---

## 三、其他目录（10 分钟一个，填表即可）

| 站点 | 提交方式 | 备注 |
| --- | --- | --- |
| https://mcp.so | 网站右上角 Submit，填 GitHub 地址 | 中文团队运营，收录快 |
| https://www.pulsemcp.com | Submit 表单，贴仓库地址 | 偏开发者，质量较高 |
| https://glama.ai/mcp/servers | 提交 GitHub 仓库自动生成页面 | 自动抓 README 生成 |
| https://mcpservers.org | Submit 表单 | 面向普通用户 |

**通用提交文案**（三处都能用）：

```
Name: Trends World
Repo: https://github.com/kioolfranrip-glitch/trend-radar
Short description: Daily trending topics for 176 countries and regions, with links to the original articles.
Long description: A zero-dependency MCP server over a public static dataset. Four tools: trending_by_country, global_pulse, search_countries, snapshot_status. No API key, no auth, refreshed every three hours. Coverage is 176 countries and regions, broader than most trend sources. Every topic carries its source label and a link to the reporting article.
Category: Search / Data
Install: node mcp/trends-mcp.mjs (stdio)
```

---

## 四、别做的事

```
❌ 提交到 Smithery CLI —— 服务已停，CLI 已废弃
❌ 花钱买目录收录 —— 没有任何一家值得
❌ 群发冷邮件求收录 —— 这类列表只认 PR 和表单
❌ 在 PR 里解释 SEO 动机 —— 列表维护者只关心「对使用者有没有用」
```

---

## 五、做完之后看什么

不用看流量。只看两件事：

1. **PR 是否合并** —— 合并即得到一条真实外链
2. **GSC 里是否出现新的引用域**（引荐流量报表）

如果 11/27 前既没有合并、GSC 也没有任何引用变化，那说明「外链路线」在当前阶段也走不通，
到那时该考虑的是把项目作为作品集，而不是继续投入流量增长。
