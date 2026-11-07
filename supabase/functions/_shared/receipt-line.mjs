// Stripe represents weighted purchases as quantity 1 at the full line amount.
// Recover the shopping quantity and price from metadata saved on the product.
export function receiptLine(line) {
  const product = line?.price?.product;
  const metadata = typeof product === 'object' && product ? product.metadata || {} : {};
  const weighted = metadata.weighted === '1';
  const quantity = weighted ? Number(metadata.qty) : Number(line?.quantity ?? 1);
  const unitAmount = weighted ? Number(metadata.unit_price_cents) : Number(line?.price?.unit_amount ?? 0);
  return {
    name: line?.description || product?.name || line?.price?.nickname || 'Item',
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    amount_cents: Number.isFinite(unitAmount) ? unitAmount : Number(line?.price?.unit_amount ?? 0),
    total_cents: Number(line?.amount_total ?? 0),
    product_id: metadata.id ?? (typeof product === 'string' ? product : product?.id) ?? null,
    is_weighted: weighted,
    unit: weighted ? metadata.unit || null : null
  };
}
