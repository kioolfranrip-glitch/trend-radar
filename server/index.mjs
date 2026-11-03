/**
 * 本地预览用的静态服务器
 *
 * 线上（Cloudflare Pages）不需要它——Pages 直接托管 public/ 目录。
 * 这里只是把同一份产物跑起来，方便本地看效果：
 *
 *   npm run crawl     # 抓取并生成 public/data/*
 *   npm run start     # 起静态服务 http://127.0.0.1:4173
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** 与 public/_headers 保持一致（线上由 Pages 接管） */
function securityHeaders(extra = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    ...extra,
  };
}

function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  if (rel === 'index.html') rel = '/index.html';

  const candidates = [path.normalize(path.join(PUBLIC, rel))];
  if (!path.extname(rel)) {
    candidates.push(path.normalize(path.join(PUBLIC, `${rel}/index.html`)));
    candidates.push(path.normalize(path.join(PUBLIC, `${rel}.html`)));
  }

  const notFound = () => {
    res.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
    res.end('not found');
  };

  const tryNext = (i) => {
    if (i >= candidates.length) {
      // 带扩展名的缺失文件直接 404；其余交给前端路由（回首页）
      if (path.extname(rel)) return notFound();
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e, buf) => {
        if (e) return notFound();
        res.writeHead(200, securityHeaders({ 'content-type': MIME['.html'], 'cache-control': 'no-cache' }));
        res.end(buf);
      });
    }
    const filePath = candidates[i];
    if (!filePath.startsWith(PUBLIC)) return notFound();

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) return tryNext(i + 1);
      const ext = path.extname(filePath).toLowerCase();
      // 文件名没有内容哈希 → 一律协商缓存，避免改了前端拿不到新版本
      const cache =
        ext === '.html' || ext === '.js' || ext === '.mjs' || ext === '.css'
          ? 'no-cache'
          : 'public, max-age=300';
      res.writeHead(
        200,
        securityHeaders({
          'content-type': MIME[ext] || 'application/octet-stream',
          'cache-control': cache,
          'last-modified': stat.mtime.toUTCString(),
        }),
      );
      fs.createReadStream(filePath).pipe(res);
    });
  };
  tryNext(0);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  serveStatic(url.pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  🌍 Trends World (static preview)');
  console.log(`     URL  http://${HOST}:${PORT}`);

  const metaPath = path.join(PUBLIC, 'data', 'meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const when = new Date(meta.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
      console.log(`     数据 ${meta.withData}/${meta.requested} 个国家 · ${when}`);
    } catch {
      console.log('     数据 meta.json 解析失败');
    }
  } else {
    console.log('     ⚠ 还没有数据快照，先运行：npm run crawl');
  }
  console.log('');
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});
