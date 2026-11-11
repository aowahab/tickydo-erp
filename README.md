# Tickydo ERP - Finance (FI)

A working, SAP S/4HANA-style Finance module: chart of accounts, double-entry journal with
document numbers and reversals, period locking, and the core financial reports.

## What it does

| Area | Features |
|---|---|
| Chart of Accounts | G/L accounts by type (Asset, Liability, Equity, Revenue, Expense) and reporting category; create, edit, deactivate |
| Journal | Balanced double-entry postings, 10-digit document numbers (from 1000000000), posting vs document date |
| Corrections | Documents are never edited or deleted. A **reversal** posts a mirror document and marks the original *Reversed* |
| Period control | Lock any month to block posting and reversal dated inside it |
| Reports | Trial Balance (opening / movement / closing), General Ledger (running balance), Income Statement, Balance Sheet; CSV export and print |
| Dashboard | Cash balance, month and fiscal-year results, six-month trend, recent postings |

Every report is built from the same journal lines, and the Trial Balance and Balance Sheet
show a **Balanced** check so any inconsistency is visible immediately.

## Run locally

Requires Node 22+. No install step is needed locally (SQLite is built into Node 22).

```bash
npm run seed:demo   # optional: loads ~30 sample postings
npm start           # http://localhost:3000
npm test            # backend logic tests
```

Local mode stores data in `data/erp.db` and has no login. Set `APP_PASSWORD` to require one.

## Deploy on Vercel

1. Push this project to the GitHub repo connected to the Vercel project.
2. In Vercel, add a Postgres database (Storage / Marketplace, e.g. Neon) and connect it to the
   project. This sets `DATABASE_URL` (or `POSTGRES_URL`) automatically. Tables and the chart of
   accounts are created on first request.
3. In Project Settings > Environment Variables, set:
   - `APP_PASSWORD` - the sign-in password (**required**: without it the deployed app refuses all data requests)
   - `SESSION_SECRET` - a long random string
   - optional: `COMPANY_NAME` (default `Tickydo`), `FISCAL_YEAR_START_MONTH` (default `7`, i.e. July), `APP_TIMEZONE` (default `Asia/Dhaka`)
4. Redeploy.

Do **not** run `seed:demo` against production; it refuses to run on Postgres unless forced.

## Design notes

- **Money is stored as integer paisa**, never floats, so totals always reconcile exactly.
- **Balance is enforced twice**: in the posting logic (debits must equal credits, accounts must
  exist, be active and postable, period must be open) and by database CHECK constraints on each line.
- **Same SQL on both databases**: SQLite locally, Postgres on Vercel, through one small adapter (`lib/db.js`).
- **Fail-closed auth**: on Vercel with no `APP_PASSWORD`, the API returns 401/503 instead of exposing data.
  Sessions use an HMAC-signed, HttpOnly, SameSite=Strict cookie; write requests must be JSON.
- **No year-end close yet**: the Balance Sheet shows cumulative profit/loss as a separate equity line.

## API

All routes are under `/api`, JSON in and out.

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard`, `/settings` | Overview data, company and fiscal settings |
| GET / POST | `/accounts` | List / create G/L accounts |
| PATCH | `/accounts/:code` | Edit, activate or deactivate |
| GET / POST | `/journal` | List / post a document |
| GET | `/journal/:docNo` | One document with lines |
| POST | `/journal/:docNo/reverse` | Reverse a document |
| GET | `/periods` | Periods with document counts and lock status |
| POST | `/periods/:YYYY-MM/lock` or `/unlock` | Lock or unlock a month |
| GET | `/reports/trial-balance`, `/reports/ledger`, `/reports/income-statement`, `/reports/balance-sheet` | Reports (`from`, `to`, `asOf`, `account` query params) |

Example posting:

```json
POST /api/journal
{ "postingDate": "2026-11-05", "headerText": "Office rent",
  "lines": [ { "account": "510200", "debit": "85000" },
             { "account": "100200", "credit": "85000" } ] }
```

## Not built yet

Accounts payable / receivable sub-ledgers (vendors, customers, invoices), year-end closing,
multi-currency, user roles and an audit log, bank reconciliation, and Controlling (cost centres).
The journal and period foundations here are what those modules post into.
