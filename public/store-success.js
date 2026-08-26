const money = c => 'S$' + (c / 100).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = new URLSearchParams(location.search);

// Checkout can hand us back a session whose PaymentIntent hasn't settled yet —
// PayNow in particular. Poll briefly rather than declaring failure on paint.
async function confirm(attempt = 0) {
  const res = await fetch(`/checkout/status?session_id=${encodeURIComponent(q.get('session_id'))}&merchantId=${encodeURIComponent(q.get('merchantId'))}`);
  const d = await res.json();
  if (!res.ok) return fail(d.error || 'Could not confirm this payment.');

  if (d.payment_status !== 'paid' && attempt < 8) {
    return setTimeout(() => confirm(attempt + 1), 1200);
  }
  render(d);
}

function fail(msg) {
  document.querySelector('#receipt').innerHTML =
    `<div class="card"><div class="card-body empty">
       <h2 style="margin:0 0 6px">Couldn't confirm</h2>
       <p style="margin:0 0 14px">${esc(msg)}</p>
       <a class="btn" href="/store.html">Back to the menu</a>
     </div></div>`;
}

function render(d) {
  const paid = d.payment_status === 'paid';
  const o = d.order;
  const fee = d.application_fee_amount ?? (o ? o.application_fee : 0);
  const total = d.amount_total ?? (o ? o.amount : 0);
  const merchantGets = total - fee;
  const feePct = total ? (fee / total) * 100 : 0;

  const items = o && o.items ? o.items.map(i => `
    <div class="ln"><span>${i.quantity} × ${esc(i.name)}</span>
    <span class="mono">${money(i.unit_amount * i.quantity)}</span></div>`).join('') : '';

  document.querySelector('#receipt').innerHTML = `
    <div class="stamp">
      <div class="tick">${paid ? '✓' : '…'}</div>
      <h1>${paid ? 'Payment confirmed' : 'Payment pending'}</h1>
      <p>${esc(d.merchant.logo_emoji || '')} ${esc(d.merchant.name)}${o ? ' · order ' + esc(o.id) : ''}</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>Receipt</h2><div class="spacer"></div>
        <span class="pill ${paid ? 'ok' : 'warn'}">${esc(d.payment_status)}</span></div>
      <div class="card-body">
        ${items}
        ${o ? `
          <div class="ln"><span class="muted">Service charge</span><span class="mono">${money(o.service_charge)}</span></div>
          <div class="ln"><span class="muted">GST</span><span class="mono">${money(o.gst)}</span></div>` : ''}
        <div class="ln grand"><span>Total paid</span><span class="mono">${money(total)}</span></div>
        ${d.customer_details && d.customer_details.email
          ? `<p class="small muted" style="margin:12px 0 0">Receipt sent to ${esc(d.customer_details.email)}</p>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Where the money went</h2><div class="spacer"></div>
        <span class="pill info">direct charge</span></div>
      <div class="card-body flow">
        <div class="bar">
          <span class="m" style="width:${100 - feePct}%">${money(merchantGets)}</span>
          <span class="p" style="width:${feePct}%"></span>
        </div>
        <div class="leg">
          <span class="k"><span class="sw" style="background:var(--ok)"></span> ${esc(d.merchant.name)} receives</span>
          <strong class="mono">${money(merchantGets)}</strong>
        </div>
        <div class="leg">
          <span class="k"><span class="sw" style="background:var(--accent)"></span> MakanPay platform fee</span>
          <strong class="mono">${money(fee)}</strong>
        </div>
        <p class="small muted" style="margin:12px 0 0">
          The outlet is merchant of record — funds settle straight into its own Stripe
          balance and the platform fee is collected automatically. No transfer step,
          no platform treasury, nothing to reconcile between the two.
        </p>
      </div>
    </div>

    <div class="btn-row" style="justify-content:center">
      <a class="btn" href="/store.html?merchantId=${encodeURIComponent(d.merchant.id)}">Order again</a>
      <a class="btn" href="/admin.html">Platform console</a>
    </div>`;
}

if (!q.get('session_id')) fail('No checkout session in the URL.');
else confirm();
