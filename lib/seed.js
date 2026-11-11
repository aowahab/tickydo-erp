'use strict';

// [code, name, type, category]
const CHART_OF_ACCOUNTS = [
  ['100100', 'Cash in Hand', 'ASSET', 'Cash and Bank'],
  ['100200', 'Bank - Current Account', 'ASSET', 'Cash and Bank'],
  ['100300', 'Mobile Wallet (bKash/Nagad) Clearing', 'ASSET', 'Cash and Bank'],
  ['110100', 'Trade Receivables', 'ASSET', 'Receivables'],
  ['110200', 'Advance to Suppliers', 'ASSET', 'Advances and Prepayments'],
  ['110300', 'Prepaid Expenses', 'ASSET', 'Advances and Prepayments'],
  ['110400', 'Advance Income Tax (AIT)', 'ASSET', 'Tax Assets'],
  ['110500', 'VAT Input (Rebatable)', 'ASSET', 'Tax Assets'],
  ['150100', 'Computer Equipment', 'ASSET', 'Fixed Assets'],
  ['150200', 'Furniture and Fixtures', 'ASSET', 'Fixed Assets'],
  ['150900', 'Accumulated Depreciation', 'ASSET', 'Fixed Assets'],
  ['160100', 'Software and Intangibles', 'ASSET', 'Intangible Assets'],

  ['200100', 'Trade Payables', 'LIABILITY', 'Current Liabilities'],
  ['200200', 'Accrued Expenses', 'LIABILITY', 'Current Liabilities'],
  ['200300', 'Salaries Payable', 'LIABILITY', 'Current Liabilities'],
  ['200400', 'Unearned Revenue / Customer Deposits', 'LIABILITY', 'Current Liabilities'],
  ['210100', 'VAT Output Payable', 'LIABILITY', 'Tax Liabilities'],
  ['210200', 'Income Tax Payable', 'LIABILITY', 'Tax Liabilities'],
  ['210300', 'TDS / VDS Payable', 'LIABILITY', 'Tax Liabilities'],
  ['250100', 'Long-term Loan', 'LIABILITY', 'Non-current Liabilities'],

  ['300100', "Share Capital / Partners' Capital", 'EQUITY', 'Equity'],
  ['300200', 'Retained Earnings', 'EQUITY', 'Equity'],

  ['400100', 'Ticket Commission Revenue', 'REVENUE', 'Operating Revenue'],
  ['400200', 'Platform and Service Fee Revenue', 'REVENUE', 'Operating Revenue'],
  ['400300', 'Advertising Revenue', 'REVENUE', 'Operating Revenue'],
  ['490100', 'Other Income', 'REVENUE', 'Other Income'],

  ['500100', 'Payment Gateway Charges', 'EXPENSE', 'Cost of Services'],
  ['500200', 'Server and Cloud Hosting', 'EXPENSE', 'Cost of Services'],
  ['510100', 'Salaries and Wages', 'EXPENSE', 'Operating Expenses'],
  ['510200', 'Office Rent', 'EXPENSE', 'Operating Expenses'],
  ['510300', 'Utilities and Internet', 'EXPENSE', 'Operating Expenses'],
  ['510400', 'Marketing and Advertising', 'EXPENSE', 'Operating Expenses'],
  ['510500', 'Professional Fees', 'EXPENSE', 'Operating Expenses'],
  ['510600', 'Travel and Conveyance', 'EXPENSE', 'Operating Expenses'],
  ['510700', 'Depreciation Expense', 'EXPENSE', 'Operating Expenses'],
  ['510800', 'Bank Charges', 'EXPENSE', 'Operating Expenses'],
  ['510900', 'Miscellaneous Expense', 'EXPENSE', 'Operating Expenses'],
];

async function seedChartOfAccounts(db) {
  const row = await db.get('SELECT COUNT(*) AS n FROM accounts');
  if (Number(row.n) > 0) return;
  const now = new Date().toISOString();
  for (const [code, name, type, category] of CHART_OF_ACCOUNTS) {
    await db.run(
      `INSERT INTO accounts (code, name, type, category, is_postable, active, created_at)
       VALUES (?, ?, ?, ?, 1, 1, ?) ON CONFLICT (code) DO NOTHING`,
      [code, name, type, category, now]
    );
  }
}

module.exports = { seedChartOfAccounts, CHART_OF_ACCOUNTS };
