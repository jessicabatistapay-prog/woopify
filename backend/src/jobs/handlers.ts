import { q } from '../lib/db.js';
import { refreshOrder, syncRefunds } from '../services/events.js';
import { checkReceipts, deliverNotification } from '../services/push.js';
import { reconcile, resumeSyncs, syncOrdersPage, syncProductsPage } from '../services/sync.js';
import { processWebhookDelivery } from '../services/webhooks.js';
import { config } from '../lib/config.js';
import { enqueue, releaseStale, runOne, type Handler } from './queue.js';
import fs from 'node:fs';
import path from 'node:path';

export const handlers: Record<string, Handler> = {
  'webhook.process': async (j) => processWebhookDelivery(j.payload.deliveryRowId),
  'push.notification': async (j) => {
    await deliverNotification(j.payload.notificationId);
  },
  'push.receipts': async () => checkReceipts(),
  'sync.orders': async (j) => {
    await syncOrdersPage(j.payload.shopId);
  },
  'sync.products': async (j) => {
    await syncProductsPage(j.payload.shopId);
  },
  reconcile: async (j) => reconcile(j.payload.shopId),
  'order.refunds': async (j) => syncRefunds(j.payload.shopId, j.payload.orderId),
  'order.refresh': async (j) => refreshOrder(j.payload.shopId, j.payload.orderId),
  'uploads.cleanup': async () => {
    const old = await q<{ id: string }>(`DELETE FROM uploads WHERE created_at < now() - interval '2 days' RETURNING id`);
    for (const u of old) fs.promises.unlink(path.join(config().UPLOAD_DIR, u.id)).catch(() => undefined);
  },
};

/** Lên lịch đối soát định kỳ cho mọi shop (dedupe theo khung thời gian) */
export async function scheduleRecurring() {
  const shops = await q<{ id: number }>('SELECT id FROM shops');
  const bucket = Math.floor(Date.now() / (config().RECONCILE_INTERVAL_MINUTES * 60_000));
  for (const s of shops) {
    await enqueue('reconcile', { shopId: s.id }, { dedupeKey: `reconcile:${s.id}:${bucket}`, maxAttempts: 2 });
  }
  await enqueue('uploads.cleanup', {}, { dedupeKey: `uploads.cleanup:${Math.floor(Date.now() / 86400_000)}`, maxAttempts: 1 });
  await enqueue('push.receipts', {}, { dedupeKey: 'push.receipts', delaySeconds: 60 });
}

export function startWorker(log: (m: string) => void = console.log) {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let lastSchedule = 0;
  const tick = async () => {
    if (stopped) return;
    try {
      if (Date.now() - lastSchedule > 60_000) {
        lastSchedule = Date.now();
        await releaseStale();
        await resumeSyncs();
        await scheduleRecurring();
      }
      // chạy liên tục khi còn job sẵn sàng
      for (let i = 0; i < 50 && !stopped; i++) if (!(await runOne(handlers))) break;
    } catch (e) {
      log(`[worker] lỗi: ${(e as Error).message}`);
    }
    if (!stopped) timer = setTimeout(tick, config().WORKER_POLL_MS);
  };
  timer = setTimeout(tick, 100);
  log('[worker] đã khởi động');
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
