'use strict';

// Local development server: serves /public and the JSON API (Vercel uses api/index.js instead).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle } = require('./lib/router');
const auth = require('./lib/auth');

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      const body = req.method === 'GET' ? {} : await readBody(req);
      const r = await handle({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
        secure: false,
      });
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', ...r.headers });
      res.end(JSON.stringify(r.body ?? {}));
      return;
    }

    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.normalize(path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath));
    if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    console.error(e);
    res.writeHead(500).end('Server error');
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Tickydo ERP (Finance) running at http://localhost:${port}`);
  if (auth.mode() === 'open') console.log('Auth: OPEN (local dev). Set APP_PASSWORD to require login.');
});
