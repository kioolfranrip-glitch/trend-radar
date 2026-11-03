# Cloudflare Pages 接入步骤（方案 C：静态站 + GitHub Actions 定时抓取）

整套只做一次，之后每 3 小时自动更新。

## 1. 建 Pages 项目

Cloudflare 控制台 → Workers & Pages → Create → Pages → **Upload assets**（不是连 Git 仓库）
项目名填 `trends-world`（或你自己起，记得同步改仓库变量 `CF_PAGES_PROJECT`）。

首次会让你手工上传一次，随便传个空目录即可，拿到项目就行。

## 2. 建 API Token

My Profile → API Tokens → Create Token → 自定义模板，权限：

- **Account** · Cloudflare Pages · **Edit**
- **Account** · Account Settings · **Read**
- 资源范围：你的账号

保存后拿到 token（只显示一次）。

Account ID 在控制台右侧栏或 URL 里能找到。

## 3. 配仓库 Secrets / 变量

仓库 → Settings → Secrets and variables → Actions：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | 第 2 步的 token |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | 你的 Account ID |
| Secret | `HTTPS_PROXY` | 可选，抓 Google 用的代理，如 `http://1.2.3.4:8080` |
| Variable | `CF_PAGES_PROJECT` | 可选，默认 `trends-world` |

> 抓取跑在 GitHub 的 runner 上（机房 IP）。不配代理时 Google Trends 可能被拦，
> 站点会退化成 Bing/百度/维基为主——功能正常，只是数据源变少。

## 4. 跑一次

仓库 → Actions → **Sync trends and deploy** → Run workflow。
约 3–5 分钟跑完，Pages 域名（`xxx.pages.dev`）就能访问了。

之后 cron 每 3 小时自动跑一次；代码有 push 也会跑一次。

## 本地预览

```bash
npm run crawl     # 抓取，生成 public/data/
npm run start     # 静态服务 http://127.0.0.1:4173
```

`public/data/` 是被 gitignore 的，本地没有数据时页面会提示先跑 crawl。
