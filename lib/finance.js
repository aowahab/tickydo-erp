'use strict';

const { getDb } = require('./db');
const { AppError } = require('./errors');
const { toMinor, fromMinor } = require('./money');

// Normal balance side per account type: D = debit-normal, C = credit-normal.
const TYPES = { ASSET: 'D', LIABILITY: 'C', EQUITY: 'C', REVENUE: 'C', EXPENSE: 'D' };

/* ---------- helpers ---------- */

const pad = (n) => String(n).padStart(2, '0');

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Dhaka',
  }).format(new Date());
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function reqDate(s, field) {
  if (!isDate(s)) throw new AppError(422, `${field} must be a valid date (YYYY-MM-DD)`);
  return s;
}

function optDate(s, def, field) {
  if (s === undefined || s === null || s === '') return def;
  return reqDate(s, field);
}

function clip(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function fiscalStartMonth() {
  const m = Number(process.env.FISCAL_YEAR_START_MONTH || 7);
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : 7;
}

function fiscalYearStart(today) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const start = fiscalStartMonth();
  return `${m >= start ? y : y - 1}-${pad(start)}-01`;
}

function monthBounds(today) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

const mapAccount = (r) => ({
  code: r.code,
  name: r.name,
  type: r.type,
  category: r.category,
  isPostable: !!r.is_postable,
  active: !!r.active,
  normalBalance: TYPES[r.type],
});

/* ---------- settings ---------- */

function getSettings() {
  const today = todayStr();
  return {
    company: process.env.COMPANY_NAME || 'Tickydo',
    currency: 'BDT',
    today,
    fiscalYearStartMonth: fiscalStartMonth(),
    fiscalYearStart: fiscalYearStart(today),
  };
}

/* ---------- chart of accounts ---------- */

async function listAccounts({ type, q, includeInactive } = {}) {
  const db = await getDb();
  const where = [];
  const p = [];
  if (type) {
    if (!TYPES[type]) throw new AppError(422, 'Unknown account type');
    where.push('type = ?');
    p.push(type);
  }
  if (!includeInactive) where.push('active = 1');
  if (q) {
    where.push('(code LIKE ? OR LOWER(name) LIKE ?)');
    p.push(`${q}%`, `%${String(q).toLowerCase()}%`);
  }
  const rows = await db.all(
    `SELECT code, name, type, category, is_postable, active FROM accounts
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY code`,
    p
  );
  return rows.map(mapAccount);
}

async function createAccount(input) {
  const db = await getDb();
  const code = clip(input.code, 10);
  if (!/^\d{4,10}$/.test(code)) throw new AppError(422, 'Account number must be 4 to 10 digits');
  const name = clip(input.name, 80);
  if (!name) throw new AppError(422, 'Account name is required');
  if (!TYPES[input.type]) throw new AppError(422, 'Account type must be ASSET, LIABILITY, EQUITY, REVENUE or EXPENSE');
  const category = clip(input.category, 50) || 'General';
  const postable = input.isPostable === false ? 0 : 1;
  if (await db.get('SELECT 1 AS x FROM accounts WHERE code = ?', [code])) {
    throw new AppError(409, `Account ${code} already exists`);
  }
  await db.run(
    `INSERT INTO accounts (code, name, type, category, is_postable, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [code, name, input.type, category, postable, new Date().toISOString()]
  );
  return mapAccount(await db.get('SELECT * FROM accounts WHERE code = ?', [code]));
}

async function updateAccount(code, input) {
  const db = await getDb();
  const cur = await db.get('SELECT * FROM accounts WHERE code = ?', [code]);
  if (!cur) throw new AppError(404, `Account ${code} not found`);
  const name = input.name !== undefined ? clip(input.name, 80) : cur.name;
  if (!name) throw new AppError(422, 'Account name is required');
  const category = input.category !== undefined ? clip(input.category, 50) || 'General' : cur.category;
  const postable = input.isPostable !== undefined ? (input.isPostable ? 1 : 0) : cur.is_postable;
  const active = input.active !== undefined ? (input.active ? 1 : 0) : cur.active;
  if (cur.active && !active) {
    const bal = await db.get(
      'SELECT COALESCE(SUM(debit - credit), 0) AS b FROM journal_lines WHERE account_code = ?',
      [code]
    );
    if (Number(bal.b) !== 0) {
      throw new AppError(409, 'Cannot deactivate an account with a non-zero balance');
    }
  }
  await db.run('UPDATE accounts SET name = ?, category = ?, is_postable = ?, active = ? WHERE code = ?', [
    name,
    category,
    postable,
    active,
    code,
  ]);
  return mapAccount(await db.get('SELECT * FROM accounts WHERE code = ?', [code]));
}

/* ---------- journal entries ---------- */

async function nextDocNo(t) {
  const row = await t.get("UPDATE number_ranges SET next_no = next_no + 1 WHERE name = 'JE' RETURNING next_no");
  return Number(row.next_no);
}

async function postJournalTx(t, input, opts = {}) {
  const postingDate = reqDate(input.postingDate, 'Posting date');
  const docDate = optDate(input.docDate, postingDate, 'Document date');
  const raw = Array.isArray(input.lines) ? input.lines : [];
  if (raw.length < 2) throw new AppError(422, 'A journal entry needs at least two lines');
  if (raw.length > 200) throw new AppError(422, 'A journal entry can have at most 200 lines');

  const lines = raw.map((l, i) => {
    const n = i + 1;
    const account = clip(l.account, 10);
    if (!account) throw new AppError(422, `Line ${n}: account is required`);
    const debit = toMinor(l.debit, `Line ${n} debit`);
    const credit = toMinor(l.credit, `Line ${n} credit`);
    if (debit > 0 && credit > 0) throw new AppError(422, `Line ${n}: enter either a debit or a credit, not both`);
    if (debit === 0 && credit === 0) throw new AppError(422, `Line ${n}: amount must be greater than zero`);
    return { n, account, debit, credit, text: clip(l.text, 100) };
  });

  const td = lines.reduce((s, l) => s + l.debit, 0);
  const tc = lines.reduce((s, l) => s + l.credit, 0);
  if (td !== tc) {
    throw new AppError(
      422,
      `Entry is out of balance: debits ${fromMinor(td).toFixed(2)}, credits ${fromMinor(tc).toFixed(2)} (difference ${fromMinor(Math.abs(td - tc)).toFixed(2)})`
    );
  }

  const codes = [...new Set(lines.map((l) => l.account))];
  const accs = await t.all(
    `SELECT code, name, active, is_postable FROM accounts WHERE code IN (${codes.map(() => '?').join(',')})`,
    codes
  );
  const byCode = new Map(accs.map((a) => [a.code, a]));
  for (const l of lines) {
    const a = byCode.get(l.account);
    if (!a) throw new AppError(422, `Line ${l.n}: account ${l.account} does not exist`);
    if (!a.active) throw new AppError(422, `Line ${l.n}: account ${l.account} is inactive`);
    if (!a.is_postable) throw new AppError(422, `Line ${l.n}: account ${l.account} does not allow direct posting`);
  }

  const period = postingDate.slice(0, 7);
  if (await t.get('SELECT 1 AS x FROM period_locks WHERE period = ?', [period])) {
    throw new AppError(409, `Posting period ${period} is locked`);
  }

  const docNo = await nextDocNo(t);
  await t.run(
    `INSERT INTO journal_entries
       (doc_no, posting_date, doc_date, period, doc_type, reference, header_text, status, reversal_of, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?)`,
    [
      docNo,
      postingDate,
      docDate,
      period,
      opts.docType || 'SA',
      clip(input.reference, 40),
      clip(input.headerText, 100),
      opts.reversalOf || null,
      opts.user || 'admin',
      new Date().toISOString(),
    ]
  );
  for (const l of lines) {
    await t.run(
      'INSERT INTO journal_lines (doc_no, line_no, account_code, debit, credit, line_text) VALUES (?, ?, ?, ?, ?, ?)',
      [docNo, l.n, l.account, l.debit, l.credit, l.text]
    );
  }
  return docNo;
}

async function postJournal(input, user) {
  const db = await getDb();
  const docNo = await db.tx((t) => postJournalTx(t, input, { user }));
  return getJournal(docNo);
}

function mapHeader(e) {
  return {
    docNo: Number(e.doc_no),
    postingDate: e.posting_date,
    docDate: e.doc_date,
    period: e.period,
    docType: e.doc_type,
    reference: e.reference,
    headerText: e.header_text,
    status: e.status,
    reversalOf: e.reversal_of == null ? null : Number(e.reversal_of),
    reversedBy: e.reversed_by == null ? null : Number(e.reversed_by),
    createdBy: e.created_by,
    createdAt: e.created_at,
  };
}

async function getJournal(docNoRaw) {
  const db = await getDb();
  const docNo = Number(docNoRaw);
  if (!Number.isSafeInteger(docNo)) throw new AppError(400, 'Invalid document number');
  const e = await db.get('SELECT * FROM journal_entries WHERE doc_no = ?', [docNo]);
  if (!e) throw new AppError(404, `Document ${docNo} not found`);
  const lines = await db.all(
    `SELECT l.line_no, l.account_code, a.name AS account_name, l.debit, l.credit, l.line_text
     FROM journal_lines l JOIN accounts a ON a.code = l.account_code
     WHERE l.doc_no = ? ORDER BY l.line_no`,
    [docNo]
  );
  const total = lines.reduce((s, l) => s + Number(l.debit), 0);
  return {
    ...mapHeader(e),
    total: fromMinor(total),
    lines: lines.map((l) => ({
      lineNo: l.line_no,
      account: l.account_code,
      accountName: l.account_name,
      debit: fromMinor(l.debit),
      credit: fromMinor(l.credit),
      text: l.line_text,
    })),
  };
}

async function listJournals({ from, to, q, limit, offset } = {}) {
  const db = await getDb();
  const where = [];
  const p = [];
  if (from) {
    where.push('e.posting_date >= ?');
    p.push(reqDate(from, 'From date'));
  }
  if (to) {
    where.push('e.posting_date <= ?');
    p.push(reqDate(to, 'To date'));
  }
  if (q) {
    const like = `%${String(q).toLowerCase()}%`;
    where.push('(CAST(e.doc_no AS TEXT) LIKE ? OR LOWER(e.reference) LIKE ? OR LOWER(e.header_text) LIKE ?)');
    p.push(like, like, like);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  const count = await db.get(`SELECT COUNT(*) AS n FROM journal_entries e ${w}`, p);
  const rows = await db.all(
    `SELECT e.*, (SELECT COALESCE(SUM(l.debit), 0) FROM journal_lines l WHERE l.doc_no = e.doc_no) AS total
     FROM journal_entries e ${w}
     ORDER BY e.posting_date DESC, e.doc_no DESC LIMIT ? OFFSET ?`,
    [...p, lim, off]
  );
  return {
    total: Number(count.n),
    items: rows.map((r) => ({ ...mapHeader(r), total: fromMinor(r.total) })),
  };
}

async function reverseJournal(docNoRaw, input = {}, user) {
  const db = await getDb();
  const docNo = Number(docNoRaw);
  if (!Number.isSafeInteger(docNo)) throw new AppError(400, 'Invalid document number');
  const newDoc = await db.tx(async (t) => {
    const orig = await t.get('SELECT * FROM journal_entries WHERE doc_no = ?', [docNo]);
    if (!orig) throw new AppError(404, `Document ${docNo} not found`);
    if (orig.status === 'REVERSED') throw new AppError(409, `Document ${docNo} is already reversed`);
    if (orig.reversal_of != null) throw new AppError(409, 'A reversal document cannot be reversed again');
    const lines = await t.all('SELECT * FROM journal_lines WHERE doc_no = ? ORDER BY line_no', [docNo]);
    const postingDate = optDate(input.postingDate, todayStr(), 'Reversal posting date');
    const id = await postJournalTx(
      t,
      {
        postingDate,
        docDate: postingDate,
        reference: `REV ${docNo}`,
        headerText: clip(input.reason, 100) || `Reversal of document ${docNo}`,
        lines: lines.map((l) => ({
          account: l.account_code,
          debit: fromMinor(l.credit),
          credit: fromMinor(l.debit),
          text: l.line_text,
        })),
      },
      { docType: 'RV', reversalOf: docNo, user }
    );
    await t.run("UPDATE journal_entries SET status = 'REVERSED', reversed_by = ? WHERE doc_no = ?", [id, docNo]);
    return id;
  });
  return getJournal(newDoc);
}

/* ---------- period control ---------- */

async function listPeriods() {
  const db = await getDb();
  const locks = await db.all('SELECT period FROM period_locks');
  const used = await db.all('SELECT period, COUNT(*) AS docs FROM journal_entries GROUP BY period');
  const map = new Map();
  for (const u of used) map.set(u.period, { period: u.period, documents: Number(u.docs), locked: false });
  for (const l of locks) {
    const cur = map.get(l.period) || { period: l.period, documents: 0 };
    cur.locked = true;
    map.set(l.period, cur);
  }
  return [...map.values()].sort((a, b) => (a.period < b.period ? 1 : -1));
}

function reqPeriod(p) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p))) throw new AppError(422, 'Period must be YYYY-MM');
  return String(p);
}

async function lockPeriod(period) {
  const db = await getDb();
  await db.run('INSERT INTO period_locks (period, locked_at) VALUES (?, ?) ON CONFLICT (period) DO NOTHING', [
    reqPeriod(period),
    new Date().toISOString(),
  ]);
  return listPeriods();
}

async function unlockPeriod(period) {
  const db = await getDb();
  await db.run('DELETE FROM period_locks WHERE period = ?', [reqPeriod(period)]);
  return listPeriods();
}

/* ---------- reports ---------- */

function dateRange(from, to) {
  const f = optDate(from, '0000-01-01', 'From date');
  const t = optDate(to, '9999-12-31', 'To date');
  if (f > t) throw new AppError(422, 'From date must not be after To date');
  return [f, t];
}

async function trialBalance({ from, to } = {}) {
  const db = await getDb();
  const [f, t] = dateRange(from, to);
  const rows = await db.all(
    `SELECT a.code, a.name, a.type, a.category,
       COALESCE(SUM(CASE WHEN e.posting_date < ? THEN l.debit - l.credit ELSE 0 END), 0) AS opening,
       COALESCE(SUM(CASE WHEN e.posting_date >= ? AND e.posting_date <= ? THEN l.debit ELSE 0 END), 0) AS period_debit,
       COALESCE(SUM(CASE WHEN e.posting_date >= ? AND e.posting_date <= ? THEN l.credit ELSE 0 END), 0) AS period_credit
     FROM accounts a
     JOIN journal_lines l ON l.account_code = a.code
     JOIN journal_entries e ON e.doc_no = l.doc_no
     WHERE e.posting_date <= ?
     GROUP BY a.code, a.name, a.type, a.category
     ORDER BY a.code`,
    [f, f, t, f, t, t]
  );
  const tot = { opening: 0, debit: 0, credit: 0, closing: 0 };
  const accounts = rows.map((r) => {
    const opening = Number(r.opening);
    const debit = Number(r.period_debit);
    const credit = Number(r.period_credit);
    const closing = opening + debit - credit;
    tot.opening += opening;
    tot.debit += debit;
    tot.credit += credit;
    tot.closing += closing;
    return {
      code: r.code,
      name: r.name,
      type: r.type,
      category: r.category,
      opening: fromMinor(opening),
      debit: fromMinor(debit),
      credit: fromMinor(credit),
      closing: fromMinor(closing),
    };
  });
  return {
    from: f === '0000-01-01' ? null : f,
    to: t === '9999-12-31' ? null : t,
    accounts,
    totals: {
      opening: fromMinor(tot.opening),
      debit: fromMinor(tot.debit),
      credit: fromMinor(tot.credit),
      closing: fromMinor(tot.closing),
    },
    balanced: tot.opening === 0 && tot.debit === tot.credit && tot.closing === 0,
  };
}

async function ledger({ account, from, to } = {}) {
  const db = await getDb();
  if (!account) throw new AppError(422, 'Account is required');
  const acc = await db.get('SELECT * FROM accounts WHERE code = ?', [String(account)]);
  if (!acc) throw new AppError(404, `Account ${account} not found`);
  const [f, t] = dateRange(from, to);
  const op = await db.get(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b
     FROM journal_lines l JOIN journal_entries e ON e.doc_no = l.doc_no
     WHERE l.account_code = ? AND e.posting_date < ?`,
    [acc.code, f]
  );
  const rows = await db.all(
    `SELECT e.doc_no, e.posting_date, e.reference, e.header_text, e.status, l.line_no, l.debit, l.credit, l.line_text
     FROM journal_lines l JOIN journal_entries e ON e.doc_no = l.doc_no
     WHERE l.account_code = ? AND e.posting_date >= ? AND e.posting_date <= ?
     ORDER BY e.posting_date, e.doc_no, l.line_no LIMIT 5000`,
    [acc.code, f, t]
  );
  let run = Number(op.b);
  const opening = run;
  let td = 0;
  let tc = 0;
  const items = rows.map((r) => {
    const d = Number(r.debit);
    const c = Number(r.credit);
    run += d - c;
    td += d;
    tc += c;
    return {
      docNo: Number(r.doc_no),
      postingDate: r.posting_date,
      reference: r.reference,
      text: r.line_text || r.header_text,
      status: r.status,
      debit: fromMinor(d),
      credit: fromMinor(c),
      balance: fromMinor(run),
    };
  });
  return {
    account: mapAccount(acc),
    from: f === '0000-01-01' ? null : f,
    to: t === '9999-12-31' ? null : t,
    opening: fromMinor(opening),
    items,
    totals: { debit: fromMinor(td), credit: fromMinor(tc) },
    closing: fromMinor(run),
  };
}

function groupByCategory(rows, amountOf) {
  const map = new Map();
  let total = 0;
  for (const r of rows) {
    const amt = amountOf(r);
    if (amt === 0) continue;
    if (!map.has(r.category)) map.set(r.category, { category: r.category, accounts: [], minor: 0 });
    const g = map.get(r.category);
    g.accounts.push({ code: r.code, name: r.name, amount: fromMinor(amt) });
    g.minor += amt;
    total += amt;
  }
  return {
    groups: [...map.values()].map((g) => ({ category: g.category, accounts: g.accounts, total: fromMinor(g.minor) })),
    totalMinor: total,
  };
}

async function incomeStatement({ from, to } = {}) {
  const db = await getDb();
  const [f, t] = dateRange(from, to);
  const rows = await db.all(
    `SELECT a.code, a.name, a.type, a.category,
       COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr
     FROM accounts a
     JOIN journal_lines l ON l.account_code = a.code
     JOIN journal_entries e ON e.doc_no = l.doc_no
     WHERE a.type IN ('REVENUE', 'EXPENSE') AND e.posting_date >= ? AND e.posting_date <= ?
     GROUP BY a.code, a.name, a.type, a.category
     ORDER BY a.code`,
    [f, t]
  );
  const rev = groupByCategory(
    rows.filter((r) => r.type === 'REVENUE'),
    (r) => Number(r.cr) - Number(r.dr)
  );
  const exp = groupByCategory(
    rows.filter((r) => r.type === 'EXPENSE'),
    (r) => Number(r.dr) - Number(r.cr)
  );
  return {
    from: f === '0000-01-01' ? null : f,
    to: t === '9999-12-31' ? null : t,
    revenue: { groups: rev.groups, total: fromMinor(rev.totalMinor) },
    expenses: { groups: exp.groups, total: fromMinor(exp.totalMinor) },
    netIncome: fromMinor(rev.totalMinor - exp.totalMinor),
  };
}

async function balanceSheet({ asOf } = {}) {
  const db = await getDb();
  const date = optDate(asOf, todayStr(), 'As-of date');
  const rows = await db.all(
    `SELECT a.code, a.name, a.type, a.category,
       COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr
     FROM accounts a
     JOIN journal_lines l ON l.account_code = a.code
     JOIN journal_entries e ON e.doc_no = l.doc_no
     WHERE e.posting_date <= ?
     GROUP BY a.code, a.name, a.type, a.category
     ORDER BY a.code`,
    [date]
  );
  const ofType = (type) => rows.filter((r) => r.type === type);
  const assets = groupByCategory(ofType('ASSET'), (r) => Number(r.dr) - Number(r.cr));
  const liabilities = groupByCategory(ofType('LIABILITY'), (r) => Number(r.cr) - Number(r.dr));
  const equity = groupByCategory(ofType('EQUITY'), (r) => Number(r.cr) - Number(r.dr));
  // No year-end close is run, so cumulative profit/loss is shown as a separate equity line.
  const result = rows
    .filter((r) => r.type === 'REVENUE' || r.type === 'EXPENSE')
    .reduce((s, r) => s + (Number(r.cr) - Number(r.dr)), 0);
  const equityTotal = equity.totalMinor + result;
  return {
    asOf: date,
    assets: { groups: assets.groups, total: fromMinor(assets.totalMinor) },
    liabilities: { groups: liabilities.groups, total: fromMinor(liabilities.totalMinor) },
    equity: { groups: equity.groups, currentResult: fromMinor(result), total: fromMinor(equityTotal) },
    totalLiabilitiesAndEquity: fromMinor(liabilities.totalMinor + equityTotal),
    balanced: assets.totalMinor === liabilities.totalMinor + equityTotal,
  };
}

async function dashboard() {
  const db = await getDb();
  const s = getSettings();
  const month = monthBounds(s.today);
  const net = async (type, from, to) => {
    const r = await db.get(
      `SELECT COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr
       FROM journal_lines l JOIN accounts a ON a.code = l.account_code
       JOIN journal_entries e ON e.doc_no = l.doc_no
       WHERE a.type = ? AND e.posting_date >= ? AND e.posting_date <= ?`,
      [type, from, to]
    );
    return type === 'REVENUE' ? Number(r.cr) - Number(r.dr) : Number(r.dr) - Number(r.cr);
  };
  const cash = await db.get(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b
     FROM journal_lines l JOIN accounts a ON a.code = l.account_code
     JOIN journal_entries e ON e.doc_no = l.doc_no
     WHERE a.category = 'Cash and Bank' AND e.posting_date <= ?`,
    [s.today]
  );
  const [revM, expM, revY, expY] = await Promise.all([
    net('REVENUE', month.from, month.to),
    net('EXPENSE', month.from, month.to),
    net('REVENUE', s.fiscalYearStart, s.today),
    net('EXPENSE', s.fiscalYearStart, s.today),
  ]);

  // Last six months of revenue vs expense.
  const months = [];
  let y = Number(s.today.slice(0, 4));
  let m = Number(s.today.slice(5, 7));
  for (let i = 0; i < 6; i++) {
    months.unshift(`${y}-${pad(m)}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  const trendRows = await db.all(
    `SELECT e.period, a.type, COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr
     FROM journal_lines l JOIN accounts a ON a.code = l.account_code
     JOIN journal_entries e ON e.doc_no = l.doc_no
     WHERE a.type IN ('REVENUE', 'EXPENSE') AND e.period >= ? AND e.period <= ?
     GROUP BY e.period, a.type`,
    [months[0], months[5]]
  );
  const trend = months.map((p) => {
    const rv = trendRows.find((r) => r.period === p && r.type === 'REVENUE');
    const ex = trendRows.find((r) => r.period === p && r.type === 'EXPENSE');
    return {
      period: p,
      revenue: fromMinor(rv ? Number(rv.cr) - Number(rv.dr) : 0),
      expenses: fromMinor(ex ? Number(ex.dr) - Number(ex.cr) : 0),
    };
  });

  const counts = await db.get(
    `SELECT (SELECT COUNT(*) FROM journal_entries) AS docs,
            (SELECT COUNT(*) FROM accounts WHERE active = 1) AS accounts,
            (SELECT COUNT(*) FROM period_locks) AS locks`
  );
  const recent = await listJournals({ limit: 8 });
  return {
    settings: s,
    cash: fromMinor(cash.b),
    month: { revenue: fromMinor(revM), expenses: fromMinor(expM), netIncome: fromMinor(revM - expM) },
    fiscalYear: { revenue: fromMinor(revY), expenses: fromMinor(expY), netIncome: fromMinor(revY - expY) },
    trend,
    counts: { documents: Number(counts.docs), accounts: Number(counts.accounts), lockedPeriods: Number(counts.locks) },
    recent: recent.items,
  };
}

module.exports = {
  getSettings,
  listAccounts,
  createAccount,
  updateAccount,
  postJournal,
  getJournal,
  listJournals,
  reverseJournal,
  listPeriods,
  lockPeriod,
  unlockPeriod,
  trialBalance,
  ledger,
  incomeStatement,
  balanceSheet,
  dashboard,
  todayStr,
};
