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