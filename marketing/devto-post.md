---
title: I built a 176-country trends aggregator that runs entirely on GitHub Actions
published: false
description: No servers, no cron box, no dependencies — and four things that broke in ways I did not expect.
tags: showdev, webdev, javascript, cloudflare
---

Every time I wanted to know what people in another country were actually searching for, I ended up opening a local trending page, hitting a region block, or reading a machine-translated news site. So I built a small tool that puts all of it on one map: **176 countries and regions, one row of topics each, every topic linked to the original source.**

<https://trends-world.pages.dev>

The interesting part isn't the site. It's the constraint I set myself: **it must not need a server.** No VPS, no container, no always-on machine. If I have to keep something running, I will eventually stop keeping it running.

Here are the four things that broke, and what I did about them.

## The architecture, in one diagram

```
GitHub Actions (every 3 hours)
  └─ node tools/crawl.mjs        → 176 requests, ~90 s
       └─ writes static JSON      → 2.7 MB total
            └─ wrangler pages deploy
Cloudflare Pages (static only)
  └─ serves HTML + JSON
```

The crawler is plain Node with zero dependencies — no axios, no cheerio, no puppeteer. RSS and JSON get parsed with a handful of regexes, which is fragile in general but fine when you only have four well-known sources.

The frontend is vanilla JS. The world map is drawn at runtime from a local GeoJSON file into SVG, so there are no map tiles and no CDN.

Payload is small enough that the "no backend" decision was easy:

```
board.json        234 KB  →  70 KB gzipped   (every country's #1 topic)
details/US.json    16 KB                     (loaded only when opened)
countries.json     36 KB  →   8 KB gzipped
```

## Problem 1: Google started handing out captchas

Google Trends publishes a daily trends RSS feed per country. Fetch 176 of them politely and you get JSON-ish XML. Fetch them a little too eagerly and you get a 302 to `/sorry/index`, which is Google's polite way of saying "slow down".

I measured the cliff. Three concurrent requests were enough to trigger it on roughly half the countries:

```
3-way concurrency:  21 countries in 13 s   →  ok 21, failed 0   (fine)
3-way concurrency:  16 countries in 6.6 s  →  ok 8,  failed 8   (bad)
```

The window is narrow, and once you're in it, everything fails at once. What worked was aggressively boring: a single global throttle shared by all workers, 260–480 ms of jitter between request starts, 3 workers, and a short retry on 302 instead of giving up.

Result: 176/176 countries, zero failures, ~90 seconds.

Then I moved the same script to GitHub's runners, expecting to be blocked outright — datacenter IPs, right? **It wasn't.** Same 122/122 Google coverage as from my residential connection. I'd built the whole proxy fallback for a problem that didn't appear. Worth remembering the next time you assume an API will reject a particular network before you've actually measured it.

## Problem 2: every URL returned 200

While chasing an unrelated issue I ran:

```bash
curl -o /dev/null -w "%{http_code}" https://example.com/no-such-page
# 200
```

And `curl https://example.com/no-such.js` also returned `200`, with 6189 bytes of HTML — the homepage. Cloudflare Pages (or rather, a deployment with an `index.html` at the root and no `404.html`) was answering every unknown path with the homepage.

This is a soft 404, and it's worse than a broken link:

- Google treats it as duplicate content across infinitely many URLs
- It can inflate "discovered" pages while adding zero value
- A missing `.js` returning HTML breaks clients in ways that are hard to debug

The fix is one file: a real `public/404.html`, which Pages serves with a 404 status. After that, unknown paths correctly 404 while real assets still return 200.

I only found this because I was checking something else. If you deploy to Pages and never added a 404 page, go check yours.

## Problem 3: Cloudflare's clean URLs broke site verification

Google Search Console offers two HTML-based verification methods. The file method needs `https://your.site/googleXXXX.html` to return 200 with a specific line of text.

Cloudflare Pages has other ideas:

```
GET /googleXXXX.html  →  308 Permanent Redirect  →  /googleXXXX
```

Pages rewrites any `.html` URL to its extensionless form. Google's verifier may or may not follow that redirect, but "may or may not" is not a good place to be when the failure message is just *"we couldn't find your file at the given location"*.

I added a rewrite in `_redirects` to serve the file at its literal path with a 200:

```
/google9963f8632195544.html  /google9963f8632195544  200
```

That worked. But I ended up switching to the meta tag method anyway — it verifies by reading a `<meta>` tag from the homepage and doesn't care about redirects, paths, or deploy timing.

## Problem 4: my own CSP silently blocked analytics

I enabled Cloudflare Web Analytics, deployed, waited, and the dashboard showed nothing. No error in the UI, no hint, just empty charts.

The cause was a security header I'd written earlier:

```
Content-Security-Policy: script-src 'self'; connect-src 'self'
```

Both directives are reasonable defaults — and both block `static.cloudflareinsights.com`. The beacon never loaded, so no data was ever sent, so the dashboard had nothing to show. I had to allow the host in both directives:

```
script-src  'self' https://static.cloudflareinsights.com;
connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com
```

Lesson: a strict CSP is good, but every third-party you add later has to be re-admitted, and the failure mode is silence rather than an error page.

## What I'd do differently

**Search trends and news interest are not the same thing.** Google only publishes daily trends for 122 of the 176 places I wanted to cover. The rest fall back to Wikipedia pageviews or per-country Bing News. That's not a bug, but it means a card for Fiji and a card for Japan are answering slightly different questions. I label every row with its actual source rather than blending them into one fake ranking — but a reader who ignores the label will draw wrong conclusions.

**Hash routing costs you your content.** I use `/#/JP` for the country view. That's one indexable URL for 176 countries. If I wanted search traffic, I'd need real routes (`/country/jp`) with prerendered titles and topic lists. That's the one architectural decision I'd revisit, and it's the reason I'm not expecting much from search yet.

---

If you want to look at the result: **<https://trends-world.pages.dev>** — click a country, or just scroll the grid.

The crawler, the static export, and the deploy workflow are all here: **<https://github.com/kioolfranrip-glitch/trend-radar>**

If you deploy to Cloudflare Pages, the two things worth checking tonight are whether you have a `404.html`, and whether your CSP is quietly eating something.
