const $ = s => document.querySelector(s);
const money = c => 'S$' + (c / 100).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let merchants = [], merchant = null, products = [], readers = [];
const cart = new Map();

// ---- trace panel -----------------------------------------------------------
// Makes a server-driven Terminal integration visible. Without this the demo is
// someone staring at a card reader in silence.
function trace(method, detail, cls = '') {
  const el = document.createElement('div');
  el.className = 'tr ' + cls;
  el.innerHTML = `<span class="t">${new Date().toLocaleTimeString('en-GB')}</span>
                  <span class="m">${esc(method)}</span><br><span class="d">${esc(detail)}</span>`;
  $('#trace').prepend(el);
  while ($('#trace').children.length > 60) $('#trace').lastChild.remove();
}
$('#clearTrace').onclick = () => { $('#trace').innerHTML = ''; };

function stage(text, spinning = true) {
  $('#stage').innerHTML = text
    ? `<div class="stage">${spinning ? '<span class="spin"></span>' : '✓'}<span>${esc(text)}</span></div>`
    : '';
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
  return d;
}

// ---- on-screen S710 --------------------------------------------------------
// A simulated reader is otherwise invisible: the "tap" is an API call with
// nothing to look at. This renders what the guest would actually see on the
// device — amount, tip prompt, approval — and drives the real test helper
// underneath, including a real tip amount.

const dev = {
  el: () => $('#devScreen'),

  idle() {
    this.el().innerHTML = '<div class="s710-idle">Reader ready</div>';
  },

  waking(amount) {
    this.el().innerHTML = `
      <div class="s710-merchant">${esc(merchant.name)}</div>
      <div class="s710-amount">${money(amount)}</div>
      <div class="s710-sub pulsing">Connecting…</div>`;
  },

  // Tip prompt renders on the DEVICE, before the card is presented — the guest
  // chooses, not the cashier. amount_eligible is the pre-tip total.
  askTip(amount, onPick) {
    const pcts = [0, 5, 10, 15];
    this.el().innerHTML = `
      <div class="s710-merchant">${esc(merchant.name)}</div>
      <div class="s710-amount">${money(amount)}</div>
      <div class="s710-prompt">Add a tip?</div>
      <div class="s710-tips">
        ${pcts.map(p => `<button data-tip="${Math.round(amount * p / 100)}">
            ${p === 0 ? 'No tip' : p + '%'}
            ${p === 0 ? '' : `<br><span style="font-weight:400;color:var(--muted)">${money(Math.round(amount * p / 100))}</span>`}
          </button>`).join('')}
      </div>`;
    document.querySelectorAll('[data-tip]').forEach(b =>
      b.onclick = () => onPick(parseInt(b.dataset.tip, 10)));
  },

  presentCard(amount, tip, onTap, onDecline) {
    this.el().innerHTML = `
      <div class="s710-merchant">${esc(merchant.name)}</div>
      <div class="s710-amount">${money(amount + tip)}</div>
      ${tip ? `<div class="s710-sub">incl. ${money(tip)} tip</div>` : ''}
      <div class="s710-wave pulsing">〰️</div>
      <div class="s710-prompt">Present card</div>
      <button class="s710-tap" id="devTap">Tap card</button>
      <button class="s710-tap ghost" id="devDecline">Tap declining card</button>`;
    $('#devTap').onclick = onTap;
    $('#devDecline').onclick = onDecline;
  },

  waiting(amount, tip) {
    this.el().innerHTML = `
      <div class="s710-merchant">${esc(merchant.name)}</div>
      <div class="s710-amount">${money(amount + tip)}</div>
      <div class="s710-wave pulsing">〰️</div>
      <div class="s710-prompt">Present card</div>
      <div class="s710-sub" style="margin-top:8px">Waiting for the guest…</div>`;
  },

  processing() {
    this.el().innerHTML = '<div class="s710-wave pulsing">⏳</div><div class="s710-prompt">Processing…</div>';
  },

  approved(total, tip) {
    this.el().innerHTML = `
      <div class="s710-ok">✓</div>
      <div class="s710-prompt">Approved</div>
      <div class="s710-amount" style="font-size:24px">${money(total)}</div>
      ${tip ? `<div class="s710-sub">incl. ${money(tip)} tip</div>` : ''}`;
  },

  declined(msg) {
    this.el().innerHTML = `
      <div class="s710-no">✕</div>
      <div class="s710-prompt">Declined</div>
      <div class="s710-sub">${esc(msg || 'Card was declined')}</div>`;
  },
};

// Resolves once the guest has chosen a tip on the device (or immediately when
// tipping is off).
function collectTip(amount, tippingOn) {
  if (!tippingOn) return Promise.resolve(0);
  return new Promise(resolve => dev.askTip(amount, resolve));
}

// Resolves when the card is presented on the simulated device.
function collectCard(amount, tip) {
  return new Promise(resolve => dev.presentCard(amount, tip,
    () => resolve({ decline: false }),
    () => resolve({ decline: true })));
}

// ---- boot ------------------------------------------------------------------
async function init() {
  ({ merchants } = await api('/platform/merchants'));
  // Open on an outlet that can actually take a payment: onboarded AND holding
  // a reader. Otherwise the POS lands on an outlet with nothing to charge to.
  const ready = merchants.filter(m => m.stripe_account_id && m.reader_count > 0);
  const live = merchants.filter(m => m.stripe_account_id);
  $('#outlet').innerHTML = merchants.map(m => `<option value="${m.id}">${esc(m.logo_emoji)} ${esc(m.name)}</option>`).join('');
  $('#outlet').value = (ready[0] || live[0] || merchants[0]).id;
  $('#outlet').onchange = () => loadOutlet($('#outlet').value);
  await loadOutlet($('#outlet').value);
}

async function loadOutlet(id) {
  cart.clear();
  const d = await api(`/platform/merchants/${id}/products`);
  merchant = d.merchant; products = d.products;

  const cats = [...new Set(products.map(p => p.category))];
  $('#menu').innerHTML = cats.map(cat => `
    <div class="cat-title">${esc(cat)}</div>
    <div class="tiles">
      ${products.filter(p => p.category === cat).map(p => `
        <button class="tile" data-add="${p.id}">
          <div class="ico">${esc(p.image_emoji || '🍽️')}</div>
          <div class="nm">${esc(p.name)}</div>
          <div class="pr">${money(p.unit_amount)}</div>
        </button>`).join('')}
    </div>`).join('');
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => add(b.dataset.add));

  await loadReaders();
  render();
  loadTabs();
  loadOrders();
}

async function loadReaders() {
  $('#reader').innerHTML = '<option>loading…</option>';
  try {
    const d = await api(`/terminal/readers?merchantId=${merchant.id}`);
    readers = d.readers;
    $('#reader').innerHTML = readers.length
      ? readers.map(r => `<option value="${r.id}" data-kind="${r.kind}">${esc(r.label || r.id)} · ${r.kind} · ${r.status}</option>`).join('')
      : '<option value="">no readers registered</option>';
    syncDeviceLabel();
  } catch (e) {
    $('#reader').innerHTML = '<option value="">unavailable</option>';
    trace('readers.list', e.message, 'err');
  }
}
function syncDeviceLabel() {
  const opt = $('#reader').selectedOptions[0];
  const kind = opt && opt.dataset.kind;
  $('#devLabel').textContent = kind ? `S710 · ${kind}` : 'no reader';
  // A physical reader has its own screen; the on-screen one only mirrors it.
  $('#devScreen').parentElement.parentElement.style.opacity = kind === 'physical' ? '.55' : '1';
  dev.idle();
}
$('#reader').onchange = syncDeviceLabel;
$('#refresh').onclick = loadReaders;

const add = id => { cart.set(id, (cart.get(id) || 0) + 1); render(); };
const sub = id => { const n = (cart.get(id) || 0) - 1; n <= 0 ? cart.delete(id) : cart.set(id, n); render(); };
$('#clear').onclick = () => { cart.clear(); stage(''); render(); };

function totals() {
  const lines = [...cart.entries()].map(([id, qty]) => ({ p: products.find(x => x.id === id), qty }));
  const subtotal = lines.reduce((s, l) => s + l.p.unit_amount * l.qty, 0);
  const svc = Math.round(subtotal * merchant.service_charge_bps / 10000);
  const gst = Math.round((subtotal + svc) * merchant.gst_bps / 10000);
  const total = subtotal + svc + gst;
  return { lines, subtotal, svc, gst, total, fee: Math.round(total * merchant.fee_bps / 10000) };
}

function render() {
  const t = totals();
  $('#tCount').textContent = t.lines.reduce((s, l) => s + l.qty, 0);

  if (!t.lines.length) {
    $('#lines').innerHTML = '<p class="muted small" style="margin:0">Tap items to build the ticket.</p>';
    $('#sum').hidden = true;
    $('#charge').disabled = true;
    $('#charge').textContent = 'Charge';
    return;
  }

  $('#lines').innerHTML = t.lines.map(l => `
    <div class="tl">
      <span>${esc(l.p.image_emoji)}</span><span class="nm">${esc(l.p.name)}</span>
      <button data-sub="${l.p.id}">−</button><span class="mono">${l.qty}</span><button data-inc="${l.p.id}">+</button>
      <span class="mono">${money(l.p.unit_amount * l.qty)}</span>
    </div>`).join('');
  document.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => sub(b.dataset.sub));
  document.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => add(b.dataset.inc));

  $('#sum').hidden = false;
  $('#sum').innerHTML = `
    <div class="row"><span class="muted">Subtotal</span><span class="mono">${money(t.subtotal)}</span></div>
    <div class="row"><span class="muted">Service ${merchant.service_charge_bps / 100}%</span><span class="mono">${money(t.svc)}</span></div>
    <div class="row"><span class="muted">GST ${merchant.gst_bps / 100}%</span><span class="mono">${money(t.gst)}</span></div>
    <div class="row grand"><span>Total</span><span class="mono">${money(t.total)}</span></div>
    <div class="row"><span class="muted small">Platform fee ${merchant.fee_bps / 100}%</span><span class="mono small muted">${money(t.fee)}</span></div>`;

  $('#charge').disabled = false;
  $('#charge').textContent = `Charge ${money(t.total)}`;
}

// ---- the card-present flow -------------------------------------------------
$('#charge').onclick = async () => {
  const readerId = $('#reader').value;
  if (!readerId) return trace('charge', 'no reader selected', 'err');

  const kind = $('#reader').selectedOptions[0].dataset.kind;
  const t = totals();
  const tippingOn = $('#tipping').value === '1';
  const btn = $('#charge');
  btn.disabled = true;

  try {
    // 1. PaymentIntent — direct charge on the connected account
    stage('Creating PaymentIntent…');
    dev.waking(t.total);
    const pi = await api('/terminal/payment-intent', { method: 'POST', body: {
      merchantId: merchant.id,
      items: [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity })),
      tableNumber: $('#table').value.trim(),
    }});
    trace('POST /terminal/payment-intent', `${pi.paymentIntentId} · ${money(pi.amount)} · fee ${money(pi.applicationFee)}`);
    trace('↳ stripe.paymentIntents.create', `card_present · { stripeAccount: ${merchant.stripe_account_id} }`);

    // 2. Push it to the reader — this is what replaces the client SDK
    stage('Pushing to reader…');
    const proc = await api('/terminal/process', { method: 'POST', body: {
      merchantId: merchant.id,
      readerId,
      paymentIntentId: pi.paymentIntentId,
      // Tip is offered against the PRE-TIP total. The tip raises the PI amount
      // but not application_fee_amount — the platform takes no cut of tips.
      tipEligibleAmount: tippingOn ? t.total : undefined,
    }});
    trace('POST /terminal/process', `reader ${readerId} · action=${proc.action}${proc.tipping ? ' · tipping on' : ''}`);

    // 3. Card presentation — on the device, by the guest
    if (kind === 'simulated') {
      const tip = await collectTip(t.total, proc.tipping);
      if (tip) trace('device', `guest added a ${money(tip)} tip`);

      stage('Waiting for the guest to tap…');
      const { decline } = await collectCard(t.total, tip);
      dev.processing();

      const tap = await api('/terminal/simulate-card', { method: 'POST', body: {
        merchantId: merchant.id, readerId,
        tipAmount: tip || undefined,
        // Stripe's standard decline test card.
        cardNumber: decline ? '4000000000000002' : undefined,
      }});
      trace('POST /terminal/simulate-card', `action=${tap.action}${tip ? ` · tip ${money(tip)}` : ''}${decline ? ' · declining card' : ''}`,
            tap.action === 'succeeded' ? '' : 'err');
    } else {
      stage('Waiting for the guest to tap…');
      dev.waiting(t.total, 0);
      trace('reader', 'awaiting physical card presentation on the S710');
    }

    // 4. Poll. The reference build polls rather than waiting on a webhook —
    //    the till is right here and the cashier is watching.
    stage('Confirming…');
    const final = await poll(pi.paymentIntentId, kind === 'physical' ? 60 : 20);

    if (final.status === 'succeeded') {
      trace('GET …/status', `succeeded · ${money(final.amount)}${final.tip ? ` · tip ${money(final.tip)}` : ''} · fee ${money(final.application_fee_amount)}`, 'ok');
      // The headline: the tip raised the amount, the platform fee did not move.
      if (final.tip) trace('fee check', `tip ${money(final.tip)} · platform fee ${money(final.application_fee_amount)} on the PRE-TIP total`, 'ok');
      dev.approved(final.amount, final.tip);
      stage(`Paid ${money(final.amount)}${final.tip ? ` incl. ${money(final.tip)} tip` : ''}`, false);
      cart.clear();
      loadOrders();
      setTimeout(() => { stage(''); dev.idle(); render(); }, 6000);
    } else {
      trace('GET …/status', `ended as ${final.status}`, 'err');
      dev.declined(`Payment ${final.status}`);
      stage(`Not completed — ${final.status}`, false);
      setTimeout(() => dev.idle(), 6000);
    }
  } catch (e) {
    trace('error', e.message, 'err');
    dev.declined(e.message);
    stage(`Failed — ${e.message}`, false);
    setTimeout(() => dev.idle(), 6000);
  } finally {
    btn.disabled = false;
    render();
  }
};

async function poll(paymentIntentId, attempts) {
  let last = {};
  for (let i = 0; i < attempts; i++) {
    last = await api(`/terminal/payment-intent/${paymentIntentId}/status?merchantId=${merchant.id}`);
    if (['succeeded', 'canceled', 'requires_capture'].includes(last.status)) return last;
    await new Promise(r => setTimeout(r, 1000));
  }
  return last;
}

// ---- tabs ------------------------------------------------------------------
// The F&B pre-auth pattern: hold now, let the bill grow, settle later against
// a card that may have left the building.

$('#openTab').onclick = () => {
  $('#tabLabel').value = $('#table').value.trim() ? `Table ${$('#table').value.trim()}` : '';
  $('#modal').hidden = false;
};
$('#tabCancel').onclick = () => { $('#modal').hidden = true; };

$('#tabGo').onclick = async () => {
  const readerId = $('#reader').value;
  if (!readerId) return trace('open tab', 'no reader selected', 'err');

  const hold = Math.round(parseFloat($('#tabHold').value) * 100);
  if (!hold || hold < 100) return trace('open tab', 'hold must be at least S$1.00', 'err');

  const kind = $('#reader').selectedOptions[0].dataset.kind;
  $('#modal').hidden = true;
  $('#tabGo').disabled = true;

  try {
    stage('Placing hold on the card…');
    dev.waking(hold);
    const tab = await api('/tabs', { method: 'POST', body: {
      merchantId: merchant.id,
      holdAmount: hold,
      readerId,
      label: $('#tabLabel').value.trim() || undefined,
      tableNumber: $('#table').value.trim(),
      items: [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity })),
    }});
    trace('POST /tabs', `${tab.id} · hold ${money(tab.hold_amount)} · action=${tab.action}`);
    trace('↳ paymentIntents.create', 'capture_method=manual · setup_future_usage=off_session');
    trace('↳ readers.processPaymentIntent', 'process_config.allow_redisplay=always');

    if (kind === 'simulated') {
      // No tip prompt on a pre-auth hold — the bill isn't known yet.
      stage('Waiting for the guest to tap…');
      await collectCard(hold, 0);
      dev.processing();
      const tap = await api('/terminal/simulate-card', { method: 'POST', body: { merchantId: merchant.id, readerId } });
      trace('POST /terminal/simulate-card', `action=${tap.action}`);
    } else {
      stage('Waiting for the guest to tap…');
      dev.waiting(hold, 0);
      trace('reader', 'awaiting physical card presentation');
    }

    // Poll until the hold is live (requires_capture).
    for (let i = 0; i < (kind === 'physical' ? 60 : 20); i++) {
      const t = await api(`/tabs/${tab.id}?merchantId=${merchant.id}`);
      if (t.holdStatus === 'requires_capture') {
        trace('GET /tabs/:id', `hold live — ${money(t.hold_amount)} authorised`, 'ok');
        dev.approved(t.hold_amount, 0);
        setTimeout(() => dev.idle(), 5000);
        stage(`Tab ${t.label} open — ${money(t.hold_amount)} held`, false);
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    cart.clear();
    render();
    loadTabs();
    setTimeout(() => stage(''), 4000);
  } catch (e) {
    trace('open tab', e.message, 'err');
    stage(`Failed — ${e.message}`, false);
  } finally {
    $('#tabGo').disabled = false;
  }
};

async function loadTabs() {
  const { tabs } = await api(`/tabs?merchantId=${merchant.id}`);
  const open = tabs.filter(t => t.status !== 'closed');
  $('#tabCount').textContent = open.length;

  $('#tabList').innerHTML = open.length ? open.map(t => {
    const over = t.overage > 0;
    return `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:6px">
        <strong style="flex:1">${esc(t.label)}</strong>
        <span class="pill ${t.status === 'open' ? 'ok' : 'warn'}">${esc(t.status)}</span>
      </div>
      <div class="small muted" style="margin:3px 0 6px">
        hold ${money(t.hold_amount)} · running <strong class="mono">${money(t.runningTotal)}</strong>
        ${over ? `<span class="pill danger" style="margin-left:4px">+${money(t.overage)} over</span>` : ''}
      </div>
      <div class="btn-row">
        <button class="btn" data-tabadd="${t.id}" style="padding:4px 9px;font-size:12px">Add ticket</button>
        <button class="btn primary" data-tabclose="${t.id}" style="padding:4px 9px;font-size:12px">Close ${money(t.runningTotal)}</button>
      </div>
    </div>`;
  }).join('') : '<p class="muted small" style="margin:0">No open tabs.</p>';

  document.querySelectorAll('[data-tabadd]').forEach(b => b.onclick = () => addToTab(b.dataset.tabadd));
  document.querySelectorAll('[data-tabclose]').forEach(b => b.onclick = () => closeTab(b.dataset.tabclose));
}

async function addToTab(tabId) {
  if (!cart.size) return trace('add round', 'ticket is empty', 'err');
  try {
    const t = await api(`/tabs/${tabId}/items`, { method: 'POST', body: {
      merchantId: merchant.id,
      items: [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity })),
    }});
    trace('POST /tabs/:id/items', `running ${money(t.runningTotal)}${t.overage ? ` · ${money(t.overage)} over hold` : ''}`);
    cart.clear(); render(); loadTabs();
  } catch (e) { trace('add round', e.message, 'err'); }
}

async function closeTab(tabId) {
  try {
    stage('Settling tab…');
    const r = await api(`/tabs/${tabId}/close`, { method: 'POST', body: { merchantId: merchant.id } });
    (r.steps || []).forEach(st => trace(`↳ ${st.step}`, st.detail + (st.released ? ` · released ${money(st.released)}` : ''), 'ok'));
    trace('POST /tabs/:id/close', `settled ${money(r.finalTotal)}`, 'ok');
    stage(`Tab closed — ${money(r.finalTotal)} settled`, false);
    loadTabs(); loadOrders();
    setTimeout(() => stage(''), 5000);
  } catch (e) {
    trace('close tab', e.message, 'err');
    stage(`Close failed — ${e.message}`, false);
  }
}

// ---- recent orders + refund ------------------------------------------------
async function loadOrders() {
  const { orders } = await api(`/orders?merchantId=${merchant.id}&limit=12`);
  $('#orderRows').innerHTML = orders.length ? orders.map(o => {
    const cls = { paid: 'ok', refunded: 'danger', partially_refunded: 'warn', open: 'info' }[o.status] || 'off';
    const canRefund = o.status === 'paid' && o.payment_intent_id;
    return `<tr>
      <td class="mono small">${esc(o.id)}</td>
      <td><span class="pill off">${esc(o.channel)}</span></td>
      <td class="small">${esc(o.table_number || '—')}</td>
      <td class="mono">${money(o.amount)}</td>
      <td class="mono small muted">${money(o.application_fee)}</td>
      <td><span class="pill ${cls}">${esc(o.status)}</span></td>
      <td>${canRefund ? `<button class="btn danger" data-refund="${o.id}" style="padding:4px 9px;font-size:12px">Refund</button>` : ''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No orders yet.</td></tr>';

  document.querySelectorAll('[data-refund]').forEach(b => b.onclick = () => refund(b.dataset.refund, b));
}
$('#refreshOrders').onclick = () => loadOrders();

async function refund(orderId, btn) {
  btn.disabled = true; btn.textContent = 'Refunding…';
  try {
    const r = await api('/refunds', { method: 'POST', body: {
      merchantId: merchant.id,
      orderId,
      // Goodwill refund: the platform gives up its fee alongside the outlet.
      refundApplicationFee: true,
    }});
    trace('POST /refunds', `${r.refundId} · ${money(r.amount)} · fee clawed back: ${r.applicationFeeRefunded}`, 'ok');
    loadOrders();
  } catch (e) {
    trace('refund', e.message, 'err');
    btn.disabled = false; btn.textContent = 'Refund';
  }
}

init();
