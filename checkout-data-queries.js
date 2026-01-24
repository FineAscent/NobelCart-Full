// Quick Reference: Checkout Data Access in Browser Console

// 1. Get all user receipts with item counts
async function getUserReceiptsSummary() {
  const receipts = await window.sb.from('receipts').select('*').order('created_at', { ascending: false });
  return receipts.data?.map(r => ({
    id: r.id,
    receipt_id: r.session_id,
    total: formatMoney(r.amount_total_cents, r.currency),
    currency: r.currency,
    date: new Date(r.created_at).toLocaleDateString(),
    time: new Date(r.created_at).toLocaleTimeString(),
  })) || [];
}

// 2. Get detailed items for a specific receipt
async function getReceiptDetails(receiptId) {
  const items = await window.sb
    .from('checkout_items')
    .select('*')
    .eq('receipt_id', receiptId)
    .order('created_at');
  
  return items.data?.map(item => ({
    product_name: item.product_name,
    qty: item.quantity,
    unit_price: formatMoney(item.unit_price_cents),
    total: formatMoney(item.total_price_cents),
    is_weighted: item.is_weighted,
    unit: item.unit,
    date: new Date(item.created_at).toLocaleDateString(),
  })) || [];
}

// 3. Get user's total spending
async function getUserTotalSpending() {
  const receipts = await window.sb.from('receipts').select('amount_total_cents, currency');
  
  const byCategory = {};
  receipts.data?.forEach(r => {
    const key = r.currency || 'USD';
    byCategory[key] = (byCategory[key] || 0) + (r.amount_total_cents || 0);
  });
  
  return Object.entries(byCategory).map(([currency, cents]) => ({
    currency,
    total: formatMoney(cents, currency),
    cents,
  }));
}

// 4. Get most recently purchased items
async function getRecentPurchases(limit = 10) {
  const items = await window.sb
    .from('checkout_items')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  
  return items.data?.map(item => ({
    product_name: item.product_name,
    qty: item.quantity,
    date: new Date(item.created_at).toLocaleDateString(),
    time: new Date(item.created_at).toLocaleTimeString(),
  })) || [];
}

// 5. Get all weighted items purchased
async function getWeightedItemsPurchased() {
  const items = await window.sb
    .from('checkout_items')
    .select('*')
    .eq('is_weighted', true)
    .order('created_at', { ascending: false });
  
  return items.data?.map(item => ({
    product_name: item.product_name,
    quantity_kg: item.quantity,
    unit: item.unit,
    total_paid: formatMoney(item.total_price_cents),
    price_per_unit: formatMoney(item.unit_price_cents),
    date: new Date(item.created_at).toLocaleDateString(),
  })) || [];
}

// 6. Export purchase history to CSV
async function exportPurchaseHistoryToCSV() {
  const receipts = await window.sb.from('receipts').select('id, amount_total_cents, currency, created_at').order('created_at', { ascending: false });
  
  let csv = 'Receipt ID,Date,Time,Total,Currency\n';
  
  for (const r of receipts.data || []) {
    const date = new Date(r.created_at);
    csv += `${r.id},"${date.toLocaleDateString()}","${date.toLocaleTimeString()}","${formatMoney(r.amount_total_cents)}","${r.currency}"\n`;
  }
  
  // Download CSV
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `purchase-history-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// 7. Format helper (reuses site.js formatMoney)
function formatMoney(cents, currency = 'USD') {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

// ========== USAGE EXAMPLES ==========

// Get all receipts
await getUserReceiptsSummary();

// Get items from receipt ID 123
await getReceiptDetails(123);

// Get total spending
await getUserTotalSpending();

// Get last 10 purchases
await getRecentPurchases(10);

// Get all weighted items
await getWeightedItemsPurchased();

// Export to CSV
await exportPurchaseHistoryToCSV();
