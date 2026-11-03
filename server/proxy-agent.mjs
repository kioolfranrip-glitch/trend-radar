/**
 * 代理探测与 HTTPS 隧道（零依赖）
 *
 * 优先级：
 *   1. 命令行 --proxy=http://127.0.0.1:7890
 *   2. 环境变量 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY (+ NO_PROXY 忽略)
 *   3. Windows 系统代理（注册表 Internet Settings，Clash / v2ray 等客户端会写这里）
 * 都没有则直连。
 */
import { execFileSync } from 'node:child_process';

function parseProxyUrl(value, defaultScheme = 'http') {
  if (!value) return null;
  let v = String(value).trim();
  if (!v) return null;
  if (!/^[a-z0-9+.-]+:\/\//i.test(v)) v = `${defaultScheme}://${v}`;
  try {
    const u = new URL(v);
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    if (!u.hostname) return null;
    return {
      host: u.hostname,
      port,
      auth: u.username ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}` : null,
      protocol: u.protocol,
    };
  } catch {
    return null;
  }
}

function readWindowsProxy() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { encoding: 'utf8', timeout: 4000, windowsHide: true },
    );
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(out);
    const server = out.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim();
    if (!enabled || !server) return null;
    let part = server;
    if (server.includes('=')) {
      const map = Object.fromEntries(
        server.split(';').filter(Boolean).map((kv) => {
          const i = kv.indexOf('=');
          return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
        }),
      );
      part = map.https || map.http || Object.values(map)[0];
    }
    const parsed = parseProxyUrl(part);
    if (!parsed) return null;
    const override = out.match(/ProxyOverride\s+REG_SZ\s+([^\r\n]+)/i)?.[1] || '';
    parsed.bypass = override.split(';').map((s) => s.trim()).filter((s) => s && s !== '<local>');
    parsed.bypassLocal = override.includes('<local>');
    return parsed;
  } catch {
    return null;
  }
}

let cached = null;
let cachedAt = 0;

export function detectProxy() {
  if (cached && Date.now() - cachedAt < 60_000) return cached;
  let result = null;
  const cli = process.argv.find((a) => a.startsWith('--proxy='));
  if (cli) {
    const p = parseProxyUrl(cli.slice(8));
    if (p) result = { ...p, source: 'cli' };
  }
  if (!result) {
    for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
      const p = parseProxyUrl(process.env[key]);
      if (p) { result = { ...p, source: `env:${key}` }; break; }
    }
  }
  if (!result) {
    const win = readWindowsProxy();
    if (win) result = { ...win, source: 'windows-registry' };
  }
  cached = result;
  cachedAt = Date.now();
  return result;
}

export function shouldBypass(hostname, proxy) {
  if (!proxy) return true;
  const host = hostname.toLowerCase();
  if (proxy.bypassLocal && !host.includes('.')) return true;
  return (proxy.bypass || []).some((rule) => {
    const r = rule.toLowerCase().replace(/^\./, '');
    if (r.startsWith('*')) return host.endsWith(r.slice(1));
    if (r.endsWith('*')) return host.startsWith(r.slice(0, -1));
    return host === r || host.endsWith(`.${r}`);
  });
}

/** fetch 兼容层：https 走代理隧道，其余直连 */
export async function proxyFetch(url, options = {}) {
  const target = new URL(url);
  const proxy = options.proxy === undefined ? detectProxy() : options.proxy;
  if (!proxy || shouldBypass(target.hostname, proxy) || target.protocol !== 'https:') {
    return fetch(url, options);
  }
  return tunnelFetch(target, options, proxy);
}

async function tunnelFetch(target, options, proxy) {
  const net = await import('node:net');
  const tls = await import('node:tls');
  const timeout = options.timeout ?? 20_000;
  const secure = await openTunnel(target, proxy, timeout, net, tls);

  try {
    const body = options.body ? await bodyToBuffer(options.body) : null;
    const headers = new Headers(options.headers || {});
    headers.set('host', target.host);
    headers.set('connection', 'close');
    if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'identity');
    if (body && !headers.has('content-length')) headers.set('content-length', String(body.length));

    let head = `${(options.method || 'GET').toUpperCase()} ${target.pathname}${target.search} HTTP/1.1\r\n`;
    for (const [k, v] of headers.entries()) head += `${k}: ${v}\r\n`;
    secure.write(`${head}\r\n`);
    if (body) secure.write(body);

    const chunks = [];
    let settled = false;
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        secure.destroy();
        reject(Object.assign(new Error('proxy read timeout'), { code: 'ETIMEDOUT' }));
      }, timeout);
      secure.on('data', (c) => chunks.push(c));
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      secure.once('end', finish);
      secure.once('close', finish);
      secure.once('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      });
    });
    await done;

    if (!chunks.length) throw new Error('through-proxy: empty response');
    return parseRawResponse(Buffer.concat(chunks), target.href);
  } finally {
    secure.destroy();
  }
}

async function openTunnel(target, proxy, timeout, net, tls) {
  const port = Number(target.port || 443);
  const raw = await new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    socket.setNoDelay(true);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error('proxy connect timeout'), { code: 'ETIMEDOUT' }));
    }, timeout);
    socket.once('error', (err) => { clearTimeout(timer); reject(err); });
    socket.once('data', (chunk) => {
      clearTimeout(timer);
      const head = chunk.toString('latin1');
      if (!/^HTTP\/1\.[01] 2\d\d/i.test(head)) {
        socket.destroy();
        reject(Object.assign(new Error(`proxy CONNECT failed: ${head.split('\r\n')[0]}`), { code: 'EPROXY' }));
        return;
      }
      socket.removeAllListeners('data');
      resolve(socket);
    });
    const auth = proxy.auth ? `Proxy-Authorization: Basic ${Buffer.from(proxy.auth).toString('base64')}\r\n` : '';
    socket.write(`CONNECT ${target.hostname}:${port} HTTP/1.1\r\nHost: ${target.hostname}:${port}\r\n${auth}\r\n`);
  });

  const secure = tls.connect({ socket: raw, servername: target.hostname, ALPNProtocols: ['http/1.1'] });
  await new Promise((resolve, reject) => {
    secure.once('secureConnect', resolve);
    secure.once('error', reject);
  });
  return secure;
}

async function bodyToBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new Error('unsupported request body');
}

function parseRawResponse(buf, url) {
  const sep = buf.indexOf('\r\n\r\n');
  if (sep < 0) throw new Error('malformed HTTP response');
  const head = buf.subarray(0, sep).toString('latin1');
  let body = buf.subarray(sep + 4);
  const lines = head.split('\r\n');
  const status = Number((lines[0].match(/^HTTP\/1\.[01] (\d{3})/) || [])[1] || 0);
  const headers = new Headers();
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  if ((headers.get('transfer-encoding') || '').toLowerCase().includes('chunked')) body = decodeChunked(body);
  const text = body.toString('utf8');
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    url,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

function decodeChunked(buf) {
  const parts = [];
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf('\r\n', i);
    if (nl < 0) break;
    const size = parseInt(buf.subarray(i, nl).toString('latin1'), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    parts.push(buf.subarray(nl + 2, nl + 2 + size));
    i = nl + 2 + size + 2;
  }
  return Buffer.concat(parts);
}
