'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.APP_USERNAME = 'tester';
process.env.APP_PASSWORD = 'correct-horse';
process.env.SESSION_SECRET = 'unit-test-secret';
delete process.env.VERCEL;
const auth = require('../lib/auth');

test('login needs both the right username and the right password', () => {
  assert.equal(auth.mode(), 'password');
  assert.equal(auth.usernameRequired(), true);
  assert.equal(auth.checkCredentials('tester', 'correct-horse'), true);
  assert.equal(auth.checkCredentials('tester', 'wrong'), false);
  assert.equal(auth.checkCredentials('someone', 'correct-horse'), false);
  assert.equal(auth.checkCredentials('', ''), false);
  assert.equal(auth.checkCredentials(undefined, undefined), false);
});

test('session tokens verify, and tampered or expired tokens are rejected', () => {
  const token = auth.makeToken();
  assert.equal(auth.isAuthenticated({ cookie: `erp_session=${token}` }), true);
  assert.equal(auth.isAuthenticated({ cookie: `erp_session=${token}x` }), false);
  assert.equal(auth.isAuthenticated({ cookie: 'erp_session=1.abc' }), false);
  assert.equal(auth.isAuthenticated({}), false);
});

test('without a password the deployed app fails closed', () => {
  delete process.env.APP_PASSWORD;
  process.env.VERCEL = '1';
  assert.equal(auth.mode(), 'locked');
  assert.equal(auth.isAuthenticated({}), false);
  assert.equal(auth.checkCredentials('tester', 'anything'), false);
});
