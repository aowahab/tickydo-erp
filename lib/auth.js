'use strict';

const crypto = require('crypto');

const SESSION_MS = 12 * 60 * 60 * 1000;

// 'password' when APP_PASSWORD is set; 'locked' (fail closed) on Vercel/production without one;
// 'open' only for local development.
function mode() {
  if (process.env.APP_PASSWORD) return 'password';
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') return 'locked';
  return 'open';
}

const secret = () => `${process.env.SESSION_SECRET || ''}|${process.env.APP_PASSWORD || ''}`;
const sign = (exp) => crypto.createHmac('sha256', secret()).update(String(exp)).digest('hex');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const usernameRequired = () => !!process.env.APP_USERNAME;

// Both checks always run, so timing does not reveal which field was wrong.
function checkCredentials(username, password) {
  if (mode() !== 'password') return false;
  const userOk = usernameRequired() ? safeEqual(username || '', process.env.APP_USERNAME) : true;
  const passOk = safeEqual(password || '', process.env.APP_PASSWORD);
  return userOk && passOk;
}

function makeToken() {
  const exp = Date.now() + SESSION_MS;
  return `${exp}.${sign(exp)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(exp));
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAuthenticated(headers) {
  const m = mode();
  if (m === 'open') return true;
  if (m === 'locked') return false;
  return verifyToken(parseCookies(headers.cookie).erp_session);
}

function sessionCookie(token, secure) {
  return `erp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
}

const clearCookie = (secure) => `erp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;

module.exports = { mode, usernameRequired, checkCredentials, makeToken, isAuthenticated, sessionCookie, clearCookie };
