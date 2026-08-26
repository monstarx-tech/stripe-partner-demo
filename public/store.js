const $ = s => document.querySelector(s);
const money = c => 'S$' + (c / 100).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let merchant = null, products = [], cart = new Map();

function toast(msg, isErr) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), isErr ? 6000 : 3000);
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

async function init() {
  const { merchants } = await api('/platform/merchants');
  const live = merchants.filter(m => m.stripe_account_id);
  const wanted = new URLSearchParams(location.search).get('merchantId');

  $('#outletPick').innerHTML = merchants
    .map(m => `<option value="${m.id}">${esc(m.logo_emoji)} ${esc(m.name)}</option>`).join('');
  $('#outletPick').value = wanted && merchants.some(m => m.id === wanted)
    ? wanted
    : (live[0] || merchants[0]).id;

  $('#outletPick').onchange = () => load($('#outletPick').value);
  if (new URLSearchParams(location.search).get('cancelled')) toast('Payment cancelled — your order is still here.');
  load($('#outletPick').value);
}

async function load(id) {
  cart.clear();
  const d = await api(`/platform/merchants/${id}/products`);
  merchant = d.merchant; products = d.products;

  $('#hEmoji').textContent = merchant.logo_emoji || '🍽️';
  $('#hName').textContent = merchant.name;
  $('#hMeta').textContent = `${merchant.cuisine || merchant.type} · ${merchant.service_charge_bps / 100}% service · ${merchant.gst_bps / 100}% GST`;

  const cats = [...new Set(products.map(p => p.category))];
  $('#menu').innerHTML = cats.map(cat => `
    <div class="cat-title">${esc(cat)}</div>
    <div class="menu-grid">
      ${products.filter(p => p.category === cat).map(p => `
        <button class="item" data-add="${p.id}">
          <span class="ico">${esc(p.image_emoji || '🍽️')}</span>
          <span>
            <span class="nm">${esc(p.name)}</span>
            <span class="ds">${esc(p.description)}</span>
            <span class="pr">${money(p.unit_amount)}</span>
          </span>
        </button>`).join('')}
    </div>`).join('');

  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => add(b.dataset.add));
  render();
}

const add = id => { cart.set(id, (cart.get(id) || 0) + 1); render(); };
const sub = id => { const n = (cart.get(id) || 0) - 1; n <= 0 ? cart.delete(id) : cart.set(id, n); render(); };

function render() {
  const lines = [...cart.entries()].map(([id, qty]) => ({ p: products.find(x => x.id === id), qty }));
  $('#cartCount').textContent = `${lines.reduce((s, l) => s + l.qty, 0)} items`;

  if (!lines.length) {
    $('#cartLines').innerHTML = '<p class="muted small" style="margin:0">Tap a dish to start your order.</p>';
    $('#totals').hidden = $('#split').hidden = true;
    $('#pay').disabled = true;
    return;
  }

  $('#cartLines').innerHTML = lines.map(l => `
    <div class="cart-line">
      <span>${esc(l.p.image_emoji)}</span>
      <span class="nm">${esc(l.p.name)}</span>
      <span class="qty">
        <button data-sub="${l.p.id}">−</button><span class="mono">${l.qty}</span><button data-inc="${l.p.id}">+</button>
      </span>
      <span class="mono">${money(l.p.unit_amount * l.qty)}</span>
    </div>`).join('');

  document.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => sub(b.dataset.sub));
  document.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => add(b.dataset.inc));

  // Mirrors server/lib/money.js — service charge on subtotal, then GST on the
  // inclusive amount. The server recomputes from its own prices before charging;
  // this is display only.
  const subtotal = lines.reduce((s, l) => s + l.p.unit_amount * l.qty, 0);
  const svc = Math.round(subtotal * merchant.service_charge_bps / 10000);
  const gst = Math.round((subtotal + svc) * merchant.gst_bps / 10000);
  const total = subtotal + svc + gst;
  const fee = Math.round(total * merchant.fee_bps / 10000);

  $('#totals').hidden = false;
  $('#totals').innerHTML = `
    <div class="row"><span class="muted">Subtotal</span><span class="mono">${money(subtotal)}</span></div>
    <div class="row"><span class="muted">Service charge ${merchant.service_charge_bps / 100}%</span><span class="mono">${money(svc)}</span></div>
    <div class="row"><span class="muted">GST ${merchant.gst_bps / 100}%</span><span class="mono">${money(gst)}</span></div>
    <div class="row grand"><span>Total</span><span class="mono">${money(total)}</span></div>`;

  $('#split').hidden = false;
  $('#split').innerHTML = `
    <div class="row"><span>${esc(merchant.name)} receives</span><strong class="mono">${money(total - fee)}</strong></div>
    <div class="row"><span>MakanPay fee ${merchant.fee_bps / 100}%</span><strong class="mono">${money(fee)}</strong></div>
    <div class="row muted" style="margin-top:4px">Direct charge — no transfer step</div>`;

  $('#pay').disabled = false;
  $('#pay').textContent = `Pay ${money(total)}`;
}

$('#pay').onclick = async () => {
  const btn = $('#pay');
  btn.disabled = true; btn.textContent = 'Redirecting…';
  try {
    const r = await api('/checkout', { method: 'POST', body: {
      merchantId: merchant.id,
      items: [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity })),
      customerEmail: $('#email').value.trim() || undefined,
    }});
    location.href = r.url;
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false;
    render();
  }
};

init();
