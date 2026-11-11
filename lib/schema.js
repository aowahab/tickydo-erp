'use strict';

// Portable DDL: runs unchanged on SQLite (local) and Postgres (Vercel).
module.exports = [
  `CREATE TABLE IF NOT EXISTS accounts (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
    category TEXT NOT NULL DEFAULT 'General',
    is_postable INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS journal_entries (
    doc_no BIGINT PRIMARY KEY,
    posting_date TEXT NOT NULL,
    doc_date TEXT NOT NULL,
    period TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'SA',
    reference TEXT NOT NULL DEFAULT '',
    header_text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','REVERSED')),
    reversal_of BIGINT,
    reversed_by BIGINT,
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS journal_lines (
    doc_no BIGINT NOT NULL REFERENCES journal_entries(doc_no),
    line_no INTEGER NOT NULL,
    account_code TEXT NOT NULL REFERENCES accounts(code),
    debit BIGINT NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
    line_text TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (doc_no, line_no),
    CHECK (debit = 0 OR credit = 0),
    CHECK (debit + credit > 0)
  )`,
  `CREATE TABLE IF NOT EXISTS period_locks (
    period TEXT PRIMARY KEY,
    locked_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS number_ranges (
    name TEXT PRIMARY KEY,
    next_no BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_je_posting_date ON journal_entries (posting_date)`,
  `CREATE INDEX IF NOT EXISTS idx_jl_account ON journal_lines (account_code)`,
  `INSERT INTO number_ranges (name, next_no) VALUES ('JE', 999999999) ON CONFLICT (name) DO NOTHING`,
];
