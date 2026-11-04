# r/MapPorn 发帖材料

> Reddit 当前对你的出口 IP 返回 403（`blocked by network security`）。
> 材料先备好，换到能通的节点后 2 分钟就能发。

## 图片

`marketing/reddit-map.png`（1549×949）

重新生成（数据会跟着更新）：

```bash
node tools/crawl.mjs --use-cache        # 刷新 local data
DEBUG_BOX=1 node tools/make-postmap.mjs # 出带定位框版本 → 截图
node tools/make-postmap.mjs             # 出干净版本 → 截图 → 裁切
```

---

## 标题（选一个）

**A（推荐，说明性最强）**
```
The single most-searched topic in every country right now, coloured by story [OC]
```

**B（新闻钩子）**
```
One basketball game is the #1 search in 9 countries today — here's the full map [OC]
```

**C（极简派）**
```
What the world is searching for, coloured by shared story [OC]
```

r/MapPorn 的标题规范：描述清楚 + `[OC]` 标注原创。**不要在标题里放链接或"看我的网站"。**

---

## 第一个评论（发完立刻自己发，很重要）

r/MapPorn 有个不成文规矩：作者要在评论里交代数据来源和方法。写了会被顶上去，不写会被人问、也可能被 mod 删。

```markdown
Data and method, since people always ask:

**Source.** The top trending search for each country comes from Google's daily
trends RSS feed, one per country (Google publishes these for 122 countries).
For the remaining places there's no Google feed at all, so I fall back to Bing
News top stories, Wikipedia page views, or Baidu's hot list depending on the
region — each row on the site is labelled with the source it actually came from,
rather than pretending they're all search data.

**Grey countries** have a topic that doesn't appear in any other country's top
topic. Coloured countries share a story: I normalise the headlines (strip
punctuation, drop generic words like "vs" and "fc"), then cluster by token
overlap. It's deliberately simple — a proper semantic model would merge more,
but it would also invent matches that aren't there.

**Caveat worth stating.** These are top topics from the last 24 hours, not a
live feed. A country's #1 can be something utterly mundane (weather, lottery
results) — that's the honest picture, not an editorial selection.

The whole thing refreshes every 3 hours and runs on GitHub Actions +
Cloudflare Pages, no server involved: trends-world.pages.dev
```

**链接放最后一行**，前面全是实质内容。这样既不像广告，也让点进去的人知道会看到什么。

---

# Hacker News（Show HN）

Reddit 通不了的话，这是更精准的选择——`Show HN` 的读者就是来看「别人做了什么工具」的。

## 标题

```
Show HN: Daily top trending topic for 176 countries on one map
```

## 正文（HN 的 `text` 字段，简短）

```text
I wanted to see what other countries were actually searching for, and every
existing option was either region-blocked or a wall of ads. So I built a map:
one country, one topic, one link to the source.

The constraint I set was that it must not need a server. A zero-dependency Node
crawler runs on GitHub Actions every 3 hours, hits Google Trends' per-country
daily RSS, falls back to Bing News / Wikipedia / Baidu where Google publishes
nothing, and writes static JSON. Cloudflare Pages serves it. Nothing to keep
running.

Two things that turned out to be more interesting than the site itself:

Google rate-limits the trends feeds hard. Three concurrent requests was enough
to get 302'd to /sorry/index on roughly half the countries. A single global
throttle with 260-480ms jitter and 3 workers gets 176/176 with zero failures.

I also discovered my site returned 200 with the homepage for *every* unknown
URL. Cloudflare Pages does that when there's no 404.html. Every bad link was a
soft-404 duplicate waiting to be indexed.

Code is here: https://github.com/kioolfranrip-glitch/trend-radar
```

**注意**：HN 帖子里的链接要放到最后，而且 `Show HN` 只能发一次。发完当天要守在评论区——有人问技术细节就认真答，那才是决定排名的东西。

---

## 顺序建议

1. **先发 dev.to**（稿子在 `marketing/devto-post-single-link.md`，账号能用，零阻力）
2. Reddit 节点通了 → 发 r/MapPorn（图 + 标题 A + 方法评论）
3. 隔 1–2 天 → Show HN（不要同一天三处齐发）

**同一天在多个平台发同一个链接是刷量特征**，会被降权。慢一点反而快。
