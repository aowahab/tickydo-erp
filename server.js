import 'dotenv/config';
import bcrypt from 'bcryptjs';
import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const isServerless = process.env.VERCEL === '1' || process.env.NETLIFY_FUNCTION === 'true' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
const htmlPath = resolve(process.cwd(), 'Tickydo_ERP_Accounting___Financial_Management.html');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: isServerless ? 1 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000
});
const PgSessionStore = connectPgSimple(session);
let databaseReady;

const elementTypes = new Set(['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']);
const subCategories = new Set([
    'Current Assets', 'Non-Current Assets', 'Current Liabilities', 'Non-Current Liabilities', 'Equity',
    'Operating Revenue', 'Operating Expense', 'Investing Income', 'Investing Expense',
    'Financing Income', 'Financing Expense', 'Income Taxes'
]);
const subCategoryTypes = new Map([
    ['Current Assets', 'Asset'], ['Non-Current Assets', 'Asset'],
    ['Current Liabilities', 'Liability'], ['Non-Current Liabilities', 'Liability'],
    ['Equity', 'Equity'], ['Operating Revenue', 'Revenue'], ['Investing Income', 'Revenue'],
    ['Financing Income', 'Revenue'], ['Operating Expense', 'Expense'], ['Investing Expense', 'Expense'],
    ['Financing Expense', 'Expense'], ['Income Taxes', 'Expense']
]);
const staffRoles = new Set(['Senior Accountant', 'Auditor', 'Finance Manager', 'Assistant Accountant']);

const seedAccounts = [
    ['acc_101', 'TF-101', 'Cash in Hand', 'Asset', 'Current Assets'],
    ['acc_102', 'TF-102', 'Commercial Bank Account (BDT)', 'Asset', 'Current Assets'],
    ['acc_103', 'TF-103', 'Mobile Financial Services Wallet', 'Asset', 'Current Assets'],
    ['acc_104', 'TF-104', 'Accounts Receivable', 'Asset', 'Current Assets'],
    ['acc_105', 'TF-105', 'Office & IT Equipment', 'Asset', 'Non-Current Assets'],
    ['acc_201', 'TF-201', 'Accounts Payable', 'Liability', 'Current Liabilities'],
    ['acc_202', 'TF-202', 'Long-Term Bank Loan', 'Liability', 'Non-Current Liabilities'],
    ['acc_301', 'TF-301', "Owner's Equity / Share Capital", 'Equity', 'Equity'],
    ['acc_401', 'TF-401', 'Operational Service Revenue', 'Revenue', 'Operating Revenue'],
    ['acc_402', 'TF-402', 'Commission & Advisory Income', 'Revenue', 'Operating Revenue'],
    ['acc_403', 'TF-403', 'Investment & Dividend Income', 'Revenue', 'Investing Income'],
    ['acc_501', 'TF-501', 'Cloud Server & Software Licensing', 'Expense', 'Operating Expense'],
    ['acc_502', 'TF-502', 'Office Rent & Utilities', 'Expense', 'Operating Expense'],
    ['acc_503', 'TF-503', 'Salaries & Professional Fees', 'Expense', 'Operating Expense'],
    ['acc_504', 'TF-504', 'Interest on Bank Borrowings', 'Expense', 'Financing Expense'],
    ['acc_505', 'TF-505', 'Corporate Income Tax Expense', 'Expense', 'Income Taxes']
];

const seedTransactions = [
    ['tx_101', '2026-10-01', 'TV-1001', 'Head Office', 'acc_102', 'acc_301', 1500000, 'Initial corporate capital deposit into commercial bank account'],
    ['tx_102', '2026-10-05', 'TV-1002', 'Corporate HQ', 'acc_105', 'acc_102', 185000, 'Acquisition of workstations and accounting hardware'],
    ['tx_103', '2026-10-12', 'TV-1003', 'Dhaka Division', 'acc_101', 'acc_401', 450000, 'Cash collection from operational service delivery'],
    ['tx_104', '2026-10-18', 'TV-1004', 'Online Portal', 'acc_103', 'acc_402', 125000, 'Advisory and digital service commission received via MFS wallet'],
    ['tx_105', '2026-10-22', 'TV-1005', 'Head Office', 'acc_501', 'acc_102', 35000, 'Monthly cloud hosting and database infrastructure billing'],
    ['tx_106', '2026-10-26', 'TV-1006', 'Head Office', 'acc_502', 'acc_101', 55000, 'Office premises rent and electricity settlement'],
    ['tx_107', '2026-10-28', 'TV-1007', 'Head Office', 'acc_503', 'acc_102', 195000, 'Monthly staff salaries and professional honorarium disbursement']
];

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.tailwindcss.com'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com', 'data:'],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"]
        }
    }
}));
app.use(express.json({ limit: '1mb' }));
app.use((_req, _res, next) => {
    if (!databaseReady) return next(new Error('Database initialization has not started.'));
    databaseReady.then(() => next(), next);
});
app.use(session({
    name: 'tickydo.sid',
    secret: process.env.SESSION_SECRET || '',
    store: new PgSessionStore({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000
    }
}));
app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    try {
        const origin = new URL(req.get('origin') || '');
        if (origin.origin !== `${req.protocol}://${req.get('host')}`) {
            return res.status(403).json({ error: 'Request origin is not allowed.' });
        }
        next();
    } catch {
        res.status(403).json({ error: 'Request origin is not allowed.' });
    }
});

function safeUser(user) {
    return { id: user.id, name: user.name, role: user.role, phone: user.phone, isSuper: user.is_super };
}

function requireAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'Authentication required.' });
    pool.query('SELECT 1 FROM app_users WHERE id = $1', [req.session.userId]).then(result => {
        if (!result.rowCount) {
            req.session.destroy(() => {});
            return res.status(401).json({ error: 'Authentication required.' });
        }
        next();
    }).catch(next);
}

async function requireSuperAdmin(req, res, next) {
    try {
        const result = await pool.query('SELECT is_super FROM app_users WHERE id = $1', [req.session.userId]);
        if (!result.rows[0]?.is_super) return res.status(403).json({ error: 'Super Admin access required.' });
        next();
    } catch (error) {
        next(error);
    }
}

function validateAccount(account) {
    return account && typeof account.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(account.id) &&
        typeof account.folio === 'string' && account.folio.trim().length > 0 && account.folio.length <= 80 &&
        typeof account.name === 'string' && account.name.trim().length > 0 && account.name.length <= 200 &&
        elementTypes.has(account.type) && subCategories.has(account.subCategory) && subCategoryTypes.get(account.subCategory) === account.type;
}

function validateTransaction(transaction, accountIds) {
    const amount = Number(transaction?.amount);
    const date = typeof transaction?.date === 'string' ? new Date(`${transaction.date}T00:00:00.000Z`) : null;
    return transaction && typeof transaction.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(transaction.id) &&
        /^\d{4}-\d{2}-\d{2}$/.test(transaction.date) && date && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === transaction.date &&
        typeof transaction.ref === 'string' && transaction.ref.trim().length > 0 && transaction.ref.length <= 100 &&
        typeof transaction.branch === 'string' && transaction.branch.length <= 120 &&
        typeof transaction.desc === 'string' && transaction.desc.trim().length > 0 && transaction.desc.length <= 1000 &&
        Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000_000 &&
        ['draft', 'posted'].includes(transaction.status) &&
        typeof transaction.debitId === 'string' && typeof transaction.creditId === 'string' &&
        transaction.debitId !== transaction.creditId && accountIds.has(transaction.debitId) && accountIds.has(transaction.creditId);
}

function isValidPeriod(period) {
    return typeof period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

async function initializeDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS app_users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            phone TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_super BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            folio TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            sub_category TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            date DATE NOT NULL,
            ref TEXT NOT NULL,
            branch TEXT NOT NULL,
            debit_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
            credit_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
            amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
            description TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted')),
            CHECK (debit_id <> credit_id)
        );
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted'));
        CREATE TABLE IF NOT EXISTS accounting_periods (
            period TEXT PRIMARY KEY CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
            closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            closed_by TEXT REFERENCES app_users(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS app_state (
            singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
            revision BIGINT NOT NULL DEFAULT 0
        );
        INSERT INTO app_state (singleton, revision) VALUES (TRUE, 0) ON CONFLICT (singleton) DO NOTHING;
    `);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', ['725293035901']);
        const userCount = await client.query('SELECT COUNT(*)::int AS count FROM app_users');
        if (userCount.rows[0].count === 0) {
            const { ADMIN_NAME, ADMIN_PHONE, ADMIN_PASSWORD } = process.env;
            if (!ADMIN_NAME || !ADMIN_PHONE || !/^\d{4}$/.test(ADMIN_PASSWORD)) {
                throw new Error('First startup requires ADMIN_NAME, ADMIN_PHONE, and a four-digit ADMIN_PASSWORD.');
            }
            const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
            await client.query(
                'INSERT INTO app_users (id, name, role, phone, password_hash, is_super) VALUES ($1, $2, $3, $4, $5, TRUE)',
                ['usr_' + randomUUID(), ADMIN_NAME, 'Super Admin', ADMIN_PHONE, passwordHash]
            );
        }

        const accountCount = await client.query('SELECT COUNT(*)::int AS count FROM accounts');
        if (accountCount.rows[0].count === 0) {
            for (const [id, folio, name, type, subCategory] of seedAccounts) {
                await client.query(
                    'INSERT INTO accounts (id, folio, name, type, sub_category) VALUES ($1, $2, $3, $4, $5)',
                    [id, folio, name, type, subCategory]
                );
            }
            for (const [id, date, ref, branch, debitId, creditId, amount, description] of seedTransactions) {
                await client.query(
                    'INSERT INTO transactions (id, date, ref, branch, debit_id, credit_id, amount, description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                    [id, date, ref, branch, debitId, creditId, amount, description]
                );
            }
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

app.get('/health', async (_req, res, next) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok' });
    } catch (error) {
        next(error);
    }
});

app.get('/api/auth/session', async (req, res, next) => {
    if (!req.session.userId) return res.json({ user: null });
    try {
        const result = await pool.query('SELECT id, name, role, phone, is_super FROM app_users WHERE id = $1', [req.session.userId]);
        if (!result.rows[0]) {
            req.session.destroy(() => {});
            return res.json({ user: null });
        }
        res.json({ user: safeUser(result.rows[0]) });
    } catch (error) {
        next(error);
    }
});

app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
    try {
        const phone = String(req.body?.phone || '').trim();
        const password = String(req.body?.password || '');
        const result = await pool.query('SELECT * FROM app_users WHERE phone = $1', [phone]);
        const user = result.rows[0];
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Invalid phone number or password.' });
        }
        req.session.regenerate(error => {
            if (error) return next(error);
            req.session.userId = user.id;
            req.session.save(saveError => {
                if (saveError) return next(saveError);
                res.json({ user: safeUser(user) });
            });
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/auth/logout', requireAuth, (req, res, next) => {
    req.session.destroy(error => {
        if (error) return next(error);
        res.clearCookie('tickydo.sid', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
        res.status(204).end();
    });
});

app.get('/api/state', requireAuth, async (req, res, next) => {
    try {
        const [userResult, usersResult, accountsResult, transactionsResult, closedPeriodsResult, revisionResult] = await Promise.all([
            pool.query('SELECT id, name, role, phone, is_super FROM app_users WHERE id = $1', [req.session.userId]),
            pool.query('SELECT id, name, role, phone, is_super FROM app_users ORDER BY name'),
            pool.query('SELECT id, folio, name, type, sub_category AS "subCategory" FROM accounts ORDER BY folio'),
            pool.query('SELECT id, TO_CHAR(date, \'YYYY-MM-DD\') AS date, ref, branch, debit_id AS "debitId", credit_id AS "creditId", amount::float8 AS amount, description AS "desc", status FROM transactions ORDER BY date DESC, ref'),
            pool.query('SELECT period FROM accounting_periods ORDER BY period DESC'),
            pool.query('SELECT revision FROM app_state WHERE singleton = TRUE')
        ]);
        res.json({
            currentUser: safeUser(userResult.rows[0]),
            users: usersResult.rows.map(safeUser),
            accounts: accountsResult.rows,
            transactions: transactionsResult.rows,
            closedPeriods: closedPeriodsResult.rows.map(row => row.period),
            revision: Number(revisionResult.rows[0].revision)
        });
    } catch (error) {
        next(error);
    }
});

app.put('/api/state', requireAuth, async (req, res, next) => {
    const { accounts: nextAccounts, transactions: nextTransactions, revision } = req.body || {};
    if (!Array.isArray(nextAccounts) || !Array.isArray(nextTransactions) ||
        !Number.isSafeInteger(revision) || revision < 0 ||
        nextAccounts.some(account => !validateAccount(account)) ||
        nextTransactions.some(transaction => !validateTransaction(transaction, new Set(nextAccounts.map(account => account.id))))) {
        return res.status(400).json({ error: 'Invalid account or journal data.' });
    }

    const accountIds = nextAccounts.map(account => account.id);
    const folios = nextAccounts.map(account => account.folio.toLowerCase());
    const transactionIds = nextTransactions.map(transaction => transaction.id);
    if (new Set(accountIds).size !== accountIds.length || new Set(folios).size !== folios.length ||
        new Set(transactionIds).size !== transactionIds.length) {
        return res.status(400).json({ error: 'IDs, account codes, and transaction IDs must be unique.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const revisionResult = await client.query('SELECT revision FROM app_state WHERE singleton = TRUE FOR UPDATE');
        if (Number(revisionResult.rows[0].revision) !== revision) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'The data changed in another session. Latest data has been reloaded; review and retry your changes.' });
        }
        const currentTransactionsResult = await client.query(
            `SELECT id, TO_CHAR(date, 'YYYY-MM-DD') AS date, ref, branch, debit_id AS "debitId",
                credit_id AS "creditId", amount::float8 AS amount, description AS "desc", status FROM transactions`
        );
        const currentTransactions = new Map(currentTransactionsResult.rows.map(transaction => [transaction.id, transaction]));
        const closedPeriodsResult = await client.query('SELECT period FROM accounting_periods');
        const closedPeriods = new Set(closedPeriodsResult.rows.map(row => row.period));
        const nextTransactionsById = new Map(nextTransactions.map(transaction => [transaction.id, transaction]));
        for (const transaction of nextTransactions) {
            const existing = currentTransactions.get(transaction.id);
            if (!existing && transaction.status !== 'draft') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'New journal entries must be saved as drafts before posting.' });
            }
            if (existing?.status === 'draft' && transaction.status !== 'draft') {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Draft journal entries must be posted through the posting workflow.' });
            }
            if (existing?.status === 'posted') {
                const unchanged = ['date', 'ref', 'branch', 'debitId', 'creditId', 'desc', 'status'].every(key => transaction[key] === existing[key]) &&
                    Number(transaction.amount) === Number(existing.amount);
                if (!unchanged) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({ error: 'Posted journal entries are immutable.' });
                }
            }
            if (transaction.status === 'draft' && closedPeriods.has(transaction.date.slice(0, 7))) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Journal entries cannot be saved in a closed accounting period.' });
            }
        }
        for (const existing of currentTransactions.values()) {
            const nextTransaction = nextTransactionsById.get(existing.id);
            if (existing.status === 'posted' && !nextTransaction) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Posted journal entries cannot be deleted.' });
            }
            if (existing.status === 'draft' && closedPeriods.has(existing.date.slice(0, 7)) &&
                (!nextTransaction || nextTransaction.date !== existing.date)) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Draft entries in a closed accounting period cannot be changed or deleted.' });
            }
        }
        const currentAccountIds = (await client.query('SELECT id FROM accounts')).rows.map(row => row.id);
        const removedAccountIds = currentAccountIds.filter(id => !accountIds.includes(id));
        if (removedAccountIds.length) {
            const userResult = await client.query('SELECT is_super FROM app_users WHERE id = $1', [req.session.userId]);
            if (!userResult.rows[0]?.is_super) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Only Super Admin can delete accounts.' });
            }
            const linked = nextTransactions.some(transaction => removedAccountIds.includes(transaction.debitId) || removedAccountIds.includes(transaction.creditId));
            if (linked) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Accounts referenced by journal entries cannot be deleted.' });
            }
        }

        for (const account of nextAccounts) {
            await client.query(
                `INSERT INTO accounts (id, folio, name, type, sub_category) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (id) DO UPDATE SET folio = EXCLUDED.folio, name = EXCLUDED.name, type = EXCLUDED.type, sub_category = EXCLUDED.sub_category`,
                [account.id, account.folio.trim(), account.name.trim(), account.type, account.subCategory]
            );
        }
        for (const transaction of nextTransactions) {
            await client.query(
                `INSERT INTO transactions (id, date, ref, branch, debit_id, credit_id, amount, description, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, ref = EXCLUDED.ref, branch = EXCLUDED.branch,
                 debit_id = EXCLUDED.debit_id, credit_id = EXCLUDED.credit_id, amount = EXCLUDED.amount,
                 description = EXCLUDED.description, status = EXCLUDED.status`,
                [transaction.id, transaction.date, transaction.ref.trim(), transaction.branch.trim(), transaction.debitId, transaction.creditId, transaction.amount, transaction.desc.trim(), transaction.status]
            );
        }
        await client.query('DELETE FROM transactions WHERE NOT (id = ANY($1::text[]))', [transactionIds]);
        if (removedAccountIds.length) {
            await client.query('DELETE FROM accounts WHERE id = ANY($1::text[])', [removedAccountIds]);
        }
        const nextRevision = await client.query('UPDATE app_state SET revision = revision + 1 WHERE singleton = TRUE RETURNING revision');
        await client.query('COMMIT');
        res.json({ saved: true, revision: Number(nextRevision.rows[0].revision) });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

app.post('/api/transactions/:id/post', requireAuth, async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT revision FROM app_state WHERE singleton = TRUE FOR UPDATE');
        const transactionResult = await client.query(
            `SELECT id, TO_CHAR(date, 'YYYY-MM-DD') AS date, status FROM transactions WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        const transaction = transactionResult.rows[0];
        if (!transaction) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Journal entry not found.' });
        }
        if (transaction.status !== 'draft') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Only draft journal entries can be posted.' });
        }
        const period = transaction.date.slice(0, 7);
        const closedPeriod = await client.query('SELECT 1 FROM accounting_periods WHERE period = $1', [period]);
        if (closedPeriod.rowCount) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Journal entries cannot be posted in a closed accounting period.' });
        }
        await client.query("UPDATE transactions SET status = 'posted' WHERE id = $1", [transaction.id]);
        const revisionResult = await client.query('UPDATE app_state SET revision = revision + 1 WHERE singleton = TRUE RETURNING revision');
        await client.query('COMMIT');
        res.json({ posted: true, revision: Number(revisionResult.rows[0].revision) });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

app.post('/api/periods/:period/close', requireAuth, requireSuperAdmin, async (req, res, next) => {
    const { period } = req.params;
    if (!isValidPeriod(period)) return res.status(400).json({ error: 'Provide a valid accounting period in YYYY-MM format.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT revision FROM app_state WHERE singleton = TRUE FOR UPDATE');
        const draftResult = await client.query(
            "SELECT COUNT(*)::int AS count FROM transactions WHERE TO_CHAR(date, 'YYYY-MM') = $1 AND status = 'draft'",
            [period]
        );
        if (draftResult.rows[0].count > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `Post or delete all ${draftResult.rows[0].count} draft journal entries before closing this period.` });
        }
        const closeResult = await client.query(
            'INSERT INTO accounting_periods (period, closed_by) VALUES ($1, $2) ON CONFLICT (period) DO NOTHING RETURNING period',
            [period, req.session.userId]
        );
        if (!closeResult.rowCount) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'This accounting period is already closed.' });
        }
        const revisionResult = await client.query('UPDATE app_state SET revision = revision + 1 WHERE singleton = TRUE RETURNING revision');
        await client.query('COMMIT');
        res.json({ closed: true, revision: Number(revisionResult.rows[0].revision) });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

app.delete('/api/periods/:period', requireAuth, requireSuperAdmin, async (req, res, next) => {
    const { period } = req.params;
    if (!isValidPeriod(period)) return res.status(400).json({ error: 'Provide a valid accounting period in YYYY-MM format.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT revision FROM app_state WHERE singleton = TRUE FOR UPDATE');
        const periodResult = await client.query('DELETE FROM accounting_periods WHERE period = $1 RETURNING period', [period]);
        if (!periodResult.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Accounting period is not closed.' });
        }
        const revisionResult = await client.query('UPDATE app_state SET revision = revision + 1 WHERE singleton = TRUE RETURNING revision');
        await client.query('COMMIT');
        res.json({ reopened: true, revision: Number(revisionResult.rows[0].revision) });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

app.post('/api/users', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const name = String(req.body?.name || '').trim();
        const phone = String(req.body?.phone || '').trim();
        const role = String(req.body?.role || '');
        const password = String(req.body?.password || '');
        if (!name || name.length > 150 || !/^\+?[0-9]{8,15}$/.test(phone) || !staffRoles.has(role) || !/^\d{4}$/.test(password)) {
            return res.status(400).json({ error: 'Provide a name, valid phone number, staff role, and a four-digit password.' });
        }
        const id = 'usr_' + randomUUID();
        const passwordHash = await bcrypt.hash(password, 12);
        await pool.query(
            'INSERT INTO app_users (id, name, role, phone, password_hash, is_super) VALUES ($1, $2, $3, $4, $5, FALSE)',
            [id, name, role, phone, passwordHash]
        );
        res.status(201).json({ id, name, role, phone, isSuper: false });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'This phone number is already registered.' });
        next(error);
    }
});

app.patch('/api/users/:id/password', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const password = String(req.body?.password || '');
        if (!/^\d{4}$/.test(password)) return res.status(400).json({ error: 'Password must contain exactly four digits.' });
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await pool.query('UPDATE app_users SET password_hash = $1 WHERE id = $2 AND is_super = FALSE RETURNING id', [passwordHash, req.params.id]);
        if (!result.rowCount) return res.status(404).json({ error: 'Staff user not found.' });
        await pool.query("DELETE FROM user_sessions WHERE sess->>'userId' = $1", [req.params.id]);
        res.status(204).end();
    } catch (error) {
        next(error);
    }
});

app.delete('/api/users/:id', requireAuth, requireSuperAdmin, async (req, res, next) => {
    if (req.params.id === req.session.userId) return res.status(400).json({ error: 'You cannot remove your own account.' });
    try {
        const result = await pool.query('DELETE FROM app_users WHERE id = $1 AND is_super = FALSE RETURNING id', [req.params.id]);
        if (!result.rowCount) return res.status(404).json({ error: 'Staff user not found.' });
        res.status(204).end();
    } catch (error) {
        next(error);
    }
});

app.get('/', (_req, res) => res.sendFile(htmlPath));
app.get('/Tickydo_ERP_Accounting___Financial_Management.html', (_req, res) => res.sendFile(htmlPath));
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
});

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters.');
}

databaseReady = initializeDatabase();
databaseReady.catch(error => console.error('Database initialization failed:', error));
export default app;

if (!isServerless) {
    databaseReady.then(() => {
        app.listen(port, '0.0.0.0', () => console.log(`Tickydo ERP listening on port ${port}`));
    }).catch(async error => {
        console.error(error);
        await pool.end();
        process.exitCode = 1;
    });
    process.on('SIGTERM', async () => {
        await pool.end();
        process.exit(0);
    });
}