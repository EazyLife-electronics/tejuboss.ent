// Admin review queue for the clean Spark-compatible order-request model.
import { setOrderReviewDecision } from '../../js/commerce-store.mjs';
import { escapeHtml } from './admin-shared.mjs';

function money(minor) {
  return (Number(minor || 0) / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 });
}
function dateLabel(value) {
  return value?.toDate ? value.toDate().toLocaleString() : '';
}
function statusClass(status) {
  if (status === 'approved') return 'bg-green-100 text-green-700';
  if (status === 'rejected') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-800';
}

export function renderOrderList(orders) {
  const root = document.getElementById('orderList');
  if (!root) return;
  root.innerHTML = (orders || []).map(order => {
    const customer = order.customer || {};
    const fulfilment = order.fulfilment || {};
    const quote = order.quote || {};
    const lines = (order.lines || []).map(line => `
      <li class="py-2 border-b border-gray-100 last:border-0">
        <div class="flex justify-between gap-3 text-xs">
          <span class="font-semibold">${escapeHtml(line.requestedName || line.productId)} · ${escapeHtml(line.requestedOption || line.sellingOptionId)} × ${Number(line.quantity) || 0}</span>
          <span class="font-bold whitespace-nowrap">${money(Number(line.displayedUnitPriceMinor || 0) * Number(line.quantity || 0))}</span>
        </div>
        ${line.requestedAddons?.length ? `<p class="text-[10px] text-gray-400 mt-1">${escapeHtml(line.requestedAddons.join(', '))}</p>` : ''}
      </li>`).join('');
    const isPending = order.status === 'awaiting_review';
    return `
      <article class="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm mb-3" data-order-card="${escapeHtml(order.id)}" data-displayed-total-minor="${Number(quote.grandTotalMinor || 0)}">
        <div class="flex justify-between items-start gap-3 mb-3">
          <div>
            <p class="font-bold text-sm text-gray-900">${escapeHtml(customer.name || 'Customer')}</p>
            <p class="text-xs text-gray-500">${escapeHtml(customer.phone || '')}${customer.email ? ' · ' + escapeHtml(customer.email) : ''}</p>
            <p class="text-[10px] text-gray-400 mt-1">${dateLabel(order.createdAt)} · Ref: ${escapeHtml(order.id)}</p>
          </div>
          <span class="text-[10px] font-bold uppercase px-2 py-1 rounded-full ${statusClass(order.status)}">${escapeHtml(order.status || 'unknown')}</span>
        </div>
        <div class="rounded-xl bg-gray-50 p-3 mb-3">
          <p class="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-2">Requested items</p>
          <ul>${lines}</ul>
          <div class="border-t border-gray-200 mt-2 pt-2 text-xs space-y-1">
            <div class="flex justify-between"><span>Customer's displayed subtotal</span><b>${money(quote.subtotalMinor)}</b></div>
            <div class="flex justify-between"><span>Displayed delivery fee</span><b>${money(quote.deliveryFeeMinor)}</b></div>
            <div class="flex justify-between text-sm"><span class="font-black">Unverified total</span><b class="text-red-700">${money(quote.grandTotalMinor)}</b></div>
          </div>
        </div>
        <p class="text-xs text-gray-600 mb-1"><b>Fulfilment:</b> ${escapeHtml(fulfilment.method || 'delivery')}</p>
        <p class="text-xs text-gray-600 mb-1"><b>Address:</b> ${escapeHtml([fulfilment.address, fulfilment.city, fulfilment.state].filter(Boolean).join(', ') || 'Not supplied')}</p>
        ${fulfilment.note ? `<p class="text-xs text-gray-500 mb-3"><b>Note:</b> ${escapeHtml(fulfilment.note)}</p>` : ''}
        ${isPending ? `
          <div class="border-t border-gray-100 pt-3 mt-3 space-y-2">
            <p class="text-[10px] font-black uppercase text-amber-700">Verify current catalogue prices and availability before deciding</p>
            <label class="block text-[10px] font-bold text-gray-500">Verified accepted total (₦)
              <input type="number" min="0" step="0.01" id="acceptedTotal-${escapeHtml(order.id)}" value="${(Number(quote.grandTotalMinor || 0) / 100).toFixed(2)}" class="mt-1 w-full p-2.5 rounded-lg border border-gray-200 text-sm">
            </label>
            <textarea id="reviewNote-${escapeHtml(order.id)}" rows="2" placeholder="Staff note, e.g. corrected current prices or stock check" class="w-full p-2.5 rounded-lg border border-gray-200 text-xs"></textarea>
            <div class="grid grid-cols-2 gap-2">
              <button data-approve-order="${escapeHtml(order.id)}" class="bg-green-700 text-white rounded-lg py-2.5 text-xs font-bold">Approve after verification</button>
              <button data-reject-order="${escapeHtml(order.id)}" class="bg-red-600 text-white rounded-lg py-2.5 text-xs font-bold">Reject request</button>
            </div>
          </div>
        ` : `
          <p class="text-xs text-gray-500 border-t border-gray-100 pt-3 mt-3">Decision: ${escapeHtml(order.staffVerification?.note || order.status)}${order.staffVerification?.acceptedTotalMinor != null ? ' · Accepted total: ' + money(order.staffVerification.acceptedTotalMinor) : ''}</p>
        `}
      </article>`;
  }).join('') || '<p class="text-center text-gray-400 text-sm py-10">No order requests yet.</p>';

  root.querySelectorAll('[data-approve-order]').forEach(button => {
    button.addEventListener('click', () => decide(button.dataset.approveOrder, 'approved', button));
  });
  root.querySelectorAll('[data-reject-order]').forEach(button => {
    button.addEventListener('click', () => decide(button.dataset.rejectOrder, 'rejected', button));
  });
}

async function decide(orderId, decision, button) {
  const amountEl = document.getElementById(`acceptedTotal-${orderId}`);
  const note = document.getElementById(`reviewNote-${orderId}`)?.value.trim() || '';
  let acceptedTotal = null;
  if (decision === 'approved') {
    acceptedTotal = Number(amountEl?.value);
    if (!Number.isFinite(acceptedTotal) || acceptedTotal < 0) return alert('Enter a valid verified total.');
    const displayedTotal = Number(document.querySelector(`[data-order-card="${CSS.escape(orderId)}"]`)?.dataset?.displayedTotalMinor);
    if (Number.isFinite(displayedTotal) && Math.round(acceptedTotal * 100) !== displayedTotal && !note) {
      return alert('Add a staff note explaining why the verified total differs from the customer\u2019s displayed total.');
    }
    if (!confirm('Confirm that you checked current prices and availability? Approval records the verified total only; it does not reserve or deduct stock.')) return;
  } else if (!confirm('Reject this order request?')) return;
  button.disabled = true;
  button.textContent = decision === 'approved' ? 'Approving…' : 'Rejecting…';
  try {
    await setOrderReviewDecision(orderId, decision, { acceptedTotal, note });
  } catch (error) {
    console.error(error);
    alert('Could not update this request: ' + (error.message || 'Unknown error'));
    button.disabled = false;
    button.textContent = decision === 'approved' ? 'Approve after verification' : 'Reject request';
  }
}
