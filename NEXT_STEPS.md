# Tickydo ERP: Next Steps Checklist

Written 2026-11-11. This file is the hand-off: the person (Abdul) can follow the "You" items,
and Claude can pick up the "Claude" items in a later session by reading this file first.

## Update (later on 2026-11-11): what the existing repo contained

The GitHub repo `aowahab/tickydo-erp` (`main`) already held a working app: an Express 5 server
(`server.js`), a 157 KB single-page UI (`Tickydo_ERP_Accounting___Financial_Management.html`),
per-user login with bcrypt and sessions stored in Postgres, rate limiting and helmet.
The "fresh start" choice was made before this was known. The new code lives on branch
`finance-module`; `main` and the production deployment are untouched.
Before merging, compare the two apps: the old one has per-user logins and rate limiting that
the new one lacks (it has a single shared password). Merging removes the old files from the
working tree (they stay in git history).

## Current status

- [x] Finance (FI) module built from scratch in `tickydo-erp/` (Node, no framework)
- [x] Chart of accounts (35 seeded accounts), double-entry journal, reversals, period locks
- [x] Reports: Trial Balance, General Ledger, Income Statement, Balance Sheet (CSV + print)
- [x] Dashboard, login (password), fail-closed security on Vercel
- [x] 10 backend tests pass; full browser test (Chrome) passes: all pages, posting, reversal, period lock, XSS check, mobile layout
- [ ] **Not deployed.** Nothing has been pushed to GitHub or Vercel yet.

## Why it is not deployed yet (blockers)

1. Claude could not attach `aowahab/tickydo-erp`: "link your GitHub account to let Claude access repositories".
2. Vercel project `tickydo-erp` (team `tickydo`) has no Postgres database yet.
3. `APP_PASSWORD` is not set on Vercel (the deployed app refuses all data requests without it, by design).
4. The live production site is still the OLD code (deployment `GkK9dgnH...`, from `main`).
   The newest deployment (`9jaUDZwN...`, codespace branch) is in `ERROR`; its build log has not been read.

## Part A: Things you do

- [ ] **A1. Choose how the code reaches GitHub** (pick one)
  - Option 1 (preferred): link your GitHub account in Claude, then tell Claude "go ahead". Claude then does all of Part B.
  - Option 2 (manual): unzip `tickydo-erp-finance.zip` and push it yourself:
    ```bash
    git clone https://github.com/aowahab/tickydo-erp.git
    cd tickydo-erp
    git checkout -b finance-module
    # keep .git; remove everything else
    find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
    cp -R /path/to/unzipped/tickydo-erp/. .      # copies the new project in
    git add -A && git commit -m "Add Finance (FI) module"
    git push -u origin finance-module            # then open a pull request
    ```
- [ ] **A2. Add a Postgres database in Vercel**: project `tickydo-erp` > Storage > Create (e.g. Neon) > Connect to project. Confirm `DATABASE_URL` (or `POSTGRES_URL`) appears under Environment Variables.
- [ ] **A3. Set environment variables** (Project Settings > Environment Variables, Production + Preview). Enter these yourself in Vercel; do not paste the password into chat:
  - `APP_PASSWORD`: sign-in password (required)
  - `SESSION_SECRET`: long random string (required)
  - optional: `COMPANY_NAME` (default Tickydo), `FISCAL_YEAR_START_MONTH` (default 7 = July), `APP_TIMEZONE` (default Asia/Dhaka)
- [ ] **A4. Decide about the old code**: the "fresh start" choice means the old app on `main` is replaced when the PR merges. If you want to keep it, create a backup branch from `main` first.

## Part B: Things Claude does next (needs A1, A2, A3)

- [ ] **B1. Attach the repo** with push access (`add_repo`, owner `aowahab`, repo `tickydo-erp`), create branch `finance-module`, replace the contents with this project (the repo has no `.github/` folder), commit and push. Commit messages and PR text must carry the attribution lines from the session reminder.
- [ ] **B2. Read the failed deployment's build log** (`list_deployments` then `get_deployment` / `list_deployment_events`) to see whether the old `ERROR` is a repo problem that the replacement also fixes.
- [ ] **B3. Watch the preview deployment** of the PR. Needs Vercel team access (`authorize_team_access` for team `team_XOmJgviaTuTDR1m5bishpKRy` if the connection asks again).
- [ ] **B4. Verify on Postgres, the one path never run in testing.** The Postgres adapter in `lib/db.js` could not be exercised in the build session (no network to install `pg`, no Postgres server). On the preview URL:
  - `GET /api/session` returns `authenticated: false`; wrong password returns 401; right password signs in
  - Chart of accounts is seeded (35 accounts) on first request
  - Post a document; list shows document number `1000000000`
  - Post an unbalanced entry: expect a 422 message
  - Reverse the document; original shows Reversed
  - Trial Balance and Balance Sheet both show **Balanced**
  - Check `get_runtime_errors` and `get_runtime_logs` for SQL errors. Likeliest trouble spots: SUM/COUNT type parsing, `ON CONFLICT`, LIKE on text, `RETURNING` in the number range update
- [ ] **B5. Remove any leftover test documents** from the production database, then merge the PR so production serves the new app.
- [ ] **B6. Confirm Vercel SSO protection** setting is what you want for this project (currently on for all deployments except custom domains).

## Part C: Known gaps and risks

- No database-level lock against editing posted lines (the app never edits or deletes them, but a direct SQL user could). Add triggers when moving to Postgres hardening.
- Single shared password, no user roles, no audit log of who unlocked a period.
- Login delay is a simple 600 ms pause, not real rate limiting (serverless has no shared memory). Add Vercel Firewall rate limit on `/api/login`.
- No year-end close: the Balance Sheet shows cumulative profit/loss as a separate equity line.
- Single currency (BDT).

## Part D: Build order for the rest of the ERP

Each module posts into the same journal, so reports stay consistent. Suggested order:

1. [ ] Accounts payable and receivable sub-ledgers: vendors, customers, invoices, payments, ageing (posts to Trade Payables / Receivables)
2. [ ] Year-end closing (moves profit/loss to Retained Earnings, opens the new fiscal year)
3. [ ] User accounts, roles (view / post / lock periods) and an audit log
4. [ ] Bank reconciliation, bKash/Nagad clearing reconciliation
5. [ ] Controlling: cost centres and profit centres
6. [ ] VAT/TDS/AIT tax reports for Bangladesh
7. [ ] Procurement (MM): purchase orders, goods receipt, invoice verification
8. [ ] Sales (SD): quotations, sales orders, billing
9. [ ] Multi-currency

## Where things are

- Code: `tickydo-erp/` (`lib/` backend logic, `api/index.js` Vercel entry, `server.js` local server, `public/` UI, `test/`, `scripts/demo.js`)
- Run tests: `npm test`. Local server: `npm start`. Demo data: `npm run seed:demo`
- Full description, API list and design notes: `README.md`
