# 🌍 Trends World · 全球每日热榜

一眼看遍世界：把 **176 个国家 / 地区** 当天热度最高的话题汇总到一张可点击的世界地图上，每条话题都带着**原文链接**，点开即达。

## 快速开始

```bash
npm run crawl     # 抓取 176 个国家/地区，生成 public/data/
npm run start     # 本地预览 http://127.0.0.1:4173
```

`crawl` 会顺带预渲染国家页 / 话题页 / sitemap / feed / 每日快照图；
只想重新生成页面（不联网）时用 `node tools/crawl.mjs --use-cache`。

> 零依赖：只需要 Node.js ≥ 20，不用 `npm install`。
> 上线后由 GitHub Actions 定时抓取，这一步不需要在任何机器上常驻。

## 它做了什么

| 能力 | 说明 |
| --- | --- |
| 世界热度地图 | 本地 GeoJSON 自绘 SVG，按热度分 4 档着色，点国家下钻 |
| 各国今日热榜 | 每国 10–20 条话题，含搜索量、来源、相关新闻链接 |
| 全球此刻 | 右侧实时榜单，按热度排序，点击直达原文 |
| 搜索 / 筛选 | 支持国家名、ISO 代码、话题关键词搜索，按大洲筛选 |
| 深链接 | `/#/JP` 直接跳到日本，可分享 |
| 自动更新 | 每 25–30 分钟后台静默刷新，页面每 10 分钟自动同步 |
| 离线可用 | 抓取结果落盘 `data/cache/`，断网也能看上次快照 |
| 跨国故事 | 同一话题在多个国家登顶时自动聚类，点开看它触及了哪些国家 |
| 话题页 | 每个跨国故事一个静态页，含各国搜索量与原文链接 |
| 变化追踪 | 国家页标注 `NEW` / `▲n` / `▼n`，并列出近期榜首 |
| 每日快照图 | 每次抓取生成一张 1200×630 可分享卡片（`/daily/latest.png`） |

## 数据来源（按优先级降级）

1. **Google Trends 每日热搜 RSS** — 122 个国家/地区，质量最高，自带 1–6 条相关新闻链接
2. **百度热搜** — 中国大陆（Google Trends 不提供 CN）
3. **维基百科当日浏览量 Top** — Google 未覆盖但有统计的国家
4. **Bing 新闻** — 剩余 51 个小国，按国名检索当天新闻

每条记录都会标注实际使用的来源，界面上没有隐藏。

## 代理说明

Google / 维基 / Bing 在国内直连不通，服务端会自动探测代理，优先级：

1. 命令行参数 `--proxy=http://127.0.0.1:7890`
2. 环境变量 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`
3. Windows 系统代理（注册表 `Internet Settings`，Clash / v2ray 等客户端会自动写入）

```bash
node server/index.mjs --proxy=http://127.0.0.1:7890
```

探测不到代理时会走直连，此时 Google 类数据源会失败并自动降级到 Bing 新闻。

## 抗限流设计

实测 Google 对突发并发请求会返回 `302 → /sorry/` 验证码页，因此：

- 全局请求节流（≈260–480ms 间隔），3 个 worker 串行排队
- 单次 302/429 快速重试，连续 5 次失败才冷却该数据源 8 分钟
- 每国结果缓存 30 分钟并落盘，重启不重复抓取
- 冷启动先在后台预热，页面读缓存秒开，缺的再轮询补齐

## 目录结构

```
trends-world/
├── server/
│   ├── store.mjs        抓取调度（队列 / 节流 / 缓存 / 降级）
│   ├── sources.mjs      各数据源解析器
│   ├── proxy-agent.mjs  代理探测 + 零依赖 HTTPS CONNECT 隧道
│   └── index.mjs        本地预览用的静态服务器（线上不用）
├── tools/
│   ├── crawl.mjs        抓取并导出静态 JSON（CI 与本地共用）
│   ├── cluster.mjs      跨国故事聚类（Global Pulse）+ 话题 slug
│   ├── history.mjs      每日快照历史（7 天，用于变化标记）
│   ├── country-pages.mjs 预渲染国家页 / 话题页 / 索引页 / sitemap / feed
│   ├── daily-image.mjs  每日快照图（headless Chrome 渲染 PNG）
│   ├── report.mjs       每日流量日报（Cloudflare Analytics）
│   └── build-countries.mjs  重新生成 countries.json
├── public/              部署产物（Pages 直接托管）
│   ├── index.html / app.js / styles.css / world.geo.json
│   ├── about/ privacy/ terms/ security/    英文说明页
│   ├── countries/       176 国全量索引页（纯 HTML）
│   ├── country/<iso>/   20 个预渲染国家详情页
│   ├── topic/<slug>/    跨国故事详情页
│   ├── topics/          当前故事的索引页
│   ├── daily/           每日快照图 + index.json（latest.png 为稳定入口）
│   ├── feed.xml         Atom 订阅
│   ├── sitemap.xml      CI 每轮重新生成（当前 37 条 URL）
│   ├── _headers         CSP / HSTS 等安全响应头
│   ├── robots.txt  .well-known/security.txt
│   └── data/            抓取生成的快照（gitignore）
├── data/
│   ├── countries.json   176 个国家/地区元数据
│   └── cache/           抓取中间缓存（gitignore）
│       └── history/     各国最近 7 天快照（随 Actions 缓存跨运行累积）
└── .github/
    ├── workflows/sync.yml          每 3 小时抓取 + 部署
    ├── workflows/daily-report.yml  每天生成流量日报并提交
    └── PAGES-SETUP.md              Cloudflare 接入步骤
```

## 页面

界面文案（顶栏、地图、面板、卡片、页脚）**全英文**；只有国家/地区名仍用中文简称，话题标题保留数据源原语言。

| 路径 | 内容 |
| --- | --- |
| `/` | World heat map + Global pulse + Today's top trends by country |
| `/countries/` | 176 个国家/地区全量索引（纯 HTML，每行带今日 Top1 与来源） |
| `/country/<iso>/` | 预渲染的国家详情页（20 个重点国家），带变化标记与近期榜首 |
| `/topic/<slug>/` | 跨国故事详情：该故事在哪些国家登顶、各自搜索量与原文链接 |
| `/topics/` | 当前跨國故事的索引 |
| `/feed.xml` | Atom 订阅（跨国故事，随快照更新） |
| `/daily/latest.png` | 当日快照图（1200×630），归档在 `/daily/<date>.png` |
| `/about/` | Methodology, data sources, coverage gaps, how it's built, limitations |
| `/privacy/` | No accounts / no cookies, request data, outbound links, GDPR rights |
| `/terms/` | Provided as is, third-party rights, acceptable use, liability |
| `/security/` | Attack surface, security headers, vulnerability disclosure |
| `/.well-known/security.txt` | RFC 9116 machine-readable contact |

> 页面里的邮箱（`hello@` / `privacy@` / `security@trends-world.example`）和
> `security.txt` 里的域名是占位符，上线前请全局替换成你自己的。
> 需要中文版说明页的话，可以照同样结构放到 `/zh/` 下。

## 内容策略（为什么站点长这样）

这一节记录几次实际踩坑后定下的规则，改动前先读。

### 国家命名一律用中性短名

站点面向全球公开访问，政治性正式国名会被举报、也会影响收录。所有生成产物
（`countries.json`、`world.geo.json`、页面）统一走 `tools/build-countries.mjs`
里的 `NEUTRAL_NAMES` 覆盖表：

```
TW 台湾   CN 中国   KP 朝鲜   KR 韩国   AE 阿联酋
HK 中国香港   MO 中国澳门   US 美国   GB 英国   RU 俄罗斯
```

**不要**在页面模板里硬编码国名，也不要绕过这张表直接改 JSON——下一轮抓取会覆盖回去。

### 页面的「可索引价值」靠时间累积

Google 对新站的表现很明确：抓一轮、判定内容太薄、不再回访。所以国家页除了当天的
Top10，还必须有**只有时间才能产生**的内容：

- `data/cache/history/<ISO>.json` 保留每国最近 7 天的 Top10（放在 CI 缓存目录里，不进 git）
- 页面显示 `NEW` / `▲n` / `▼n` 变化标记，以及「近期榜首」列表
- **只有存在第 2 天数据时才显示标记**，避免首日整屏 `NEW` 的假信号

### 页面矩阵

| 层级 | 数量 | 作用 |
| --- | --- | --- |
| 国家详情页 | 20（预渲染） | 长尾词 + 内链枢纽 |
| 国家索引页 | 1（176 行） | 一次给爬虫 176 个入口 |
| 话题详情页 | 10/天（滚动） | 每条跨国故事一页，天然每天新增 |
| 话题索引页 | 1 | 串起当天所有话题页 |

### 跨国故事是按标题相似度聚类，不是按地理

所以会出现反直觉的配对——例如美国某天的 Top1 是板球赛 `new zealand vs india`，
它就会被归进那个簇。这是数据本身如此，不是 bug。

## 每日快照图

`tools/daily-image.mjs` 在每次抓取末尾渲染一张 1200×630 的卡片（TOP3 跨国故事 +
高亮世界地图），输出：

```
public/daily/<YYYY-MM-DD>.png   按日期归档
public/daily/latest.png         稳定入口，前端不用算日期
public/daily/index.json         最近 30 天索引
```

**没有 npm 依赖**：脚本直接 `spawn` 无头 Chrome 截图（`--headless=new --screenshot`），
`findChrome()` 依次查找 Playwright 缓存目录 → `/usr/bin/google-chrome` → `/usr/bin/chromium`
→ Windows 本地安装路径。

CI 里只需要装浏览器二进制：

```yaml
- name: Install headless Chromium
  continue-on-error: true
  run: npx --yes playwright@1 install --with-deps chromium
```

`continue-on-error` 是刻意的：**浏览器装不上不该拖垮部署**。脚本找不到浏览器时打印一行
提示后正常退出，站点其余部分照常发布。

## 部署到 Cloudflare（当前方案：静态站 + GitHub Actions 定时抓取）


站点本身**是纯静态的**：Cloudflare Pages 只负责发文件，抓取由 GitHub Actions 定时完成。
部署完就不用管了，不需要服务器、不需要保持任何机器在线。

```
GitHub Actions（每 3 小时）
  └─ node tools/crawl.mjs
        ├─ 抓取 176 国 → public/data/*.json
        ├─ 记录当日快照 → data/cache/history/<ISO>.json
        └─ 调用 country-pages.mjs → 国家页/话题页/索引/feed/sitemap
             └─ 调用 daily-image.mjs → public/daily/<date>.png
                  └─ wrangler pages deploy public → Cloudflare Pages
```

### 数据契约（前端只认这四个文件）

| 文件 | 用途 | gzip |
| --- | --- | --- |
| `/data/countries.json` | 176 个国家元数据 | 8 KB |
| `/data/board.json` | 每国 Top1，首屏点亮地图 | 70 KB |
| `/data/details/<ISO>.json` | 单国完整热榜，点开才加载 | ~3 KB |
| `/data/global.json` | Global Pulse：跨国故事聚类，每条带 slug | 3 KB |
| `/data/meta.json` | 生成时间、覆盖率、失败清单 | < 1 KB |

### 一次性配置

详细步骤见 [.github/PAGES-SETUP.md](.github/PAGES-SETUP.md)，概括：

1. Cloudflare 建一个 Pages 项目（Upload assets 方式）；
2. 建 API Token（Pages:Edit + Account Settings:Read）；
3. 仓库 Secrets 配 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，
   可选 `HTTPS_PROXY`（抓 Google 用）；
4. Actions 手动跑一次 `Sync trends and deploy`。

### 为什么不用 Workers

Workers 的出口是机房 IP，Google Trends 大概率返回 302 验证码；且没有磁盘、单次调用有子请求上限，
需要 KV + 多段 Cron 才能跑完 176 个国家。GitHub Actions 里跑现有 Node 脚本，改动最小、行为与本地一致。

### 本地预览

```bash
npm run crawl     # 抓取并生成 public/data/
npm run start     # 静态服务 http://127.0.0.1:4173
npm run preview   # 小范围先抓 8 个国家，再起服务（调试用）
```

`public/data/` 与 `data/cache/` 都在 `.gitignore` 里——数据不进版本库，避免每轮 2 MB 快照撑爆仓库。

### 抓取脚本参数

```bash
node tools/crawl.mjs --jobs=4                 # 并发数（默认 4）
node tools/crawl.mjs --only=US,JP,CN          # 只抓指定国家
node tools/crawl.mjs --use-cache              # 不联网，只用缓存重新导出
node tools/crawl.mjs --proxy=http://127.0.0.1:7890
```

失败不会清空站点：抓不到的国家会沿用上一轮的 `details/*.json`，并在 `meta.json` 里记一笔。

## 已知边界

- Google Trends 每日热搜本身**不是实时**的，一天更新数次，所以「今日」指最近一次榜单
- 小国（约 51 个）用的 Bing 新闻是「当天新闻热度」，不是搜索量，界面已标注来源区分
- 部分外链（如 Cricinfo）对非浏览器请求返回 403，正常浏览器打开不受影响
- 跨国故事按标题相似度聚类，偶尔会把同一天的不同事件合并，页面已注明这一点
- 数据版权归各来源所有，本工具只做聚合与跳转
