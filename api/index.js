'use strict';

// Vercel serverless entry point: every /api/* request is rewritten here (see vercel.json).
const { handle } = require('../lib/router');

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try {
      return JSON.parse(req.body);
    } catch (_) {
      return {};
    }
  }
  return {};
}

module.exports = async (req, res) => {
  const body = req.method === 'GET' ? {} : await readJson(req);
  const proto = String(req.headers['x-forwarded-proto'] || 'https');
  const r = await handle({
    method: req.method,
    url: req.url,
    headers: req.headers,
    body,
    secure: proto === 'https',
  });
  res.statusCode = r.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
  res.end(JSON.stringify(r.body ?? {}));
};
