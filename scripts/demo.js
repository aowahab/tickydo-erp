'use strict';

// Loads realistic sample postings so the dashboard and reports have something to show.
// Refuses to run against a Postgres (production) database unless --force is given.
const fin = require('../lib/finance');
const { getDb } = require('../lib/db');

const line = (account, debit, credit, text = '') => ({ account, debit, credit, text });
const pad = (n) => String(n).padStart(2, '0');

function monthsBack(today, n) {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7)) - n;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  return `${y}-${pad(m)}`;
}

(async () => {
  const db = await getDb();
  if (db.kind === 'pg' && !process.argv.includes('--force')) {
    console.error('Refusing to load demo data into a Postgres database. Re-run with --force if you really mean it.');
    process.exit(1);
  }
  const existing = await db.get('SELECT COUNT(*) AS n FROM journal_entries');
  if (Number(existing.n) > 0 && !process.argv.includes('--force')) {
    console.error('Database already has postings; skipping demo load (use --force to add anyway).');
    process.exit(1);
  }

  const today = fin.todayStr();
  const first = monthsBack(today, 4);
  let count = 0;
  const post = async (postingDate, headerText, lines, reference = '') => {
    await fin.postJournal({ postingDate, headerText, reference, lines }, 'demo');
    count++;
  };

  await post(`${first}-02`, 'Partners capital introduced', [line('100200', '3000000', 0), line('300100', 0, '3000000')], 'CAP-001');
  await post(`${first}-05`, 'Laptops and office equipment', [line('150100', '420000', 0), line('100200', 0, '420000')], 'PUR-001');

  for (let i = 3; i >= 0; i--) {
    const ym = monthsBack(today, i);
    const k = 3 - i; // growth factor so the trend chart has a visible shape
    const commission = 380000 + k * 95000;
    const fees = 120000 + k * 30000;
    await post(`${ym}-08`, 'Ticket commission settled via bKash', [line('100300', commission, 0), line('400100', 0, commission)], `BKS-${ym}`);
    await post(`${ym}-12`, 'Platform service fees received', [line('100200', fees, 0), line('400200', 0, fees)], `FEE-${ym}`);
    await post(`${ym}-15`, 'Payment gateway charges', [line('500100', Math.round(commission * 0.018), 0), line('100300', 0, Math.round(commission * 0.018))], `PG-${ym}`);
    await post(`${ym}-18`, 'Cloud hosting', [line('500200', 42000 + k * 4000, 0), line('100200', 0, 42000 + k * 4000)], `AWS-${ym}`);
    await post(`${ym}-25`, 'Office rent', [line('510200', 85000, 0), line('100200', 0, 85000)], `RENT-${ym}`);
    await post(`${ym}-28`, 'Salaries', [line('510100', 310000, 0), line('100200', 0, 310000)], `PAY-${ym}`);
    await post(`${ym}-28`, 'Marketing campaign', [line('510400', 60000 + k * 15000, 0), line('200100', 0, 60000 + k * 15000)], `MKT-${ym}`);
  }
  await post(`${monthsBack(today, 2)}-30`, 'Depreciation on equipment', [line('510700', '8750', 0), line('150900', 0, '8750')], 'DEP-AUTO');

  console.log(`Loaded ${count} demo documents.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
