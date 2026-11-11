'use strict';

/* ================= utilities ================= */

const $ = (sel, root = document) => root.querySelector(sel);

// Tiny DOM builder. Text is always inserted as text nodes (never HTML), so user data cannot inject markup.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  const a = attrs || {};
  if ('type' in a) el.setAttribute('type', a.type);
  for (const [k, v] of Object.entries(a)) {
    if (k === 'type' || v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  if (value !== undefined) el.value = value;
  return el;
}

// replaceChildren() would render null/false as the text "null"/"false"; drop empties first.
const nodes = (...items) => items.flat(Infinity).filter((x) => x != null && x !== false);

const nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => nf.format(Number(n) || 0);
const amt = (n) => (Number(n) ? money(n) : '');
const taka = (n) => (Number(n) < 0 ? '-' : '') + '৳ ' + money(Math.abs(Number(n) || 0));
const drcr = (n) => {
  n = Number(n) || 0;
  return n === 0 ? '0.00' : money(Math.abs(n)) + (n > 0 ? ' Dr' : ' Cr');
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fdate = (s) => (s ? `${s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}` : '');
const fperiod = (p) => `${MON[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}`;

// Integer paisa from a user-typed amount; NaN if invalid. Mirrors the server's rules.
function paisa(str) {
  const s = String(str || '').trim().replace(/,/g, '');
  if (s === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [w, f = ''] = s.split('.');
  return Number(w) * 100 + Number((f + '00').slice(0, 2));
}

function toast(msg, isErr) {
  const t = h('div', { class: 't' + (isErr ? ' err' : '') }, msg);
  $('#toast').append(t);
  setTimeout(() => t.remove(), isErr ? 6000 : 3200);
}

// Wrap an async handler so failures surface as a toast instead of an unhandled rejection.
const on = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (e) {
    toast(e.message, true);
  }
};

const dlg = $('#dlg');
dlg.addEventListener('click', (e) => {
  if (e.target === dlg) closeDialog();
});
function openDialog(title, body, footer) {
  dlg.replaceChildren(
    ...nodes(
      h('div', { class: 'dlg-head' }, h('h2', null, title), h('button', { class: 'ghost small', 'aria-label': 'Close', onclick: closeDialog }, '✕')),
      h('div', { class: 'dlg-body' }, body),
      footer && footer.length ? h('div', { class: 'dlg-foot' }, footer) : null
    )
  );
  if (!dlg.open) dlg.showModal();
}
function closeDialog() {
  if (dlg.open) dlg.close();
}

function downloadCsv(filename, rows) {
  const cell = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ================= api / state ================= */

const state = { settings: null, accounts: [], session: null };

async function api(path, opts = {}) {
  const { method = 'GET', body, params } = opts;
  let url = path;
  if (params) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    if ([...q].length) url += '?' + q;
  }
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    /* non-JSON error page */
  }
  if (res.status === 401) {
    showLogin('password');
    throw new Error('Please sign in');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadAccounts() {
  state.accounts = await api('/api/accounts', { params: { includeInactive: '1' } });
}

const accountLabel = (a) => `${a.code} — ${a.name}`;

/* ================= shared view pieces ================= */

function pageHead(title, sub, ...actions) {
  return h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null), h('div', { class: 'spacer' }), actions);
}

function dateField(label, value) {
  const input = h('input', { type: 'date', value });
  const el = h('label', { class: 'field' }, label, input);
  el.input = input;
  return el;
}

const chipForType = { ASSET: 'blue', LIABILITY: 'warn', EQUITY: 'gray', REVENUE: 'good', EXPENSE: 'gray' };
const typeChip = (t) => h('span', { class: 'chip ' + (chipForType[t] || 'gray') }, t.charAt(0) + t.slice(1).toLowerCase());
const statusChip = (s) => h('span', { class: 'chip ' + (s === 'POSTED' ? 'good' : 'gray') }, s === 'POSTED' ? 'Posted' : 'Reversed');

function reportActions(getRows, filename) {
  return [
    h('div', { class: 'spacer', style: 'flex:1' }),
    h('button', { class: 'no-print', onclick: on(() => { const r = getRows(); if (!r) throw new Error('Run the report first'); downloadCsv(filename, r); }) }, 'Export CSV'),
    h('button', { class: 'no-print', onclick: () => window.print() }, 'Print'),
  ];
}

function reportTitle(name, range) {
  return h('div', { class: 'report-title' }, h('h2', null, name), h('div', { class: 'muted' }, `${state.settings.company} · ${range}`));
}

const rangeText = (from, to) => (from && to ? `${fdate(from)} to ${fdate(to)}` : from ? `From ${fdate(from)}` : to ? `Up to ${fdate(to)}` : 'All dates');

/* ================= views ================= */

const VIEWS = {};

/* ---------- Home ---------- */
VIEWS.home = async function () {
  const d = await api('/api/dashboard');
  const m = d.month;
  const tile = (label, value, hint, cls) =>
    h('div', { class: 'card tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value ' + (cls || '') }, taka(value)), h('div', { class: 'hint' }, hint));
  const monthName = fperiod(d.settings.today.slice(0, 7));

  const hasTrend = d.trend.some((t) => t.revenue || t.expenses);
  const max = Math.max(1, ...d.trend.flatMap((t) => [t.revenue, t.expenses]));
  const chart = hasTrend
    ? h(
        'div',
        { class: 'trend', role: 'img', 'aria-label': 'Revenue and expenses for the last six months' },
        d.trend.map((t) =>
          h(
            'div',
            { class: 'col', title: `${fperiod(t.period)}\nRevenue: ${money(t.revenue)}\nExpenses: ${money(t.expenses)}` },
            h('div', { class: 'bars' }, h('div', { class: 'bar rev', style: `height:${(t.revenue / max) * 100}%` }), h('div', { class: 'bar exp', style: `height:${(t.expenses / max) * 100}%` })),
            h('div', { class: 'lbl' }, MON[+t.period.slice(5, 7) - 1])
          )
        )
      )
    : h('div', { class: 'loading' }, 'No revenue or expenses posted in the last six months.');

  const recentRows = d.recent.length
    ? d.recent.map((e) =>
        h(
          'tr',
          { class: 'click', onclick: on(() => showDoc(e.docNo)) },
          h('td', { class: 'mono' }, String(e.docNo)),
          h('td', null, fdate(e.postingDate)),
          h('td', null, e.headerText || e.reference || '—'),
          h('td', { class: 'num' }, money(e.total)),
          h('td', null, statusChip(e.status))
        )
      )
    : [h('tr', null, h('td', { class: 'empty', colspan: 5 }, 'No documents yet. Post your first journal entry to get started.'))];

  return h(
    'div',
    null,
    pageHead(`${state.settings.company} Finance`, `Overview · ${fdate(d.settings.today)}`, h('button', { class: 'primary', onclick: () => (location.hash = '#/post') }, '+ Post journal entry')),
    h(
      'div',
      { class: 'tiles' },
      tile('Cash and bank balance', d.cash, 'As of today', d.cash < 0 ? 'neg' : ''),
      tile(`Revenue · ${monthName}`, m.revenue, 'Posted this month'),
      tile(`Expenses · ${monthName}`, m.expenses, 'Posted this month'),
      tile(`Net result · ${monthName}`, m.netIncome, m.netIncome >= 0 ? 'Profit this month' : 'Loss this month', m.netIncome > 0 ? 'pos' : m.netIncome < 0 ? 'neg' : '')
    ),
    h(
      'div',
      { class: 'grid-2' },
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Last six months'), h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:var(--primary)' }), 'Revenue'), h('span', null, h('i', { style: 'background:#f0a030' }), 'Expenses'))),
        h('div', { class: 'card-body' }, chart)
      ),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, `Fiscal year to date`)),
        h(
          'div',
          { class: 'card-body' },
          h(
            'dl',
            { class: 'kv' },
            h('dt', null, 'Since'), h('dd', null, fdate(d.settings.fiscalYearStart)),
            h('dt', null, 'Revenue'), h('dd', { class: 'mono' }, taka(d.fiscalYear.revenue)),
            h('dt', null, 'Expenses'), h('dd', { class: 'mono' }, taka(d.fiscalYear.expenses)),
            h('dt', null, 'Net result'), h('dd', { class: 'mono' }, h('b', null, taka(d.fiscalYear.netIncome))),
            h('dt', null, 'Documents'), h('dd', null, String(d.counts.documents)),
            h('dt', null, 'Active accounts'), h('dd', null, String(d.counts.accounts)),
            h('dt', null, 'Locked periods'), h('dd', null, String(d.counts.lockedPeriods))
          )
        )
      )
    ),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Recent postings'), h('div', { style: 'flex:1' }), h('a', { href: '#/journal' }, 'View all')),
      h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Document'), h('th', null, 'Posting date'), h('th', null, 'Text'), h('th', { class: 'num' }, 'Amount'), h('th', null, 'Status'))), h('tbody', null, recentRows)))
    )
  );
};

/* ---------- Chart of accounts ---------- */
VIEWS.accounts = async function () {
  await loadAccounts();
  const f = { type: '', q: '', inactive: false };
  const tbody = h('tbody');

  function draw() {
    const q = f.q.trim().toLowerCase();
    const rows = state.accounts.filter((a) => (!f.type || a.type === f.type) && (f.inactive || a.active) && (!q || a.code.startsWith(q) || a.name.toLowerCase().includes(q)));
    tbody.replaceChildren(
      ...(rows.length
        ? rows.map((a) =>
            h(
              'tr',
              null,
              h('td', { class: 'mono' }, a.code),
              h('td', null, a.name),
              h('td', null, typeChip(a.type)),
              h('td', null, a.category),
              h('td', null, a.isPostable ? 'Yes' : 'No'),
              h('td', null, a.active ? h('span', { class: 'chip good' }, 'Active') : h('span', { class: 'chip gray' }, 'Inactive')),
              h(
                'td',
                { class: 'num' },
                h('a', { href: `#/ledger?account=${a.code}` }, 'Ledger'),
                ' ',
                h('button', { class: 'small', onclick: () => accountDialog(a, draw) }, 'Edit'),
                ' ',
                h('button', { class: 'small', onclick: on(async () => { await api('/api/accounts/' + a.code, { method: 'PATCH', body: { active: !a.active } }); await loadAccounts(); draw(); toast(`Account ${a.code} ${a.active ? 'deactivated' : 'activated'}`); }) }, a.active ? 'Deactivate' : 'Activate')
              )
            )
          )
        : [h('tr', null, h('td', { class: 'empty', colspan: 7 }, 'No accounts match your filters'))])
    );
  }

  const typeSel = h('select', { onchange: (e) => { f.type = e.target.value; draw(); } }, h('option', { value: '' }, 'All types'), ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((t) => h('option', { value: t }, t.charAt(0) + t.slice(1).toLowerCase())));
  const search = h('input', { type: 'search', placeholder: 'Account no. or name', oninput: (e) => { f.q = e.target.value; draw(); } });
  const inactive = h('input', { type: 'checkbox', onchange: (e) => { f.inactive = e.target.checked; draw(); } });
  draw();

  return h(
    'div',
    null,
    pageHead('Chart of Accounts', 'General ledger accounts, grouped by type and reporting category', h('button', { class: 'primary', onclick: () => accountDialog(null, draw) }, '+ New account')),
    h('div', { class: 'filters' }, h('label', { class: 'field' }, 'Type', typeSel), h('label', { class: 'field' }, 'Search', search), h('label', { class: 'check' }, inactive, 'Show inactive')),
    h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Account', 'Name', 'Type', 'Category', 'Postable', 'Status', ''].map((c) => h('th', null, c)))), tbody)))
  );
};

function accountDialog(acc, redraw) {
  const isNew = !acc;
  const code = h('input', { value: acc ? acc.code : '', inputmode: 'numeric', maxlength: 10, placeholder: '4 to 10 digits', disabled: !isNew });
  const name = h('input', { value: acc ? acc.name : '', maxlength: 80 });
  const type = h('select', { disabled: !isNew }, ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((t) => h('option', { value: t, selected: acc && acc.type === t }, t.charAt(0) + t.slice(1).toLowerCase())));
  const cats = [...new Set(state.accounts.map((a) => a.category))].sort();
  const category = h('input', { value: acc ? acc.category : '', maxlength: 50, list: 'catlist', placeholder: 'e.g. Operating Expenses' });
  const postable = h('input', { type: 'checkbox', checked: acc ? acc.isPostable : true });
  const body = h(
    'div',
    { class: 'form-grid' },
    h('label', { class: 'field' }, 'Account number', code),
    h('label', { class: 'field' }, 'Account name', name),
    h('label', { class: 'field' }, 'Account type' + (isNew ? '' : ' (fixed)'), type),
    h('label', { class: 'field' }, 'Reporting category', category),
    h('datalist', { id: 'catlist' }, cats.map((c) => h('option', { value: c }))),
    h('label', { class: 'check' }, postable, 'Allow direct posting')
  );
  openDialog(isNew ? 'New G/L account' : `Edit account ${acc.code}`, body, [
    h('button', { onclick: closeDialog }, 'Cancel'),
    h(
      'button',
      {
        class: 'primary',
        onclick: on(async () => {
          const payload = { name: name.value, category: category.value, isPostable: postable.checked };
          if (isNew) await api('/api/accounts', { method: 'POST', body: { ...payload, code: code.value.trim(), type: type.value } });
          else await api('/api/accounts/' + acc.code, { method: 'PATCH', body: payload });
          await loadAccounts();
          redraw();
          closeDialog();
          toast(isNew ? 'Account created' : 'Account updated');
        }),
      },
      isNew ? 'Create account' : 'Save changes'
    ),
  ]);
}

/* ---------- Post journal entry ---------- */
VIEWS.post = async function () {
  await loadAccounts();
  const postable = state.accounts.filter((a) => a.active && a.isPostable);
  const today = state.settings.today;
  const postingDate = h('input', { type: 'date', value: today, required: true });
  const docDate = h('input', { type: 'date', value: today });
  const reference = h('input', { maxlength: 40, placeholder: 'Voucher or invoice no.' });
  const headerText = h('input', { maxlength: 100, placeholder: 'What is this entry for?' });
  const tbody = h('tbody');
  const rows = [];
  let lastTd = 0;
  let lastTc = 0;

  const statusEl = h('span', { class: 'chip gray' }, 'Incomplete');
  const tdEl = h('b', null, '0.00');
  const tcEl = h('b', null, '0.00');
  const postBtn = h('button', { class: 'primary', disabled: true, onclick: on(submit) }, 'Post document');

  function recalc() {
    let td = 0;
    let tc = 0;
    let ok = rows.length >= 2;
    for (const r of rows) {
      const code = r.acc.value.trim();
      const a = state.accounts.find((x) => x.code === code);
      r.name.className = 'accname';
      if (!code) { r.name.textContent = ''; ok = false; }
      else if (!a) { r.name.textContent = 'Unknown account'; r.name.className = 'accname err'; ok = false; }
      else if (!a.active || !a.isPostable) { r.name.textContent = a.name + ' (not open for posting)'; r.name.className = 'accname err'; ok = false; }
      else r.name.textContent = a.name;
      const d = paisa(r.deb.value);
      const c = paisa(r.cre.value);
      if (Number.isNaN(d) || Number.isNaN(c)) ok = false;
      else {
        if (d === 0 && c === 0) ok = false;
        td += d;
        tc += c;
      }
    }
    lastTd = td;
    lastTc = tc;
    tdEl.textContent = money(td / 100);
    tcEl.textContent = money(tc / 100);
    const balanced = ok && td === tc && td > 0;
    if (balanced) { statusEl.className = 'chip good'; statusEl.textContent = 'Balanced'; }
    else if (td !== tc) { statusEl.className = 'chip bad'; statusEl.textContent = `Difference ${money(Math.abs(td - tc) / 100)}`; }
    else { statusEl.className = 'chip gray'; statusEl.textContent = 'Incomplete'; }
    postBtn.disabled = !(balanced && postingDate.value);
  }

  function addLine(pre = {}) {
    const acc = h('input', { list: 'acclist', value: pre.account || '', placeholder: 'Account no.', autocomplete: 'off', 'aria-label': 'Account' });
    const name = h('div', { class: 'accname' });
    const deb = h('input', { inputmode: 'decimal', value: pre.debit || '', placeholder: '0.00', 'aria-label': 'Debit' });
    const cre = h('input', { inputmode: 'decimal', value: pre.credit || '', placeholder: '0.00', 'aria-label': 'Credit' });
    const txt = h('input', { maxlength: 100, value: pre.text || '', placeholder: 'Line text (optional)', 'aria-label': 'Line text' });
    const row = { acc, name, deb, cre, txt, tr: null };
    const del = h('button', { type: 'button', class: 'ghost small', title: 'Remove line', 'aria-label': 'Remove line', onclick: () => { if (rows.length <= 2) return toast('An entry needs at least two lines', true); rows.splice(rows.indexOf(row), 1); row.tr.remove(); recalc(); } }, '✕');
    row.tr = h('tr', null, h('td', { class: 'acc' }, acc, name), h('td', { class: 'amt' }, deb), h('td', { class: 'amt' }, cre), h('td', null, txt), h('td', { class: 'del' }, del));
    acc.addEventListener('input', recalc);
    deb.addEventListener('input', () => { if (deb.value.trim()) cre.value = ''; recalc(); });
    cre.addEventListener('input', () => { if (cre.value.trim()) deb.value = ''; recalc(); });
    rows.push(row);
    tbody.append(row.tr);
    recalc();
  }

  async function submit() {
    postBtn.disabled = true;
    try {
      const doc = await api('/api/journal', {
        method: 'POST',
        body: {
          postingDate: postingDate.value,
          docDate: docDate.value || postingDate.value,
          reference: reference.value,
          headerText: headerText.value,
          lines: rows.map((r) => ({ account: r.acc.value.trim(), debit: r.deb.value.trim() || 0, credit: r.cre.value.trim() || 0, text: r.txt.value })),
        },
      });
      toast(`Document ${doc.docNo} posted`);
      location.hash = '#/journal?doc=' + doc.docNo;
    } catch (e) {
      toast(e.message, true);
      recalc();
    }
  }

  postingDate.addEventListener('input', recalc);
  addLine();
  addLine();

  return h(
    'div',
    null,
    pageHead('Post Journal Entry', 'Every document must balance: total debits equal total credits'),
    h('datalist', { id: 'acclist' }, postable.map((a) => h('option', { value: a.code }, a.name))),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-body' }, h('div', { class: 'form-grid' }, h('label', { class: 'field' }, 'Posting date', postingDate), h('label', { class: 'field' }, 'Document date', docDate), h('label', { class: 'field' }, 'Reference', reference), h('label', { class: 'field' }, 'Header text', headerText))),
      h('div', { class: 'table-wrap' }, h('table', { class: 'lines' }, h('thead', null, h('tr', null, h('th', null, 'G/L account'), h('th', { class: 'num' }, 'Debit'), h('th', { class: 'num' }, 'Credit'), h('th', null, 'Line text'), h('th', null, ''))), tbody)),
      h(
        'div',
        { class: 'balance-bar' },
        h('button', { type: 'button', onclick: () => { const diff = lastTd - lastTc; addLine(diff > 0 ? { credit: (diff / 100).toFixed(2) } : diff < 0 ? { debit: (-diff / 100).toFixed(2) } : {}); } }, '+ Add line'),
        statusEl,
        h('div', { class: 'totals' }, h('div', null, 'Total debit', tdEl), h('div', null, 'Total credit', tcEl)),
        postBtn
      )
    )
  );
};

/* ---------- Journal entries ---------- */
VIEWS.journal = async function (params) {
  const f = { from: '', to: '', q: '', page: 0 };
  const size = 25;
  const tbody = h('tbody');
  const pager = h('div', { class: 'card-body', style: 'display:flex;gap:10px;align-items:center' });

  async function load() {
    const d = await api('/api/journal', { params: { from: f.from, to: f.to, q: f.q.trim(), limit: size, offset: f.page * size } });
    tbody.replaceChildren(
      ...(d.items.length
        ? d.items.map((e) =>
            h(
              'tr',
              { class: 'click', onclick: on(() => showDoc(e.docNo)) },
              h('td', { class: 'mono' }, String(e.docNo)),
              h('td', null, fdate(e.postingDate)),
              h('td', null, e.reference || ''),
              h('td', null, e.headerText || '', e.reversalOf ? h('span', { class: 'chip gray', style: 'margin-left:6px' }, `Reversal of ${e.reversalOf}`) : null),
              h('td', { class: 'num' }, money(e.total)),
              h('td', null, statusChip(e.status))
            )
          )
        : [h('tr', null, h('td', { class: 'empty', colspan: 6 }, 'No documents found'))])
    );
    const pages = Math.max(1, Math.ceil(d.total / size));
    pager.replaceChildren(
      h('span', { class: 'muted' }, `${d.total} document${d.total === 1 ? '' : 's'}`),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'small', disabled: f.page === 0, onclick: on(() => { f.page--; return load(); }) }, 'Previous'),
      h('span', null, `Page ${f.page + 1} of ${pages}`),
      h('button', { class: 'small', disabled: f.page + 1 >= pages, onclick: on(() => { f.page++; return load(); }) }, 'Next')
    );
  }

  const from = dateField('Posting date from', '');
  const to = dateField('To', '');
  const q = h('input', { type: 'search', placeholder: 'Document no., reference or text' });
  const apply = on(() => { f.from = from.input.value; f.to = to.input.value; f.q = q.value; f.page = 0; return load(); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  await load();
  if (params.doc) {
    setTimeout(on(() => showDoc(params.doc)), 0);
    history.replaceState(null, '', '#/journal');
  }

  return h(
    'div',
    null,
    pageHead('Journal Entries', 'Posted accounting documents. Documents are never deleted; use reversal to correct them.', h('button', { class: 'primary', onclick: () => (location.hash = '#/post') }, '+ Post journal entry')),
    h('div', { class: 'filters' }, from, to, h('label', { class: 'field' }, 'Search', q), h('button', { onclick: apply }, 'Apply')),
    h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Document'), h('th', null, 'Posting date'), h('th', null, 'Reference'), h('th', null, 'Text'), h('th', { class: 'num' }, 'Amount'), h('th', null, 'Status'))), tbody)), pager)
  );
};

async function showDoc(docNo) {
  const d = await api('/api/journal/' + docNo);
  const body = h(
    'div',
    null,
    h(
      'dl',
      { class: 'kv' },
      h('dt', null, 'Status'), h('dd', null, statusChip(d.status), d.reversedBy ? h('span', null, ' reversed by ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); on(() => showDoc(d.reversedBy))(); } }, String(d.reversedBy))) : null),
      d.reversalOf ? [h('dt', null, 'Reversal of'), h('dd', null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); on(() => showDoc(d.reversalOf))(); } }, String(d.reversalOf)))] : null,
      h('dt', null, 'Posting date'), h('dd', null, fdate(d.postingDate)),
      h('dt', null, 'Document date'), h('dd', null, fdate(d.docDate)),
      h('dt', null, 'Period'), h('dd', null, fperiod(d.period)),
      h('dt', null, 'Reference'), h('dd', null, d.reference || '—'),
      h('dt', null, 'Header text'), h('dd', null, d.headerText || '—'),
      h('dt', null, 'Posted by'), h('dd', null, `${d.createdBy} · ${new Date(d.createdAt).toLocaleString('en-GB')}`)
    ),
    h(
      'div',
      { class: 'table-wrap card' },
      h(
        'table',
        null,
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Account'), h('th', null, 'Text'), h('th', { class: 'num' }, 'Debit'), h('th', { class: 'num' }, 'Credit'))),
        h('tbody', null, d.lines.map((l) => h('tr', null, h('td', null, String(l.lineNo)), h('td', null, h('a', { href: `#/ledger?account=${l.account}`, onclick: closeDialog }, l.account), ' ', l.accountName), h('td', null, l.text), h('td', { class: 'num' }, amt(l.debit)), h('td', { class: 'num' }, amt(l.credit))))),
        h('tfoot', null, h('tr', { class: 'total' }, h('td', { colspan: 3 }, 'Total'), h('td', { class: 'num' }, money(d.total)), h('td', { class: 'num' }, money(d.total))))
      )
    )
  );
  const canReverse = d.status === 'POSTED' && !d.reversalOf;
  openDialog(`Document ${d.docNo}`, body, [canReverse ? h('button', { class: 'danger', onclick: () => reverseDialog(d) }, 'Reverse document') : null, h('button', { onclick: closeDialog }, 'Close')]);
}

function reverseDialog(d) {
  const date = h('input', { type: 'date', value: state.settings.today });
  const reason = h('input', { maxlength: 100, placeholder: 'Why is this being reversed?' });
  openDialog(
    `Reverse document ${d.docNo}`,
    h('div', null, h('div', { class: 'callout warn' }, 'A reversal posts a new document with debits and credits swapped. The original stays on record and is marked Reversed.'), h('div', { class: 'form-grid' }, h('label', { class: 'field' }, 'Reversal posting date', date), h('label', { class: 'field' }, 'Reason', reason))),
    [
      h('button', { onclick: closeDialog }, 'Cancel'),
      h(
        'button',
        {
          class: 'danger',
          onclick: on(async () => {
            const r = await api(`/api/journal/${d.docNo}/reverse`, { method: 'POST', body: { postingDate: date.value, reason: reason.value } });
            closeDialog();
            toast(`Reversal document ${r.docNo} posted`);
            await route();
          }),
        },
        'Post reversal'
      ),
    ]
  );
}

/* ---------- General ledger ---------- */
VIEWS.ledger = async function (p) {
  await loadAccounts();
  const s = state.settings;
  const sel = h('select', null, h('option', { value: '' }, 'Select an account…'), state.accounts.map((a) => h('option', { value: a.code, selected: a.code === p.account }, accountLabel(a) + (a.active ? '' : ' (inactive)'))));
  const from = dateField('From', p.from || s.fiscalYearStart);
  const to = dateField('To', p.to || s.today);
  const out = h('div', null, h('div', { class: 'loading' }, 'Choose an account and press Run.'));
  let csvRows = null;

  const run = on(async () => {
    if (!sel.value) throw new Error('Select an account first');
    const d = await api('/api/reports/ledger', { params: { account: sel.value, from: from.input.value, to: to.input.value } });
    csvRows = [['Posting date', 'Document', 'Reference', 'Text', 'Debit', 'Credit', 'Running balance (Dr +)'], ['', '', '', 'Opening balance', '', '', d.opening], ...d.items.map((i) => [i.postingDate, i.docNo, i.reference, i.text, i.debit, i.credit, i.balance]), ['', '', '', 'Closing balance', d.totals.debit, d.totals.credit, d.closing]];
    out.replaceChildren(
      reportTitle(`General Ledger — ${d.account.code} ${d.account.name}`, rangeText(d.from, d.to)),
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            null,
            h('thead', null, h('tr', null, h('th', null, 'Posting date'), h('th', null, 'Document'), h('th', null, 'Reference'), h('th', null, 'Text'), h('th', { class: 'num' }, 'Debit'), h('th', { class: 'num' }, 'Credit'), h('th', { class: 'num' }, 'Balance'))),
            h(
              'tbody',
              null,
              h('tr', { class: 'sub' }, h('td', { colspan: 6 }, 'Opening balance'), h('td', { class: 'num' }, drcr(d.opening))),
              d.items.length
                ? d.items.map((i) => h('tr', null, h('td', null, fdate(i.postingDate)), h('td', null, h('a', { href: '#', class: 'mono', onclick: (e) => { e.preventDefault(); on(() => showDoc(i.docNo))(); } }, String(i.docNo))), h('td', null, i.reference), h('td', null, i.text, i.status === 'REVERSED' ? h('span', { class: 'chip gray', style: 'margin-left:6px' }, 'Reversed') : null), h('td', { class: 'num' }, amt(i.debit)), h('td', { class: 'num' }, amt(i.credit)), h('td', { class: 'num' }, drcr(i.balance))))
                : h('tr', null, h('td', { class: 'empty', colspan: 7 }, 'No postings in this period'))
            ),
            h('tfoot', null, h('tr', { class: 'total' }, h('td', { colspan: 4 }, 'Period total / closing balance'), h('td', { class: 'num' }, money(d.totals.debit)), h('td', { class: 'num' }, money(d.totals.credit)), h('td', { class: 'num' }, drcr(d.closing))))
          )
        )
      )
    );
  });

  if (p.account) setTimeout(run, 0);
  return h('div', null, pageHead('General Ledger', 'Line items for one account with a running balance'), h('div', { class: 'filters' }, h('label', { class: 'field', style: 'min-width:280px' }, 'Account', sel), from, to, h('button', { class: 'primary', onclick: run }, 'Run'), reportActions(() => csvRows, 'general-ledger.csv')), out);
};

/* ---------- Trial balance ---------- */
VIEWS.tb = async function (p) {
  const s = state.settings;
  const from = dateField('From', p.from || s.fiscalYearStart);
  const to = dateField('To', p.to || s.today);
  const out = h('div');
  let csvRows = null;

  const run = on(async () => {
    const d = await api('/api/reports/trial-balance', { params: { from: from.input.value, to: to.input.value } });
    csvRows = [['Account', 'Name', 'Type', 'Opening (Dr +)', 'Debit', 'Credit', 'Closing (Dr +)'], ...d.accounts.map((a) => [a.code, a.name, a.type, a.opening, a.debit, a.credit, a.closing]), ['', 'Total', '', d.totals.opening, d.totals.debit, d.totals.credit, d.totals.closing]];
    out.replaceChildren(
      ...nodes(
      reportTitle('Trial Balance', rangeText(d.from, d.to)),
      d.balanced ? null : h('div', { class: 'callout bad' }, 'The trial balance does not balance. This should never happen; please investigate before relying on any report.'),
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            null,
            h('thead', null, h('tr', null, h('th', null, 'Account'), h('th', null, 'Name'), h('th', { class: 'num' }, 'Opening balance'), h('th', { class: 'num' }, 'Debit'), h('th', { class: 'num' }, 'Credit'), h('th', { class: 'num' }, 'Closing balance'))),
            h('tbody', null, d.accounts.length ? d.accounts.map((a) => h('tr', null, h('td', { class: 'mono' }, h('a', { href: `#/ledger?account=${a.code}&from=${from.input.value}&to=${to.input.value}` }, a.code)), h('td', null, a.name), h('td', { class: 'num' }, drcr(a.opening)), h('td', { class: 'num' }, amt(a.debit)), h('td', { class: 'num' }, amt(a.credit)), h('td', { class: 'num' }, drcr(a.closing)))) : h('tr', null, h('td', { class: 'empty', colspan: 6 }, 'No postings up to this date'))),
            h('tfoot', null, h('tr', { class: 'total' }, h('td', { colspan: 2 }, 'Total ', d.balanced ? h('span', { class: 'chip good' }, 'Balanced') : h('span', { class: 'chip bad' }, 'Out of balance')), h('td', { class: 'num' }, drcr(d.totals.opening)), h('td', { class: 'num' }, money(d.totals.debit)), h('td', { class: 'num' }, money(d.totals.credit)), h('td', { class: 'num' }, drcr(d.totals.closing))))
          )
        )
      )
      )
    );
  });

  await run();
  return h('div', null, pageHead('Trial Balance', 'Opening balance, period movement and closing balance for every account with postings'), h('div', { class: 'filters' }, from, to, h('button', { class: 'primary', onclick: run }, 'Run'), reportActions(() => csvRows, 'trial-balance.csv')), out);
};

/* ---------- statement helpers ---------- */
function statementRows(title, section, extra) {
  const rows = [h('tr', { class: 'sub' }, h('td', null, title), h('td', { class: 'num' }, money(section.total)))];
  for (const g of section.groups) {
    rows.push(h('tr', { class: 'indent' }, h('td', null, h('b', null, g.category)), h('td', { class: 'num' }, h('b', null, money(g.total)))));
    for (const a of g.accounts) rows.push(h('tr', { class: 'indent2' }, h('td', null, `${a.code}  ${a.name}`), h('td', { class: 'num' }, money(a.amount))));
  }
  if (extra) rows.push(extra);
  return rows;
}
function flatten(section, label) {
  return section.groups.flatMap((g) => g.accounts.map((a) => [label, g.category, a.code, a.name, a.amount]));
}
const statementTable = (...bodyRows) => h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Item'), h('th', { class: 'num' }, `Amount (${'৳'})`))), h('tbody', null, bodyRows))));

/* ---------- Income statement ---------- */
VIEWS.is = async function (p) {
  const s = state.settings;
  const from = dateField('From', p.from || s.fiscalYearStart);
  const to = dateField('To', p.to || s.today);
  const out = h('div');
  let csvRows = null;

  const run = on(async () => {
    const d = await api('/api/reports/income-statement', { params: { from: from.input.value, to: to.input.value } });
    csvRows = [['Section', 'Category', 'Account', 'Name', 'Amount'], ...flatten(d.revenue, 'Revenue'), ['Revenue', '', '', 'Total revenue', d.revenue.total], ...flatten(d.expenses, 'Expenses'), ['Expenses', '', '', 'Total expenses', d.expenses.total], ['', '', '', d.netIncome >= 0 ? 'Net profit' : 'Net loss', d.netIncome]];
    out.replaceChildren(
      reportTitle('Income Statement', rangeText(d.from, d.to)),
      statementTable(
        statementRows('Revenue', d.revenue),
        statementRows('Expenses', d.expenses),
        h('tr', { class: 'total' }, h('td', null, d.netIncome >= 0 ? 'Net profit' : 'Net loss'), h('td', { class: 'num' }, money(d.netIncome)))
      )
    );
  });

  await run();
  return h('div', null, pageHead('Income Statement', 'Revenue less expenses for the selected period'), h('div', { class: 'filters' }, from, to, h('button', { class: 'primary', onclick: run }, 'Run'), reportActions(() => csvRows, 'income-statement.csv')), out);
};

/* ---------- Balance sheet ---------- */
VIEWS.bs = async function (p) {
  const asOf = dateField('As of', p.asOf || state.settings.today);
  const out = h('div');
  let csvRows = null;

  const run = on(async () => {
    const d = await api('/api/reports/balance-sheet', { params: { asOf: asOf.input.value } });
    csvRows = [['Section', 'Category', 'Account', 'Name', 'Amount'], ...flatten(d.assets, 'Assets'), ['Assets', '', '', 'Total assets', d.assets.total], ...flatten(d.liabilities, 'Liabilities'), ['Liabilities', '', '', 'Total liabilities', d.liabilities.total], ...flatten(d.equity, 'Equity'), ['Equity', '', '', 'Current period result (not yet closed)', d.equity.currentResult], ['Equity', '', '', 'Total equity', d.equity.total], ['', '', '', 'Total liabilities and equity', d.totalLiabilitiesAndEquity]];
    const resultRow = h('tr', { class: 'indent' }, h('td', null, h('b', null, 'Current period result'), h('span', { class: 'muted' }, ' (year-end close not yet run)')), h('td', { class: 'num' }, h('b', null, money(d.equity.currentResult))));
    out.replaceChildren(
      ...nodes(
        reportTitle('Balance Sheet', `As of ${fdate(d.asOf)}`),
        d.balanced ? null : h('div', { class: 'callout bad' }, 'Assets do not equal liabilities plus equity. This should never happen; please investigate.'),
        statementTable(
          statementRows('Assets', d.assets),
          statementRows('Liabilities', d.liabilities),
          statementRows('Equity', d.equity, resultRow),
          h('tr', { class: 'total' }, h('td', null, 'Total liabilities and equity ', d.balanced ? h('span', { class: 'chip good' }, 'Balanced') : h('span', { class: 'chip bad' }, 'Out of balance')), h('td', { class: 'num' }, money(d.totalLiabilitiesAndEquity)))
        )
      )
    );
  });

  await run();
  return h('div', null, pageHead('Balance Sheet', 'Assets, liabilities and equity at a point in time'), h('div', { class: 'filters' }, asOf, h('button', { class: 'primary', onclick: run }, 'Run'), reportActions(() => csvRows, 'balance-sheet.csv')), out);
};

/* ---------- Posting periods ---------- */
VIEWS.periods = async function () {
  const tbody = h('tbody');
  const month = h('input', { type: 'month', value: state.settings.today.slice(0, 7) });

  async function load() {
    const list = await api('/api/periods');
    tbody.replaceChildren(
      ...(list.length
        ? list.map((r) =>
            h(
              'tr',
              null,
              h('td', null, fperiod(r.period), ' ', h('span', { class: 'muted mono' }, r.period)),
              h('td', { class: 'num' }, String(r.documents)),
              h('td', null, r.locked ? h('span', { class: 'chip warn' }, 'Locked') : h('span', { class: 'chip good' }, 'Open')),
              h('td', { class: 'num' }, h('button', { class: 'small', onclick: on(async () => { await api(`/api/periods/${r.period}/${r.locked ? 'unlock' : 'lock'}`, { method: 'POST' }); toast(`${fperiod(r.period)} ${r.locked ? 'unlocked' : 'locked'}`); await load(); }) }, r.locked ? 'Unlock' : 'Lock'))
            )
          )
        : [h('tr', null, h('td', { class: 'empty', colspan: 4 }, 'No periods yet'))])
    );
  }
  await load();

  return h(
    'div',
    null,
    pageHead('Posting Periods', 'Lock a month to stop any new posting or reversal dated inside it'),
    h('div', { class: 'callout info' }, 'Lock a period after it has been reviewed or audited. Unlocking is available here, so restrict access to this system accordingly.'),
    h('div', { class: 'filters' }, h('label', { class: 'field' }, 'Lock a specific month', month), h('button', { class: 'primary', onclick: on(async () => { if (!month.value) throw new Error('Pick a month'); await api(`/api/periods/${month.value}/lock`, { method: 'POST' }); toast(`${fperiod(month.value)} locked`); await load(); }) }, 'Lock month')),
    h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Period'), h('th', { class: 'num' }, 'Documents'), h('th', null, 'Status'), h('th', null, ''))), tbody)))
  );
};

/* ================= shell, routing, auth ================= */

const NAV = [
  [null, [['home', 'Home']]],
  ['Master data', [['accounts', 'Chart of Accounts']]],
  ['Accounting', [['post', 'Post Journal Entry'], ['journal', 'Journal Entries']]],
  ['Reports', [['ledger', 'General Ledger'], ['tb', 'Trial Balance'], ['is', 'Income Statement'], ['bs', 'Balance Sheet']]],
  ['Period control', [['periods', 'Posting Periods']]],
];
const TITLES = Object.fromEntries(NAV.flatMap(([, items]) => items));

function renderShell() {
  const side = h('nav', { class: 'side', 'aria-label': 'Main navigation' }, NAV.flatMap(([group, items]) => [group ? h('div', { class: 'grp' }, group) : null, items.map(([key, label]) => h('a', { href: '#/' + key, 'data-key': key }, label))]));
  const menuBtn = h('button', { class: 'ghost menu-btn', 'aria-label': 'Toggle navigation', onclick: () => side.classList.toggle('open') }, '☰');
  $('#app').replaceChildren(
    h(
      'div',
      { class: 'shell' },
      h('header', { class: 'shellbar' }, menuBtn, h('div', { class: 'brand' }, h('div', { class: 'logo' }, 'T'), state.settings.company), h('div', { class: 'app-title' }, 'Finance (FI)'), h('div', { class: 'spacer' }), state.session && state.session.mode === 'password' ? h('button', { class: 'ghost small', onclick: on(async () => { await api('/api/logout', { method: 'POST' }); location.hash = ''; location.reload(); }) }, 'Sign out') : h('span', { class: 'muted', style: 'font-size:12px;color:#8fa3b5' }, 'Local mode')),
      h('div', { class: 'layout' }, side, h('main', { id: 'view' }))
    )
  );
}

let routeSeq = 0;
async function route() {
  const seq = ++routeSeq;
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, qs] = raw.split('?');
  const key = VIEWS[name] ? name : 'home';
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const view = $('#view');
  if (!view) return;
  for (const a of document.querySelectorAll('.side a')) {
    if (a.dataset.key === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  $('.side')?.classList.remove('open');
  document.title = `${TITLES[key]} · ${state.settings.company} ERP`;
  view.replaceChildren(h('div', { class: 'loading' }, 'Loading…'));
  try {
    const node = await VIEWS[key](params);
    if (seq !== routeSeq) return;
    view.replaceChildren(node);
    window.scrollTo(0, 0);
  } catch (e) {
    if (seq !== routeSeq) return;
    view.replaceChildren(h('div', { class: 'callout bad' }, e.message));
  }
}

function showLogin(mode) {
  closeDialog();
  const locked = mode === 'locked';
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Password' });
  const err = h('div', { class: 'callout bad', style: 'display:none' });
  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.style.display = 'none';
        try {
          const res = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Sign-in failed');
          state.session = { authenticated: true, mode: 'password' };
          await start();
        } catch (ex) {
          err.textContent = ex.message;
          err.style.display = 'block';
          pw.select();
        }
      },
    },
    err,
    h('label', { class: 'field' }, 'Password', pw),
    h('button', { class: 'primary', type: 'submit' }, 'Sign in')
  );
  $('#app').replaceChildren(
    h('div', { class: 'login' }, h('div', { class: 'card' }, h('div', { class: 'logo' }, 'T'), h('h1', null, 'Tickydo ERP'), h('div', { class: 'muted' }, 'Finance module'), locked ? h('div', { class: 'callout warn', style: 'margin-top:16px' }, 'This server is locked. Set the APP_PASSWORD environment variable and redeploy to enable sign-in.') : form))
  );
  if (!locked) pw.focus();
}

let hashBound = false;
async function start() {
  state.settings = await api('/api/settings');
  await loadAccounts();
  renderShell();
  if (!hashBound) {
    window.addEventListener('hashchange', route);
    hashBound = true;
  }
  await route();
}

(async function boot() {
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    state.session = await res.json();
    if (!state.session.authenticated) return showLogin(state.session.mode);
    await start();
  } catch (e) {
    $('#app').replaceChildren(h('div', { class: 'callout bad', style: 'margin:24px' }, 'Cannot reach the server: ' + e.message));
  }
})();
