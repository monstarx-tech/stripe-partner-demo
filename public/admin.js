// MakanPay platform console.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let merchants = [];
let lastEventId = 0;

const money = (cents, cur = 'sgd') => {
  const sym = { sgd: 'S$', usd: '$', myr: 'RM' }[cur] || '';
  return sym + (cents / 100).toFixed(2);
};
const pct = bps => (bps / 100).toFixed(2) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg, isErr) {
  $$('.toast').forEach(t => t.remove());
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

// ---- tabs ----
$$('.tabs button').forEach(btn => btn.onclick = () => {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b === btn));
  $$('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== btn.dataset.tab);
  if (btn.dataset.tab === 'menu') loadMenu();
  if (btn.dataset.tab === 'readers') loadReaders();
  if (btn.dataset.tab === 'config') fillConfig();
  if (btn.dataset.tab === 'money') loadMoney();
});

// ---- outlets ----
async function loadMerchants() {
  ({ merchants } = await api('/platform/merchants'));
  renderOutlets();
  ['menuOutlet', 'readerOutlet', 'cfgOutlet'].forEach(id => {
    const sel = $('#' + id);
    const keep = sel.value;
    sel.innerHTML = merchants.map(m => `<option value="${m.id}">${esc(m.logo_emoji)} ${esc(m.name)}</option>`).join('');
    if (keep && merchants.some(m => m.id === keep)) sel.value = keep;
  });
}

function renderOutlets() {
  const tbody = $('#outletRows');
  if (!merchants.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No outlets yet.</td></tr>'; return; }

  tbody.innerHTML = merchants.map(m => {
    const mode = m.onboarding_mode === 'none'
      ? '<span class="pill info">API-based</span>'
      : '<span class="pill off">Stripe-hosted</span>';

    const acct = m.stripe_account_id
      ? `<span class="mono">${esc(m.stripe_account_id)}</span>`
      : '<span class="muted small">not created</span>';

    const actions = !m.stripe_account_id
      ? `<div class="btn-row">
           <button class="btn primary" data-create="${m.id}" data-mode="express">Onboard (hosted)</button>
           <button class="btn" data-create="${m.id}" data-mode="none">Onboard (API)</button>
         </div>`
      : m.onboarding_mode === 'none'
        ? `<div class="btn-row">
             <button class="btn primary" data-prefill="${m.id}">Submit KYC</button>
             <button class="btn" data-status="${m.id}">Check</button>
           </div>`
        : `<div class="btn-row">
             <a class="btn primary" href="/accounts/${m.id}/onboard" target="_blank">Onboard</a>
             <button class="btn" data-status="${m.id}">Check</button>
           </div>`;

    return `<tr data-row="${m.id}">
      <td><div class="outlet">
        <div class="emoji">${esc(m.logo_emoji || '🍽️')}</div>
        <div><strong>${esc(m.name)}</strong><span class="muted small">${esc(m.cuisine || m.type)}</span></div>
      </div></td>
      <td>${mode}</td>
      <td>${acct}</td>
      <td data-cell="status">${m.stripe_account_id ? '<span class="pill off">unknown</span>' : '<span class="pill off">—</span>'}</td>
      <td class="small">${pct(m.fee_bps)} fee<br><span class="muted">${pct(m.service_charge_bps)} svc · ${pct(m.gst_bps)} GST</span></td>
      <td>${actions}</td>
    </tr>`;
  }).join('');

  $$('[data-create]').forEach(b => b.onclick = () => createAccount(b.dataset.create, b.dataset.mode, b));
  $$('[data-prefill]').forEach(b => b.onclick = () => prefill(b.dataset.prefill, b));
  $$('[data-status]').forEach(b => b.onclick = () => refreshStatus(b.dataset.status));
}

async function createAccount(id, dashboard, btn) {
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const r = await api('/accounts', { method: 'POST', body: { merchantId: id, dashboard } });
    toast(`Connected account ${r.accountId} created (${r.api}, ${r.dashboard})`);
    await loadMerchants();
    if (dashboard === 'none') await prefill(id);
  } catch (e) { toast(e.message, true); btn.disabled = false; }
}

async function prefill(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  try {
    const r = await api(`/accounts/${id}/prefill-test`, { method: 'POST' });
    toast(r.charges_enabled ? 'KYC submitted — charges enabled' : 'KYC submitted — charges still pending');
    await loadMerchants();
    refreshStatus(id);
  } catch (e) { toast(e.message, true); if (btn) btn.disabled = false; }
}

async function refreshStatus(id) {
  const cell = $(`[data-row="${id}"] [data-cell="status"]`);
  if (!cell) return;
  cell.innerHTML = '<span class="pill off">checking…</span>';
  try {
    const s = await api(`/accounts/${id}/status`);
    const pills = [
      `<span class="pill ${s.charges_enabled ? 'ok' : 'warn'}">charges ${s.charges_enabled ? '✓' : '✗'}</span>`,
      `<span class="pill ${s.payouts_enabled ? 'ok' : 'off'}">payouts ${s.payouts_enabled ? '✓' : '✗'}</span>`,
    ];
    if (s.dashboard_url) pills.push(`<a class="pill info" href="${s.dashboard_url}" target="_blank">dashboard ↗</a>`);
    cell.innerHTML = pills.join(' ');
  } catch (e) {
    cell.innerHTML = `<span class="pill danger" title="${esc(e.message)}">error</span>`;
  }
}

$('#refreshAll').onclick = () => merchants.filter(m => m.stripe_account_id).forEach(m => refreshStatus(m.id));

$('#addOutlet').onclick = async () => {
  const name = $('#nName').value.trim();
  if (!name) return toast('Name is required', true);
  try {
    await api('/merchants', { method: 'POST', body: {
      name, type: $('#nType').value,
      cuisine: $('#nCuisine').value.trim(),
      logo_emoji: $('#nEmoji').value.trim() || '🍽️',
    }});
    ['#nName', '#nCuisine', '#nEmoji'].forEach(s => $(s).value = '');
    toast(`${name} added`);
    loadMerchants();
  } catch (e) { toast(e.message, true); }
};

// ---- menu ----
async function loadMenu() {
  const id = $('#menuOutlet').value;
  if (!id) return;
  const { products } = await api(`/platform/merchants/${id}/products?all=true`);
  $('#menuRows').innerHTML = products.length ? products.map(p => `
    <tr>
      <td><div class="outlet">
        <div class="emoji">${esc(p.image_emoji || '🍽️')}</div>
        <div><strong>${esc(p.name)}</strong><span class="muted small">${esc(p.description)}</span></div>
      </div></td>
      <td>${esc(p.category)}</td>
      <td class="mono">${money(p.unit_amount, p.currency)}</td>
      <td><span class="pill ${p.active ? 'ok' : 'off'}">${p.active ? 'active' : 'hidden'}</span></td>
      <td><div class="btn-row">
        <button class="btn" data-toggle="${p.id}" data-active="${p.active ? 0 : 1}">${p.active ? 'Hide' : 'Show'}</button>
        <button class="btn danger" data-del="${p.id}">Delete</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty">No menu items yet.</td></tr>';

  $$('[data-toggle]').forEach(b => b.onclick = async () => {
    await api(`/platform/products/${b.dataset.toggle}`, { method: 'PATCH', body: { active: b.dataset.active } });
    loadMenu();
  });
  $$('[data-del]').forEach(b => b.onclick = async () => {
    await api(`/platform/products/${b.dataset.del}`, { method: 'DELETE' });
    toast('Item deleted'); loadMenu();
  });
}
$('#menuOutlet').onchange = loadMenu;

$('#addProduct').onclick = async () => {
  const name = $('#pName').value.trim();
  const price = parseFloat($('#pPrice').value);
  if (!name || !price) return toast('Name and price are required', true);
  try {
    await api(`/platform/merchants/${$('#menuOutlet').value}/products`, { method: 'POST', body: {
      name, category: $('#pCategory').value,
      unit_amount: Math.round(price * 100),
      image_emoji: $('#pEmoji').value.trim(),
      description: $('#pDesc').value.trim(),
    }});
    ['#pName', '#pPrice', '#pEmoji', '#pDesc'].forEach(s => $(s).value = '');
    toast(`${name} added`); loadMenu();
  } catch (e) { toast(e.message, true); }
};

// ---- readers ----
async function loadReaders() {
  const id = $('#readerOutlet').value;
  if (!id) return;
  $('#readerRows').innerHTML = '<tr><td colspan="5" class="empty">Loading…</td></tr>';
  try {
    const { readers } = await api(`/platform/readers?merchantId=${id}`);
    $('#readerRows').innerHTML = readers.length ? readers.map(r => `
      <tr>
        <td><strong>${esc(r.label || '—')}</strong></td>
        <td class="mono">${esc(r.id)}</td>
        <td class="small muted">${esc(r.device_type)}</td>
        <td><span class="pill ${r.kind === 'physical' ? 'info' : 'off'}">${r.kind}</span></td>
        <td><span class="pill ${r.status === 'online' ? 'ok' : 'warn'}">${esc(r.status)}</span></td>
      </tr>`).join('') : '<tr><td colspan="5" class="empty">No readers registered.</td></tr>';
  } catch (e) {
    $('#readerRows').innerHTML = `<tr><td colspan="5" class="empty">${esc(e.message)}</td></tr>`;
  }
}
$('#readerOutlet').onchange = loadReaders;
$('#refreshReaders').onclick = loadReaders;

$('#addReader').onclick = async () => {
  const code = $('#rCode').value.trim();
  if (!code) return toast('Registration code is required', true);
  const btn = $('#addReader');
  btn.disabled = true; btn.textContent = 'Registering…';
  try {
    const r = await api('/terminal/readers/register', { method: 'POST', body: {
      merchantId: $('#readerOutlet').value,
      registrationCode: code,
      label: $('#rLabel').value.trim() || 'Reader',
    }});
    toast(`Reader ${r.readerId} registered (${r.status})`);
    $('#rCode').value = ''; $('#rLabel').value = '';
    loadReaders();
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; btn.textContent = 'Register'; }
};

// ---- config ----
function fillConfig() {
  const m = merchants.find(x => x.id === $('#cfgOutlet').value);
  if (!m) return;
  $('#cFee').value = m.fee_bps;
  $('#cService').value = m.service_charge_bps;
  $('#cGst').value = m.gst_bps;
  $('#cCountry').value = m.country;
  $('#cCurrency').value = m.currency;
  $('#cColor').value = m.brand_color || '#635bff';
  previewConfig();
}
$('#cfgOutlet').onchange = fillConfig;
['#cFee', '#cService', '#cGst'].forEach(s => $(s).oninput = previewConfig);

function previewConfig() {
  const sub = 6000;
  const svc = Math.round(sub * (+$('#cService').value || 0) / 10000);
  const gst = Math.round((sub + svc) * (+$('#cGst').value || 0) / 10000);
  const total = sub + svc + gst;
  const fee = Math.round(total * (+$('#cFee').value || 0) / 10000);
  $('#cfgPreview').innerHTML =
    `Worked example — subtotal <strong>${money(sub)}</strong> ` +
    `+ service ${money(svc)} + GST ${money(gst)} = <strong>${money(total)}</strong>. ` +
    `Platform keeps <strong>${money(fee)}</strong>, outlet receives <strong>${money(total - fee)}</strong>. ` +
    `<em>Tips are excluded from the platform fee.</em>`;
}

$('#saveConfig').onclick = async () => {
  try {
    await api(`/platform/merchants/${$('#cfgOutlet').value}`, { method: 'PATCH', body: {
      fee_bps: $('#cFee').value, service_charge_bps: $('#cService').value, gst_bps: $('#cGst').value,
      country: $('#cCountry').value.toUpperCase(), currency: $('#cCurrency').value.toLowerCase(),
      brand_color: $('#cColor').value,
    }});
    toast('Configuration saved');
    await loadMerchants();
  } catch (e) { toast(e.message, true); }
};

// ---- activity ----
async function pollEvents() {
  try {
    const { events } = await api(`/platform/events?since=${lastEventId}&limit=40`);
    if (events.length) {
      lastEventId = Math.max(...events.map(e => e.id));
      const feed = $('#feed');
      for (const e of events.reverse()) {
        const row = document.createElement('div');
        row.className = 'feed-row';
        row.innerHTML = `<time>${new Date(e.created_at).toLocaleTimeString()}</time>
                         <span class="k">${esc(e.kind)}</span>
                         <span>${esc(e.message)}</span>`;
        feed.prepend(row);
      }
      while (feed.children.length > 200) feed.lastChild.remove();
    }
  } catch { /* transient */ }
}

// Arriving back from Stripe-hosted onboarding. The merchant has just finished a
// KYC flow on someone else's domain; landing them on an unchanged table with no
// acknowledgement reads as "did that work?".
async function handleOnboardingReturn() {
  const id = new URLSearchParams(location.search).get('onboarded');
  if (!id) return;

  history.replaceState({}, '', location.pathname);
  const m = merchants.find(x => x.id === id);
  const name = m ? m.name : id;

  const bar = document.createElement('div');
  bar.className = 'card';
  bar.style.cssText = 'border-color:var(--accent);background:var(--accent-soft)';
  bar.innerHTML = `<div class="card-body" style="display:flex;align-items:center;gap:12px">
      <svg class="i" style="color:var(--accent)" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>
      <div style="flex:1">
        <strong>Onboarding submitted for ${esc(name)}</strong>
        <div class="small muted" id="obDetail">Checking with Stripe…</div>
      </div>
    </div>`;
  $('.tabs').insertAdjacentElement('beforebegin', bar);

  try {
    const st = await api(`/accounts/${id}/status`);
    // Capabilities activate asynchronously — "submitted" is not "live".
    $('#obDetail').innerHTML = st.charges_enabled
      ? `Charges enabled${st.payouts_enabled ? ' and payouts enabled' : ' — payouts still pending'}. This outlet can take payments now.`
      : 'Details submitted. Stripe is still verifying — charges will enable shortly.';
    refreshStatus(id);
  } catch (e) {
    $('#obDetail').textContent = e.message;
  }
  setTimeout(() => bar.remove(), 15000);
}

// ---- reconciliation ----
async function loadMoney() {
  const d = await api('/platform/reconciliation');
  const t = d.totals;

  const kpi = (label, value, sub) =>
    `<div><div class="small muted">${label}</div>
     <div style="font-size:22px;font-weight:700;letter-spacing:-.02em">${value}</div>
     <div class="small muted">${sub}</div></div>`;

  $('#kpis').innerHTML =
    kpi('Gross processed', money(t.gross), `${t.orders} settled orders`) +
    kpi('Platform revenue', money(t.platformFee), t.gross ? `${((t.platformFee / t.gross) * 100).toFixed(2)}% effective` : '—') +
    kpi('Net to outlets', money(t.netToMerchant), 'settled to connected accounts') +
    kpi('Refunded', money(t.refunded), 'fees clawed back with it');

  $('#moneyRows').innerHTML = d.merchants.map(m => `
    <tr>
      <td><div class="outlet"><div class="emoji">${esc(m.logo_emoji || '🍽️')}</div>
        <div><strong>${esc(m.name)}</strong><span class="muted small mono">${esc(m.accountId || 'not onboarded')}</span></div></div></td>
      <td class="mono">${m.orders}</td>
      <td class="mono">${money(m.gross)}</td>
      <td class="mono">${money(m.platformFee)} <span class="muted small">${pct(m.feeBps)}</span></td>
      <td class="mono">${money(m.netToMerchant)}</td>
      <td><span class="pill ${m.payoutSchedule === 'manual' ? 'info' : 'off'}">${esc(m.payoutSchedule)}</span></td>
    </tr>`).join('');

  const channels = Object.entries(d.byChannel);
  $('#channelRows').innerHTML = channels.length ? channels.map(([name, c]) => {
    const viaStripe = name !== 'aggregator';
    return `<tr>
      <td><span class="pill ${viaStripe ? 'info' : 'warn'}">${esc(name)}</span></td>
      <td class="mono">${c.orders}</td>
      <td class="mono">${money(c.gross)}</td>
      <td class="mono">${money(c.platformFee)}</td>
      <td>${viaStripe ? '<span class="pill ok">yes</span>' : '<span class="pill warn">no — remitted separately</span>'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="empty">No settled orders yet.</td></tr>';
}
$('#reloadMoney').onclick = loadMoney;

loadMerchants().then(() => {
  handleOnboardingReturn();
  merchants.filter(m => m.stripe_account_id).forEach(m => refreshStatus(m.id));
  pollEvents();
  setInterval(pollEvents, 2000);
});
