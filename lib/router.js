'use strict';

const fin = require('./finance');
const auth = require('./auth');
const { getDb } = require('./db');
const { AppError } = require('./errors');

const routes = [];
const add = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/:([a-zA-Z]+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '/?$'
  );
  routes.push({ method, re, keys, handler, public: !!opts.public, opts });
};

/* ---- session ---- */
add('GET', '/api/session', async (ctx) => ({
  authenticated: auth.isAuthenticated(ctx.headers),
  mode: auth.mode(),
  usernameRequired: auth.usernameRequired(),
}), { public: true });

add('POST', '/api/login', async (ctx) => {
  if (auth.mode() === 'locked') {
    throw new AppError(503, 'Server is locked: set the APP_PASSWORD environment variable to enable login');
  }
  if (auth.mode() === 'open') return { authenticated: true };
  if (!auth.checkCredentials(ctx.body.username, ctx.body.password)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    throw new AppError(401, 'Incorrect username or password');
  }
  ctx.setCookie = auth.sessionCookie(auth.makeToken(), ctx.secure);
  return { authenticated: true };
}, { public: true });

add('POST', '/api/logout', async (ctx) => {
  ctx.setCookie = auth.clearCookie(ctx.secure);
  return { authenticated: false };
}, { public: true });

/* ---- health (public, read-only, no business data) ---- */
add('GET', '/api/health', async () => {
  const db = await getDb(); // creates tables and seeds the chart of accounts on first run
  const tb = await fin.trialBalance();
  await fin.balanceSheet();
  await fin.dashboard();
  return { ok: true, database: db.kind, booksBalanced: tb.balanced };
}, { public: true });

/* ---- data ---- */
add('GET', '/api/settings', async () => fin.getSettings());
add('GET', '/api/dashboard', async () => fin.dashboard());

add('GET', '/api/accounts', async (ctx) =>
  fin.listAccounts({
    type: ctx.query.type,
    q: ctx.query.q,
    includeInactive: ctx.query.includeInactive === '1',
  })
);
add('POST', '/api/accounts', async (ctx) => fin.createAccount(ctx.body), { status: 201 });
add('PATCH', '/api/accounts/:code', async (ctx) => fin.updateAccount(ctx.params.code, ctx.body));

add('GET', '/api/journal', async (ctx) => fin.listJournals(ctx.query));
add('POST', '/api/journal', async (ctx) => fin.postJournal(ctx.body, 'admin'), { status: 201 });
add('GET', '/api/journal/:docNo', async (ctx) => fin.getJournal(ctx.params.docNo));
add('POST', '/api/journal/:docNo/reverse', async (ctx) => fin.reverseJournal(ctx.params.docNo, ctx.body, 'admin'), {
  status: 201,
});

add('GET', '/api/periods', async () => fin.listPeriods());
add('POST', '/api/periods/:period/lock', async (ctx) => fin.lockPeriod(ctx.params.period));
add('POST', '/api/periods/:period/unlock', async (ctx) => fin.unlockPeriod(ctx.params.period));

add('GET', '/api/reports/trial-balance', async (ctx) => fin.trialBalance(ctx.query));
add('GET', '/api/reports/ledger', async (ctx) => fin.ledger(ctx.query));
add('GET', '/api/reports/income-statement', async (ctx) => fin.incomeStatement(ctx.query));
add('GET', '/api/reports/balance-sheet', async (ctx) => fin.balanceSheet(ctx.query));

/**
 * Framework-agnostic request handler.
 * Input:  { method, url, headers, body, secure }
 * Output: { status, body, headers }
 */
async function handle({ method, url, headers = {}, body, secure }) {
  const u = new URL(url, 'http://localhost');
  const path = u.pathname.replace(/\/+$/, '') || '/';
  const query = Object.fromEntries(u.searchParams.entries());
  const out = { status: 200, headers: { 'Cache-Control': 'no-store' } };

  try {
    let matched = null;
    let pathExists = false;
    for (const r of routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathExists = true;
      if (r.method !== method) continue;
      matched = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      break;
    }
    if (!matched) {
      throw new AppError(pathExists ? 405 : 404, pathExists ? 'Method not allowed' : 'Not found');
    }

    if (!matched.r.public && !auth.isAuthenticated(headers)) {
      throw new AppError(401, 'Authentication required');
    }

    // CSRF defence in depth (cookie is also SameSite=Strict): writes must be JSON.
    if (method !== 'GET') {
      const ct = String(headers['content-type'] || '');
      if (!ct.includes('application/json')) throw new AppError(415, 'Content-Type must be application/json');
    }

    const ctx = { query, params: matched.params, body: body && typeof body === 'object' ? body : {}, headers, secure };
    const data = await matched.r.handler(ctx);
    if (ctx.setCookie) out.headers['Set-Cookie'] = ctx.setCookie;
    if (matched.r.opts && matched.r.opts.status) out.status = matched.r.opts.status;
    out.body = data;
  } catch (e) {
    if (e instanceof AppError) {
      out.status = e.status;
      out.body = { error: e.message };
    } else if (e && /SQLITE_CONSTRAINT|violates/i.test(String(e.message))) {
      out.status = 409;
      out.body = { error: 'Database constraint violated' };
    } else {
      console.error('Unhandled error:', e);
      out.status = 500;
      out.body = { error: 'Internal server error' };
    }
  }
  return out;
}

module.exports = { handle };
