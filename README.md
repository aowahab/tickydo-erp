# Tickydo ERP

The app is served as one Node.js service. Express serves the existing HTML UI and its API; PostgreSQL stores users, accounts, transactions, and sessions.

## Local setup

1. Install Node.js 20+ and PostgreSQL.
2. Create a PostgreSQL database and copy `.env.example` to `.env`.
3. Set `DATABASE_URL`, a random `SESSION_SECRET` of at least 32 characters, and the initial `ADMIN_NAME`, `ADMIN_PHONE`, and `ADMIN_PASSWORD` (exactly 4 digits).
4. Run `npm install`, then `npm start`.
5. Open `http://localhost:3000`.

The first startup creates the initial Super Admin and sample chart of accounts/journal entries. The initial admin credentials are read from environment variables and are not stored in the repository. Later restarts do not reset the admin password.

Super Admins can create or reset staff passwords using exactly 4 digits. Four-digit passwords are weak; use this policy only if that tradeoff is acceptable. The initial Super Admin password follows the same rule.

Existing browser `localStorage` demo data is not imported. Back it up and migrate it separately before switching from the prototype; never use its hardcoded demo login for deployment.

## Journal posting and period close

New journal entries are saved as drafts and do not affect the general ledger, trial balance, or financial statements until posted. Drafts can be edited or deleted; posting locks the voucher against changes or deletion. Existing transactions are migrated as posted to preserve their current balances.

Super Admins can close a month from **Administration → Period Close** after all drafts for that month have been posted or deleted. A closed period rejects new drafts and postings and prevents draft changes. Reopen the period to resume activity; reopening does not modify posted entries. Posting and period-close rules are enforced by the API, not only by the browser UI.

## Railway deployment

1. Push this repository to GitHub and create a Railway project from that repository.
2. Add a PostgreSQL service to the same Railway project.
3. In the app service, add `DATABASE_URL` using the PostgreSQL service's connection reference, and set `NODE_ENV=production`, `SESSION_SECRET`, `ADMIN_NAME`, `ADMIN_PHONE`, and a unique four-digit `ADMIN_PASSWORD` as service variables. Use a generated session secret; do not commit `.env`.
4. Deploy the app service. Railway uses `npm start` and checks `/health`.

Keep the PostgreSQL service and its persistent volume attached to the Railway project. The app expects one company dataset; it is not multi-tenant. Back up the database before production use.

## Vercel deployment

1. Import the GitHub repository into Vercel. The included `vercel.json` routes requests to the Express function and includes the HTML UI in its deployment bundle.
2. Attach a PostgreSQL database reachable from Vercel and add `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_NAME`, `ADMIN_PHONE`, and a unique four-digit `ADMIN_PASSWORD` under **Project Settings → Environment Variables**. Use a generated session secret of at least 32 characters; do not commit `.env`.
3. Set `NODE_ENV=production`, then deploy. The app initializes its database when the function starts; the first successful startup creates the initial Super Admin and sample data.

Vercel functions are serverless, so use an external PostgreSQL provider with a connection option suitable for serverless workloads. Keep the database persistent and back it up before production use.

## Netlify deployment

The Netlify configuration publishes a generated `dist/index.html` and routes `/api/*` and `/health` to an Express-backed Netlify Function. The function uses PostgreSQL for persistent users, accounting data, and sessions; this is not a static-only deployment. Run the following commands from the repository root:

1. Back up any data in the currently deployed site before replacing it. The previous browser `localStorage` demo data is not automatically imported into PostgreSQL.
2. Install project dependencies and authenticate/link the existing Netlify site:

   ```sh
   npm ci
   npx --yes netlify-cli login
   npx --yes netlify-cli link
   ```

   In the link prompt, select the existing **tickydo-erp** site.
3. Before production deploy, configure these variables in the Netlify dashboard under **Site configuration → Environment variables**, with the **Functions** scope enabled:
   - `DATABASE_URL`: persistent PostgreSQL connection URL reachable from Netlify.
   - `SESSION_SECRET`: at least 32 random characters.
   - `ADMIN_NAME`, `ADMIN_PHONE`, and a unique four-digit `ADMIN_PASSWORD` for first-time database setup.
   - `NODE_ENV=production`.

   Do not put secret values in `netlify.toml`, source control, or terminal command arguments. Netlify applies function environment variables at deploy time; deploy again after changing them.
4. Preview the build (optional), then publish to production:

   ```sh
   npx --yes netlify-cli deploy --build
   npx --yes netlify-cli deploy --build --prod
   ```

   `netlify.toml` configures the build and deploy output; no separate manual copy of HTML or function files is needed.
5. Verify `https://tickydo-erp.netlify.app/health` returns `{"status":"ok"}`. Then sign in with the initial admin credentials and verify journal posting and period close.

The first successful function startup initializes the database and creates the initial Super Admin and sample chart of accounts/journal entries. Existing PostgreSQL databases keep their records; existing transactions are migrated as posted. Netlify Functions are ephemeral, so do not use local files or in-memory sessions as persistent storage. Back up the database before production use.