// 本地开发用：模拟 Vercel 静态托管 + /api/image 函数，零依赖。
// 用法：node dev-server.js  → 打开 http://localhost:3000
// 部署到 Vercel 时此文件不参与运行。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const imageHandler = require('./api/image.js');

const PORT = process.env.PORT || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/image') {
    req.query = Object.fromEntries(url.searchParams.entries());
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.end(body); return res; };
    res.json = (obj) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
    Promise.resolve(imageHandler(req, res)).catch((e) => {
      if (!res.headersSent) res.writeHead(500);
      res.end('internal error: ' + e.message);
    });
    return;
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.join(__dirname, rel);
  if (!full.startsWith(__dirname)) { res.writeHead(403); res.end('forbidden'); return; }

  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log('本地预览： http://localhost:' + PORT);
  console.log('带参数：   http://localhost:' + PORT + '/?url=' + encodeURIComponent('https://raw.githubusercontent.com/gordicaleksa/pytorch-original-transformer/main/data/readme_pics/transformer_architecture.PNG'));
});
