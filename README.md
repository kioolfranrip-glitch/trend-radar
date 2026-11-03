# 🌍 Trends World · 全球每日热榜

一眼看遍世界：把 **176 个国家 / 地区** 当天热度最高的话题汇总到一张可点击的世界地图上，每条话题都带着**原文链接**，点开即达。

## 快速开始

```bash
npm run crawl     # 抓取 176 个国家/地区，生成 public/data/
npm run start     # 本地预览 http://127.0.0.1:4173
```

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
│   └── build-countries.mjs  重新生成 countries.json
├── public/              部署产物（Pages 直接托管）
│   ├── index.html / app.js / styles.css / world.geo.json
│   ├── about/ privacy/ terms/ security/    英文说明页
│   ├── _headers         CSP / HSTS 等安全响应头
│   ├── robots.txt  .well-known/security.txt
│   └── data/            抓取生成的快照（gitignore）
├── data/
│   ├── countries.json   176 个国家/地区元数据
│   └── cache/           抓取中间缓存（gitignore）
└── .github/
    ├── workflows/sync.yml  定时抓取 + 部署
    └── PAGES-SETUP.md      Cloudflare 接入步骤
```

## 页面

界面文案（顶栏、地图、面板、卡片、页脚）**全英文**；只有国家/地区名仍用中文简称，话题标题保留数据源原语言。

| 路径 | 内容 |
| --- | --- |
| `/` | World heat map + Right now, worldwide + Today's top trends by country |
| `/about/` | Methodology, data sources, coverage gaps, how it's built, limitations |
| `/privacy/` | No accounts / no cookies, request data, outbound links, GDPR rights |
| `/terms/` | Provided as is, third-party rights, acceptable use, liability |
| `/security/` | Attack surface, security headers, vulnerability disclosure |
| `/.well-known/security.txt` | RFC 9116 machine-readable contact |

> 页面里的邮箱（`hello@` / `privacy@` / `security@trends-world.example`）和
> `security.txt` 里的域名是占位符，上线前请全局替换成你自己的。
> 需要中文版说明页的话，可以照同样结构放到 `/zh/` 下。

## 部署到 Cloudflare（当前方案：静态站 + GitHub Actions 定时抓取）

站点本身**是纯静态的**：Cloudflare Pages 只负责发文件，抓取由 GitHub Actions 定时完成。
部署完就不用管了，不需要服务器、不需要保持任何机器在线。

```
GitHub Actions（每 2 小时）
  └─ node tools/crawl.mjs → 生成 public/data/*.json
        └─ wrangler pages deploy public → Cloudflare Pages
```

### 数据契约（前端只认这四个文件）

| 文件 | 用途 | gzip |
| --- | --- | --- |
| `/data/countries.json` | 176 个国家元数据 | 8 KB |
| `/data/board.json` | 每国 Top1，首屏点亮地图 | 70 KB |
| `/data/details/<ISO>.json` | 单国完整热榜，点开才加载 | ~3 KB |
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
- 数据版权归各来源所有，本工具只做聚合与跳转
