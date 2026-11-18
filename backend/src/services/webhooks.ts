import { q, q1 } from '../lib/db.js';
import { verifyWooSignature } from '../lib/crypto.js';
import { enqueue } from '../jobs/queue.js';
import { processOrderSnapshot } from './events.js';
import { getShopById, webhookSecret } from './shop.js';
import { handleProductPayload } from './sync.js';

export interface IncomingWebhook {
  shopId: number;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

const h = (headers: IncomingWebhook['headers'], k: string) => {
  const v = headers[k];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Nhận webhook: kiểm tra chữ ký trên raw body, lưu sự kiện, trả 200 nhanh; xử lý ở job nền.
 * WooCommerce tắt webhook nếu nhận lỗi nhiều lần → chỉ trả lỗi khi chữ ký sai.
 */
export async function receiveWebhook(w: IncomingWebhook): Promise<{ status: number; body: any }> {
  const shop = await getShopById(w.shopId);
  if (!shop) return { status: 404, body: { error: 'unknown_shop' } };

  const topic = h(w.headers, 'x-wc-webhook-topic');
  const signature = h(w.headers, 'x-wc-webhook-signature');
  const bodyText = w.rawBody.toString('utf8');

  // Ping khi tạo webhook: body "webhook_id=123", không có topic
  if (!topic && /^webhook_id=\d+$/.test(bodyText.trim())) {
    await q('UPDATE shops SET last_ping_at=now() WHERE id=$1', [shop.id]);
    return { status: 200, body: { ok: true, ping: true } };
  }

  if (!verifyWooSignature(w.rawBody, signature, webhookSecret(shop))) {
    await q('UPDATE shops SET last_bad_signature_at=now() WHERE id=$1', [shop.id]);
    return { status: 401, body: { error: 'invalid_signature' } };
  }

  let payload: any;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }

  const deliveryId = h(w.headers, 'x-wc-webhook-delivery-id') ?? null;
  const webhookId = h(w.headers, 'x-wc-webhook-id') ?? null;
  const row = await q1<{ id: number }>(
    `INSERT INTO webhook_deliveries (shop_id, delivery_id, webhook_id, topic, resource_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (shop_id, webhook_id, delivery_id) WHERE delivery_id IS NOT NULL DO NOTHING RETURNING id`,
    [shop.id, deliveryId, webhookId, topic ?? 'unknown', payload?.id ?? null, JSON.stringify(payload)],
  );
  await q('UPDATE shops SET last_webhook_at=now(), last_webhook_topic=$2 WHERE id=$1', [shop.id, topic]);
  if (!row) return { status: 200, body: { ok: true, duplicate: true } };
  await enqueue('webhook.process', { deliveryRowId: row.id });
  return { status: 200, body: { ok: true } };
}

export async function processWebhookDelivery(deliveryRowId: number) {
  const d = await q1<any>('SELECT * FROM webhook_deliveries WHERE id=$1', [deliveryRowId]);
  if (!d || d.status !== 'pending') return;
  const shop = await getShopById(d.shop_id);
  if (!shop) return;
  const topic: string = d.topic;
  const p = d.payload;
  let status = 'processed';
  if (topic.startsWith('order.')) {
    if (topic === 'order.deleted') {
      await q(`UPDATE orders SET status='trash', updated_at=now() WHERE shop_id=$1 AND id=$2`, [shop.id, p.id]);
    } else if (p && p.id && p.status) {
      await processOrderSnapshot(shop, p, 'webhook');
    } else {
      status = 'ignored';
    }
  } else if (topic.startsWith('product.')) {
    if (p && p.id) await handleProductPayload(shop, topic, p);
    else status = 'ignored';
  } else {
    status = 'ignored';
  }
  await q('UPDATE webhook_deliveries SET status=$2, processed_at=now() WHERE id=$1', [deliveryRowId, status]);
}
