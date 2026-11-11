'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

for (const k of Object.keys(process.env)) {
  if (/DATABASE_URL|POSTGRES_URL/.test(k)) delete process.env[k];
}
const { dbUrl } = require('../lib/db');

test('no database variable means SQLite (empty URL)', () => {
  assert.equal(dbUrl(), '');
});

test('plain DATABASE_URL wins', () => {
  process.env.DATABASE_URL = 'postgres://plain';
  process.env.MY_X_DATABASE_URL = 'postgres://prefixed';
  assert.equal(dbUrl(), 'postgres://plain');
  delete process.env.DATABASE_URL;
});

test('prefixed pooled URL is found and the unpooled/no-ssl variants are ignored', () => {
  process.env.MY_X_DATABASE_URL_UNPOOLED = 'postgres://unpooled';
  process.env.MY_X_POSTGRES_URL_NO_SSL = 'postgres://nossl';
  process.env.MY_X_POSTGRES_PRISMA_URL = 'postgres://prisma';
  assert.equal(dbUrl(), 'postgres://prefixed');
  delete process.env.MY_X_DATABASE_URL;
  assert.equal(dbUrl(), '', 'only unpooled/no-ssl/prisma variants left: must not be used');
});
