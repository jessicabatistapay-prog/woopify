import { config } from '../lib/config.js';
import { q, q1, tx } from '../lib/db.js';
import { formatMoney, gmt, statusLabel } from '../lib/format.js';
import { enqueue } from '../jobs/queue.js';
import type { WooOrder } from '../woo/types.js';
import { isPaid, isPlaced, replaceRefunds, upsertOrder } from './orderStore.js';
import { clientFor, getShopById, type ShopRow } from './shop.js';

export type EventSource = 'webhook' | 'reconcile' | 'initial' | 'manual';
export type EventType = 'order.placed' | 'order.paid';

export interface ProcessResult {
  applied: boolean;
  newEvents: { id: number; type: EventType; suppressed: boolean; reason?: string }[];
}

/**
 * Điểm vào duy nhất cho mọi snapshot đơn hàng (webhook created/updated, đồng bộ, đối soát).
 * - Lưu bản đệm nếu snapshot không cũ hơn bản đang có.
 * - Phát hiện sự kiện nghiệp vụ đơn điệu (đã đặt, đã thanh toán). Một snapshot hợp lệ chứng minh sự kiện
 *   đã xảy ra, nên dù webhook đến sai thứ tự vẫn an toàn. UNIQUE(shop, order, type) đảm bảo chỉ một lần.
 * - checkout-draft / auto-draft bị bỏ qua: khi đơn rời trạng thái nháp (qua order.updated) mới tính là đặt.
 * - Đồng bộ lịch sử: sự kiện xảy ra trước notify_since hoặc quá cũ được ghi nhận nhưng không báo.
 */
export async function processOrderSnapshot(shop: ShopRow, o: WooOrder, source: EventSource): Promise<ProcessResult> {
  const res = await upsertOrder(shop.id, o);
  if (res.tie) await enqueue('order.refresh', { shopId: shop.id, orderId: o.id }, { dedupeKey: `order.refresh:${shop.id}:${o.id}` });
  if (res.refundsChanged && (o.refunds?.length ?? 0) > 0) {
    await enqueue('order.refunds', { shopId: shop.id, orderId: o.id }, { dedupeKey: `order.refunds:${shop.id}:${o.id}` });
  } else if (res.refundsChanged) {
    await replaceRefunds(shop.id, o.id, []);
  }

  const candidates: { type: EventType; at: Date }[] = [];
  if (isPlaced(o)) candidates.push({ type: 'order.placed', at: gmt(o.date_created_gmt)! });
  if (isPaid(o)) candidates.push({ type: 'order.paid', at: gmt(o.date_paid_gmt) ?? gmt(o.date_modified_gmt) ?? new Date() });

  const newEvents: ProcessResult['newEvents'] = [];
  const maxAgeMs = config().NOTIFY_MAX_AGE_HOURS * 3600_000;
  for (const c of candidates) {
    let reason: string | undefined;
    // dung sai 2 phút cho lệch đồng hồ giữa WordPress và backend
    if (c.at.getTime() < shop.notify_since.getTime() - 120_000) reason = 'before_connect';
    else if (Date.now() - c.at.getTime() > maxAgeMs) reason = 'too_old';
    const row = await q1<{ id: number }>(
      `INSERT INTO business_events (shop_id, order_id, type, source, event_at, suppressed, suppressed_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (shop_id, order_id, type) DO NOTHING RETURNING id`,
      [shop.id, o.id, c.type, source, c.at, !!reason, reason ?? null],
    );
    if (!row) continue;
    newEvents.push({ id: row.id, type: c.type, suppressed: !!reason, reason });
    if (!reason) await createNotificationsForEvent(shop, row.id, c.type, o.id);
  }
  return { applied: res.applied, newEvents };
}

export async function buildOrderMessage(shop: ShopRow, orderId: number, kind: EventType) {
  const row = await q1<any>('SELECT number, status, currency, total, item_count, date_paid_gmt FROM orders WHERE shop_id=$1 AND id=$2', [
    shop.id,
    orderId,
  ]);
  const number = row?.number ?? String(orderId);
  const money = row ? formatMoney(row.total, row.currency, shop.price_decimals) : '';
  const prefix = kind === 'order.paid' ? 'Đã thanh toán' : 'Đơn mới';
  const paid = row ? isPaid({ status: row.status, date_paid_gmt: row.date_paid_gmt }) : false;
  const state = kind === 'order.paid' ? statusLabel(row?.status ?? '') : paid ? 'Đã thanh toán' : statusLabel(row?.status ?? '');
  const items = row ? `${row.item_count} sản phẩm` : '';
  return {
    title: money ? `${prefix} #${number} · ${money}` : `${prefix} #${number}`,
    titlePrivate: `${prefix} #${number}`,
    body: [items, state].filter(Boolean).join(' · '),
  };
}

async function createNotificationsForEvent(shop: ShopRow, eventId: number, kind: EventType, orderId: number) {
  const msg = await buildOrderMessage(shop, orderId, kind);
  const users = await q<{ id: number }>('SELECT id FROM users');
  await tx(async (c) => {
    for (const u of users) {
      const n = await c.query(
        `INSERT INTO notifications (shop_id, user_id, event_id, kind, order_id, title, title_private, body, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (event_id, user_id) DO NOTHING RETURNING id`,
        [shop.id, u.id, eventId, kind, orderId, msg.title, msg.titlePrivate, msg.body,
          JSON.stringify({ type: 'order', orderId, shopId: shop.id, url: `wooadmin://orders/${orderId}` })],
      );
      if (n.rows[0]) {
        // "Đơn mới" chờ vài giây để gom các cập nhật liên tiếp (vd. thanh toán ngay) → nội dung chính xác hơn
        await enqueue(
          'push.notification',
          { notificationId: n.rows[0].id },
          { client: c, delaySeconds: kind === 'order.placed' ? config().PUSH_COALESCE_SECONDS : 0, dedupeKey: `push:${n.rows[0].id}` },
        );
      }
    }
  });
}

/** Tải danh sách hoàn tiền (có ngày) — WooCommerce Analytics ghi nhận hoàn tiền theo ngày hoàn */
export async function syncRefunds(shopId: number, orderId: number) {
  const shop = await getShopById(shopId);
  if (!shop) return;
  const refunds = (await clientFor(shop).get<any[]>(`/wc/v3/orders/${orderId}/refunds`, { per_page: 100 })).data;
  await replaceRefunds(
    shopId,
    orderId,
    refunds.map((r) => ({ id: r.id, amount: r.amount ?? r.total, reason: r.reason, date_created_gmt: r.date_created_gmt })),
  );
}

export async function refreshOrder(shopId: number, orderId: number) {
  const shop = await getShopById(shopId);
  if (!shop) return;
  const o = (await clientFor(shop).get<WooOrder>(`/wc/v3/orders/${orderId}`)).data;
  await q('UPDATE orders SET date_modified_gmt = date_modified_gmt - interval \'1 second\' WHERE shop_id=$1 AND id=$2', [shopId, orderId]);
  await processOrderSnapshot(shop, o, 'reconcile');
}
