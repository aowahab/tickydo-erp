'use strict';

const { AppError } = require('./errors');

// All money is stored as integer paisa (minor units) to avoid floating-point drift.
function toMinor(value, field = 'amount') {
  if (value === null || value === undefined || value === '') return 0;
  const s = String(value).trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new AppError(422, `${field}: "${value}" is not a valid amount (non-negative, max 2 decimals)`);
  }
  const [whole, frac = ''] = s.split('.');
  const minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(minor) || minor > 9e13) {
    throw new AppError(422, `${field}: amount is too large`);
  }
  return minor;
}

const fromMinor = (n) => Math.round(Number(n || 0)) / 100;

module.exports = { toMinor, fromMinor };
