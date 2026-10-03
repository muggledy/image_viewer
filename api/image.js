const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const TIMEOUT_MS = 15000;
const ALLOWED_PORTS = new Set(['', '80', '443']);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || b === 0)) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true;
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('blocked host');
    return;
  }
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length) throw new Error('unresolvable host');
  for (const rec of records) {
    if (isPrivateIp(rec.address)) throw new Error('blocked host');
  }
}

function sniffMagic(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12).toLowerCase();
    if (brand.startsWith('avif')) return 'image/avif';
    if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('mif1')) return 'image/heic';
  }
  const head = buf.toString('utf8', 0, Math.min(buf.length, 1024)).trimStart().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) {
    if (head.includes('<svg')) return 'image/svg+xml';
  }
  return null;
}

const EXT_MAP = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  avif: 'image/avif', heic: 'image/heic', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
};

function detectFormat(buf, upstreamType, pathname) {
  const magic = sniffMagic(buf);
  if (magic) return magic;
  const ct = (upstreamType || '').split(';')[0].trim().toLowerCase();
  if (ct.startsWith('image/')) return ct;
  const ext = (pathname.split('.').pop() || '').toLowerCase();
  return EXT_MAP[ext] || 'application/octet-stream';
}

function pickFilename(contentDisposition, target) {
  if (contentDisposition) {
    const star = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
    if (star) {
      try { return decodeURIComponent(star[1]); } catch (e) { /* fall through */ }
    }
    const plain = /filename="?([^";]+)"?/i.exec(contentDisposition);
    if (plain) return plain[1].trim();
  }
  const last = target.pathname.split('/').filter(Boolean).pop() || '';
  let decoded = last;
  try { decoded = decodeURIComponent(last); } catch (e) { /* keep raw */ }
  return decoded || 'image';
}

function asciiSafe(name) {
  return name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
}

function fail(res, code, message) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(code).send(JSON.stringify({ error: message }));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type, X-Image-Filename, X-Image-Format, X-Image-Size');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    fail(res, 405, 'method not allowed');
    return;
  }

  const raw = req.query && req.query.url;
  if (!raw) {
    fail(res, 400, 'missing ?url= parameter');
    return;
  }

  let target;
  try {
    target = new URL(String(raw));
  } catch (e) {
    fail(res, 400, 'invalid url');
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    fail(res, 400, 'only http/https urls are allowed');
    return;
  }
  if (!ALLOWED_PORTS.has(target.port)) {
    fail(res, 400, 'port not allowed (use 80/443)');
    return;
  }
  try {
    await assertPublicHost(target.hostname);
  } catch (e) {
    fail(res, 403, 'host not allowed');
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(target, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ImageViewer/1.0; +https://vercel.app)',
        Accept: 'image/*,*/*;q=0.8',
      },
    });
  } catch (e) {
    clearTimeout(timer);
    fail(res, 504, 'upstream fetch failed: ' + e.message);
    return;
  }

  if (!upstream.ok) {
    clearTimeout(timer);
    fail(res, upstream.status, 'upstream responded ' + upstream.status);
    return;
  }

  const declared = Number(upstream.headers.get('content-length') || 0);
  if (declared && declared > MAX_BYTES) {
    clearTimeout(timer);
    fail(res, 413, 'image exceeds 20MB limit');
    return;
  }

  let buf;
  try {
    buf = Buffer.from(await upstream.arrayBuffer());
  } catch (e) {
    clearTimeout(timer);
    fail(res, 502, 'failed to read upstream body');
    return;
  } finally {
    clearTimeout(timer);
  }

  if (buf.length > MAX_BYTES) {
    fail(res, 413, 'image exceeds 20MB limit');
    return;
  }

  const contentType = detectFormat(buf, upstream.headers.get('content-type'), target.pathname);
  const filename = pickFilename(upstream.headers.get('content-disposition'), target);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.setHeader('X-Image-Filename', encodeURIComponent(filename));
  res.setHeader('X-Image-Format', contentType);
  res.setHeader('X-Image-Size', String(buf.length));

  const wantsDownload = req.query.download === '1' || req.query.download === 'true';
  const disposition = wantsDownload ? 'attachment' : 'inline';
  res.setHeader(
    'Content-Disposition',
    disposition + '; filename="' + asciiSafe(filename) + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename)
  );

  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }
  res.status(200).send(buf);
};
