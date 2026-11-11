'use strict';

const fs = require('fs');
const path = require('path');
const schema = require('./schema');
const { AppError } = require('./errors');

let ready = null;

// Vercel can prefix integration variables (e.g. MY_TICKYDO_DATABASE_URL), so accept any
// prefix. The pooled URL is preferred; *_UNPOOLED, *_NON_POOLING, *_NO_SSL and *_PRISMA_URL
// are deliberately not matched.
function dbUrl() {
  const direct = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (direct) return direct;
  for (const suffix of ['DATABASE_URL', 'POSTGRES_URL']) {
    const key = Object.keys(process.env).sort().find((k) => k.endsWith('_' + suffix) && process.env[k]);
    if (key) return process.env[key];
  }
  return '';
}

function wrap(q) {
  return {
    async all(sql, params = []) {
      return (await q(sql, params)).rows;
    },
    async get(sql, params = []) {
      return (await q(sql, params)).rows[0] || null;
    },
    async run(sql, params = []) {
      return { changes: (await q(sql, params)).changes };
    },
  };
}

function openSqlite() {
  if (process.env.VERCEL) {
    throw new AppError(503, 'Database not connected. Add a Postgres database to the Vercel project (this sets DATABASE_URL), then redeploy.');
  }
  const { DatabaseSync } = require('node:sqlite');
  const file = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'erp.db');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');

  const q = async (sql, params = []) => {
    const p = params.map((v) => (v === undefined ? null : v));
    const st = db.prepare(sql);
    if (/^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql)) {
      const rows = st.all(...p);
      return { rows, changes: rows.length };
    }
    const r = st.run(...p);
    return { rows: [], changes: Number(r.changes) };
  };

  const base = wrap(q);
  let chain = Promise.resolve();
  return {
    kind: 'sqlite',
    ...base,
    async exec(statements) {
      for (const s of statements) db.exec(s);
    },
    // Transactions are serialised so concurrent requests never interleave inside BEGIN/COMMIT.
    tx(fn) {
      const run = async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const out = await fn(base);
          db.exec('COMMIT');
          return out;
        } catch (e) {
          try {
            db.exec('ROLLBACK');
          } catch (_) {
            /* ignore */
          }
          throw e;
        }
      };
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    },
  };
}

function openPg() {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, (v) => Number(v)); // BIGINT
  types.setTypeParser(1700, (v) => Number(v)); // NUMERIC (SUM results)
  const conv = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => '$' + ++i);
  };
  const pool = new Pool({
    connectionString: dbUrl(),
    max: 1,
  });
  const mk = (client) =>
    wrap(async (sql, params = []) => {
      const r = await client.query(conv(sql), params);
      return { rows: r.rows, changes: r.rowCount };
    });
  const base = mk(pool);
  return {
    kind: 'pg',
    ...base,
    async exec(statements) {
      for (const s of statements) await pool.query(s);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(mk(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

function getDb() {
  if (!ready) {
    ready = (async () => {
      const usePg = !!dbUrl();
      const db = usePg ? openPg() : openSqlite();
      await db.exec(schema);
      await require('./seed').seedChartOfAccounts(db);
      return db;
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

module.exports = { getDb, dbUrl };
