import { brandedEmailHtml, escapeEmailHtml as escape } from './email-layout.mjs';

export function receiptEmailHtml({ items, totalCents, currency = 'USD', receiptId, timestamp }) {
  const money = cents => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
    } catch {
      return `${currency} ${(cents / 100).toFixed(2)}`;
    }
  };
  const rows = items.map(item => {
    const qty = Number(item.quantity || item.qty || 1) || 1;
    const unit = Number(item.unit_price_cents || item.amount_cents / qty || 0);
    const total = Number(item.total_price_cents || item.amount_cents || 0);
    return `<tr>
      <td style="padding:12px 4px;border-bottom:1px solid #d8d8d8;word-break:break-word;">${escape(item.product_name || item.name || item.description || 'Item')}</td>
      <td align="center" style="padding:12px 4px;border-bottom:1px solid #d8d8d8;">${escape(qty)}</td>
      <td align="right" style="padding:12px 4px;border-bottom:1px solid #d8d8d8;">${escape(money(unit))}</td>
      <td align="right" style="padding:12px 4px;border-bottom:1px solid #d8d8d8;">${escape(money(total))}</td>
    </tr>`;
  }).join('');
  return brandedEmailHtml({
    title: 'Thank you for your purchase',
    preheader: `Your NobleCart receipt: ${money(totalCents)}.`,
    contentHtml: `
      <h1 class="email-title" style="margin:0 0 24px;color:#303030;font-family:Arial,Helvetica,sans-serif;font-size:27px;font-weight:400;letter-spacing:-0.7px;line-height:34px;">Thank you for your purchase</h1>
      <p style="margin:0 0 20px;color:#444444;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:27px;">We’ve received your payment. Here’s a summary of your order.</p>
      <p style="margin:0 0 24px;color:#666666;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:23px;"><strong>Receipt:</strong> ${escape(receiptId || '')}<br><strong>Date:</strong> ${escape(timestamp)}<br><strong>Currency:</strong> ${escape(currency.toUpperCase())}</p>
      <table role="table" aria-label="Order details" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;margin:0 0 24px;color:#444444;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;">
        <thead><tr>
          <th scope="col" width="40%" align="left" style="padding:10px 4px;border-bottom:1px solid #d8d8d8;">Product</th>
          <th scope="col" width="12%" style="padding:10px 4px;border-bottom:1px solid #d8d8d8;">Qty</th>
          <th scope="col" width="24%" align="right" style="padding:10px 4px;border-bottom:1px solid #d8d8d8;">Unit price</th>
          <th scope="col" width="24%" align="right" style="padding:10px 4px;border-bottom:1px solid #d8d8d8;">Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th scope="row" colspan="3" align="left" style="padding:16px 4px;font-size:16px;">Total amount</th><td align="right" style="padding:16px 4px;font-size:16px;font-weight:600;">${escape(money(totalCents))}</td></tr></tfoot>
      </table>
      <p style="margin:0;color:#666666;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:23px;">Keep this email for your records. If you have questions about your order, contact our support team below.</p>`,
  });
}
