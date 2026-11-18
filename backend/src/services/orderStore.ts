import type pg from 'pg';
import { db, q } from '../lib/db.js';
import { gmt, toNum } from '../lib/format.js';
import type { WooOrder } from '../woo/types.js';

export const DRAFT_STATUSES = new Set(['checkout-draft', 'draft', 'auto-draft']);
export const PAID_STATUSES = new Set(['processing', 'completed']);

export function isPlaced(o: Pick<WooOrder, 'status'>): boolean {
  return !DRAFT_STATUSES.has(o.status) && o.status !== 'trash';
}

export function isPaid(o: Pick<WooOrder, 'status' | 'date_paid_gmt'>): boolean {
  return isPlaced(o) && (!!o.date_paid_gmt || PAID_STATUSES.has(o.status));
}

export function customerName(o: WooOrder): string {
  const b = `${o.billing?.first_name ?? ''} ${o.billing?.last_name ?? ''}`.trim();
  const s = `${o.shipping?.first_name ?? ''} ${o.shipping?.last_name ?? ''}`.trim();
  return b || s || o.billing?.company || o.billing?.email || 'Khách vãng lai';
}

export function mapOrder(o: WooOrder) {
  const items = o.line_items ?? [];
  return {
    id: o.id,
    number: String(o.number ?? o.id),
    status: o.status,
    currency: o.currency,
    total: toNum(o.total),
    items_subtotal: items.reduce((s, li) => s + toNum(li.subtotal), 0),
    discount_total: toNum(o.discount_total),
    shipping_total: toNum(o.shipping_total),
    total_tax: toNum(o.total_tax),
    refund_total: (o.refunds ?? []).reduce((s, r) => s + Math.abs(toNum(r.total)), 0),
    customer_name: customerName(o),
    billing_email: o.billing?.email ?? '',
    item_count: items.reduce((s, li) => s + (li.quantity ?? 0), 0),
    payment_method_title: o.payment_method_title ?? '',
    created_via: o.created_via ?? '',
    date_created_gmt: gmt(o.date_created_gmt)!,
    date_paid_gmt: gmt(o.date_paid_gmt),
    date_completed_gmt: gmt(o.date_completed_gmt),
    date_modified_gmt: gmt(o.date_modified_gmt) ?? gmt(o.date_created_gmt)!,
    refund_ids: (o.refunds ?? [])
      .map((r) => r.id)
      .sort((a, b) => a - b)
      .join(','),
    search_text: [o.number, o.id, customerName(o), o.billing?.email, o.billing?.phone, o.shipping?.first_name, o.shipping?.last_name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  };
}

export interface UpsertResult {
  applied: boolean; // false nếu snapshot cũ hơn bản đang lưu (webhook đến sai thứ tự)
  tie: boolean; // cùng date_modified nhưng khác trạng thái → nên tải lại
  refundsChanged: boolean;
  previousStatus: string | null;
}

/** Lưu đơn nếu snapshot mới hơn hoặc bằng bản đang có. */
export async function upsertOrder(shopId: number, o: WooOrder, client?: pg.PoolClient): Promise<UpsertResult> {
  const runner = client ?? db();
  const m = mapOrder(o);
  const prev = (
    await runner.query('SELECT status, date_modified_gmt, refund_ids FROM orders WHERE shop_id=$1 AND id=$2', [shopId, o.id])
  ).rows[0] as { status: string; date_modified_gmt: Date; refund_ids: string } | undefined;

  if (prev && prev.date_modified_gmt > m.date_modified_gmt) {
    return { applied: false, tie: false, refundsChanged: false, previousStatus: prev.status };
  }
  const tie = !!prev && prev.date_modified_gmt.getTime() === m.date_modified_gmt.getTime() && prev.status !== m.status;

  await runner.query(
    `INSERT INTO orders (shop_id, id, number, status, currency, total, items_subtotal, discount_total, shipping_total, total_tax,
       refund_total, customer_name, billing_email, item_count, payment_method_title, created_via, date_created_gmt, date_paid_gmt,
       date_completed_gmt, date_modified_gmt, refund_ids, raw, search_text, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23, now())
     ON CONFLICT (shop_id, id) DO UPDATE SET number=EXCLUDED.number, status=EXCLUDED.status, currency=EXCLUDED.currency,
       total=EXCLUDED.total, items_subtotal=EXCLUDED.items_subtotal, discount_total=EXCLUDED.discount_total,
       shipping_total=EXCLUDED.shipping_total, total_tax=EXCLUDED.total_tax, refund_total=EXCLUDED.refund_total,
       customer_name=EXCLUDED.customer_name, billing_email=EXCLUDED.billing_email, item_count=EXCLUDED.item_count,
       payment_method_title=EXCLUDED.payment_method_title, created_via=EXCLUDED.created_via,
       date_created_gmt=EXCLUDED.date_created_gmt, date_paid_gmt=EXCLUDED.date_paid_gmt,
       date_completed_gmt=EXCLUDED.date_completed_gmt, date_modified_gmt=EXCLUDED.date_modified_gmt,
       refund_ids=EXCLUDED.refund_ids, raw=EXCLUDED.raw, search_text=EXCLUDED.search_text, updated_at=now()`,
    [shopId, m.id, m.number, m.status, m.currency, m.total, m.items_subtotal, m.discount_total, m.shipping_total, m.total_tax,
      m.refund_total, m.customer_name, m.billing_email, m.item_count, m.payment_method_title, m.created_via, m.date_created_gmt,
      m.date_paid_gmt, m.date_completed_gmt, m.date_modified_gmt, m.refund_ids, JSON.stringify(o), m.search_text],
  );

  await runner.query('DELETE FROM order_line_items WHERE shop_id=$1 AND order_id=$2', [shopId, o.id]);
  for (const li of o.line_items ?? []) {
    await runner.query(
      `INSERT INTO order_line_items (shop_id, order_id, line_id, product_id, variation_id, name, sku, quantity, subtotal, total, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [shopId, o.id, li.id, li.product_id ?? 0, li.variation_id ?? 0, li.name ?? '', li.sku ?? '', li.quantity ?? 0,
        toNum(li.subtotal), toNum(li.total), li.image?.src || null],
    );
  }
  return {
    applied: true,
    tie,
    refundsChanged: (prev?.refund_ids ?? '') !== m.refund_ids,
    previousStatus: prev?.status ?? null,
  };
}

export async function replaceRefunds(
  shopId: number,
  orderId: number,
  refunds: { id: number; amount: string | number; reason?: string; date_created_gmt: string }[],
) {
  await q('DELETE FROM refunds WHERE shop_id=$1 AND order_id=$2', [shopId, orderId]);
  for (const r of refunds) {
    await q(
      `INSERT INTO refunds (shop_id, id, order_id, amount, reason, date_created_gmt) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (shop_id, id) DO UPDATE SET amount=EXCLUDED.amount, reason=EXCLUDED.reason, date_created_gmt=EXCLUDED.date_created_gmt`,
      [shopId, r.id, orderId, Math.abs(toNum(r.amount)), r.reason ?? '', gmt(r.date_created_gmt)],
    );
  }
}
