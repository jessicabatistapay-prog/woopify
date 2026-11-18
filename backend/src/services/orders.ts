import { q, q1 } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { gmt, statusLabel, toNum } from '../lib/format.js';
import { WooError } from '../woo/client.js';
import type { WooOrder } from '../woo/types.js';
import { processOrderSnapshot } from './events.js';
import { withIdempotency } from './idempotency.js';
import { isPaid } from './orderStore.js';
import { adminOrderUrl, clientFor, type ShopRow } from './shop.js';

export interface ListOrdersQuery {
  status?: string; // một hoặc nhiều, phân tách bằng dấu phẩy; 'any'
  q?: string;
  from?: string; // ISO
  to?: string;
  page?: number;
  limit?: number;
}

export async function listOrders(shop: ShopRow, query: ListOrdersQuery) {
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const where = ['shop_id=$1', `status NOT IN ('checkout-draft','draft','auto-draft','trash')`];
  const params: unknown[] = [shop.id];
  if (query.status && query.status !== 'any') {
    params.push(query.status.split(',').map((s) => s.trim()));
    where.push(`status = ANY($${params.length})`);
  }
  if (query.q) {
    const term = query.q.trim().replace(/^#/, '').toLowerCase();
    params.push(`%${term.replace(/[%_]/g, '\\$&')}%`);
    params.push(term);
    where.push(`(search_text LIKE $${params.length - 1} OR number = $${params.length} OR id::text = $${params.length})`);
  }
  if (query.from) {
    params.push(new Date(query.from));
    where.push(`date_created_gmt >= $${params.length}`);
  }
  if (query.to) {
    params.push(new Date(query.to));
    where.push(`date_created_gmt < $${params.length}`);
  }
  params.push(limit + 1, (page - 1) * limit);
  const rows = await q<any>(
    `SELECT id, number, status, currency, total, customer_name, billing_email, item_count, date_created_gmt, date_paid_gmt, payment_method_title
     FROM orders WHERE ${where.join(' AND ')} ORDER BY date_created_gmt DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    items: rows.slice(0, limit).map((r) => ({ ...r, total: toNum(r.total), paid: isPaid({ status: r.status, date_paid_gmt: r.date_paid_gmt }) })),
    page,
    hasMore: rows.length > limit,
  };
}

export async function statusCounts(shop: ShopRow) {
  const rows = await q<{ status: string; n: number }>(
    `SELECT status, count(*)::int n FROM orders WHERE shop_id=$1 AND status NOT IN ('checkout-draft','draft','auto-draft','trash') GROUP BY status`,
    [shop.id],
  );
  let labels: Record<string, string> = {};
  try {
    const totals = (await clientFor(shop).get<any[]>('/wc/v3/reports/orders/totals')).data;
    labels = Object.fromEntries(totals.map((t) => [t.slug, t.name]));
  } catch {
    /* dùng nhãn mặc định */
  }
  const slugs = new Set([...Object.keys(labels), ...rows.map((r) => r.status), 'pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed']);
  slugs.delete('checkout-draft');
  return [...slugs].map((slug) => ({ slug, label: statusLabel(slug, labels), count: rows.find((r) => r.status === slug)?.n ?? 0 }));
}

export interface TrackingItem {
  provider: string;
  number: string;
  link: string | null;
  dateShipped: string | null;
}

/** Advanced Shipment Tracking / WooCommerce Shipment Tracking (tùy chọn) */
export async function fetchTracking(shop: ShopRow, o: WooOrder): Promise<TrackingItem[] | null> {
  const fromMeta = (o.meta_data ?? []).find((m) => m.key === '_wc_shipment_tracking_items')?.value;
  const map = (arr: any[]): TrackingItem[] =>
    arr.map((t) => ({
      provider: t.formatted_tracking_provider || t.tracking_provider || t.custom_tracking_provider || '',
      number: String(t.tracking_number ?? ''),
      link: t.formatted_tracking_link || t.tracking_link || t.custom_tracking_link || null,
      dateShipped: t.date_shipped ? String(t.date_shipped) : null,
    }));
  if (Array.isArray(fromMeta) && fromMeta.length) return map(fromMeta);
  if (!shop.ast_enabled) return null;
  for (const ns of ['wc-shipment-tracking/v3', 'wc-ast/v3']) {
    try {
      const res = await clientFor(shop).get<any[]>(`/${ns}/orders/${o.id}/shipment-trackings`);
      if (Array.isArray(res.data)) return map(res.data);
    } catch {
      /* thử namespace khác */
    }
  }
  return [];
}

function lineMeta(li: WooOrder['line_items'][number]) {
  return (li.meta_data ?? [])
    .filter((m) => !String(m.key).startsWith('_'))
    .map((m) => ({ key: String(m.display_key ?? m.key), value: String(m.display_value ?? m.value) }));
}

export function presentOrder(shop: ShopRow, o: WooOrder, extra: { notes?: any[]; tracking?: TrackingItem[] | null; stale?: boolean; fetchedAt?: Date }) {
  const sa = o.shipping ?? {};
  const hasShipping = !!(sa.address_1 || sa.city);
  const addr = hasShipping ? sa : o.billing;
  const addressLines = [
    `${addr.first_name ?? ''} ${addr.last_name ?? ''}`.trim(),
    addr.company,
    addr.address_1,
    addr.address_2,
    [addr.city, addr.state, addr.postcode].filter(Boolean).join(', '),
    addr.country,
  ].filter((x) => x && String(x).trim());
  return {
    id: o.id,
    number: String(o.number ?? o.id),
    status: o.status,
    statusLabel: statusLabel(o.status),
    paid: isPaid(o),
    currency: o.currency,
    dateCreated: gmt(o.date_created_gmt),
    datePaid: gmt(o.date_paid_gmt),
    dateModified: o.date_modified_gmt,
    paymentMethod: o.payment_method_title || o.payment_method,
    transactionId: o.transaction_id || null,
    customerNote: o.customer_note || '',
    customer: {
      name: `${o.billing?.first_name ?? ''} ${o.billing?.last_name ?? ''}`.trim(),
      email: o.billing?.email ?? '',
      phone: o.billing?.phone ?? '',
    },
    shippingAddress: { lines: addressLines, isBilling: !hasShipping, phone: (sa as any).phone || o.billing?.phone || '' },
    items: (o.line_items ?? []).map((li) => ({
      id: li.id,
      name: li.name,
      sku: li.sku,
      productId: li.product_id,
      variationId: li.variation_id,
      quantity: li.quantity,
      unitPrice: toNum(li.price),
      subtotal: toNum(li.subtotal),
      total: toNum(li.total),
      imageUrl: li.image?.src || null,
      meta: lineMeta(li),
    })),
    totals: {
      subtotal: (o.line_items ?? []).reduce((s, li) => s + toNum(li.subtotal), 0),
      discount: toNum(o.discount_total),
      shipping: toNum(o.shipping_total),
      shippingMethods: (o.shipping_lines ?? []).map((s) => s.method_title),
      fees: (o.fee_lines ?? []).map((f) => ({ name: f.name, total: toNum(f.total) })),
      tax: toNum(o.total_tax),
      total: toNum(o.total),
      refunded: (o.refunds ?? []).reduce((s, r) => s + Math.abs(toNum(r.total)), 0),
      coupons: (o.coupon_lines ?? []).map((c) => c.code),
    },
    refunds: (o.refunds ?? []).map((r) => ({ id: r.id, reason: r.reason, amount: Math.abs(toNum(r.total)) })),
    notes: extra.notes,
    tracking: extra.tracking ?? null,
    trackingSupported: shop.ast_enabled || extra.tracking != null,
    adminUrl: adminOrderUrl(shop, o.id),
    stale: !!extra.stale,
    fetchedAt: extra.fetchedAt ?? new Date(),
  };
}

export async function getOrderDetail(shop: ShopRow, id: number) {
  const client = clientFor(shop);
  try {
    const o = (await client.get<WooOrder>(`/wc/v3/orders/${id}`)).data;
    await processOrderSnapshot(shop, o, 'manual');
    const [notes, tracking] = await Promise.all([
      client
        .get<any[]>(`/wc/v3/orders/${id}/notes`)
        .then((r) => r.data.map((n) => ({ id: n.id, note: n.note, author: n.author, customerNote: n.customer_note, date: gmt(n.date_created_gmt) })))
        .catch(() => []),
      fetchTracking(shop, o).catch(() => null),
    ]);
    return presentOrder(shop, o, { notes, tracking });
  } catch (e) {
    if (e instanceof WooError && e.kind === 'not_found') throw new AppError(404, 'not_found', 'Đơn không tồn tại trên website.');
    const cached = await q1<any>('SELECT raw, updated_at FROM orders WHERE shop_id=$1 AND id=$2', [shop.id, id]);
    if (!cached) throw e;
    // Website tạm không truy cập được → dùng dữ liệu đã lưu, gắn cờ stale
    return presentOrder(shop, cached.raw, { notes: undefined, tracking: null, stale: true, fetchedAt: cached.updated_at });
  }
}

export async function updateOrderStatus(shop: ShopRow, id: number, status: string, expectedStatus?: string, force = false) {
  const client = clientFor(shop);
  const current = (await client.get<WooOrder>(`/wc/v3/orders/${id}`)).data;
  if (!force && expectedStatus && current.status !== expectedStatus) {
    await processOrderSnapshot(shop, current, 'manual');
    throw new AppError(409, 'conflict', `Trạng thái trên website đã đổi thành “${statusLabel(current.status)}”.`, {
      current: presentOrder(shop, current, {}),
    });
  }
  if (current.status === status) return presentOrder(shop, current, {});
  const updated = (await client.put<WooOrder>(`/wc/v3/orders/${id}`, { status })).data;
  await processOrderSnapshot(shop, updated, 'manual');
  return presentOrder(shop, updated, {});
}

export async function addOrderNote(shop: ShopRow, userId: number, id: number, note: string, customer: boolean, key?: string) {
  const client = clientFor(shop);
  const text = note.trim();
  if (!text) throw new AppError(400, 'bad_request', 'Ghi chú trống');
  const mapNote = (n: any) => ({ id: n.id, note: n.note, author: n.author, customerNote: n.customer_note, date: gmt(n.date_created_gmt) });
  return withIdempotency(
    key,
    userId,
    `order.note:${id}`,
    { note: text, customer },
    async () => mapNote((await client.post(`/wc/v3/orders/${id}/notes`, { note: text, customer_note: customer })).data),
    async (since) => {
      const notes = (await client.get<any[]>(`/wc/v3/orders/${id}/notes`)).data;
      const hit = notes.find(
        (n) => n.note.trim() === text && !!n.customer_note === customer && (gmt(n.date_created_gmt)?.getTime() ?? 0) >= since.getTime(),
      );
      return hit ? mapNote(hit) : null;
    },
  );
}
