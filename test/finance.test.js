'use strict';

process.env.SQLITE_FILE = ':memory:';
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../lib/finance');
const { toMinor } = require('../lib/money');

const line = (account, debit, credit, text = '') => ({ account, debit, credit, text });

test('money parsing is exact and strict', () => {
  assert.equal(toMinor('1,234.50'), 123450);
  assert.equal(toMinor(0.1 + 0.2 > 0 ? '0.30' : '0'), 30);
  assert.equal(toMinor(''), 0);
  assert.throws(() => toMinor('12.345'));
  assert.throws(() => toMinor('-5'));
  assert.throws(() => toMinor('abc'));
});

test('chart of accounts is seeded', async () => {
  const accs = await f.listAccounts();
  assert.ok(accs.length >= 30);
  assert.ok(accs.find((a) => a.code === '100200'));
});

test('balanced entry posts; unbalanced and bad lines are rejected', async () => {
  const je = await f.postJournal({
    postingDate: '2026-07-05',
    reference: 'CAP-1',
    headerText: 'Initial capital',
    lines: [line('100200', '5000000', 0), line('300100', 0, '5000000')],
  });
  assert.equal(je.docNo, 1000000000);
  assert.equal(je.total, 5000000);

  await assert.rejects(
    f.postJournal({ postingDate: '2026-07-06', lines: [line('100200', '100', 0), line('300100', 0, '99.99')] }),
    /out of balance/
  );
  await assert.rejects(
    f.postJournal({ postingDate: '2026-07-06', lines: [line('100200', '100', '100'), line('300100', 0, '100')] }),
    /not both/
  );
  await assert.rejects(f.postJournal({ postingDate: '2026-07-06', lines: [line('100200', '100', 0)] }), /at least two/);
  await assert.rejects(
    f.postJournal({ postingDate: '2026-07-06', lines: [line('999999', '100', 0), line('300100', 0, '100')] }),
    /does not exist/
  );
  await assert.rejects(
    f.postJournal({ postingDate: '2026-13-40', lines: [line('100200', '100', 0), line('300100', 0, '100')] }),
    /valid date/
  );
});

test('reports: trial balance, income statement and balance sheet all balance', async () => {
  await f.postJournal({
    postingDate: '2026-07-10',
    headerText: 'Commission received',
    lines: [line('100200', '200000', 0), line('400100', 0, '200000')],
  });
  await f.postJournal({
    postingDate: '2026-07-31',
    headerText: 'Rent',
    lines: [line('510200', '60000.50', 0), line('100200', 0, '60000.50')],
  });
  const tb = await f.trialBalance({ from: '2026-07-01', to: '2026-07-31' });
  assert.equal(tb.balanced, true);
  assert.equal(tb.totals.debit, tb.totals.credit);

  const is = await f.incomeStatement({ from: '2026-07-01', to: '2026-07-31' });
  assert.equal(is.revenue.total, 200000);
  assert.equal(is.expenses.total, 60000.5);
  assert.equal(is.netIncome, 139999.5);

  const bs = await f.balanceSheet({ asOf: '2026-07-31' });
  assert.equal(bs.balanced, true);
  assert.equal(bs.assets.total, 5000000 + 200000 - 60000.5);
  assert.equal(bs.equity.currentResult, 139999.5);
});

test('trial balance opening column rolls forward correctly', async () => {
  const tb = await f.trialBalance({ from: '2026-07-31', to: '2026-07-31' });
  const bank = tb.accounts.find((a) => a.code === '100200');
  assert.equal(bank.opening, 5000000 + 200000);
  assert.equal(bank.credit, 60000.5);
  assert.equal(bank.closing, 5139999.5);
  assert.equal(tb.balanced, true);
});

test('general ledger shows running balance', async () => {
  const gl = await f.ledger({ account: '100200', from: '2026-07-01', to: '2026-07-31' });
  assert.equal(gl.opening, 0);
  assert.equal(gl.items.length, 3);
  assert.equal(gl.closing, 5139999.5);
  assert.equal(gl.items[2].balance, 5139999.5);
});

test('reversal nets the original to zero and cannot be repeated', async () => {
  const je = await f.postJournal({
    postingDate: '2026-08-02',
    headerText: 'Posted in error',
    lines: [line('510900', '1000', 0), line('100100', 0, '1000')],
  });
  const rev = await f.reverseJournal(je.docNo, { postingDate: '2026-08-03', reason: 'Wrong account' });
  assert.equal(rev.reversalOf, je.docNo);
  assert.equal(rev.docType, 'RV');
  const orig = await f.getJournal(je.docNo);
  assert.equal(orig.status, 'REVERSED');
  assert.equal(orig.reversedBy, rev.docNo);

  const gl = await f.ledger({ account: '510900' });
  assert.equal(gl.closing, 0);

  await assert.rejects(f.reverseJournal(je.docNo), /already reversed/);
  await assert.rejects(f.reverseJournal(rev.docNo), /cannot be reversed/);
});

test('locked period blocks posting and reversal until unlocked', async () => {
  await f.lockPeriod('2026-09');
  await assert.rejects(
    f.postJournal({ postingDate: '2026-09-15', lines: [line('100100', '10', 0), line('100200', 0, '10')] }),
    /locked/
  );
  await f.unlockPeriod('2026-09');
  const ok = await f.postJournal({
    postingDate: '2026-09-15',
    lines: [line('100100', '10', 0), line('100200', 0, '10')],
  });
  assert.ok(ok.docNo);
});

test('accounts: create, duplicate guard, deactivate rules', async () => {
  const a = await f.createAccount({ code: '510950', name: 'Test Expense', type: 'EXPENSE', category: 'Operating Expenses' });
  assert.equal(a.active, true);
  await assert.rejects(f.createAccount({ code: '510950', name: 'Dup', type: 'EXPENSE' }), /already exists/);
  await assert.rejects(f.createAccount({ code: '12', name: 'Bad', type: 'EXPENSE' }), /4 to 10 digits/);
  const off = await f.updateAccount('510950', { active: false });
  assert.equal(off.active, false);
  await assert.rejects(
    f.postJournal({ postingDate: '2026-10-01', lines: [line('510950', '5', 0), line('100100', 0, '5')] }),
    /inactive/
  );
  // 100200 has a non-zero balance, so it must not be deactivated.
  await assert.rejects(f.updateAccount('100200', { active: false }), /non-zero balance/);
});

test('journal list and dashboard work', async () => {
  const list = await f.listJournals({ q: 'rent' });
  assert.equal(list.total, 1);
  const d = await f.dashboard();
  assert.equal(d.trend.length, 6);
  assert.ok(d.counts.documents >= 5);
});
