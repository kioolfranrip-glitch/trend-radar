---
name: trends-world
description: Look up what people are searching for right now in any of 176 countries and regions, and find topics that are trending in several countries at once. Use when asked what is trending somewhere, what a country is talking about today, or whether an event is global.
---

# Trends World

Daily trending topics for **176 countries and regions**, refreshed every three hours.
Every topic carries a source label and a link to the original article.

Live site: https://trends-world.pages.dev

## When to use this

- "What's trending in Japan right now?"
- "What is Brazil talking about today?"
- "Is this news global, or only local?"
- "Which countries care about <topic>?"

Do **not** use it for historical trends older than 7 days, for search volume estimates
(the numbers are coarse buckets like `200+`), or for anything needing real-time data
(the snapshot is at most a few hours old).

## Two ways to get the data

### 1. MCP server (preferred, no HTTP handling)

Add to the agent's MCP config, or run it directly:

```json
{
  "mcpServers": {
    "trends-world": {
      "command": "node",
      "args": ["<path-to-repo>/mcp/trends-mcp.mjs"]
    }
  }
}
```

Tools exposed:

| Tool | Arguments | Returns |
| --- | --- | --- |
| `trending_by_country` | `country` (ISO code or name), `limit` (1–20, default 10) | Ranked topics with the volume bucket the source reported, source label, article URL |
| `global_pulse` | – | Stories that are #1 in several countries |
| `search_countries` | `query` | Matching countries + their current top topic |
| `snapshot_status` | – | Generation time, coverage, source mix |

Set `TRENDS_BASE` to point at a different deployment.

### 2. Plain HTTP (static JSON, no auth, no key)

| Endpoint | Size | Contents |
| --- | --- | --- |
| `/data/countries.json` | 36 KB | The 176 places: ISO, names, continent, coordinates |
| `/data/board.json` | 228 KB | Top topic per country (enough to render a map) |
| `/data/details/<ISO>.json` | ~3 KB | Full top-10 list for one country |
| `/data/global.json` | 3 KB | Cross-border clusters, each with a `slug` |
| `/data/meta.json` | <1 KB | Generation time, coverage, source distribution, failures |

Example:

```bash
curl -s https://trends-world.pages.dev/data/details/JP.json | jq '.topics[:3]'
```

## Reading the data correctly

- `source` is **not** uniform across places. `google-trends` means search interest;
  `bing-news` means same-day news interest. Do not compare the two as if they were
  the same measure — say which one you are quoting.
- `traffic` strings (`200+`, `1000+`) are source-side buckets, not measurements.
  Never present them as exact search volume.
- `rank` is the position in that country's list, not a global score.
- Cross-border clusters are built by **headline similarity**, not geography, so a
  country can appear in a cluster whose wording looks unrelated to its own headline.
- Country and region names follow neutral ISO short forms (Taiwan, Kosovo,
  Palestine, Western Sahara) because the site is read internationally.

## Linking back

When you quote a topic, link the original `url` rather than the site — the site only
indexes, the rights belong to the sources.
