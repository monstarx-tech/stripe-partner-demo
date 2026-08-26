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
}

async function loadReaders() {
  $('#reader').innerHTML = '<option>loading…</option>';
  try {
    const d = await api(`/terminal/readers?merchantId=${merchant.id}`);
    readers = d.readers;
    $('#reader').innerHTML = readers.length
      ? readers.map(r => `<option value="${r.id}" data-kind="${r.kind}">${esc(r.label || r.id)} · ${r.kind} · ${r.status}</option>`).join('')
      : '<option value="">no readers registered</option>';
  } catch (e) {
    $('#reader').innerHTML = '<option value="">unavailable</option>';
    trace('readers.list', e.message, 'err');
  }
}
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
  const btn = $('#charge');
  btn.disabled = true;

  try {
    // 1. PaymentIntent — direct charge on the connected account
    stage('Creating PaymentIntent…');
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
      tipEligibleAmount: $('#tipping').value === '1' ? t.total : undefined,
    }});
    trace('POST /terminal/process', `reader ${readerId} · action=${proc.action}${proc.tipping ? ' · tipping on' : ''}`);

    // 3. Card presentation
    if (kind === 'simulated') {
      stage('Simulating card tap…');
      const tap = await api('/terminal/simulate-card', { method: 'POST', body: { merchantId: merchant.id, readerId } });
      trace('POST /terminal/simulate-card', `action=${tap.action}`);
    } else {
      stage('Waiting for the guest to tap…');
      trace('reader', 'awaiting physical card presentation on the S710');
    }

    // 4. Poll. The reference build polls rather than waiting on a webhook —
    //    the till is right here and the cashier is watching.
    stage('Confirming…');
    const final = await poll(pi.paymentIntentId, kind === 'physical' ? 60 : 20);

    if (final.status === 'succeeded') {
      trace('GET …/status', `succeeded · ${money(final.amount)}${final.tip ? ` · tip ${money(final.tip)}` : ''} · fee ${money(final.application_fee_amount)}`, 'ok');
      stage(`Paid ${money(final.amount)}${final.tip ? ` incl. ${money(final.tip)} tip` : ''}`, false);
      cart.clear();
      setTimeout(() => { stage(''); render(); }, 4000);
    } else {
      trace('GET …/status', `ended as ${final.status}`, 'err');
      stage(`Not completed — ${final.status}`, false);
    }
  } catch (e) {
    trace('error', e.message, 'err');
    stage(`Failed — ${e.message}`, false);
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

init();
