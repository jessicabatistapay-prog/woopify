import { config } from '../lib/config.js';
import { q, q1 } from '../lib/db.js';
import { RetryLater, enqueue } from '../jobs/queue.js';
import { buildOrderMessage, type EventType } from './events.js';
import { getShopById } from './shop.js';

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: string;
  channelId: string;
  priority: 'high';
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export function isExpoToken(t: string | null | undefined): t is string {
  return !!t && /^Expo(nent)?PushToken\[.+\]$/.test(t);
}

async function expoPost(url: string, body: unknown): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (config().EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${config().EXPO_ACCESS_TOKEN}`;
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new RetryLater(`Không gọi được Expo Push: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (res.status === 429 || res.status >= 500) throw new RetryLater(`Expo Push tạm lỗi ${res.status}`);
  if (!res.ok) throw new Error(`Expo Push lỗi ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export async function sendExpo(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
  const out: ExpoTicket[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const json = await expoPost(config().EXPO_PUSH_URL, messages.slice(i, i + 100));
    out.push(...(json.data as ExpoTicket[]));
  }
  return out;
}

/** Tên file âm thanh đóng gói trong app (mobile/assets/sounds) và kênh Android tương ứng */
export const SOUNDS: Record<string, { ios: string; channel: string }> = {
  kaching: { ios: 'ka_ching.wav', channel: 'orders_kaching' },
  default: { ios: 'default', channel: 'orders' },
};

interface DeviceRow {
  id: string;
  sound: string;
  push_token: string | null;
  hide_amount: boolean;
  notify_new_order: boolean;
  notify_paid: boolean;
  active: boolean;
  permission: string;
}

function wantsKind(d: DeviceRow, kind: string): boolean {
  if (kind === 'order.placed') return d.notify_new_order;
  if (kind === 'order.paid') return d.notify_paid;
  return true; // test
}

export interface SendSummary {
  sent: number;
  skipped: number;
  errors: { deviceId: string; error: string }[];
}

/**
 * Gửi một thông báo tới các thiết bị của người dùng. Bảng push_deliveries có UNIQUE(notification, device):
 * job chạy lại (do lỗi tạm thời, worker khởi động lại) không gửi lại cho thiết bị đã nhận ticket thành công.
 */
export async function deliverNotification(notificationId: number, onlyDeviceId?: string): Promise<SendSummary> {
  const n = await q1<any>('SELECT * FROM notifications WHERE id=$1', [notificationId]);
  if (!n) return { sent: 0, skipped: 0, errors: [] };

  let { title, title_private: titlePrivate, body } = n;
  if (n.kind !== 'test' && n.order_id && n.shop_id) {
    const shop = await getShopById(n.shop_id);
    if (shop) {
      ({ title, titlePrivate, body } = await buildOrderMessage(shop, n.order_id, n.kind as EventType));
      await q('UPDATE notifications SET title=$2, title_private=$3, body=$4 WHERE id=$1', [n.id, title, titlePrivate, body]);
    }
  }

  const devices = await q<DeviceRow>(
    `SELECT * FROM devices WHERE user_id=$1 AND active AND push_token IS NOT NULL ${onlyDeviceId ? 'AND id=$2' : ''}`,
    onlyDeviceId ? [n.user_id, onlyDeviceId] : [n.user_id],
  );
  const summary: SendSummary = { sent: 0, skipped: 0, errors: [] };
  const targets: { d: DeviceRow; deliveryId: number }[] = [];
  for (const d of devices) {
    if (!wantsKind(d, n.kind) || !isExpoToken(d.push_token)) {
      summary.skipped++;
      continue;
    }
    await q(`INSERT INTO push_deliveries (notification_id, device_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [n.id, d.id]);
    const del = await q1<{ id: number; status: string }>(
      'SELECT id, status FROM push_deliveries WHERE notification_id=$1 AND device_id=$2',
      [n.id, d.id],
    );
    if (!del || !['queued', 'retry'].includes(del.status)) {
      summary.skipped++;
      continue;
    }
    targets.push({ d, deliveryId: del.id });
  }
  if (targets.length === 0) return summary;

  const messages: ExpoMessage[] = targets.map(({ d }) => ({
    to: d.push_token!,
    title: d.hide_amount ? titlePrivate : title,
    body,
    data: { ...n.data, notificationId: n.id },
    sound: (SOUNDS[d.sound] ?? SOUNDS.kaching).ios,
    channelId: (SOUNDS[d.sound] ?? SOUNDS.kaching).channel,
    priority: 'high',
  }));

  let tickets: ExpoTicket[];
  try {
    tickets = await sendExpo(messages);
  } catch (e) {
    for (const t of targets) {
      await q(`UPDATE push_deliveries SET status='retry', error=$2, attempts=attempts+1, updated_at=now() WHERE id=$1`, [
        t.deliveryId,
        (e as Error).message,
      ]);
    }
    throw e;
  }

  for (let i = 0; i < targets.length; i++) {
    const { d, deliveryId } = targets[i];
    const t = tickets[i];
    if (t?.status === 'ok') {
      summary.sent++;
      await q(`UPDATE push_deliveries SET status='sent', ticket_id=$2, error=NULL, attempts=attempts+1, updated_at=now() WHERE id=$1`, [
        deliveryId,
        t.id ?? null,
      ]);
      await q(`UPDATE devices SET last_push_at=now(), last_push_status='sent', last_push_error=NULL WHERE id=$1`, [d.id]);
    } else {
      const code = t?.details?.error ?? 'Unknown';
      summary.errors.push({ deviceId: d.id, error: `${code}: ${t?.message ?? ''}` });
      await q(`UPDATE push_deliveries SET status='error', error=$2, attempts=attempts+1, updated_at=now() WHERE id=$1`, [
        deliveryId,
        `${code}: ${t?.message ?? ''}`,
      ]);
      await q(`UPDATE devices SET last_push_at=now(), last_push_status='error', last_push_error=$2 WHERE id=$1`, [d.id, code]);
      if (code === 'DeviceNotRegistered') {
        await q(`UPDATE devices SET active=false, inactive_reason='DeviceNotRegistered' WHERE id=$1`, [d.id]);
      } else if (code === 'MessageRateExceeded') {
        await q(`UPDATE push_deliveries SET status='retry' WHERE id=$1`, [deliveryId]);
      }
    }
  }
  if (summary.sent > 0) await enqueue('push.receipts', {}, { delaySeconds: 15 * 60, dedupeKey: 'push.receipts' });
  if (tickets.some((t) => t.details?.error === 'MessageRateExceeded')) throw new RetryLater('MessageRateExceeded', 30);
  return summary;
}

/** Kiểm tra receipt từ Expo (APNs/FCM có nhận hay không) và vô hiệu hóa token chết */
export async function checkReceipts() {
  const rows = await q<{ id: number; ticket_id: string; device_id: string }>(
    `SELECT id, ticket_id, device_id FROM push_deliveries WHERE status='sent' AND ticket_id IS NOT NULL
     AND updated_at < now() - interval '1 minute' ORDER BY id LIMIT 1000`,
  );
  if (rows.length === 0) return;
  const json = await expoPost(config().EXPO_RECEIPTS_URL, { ids: rows.map((r) => r.ticket_id) });
  const receipts = json.data ?? {};
  for (const r of rows) {
    const rc = receipts[r.ticket_id];
    if (!rc) continue;
    if (rc.status === 'ok') {
      await q(`UPDATE push_deliveries SET status='delivered', updated_at=now() WHERE id=$1`, [r.id]);
    } else {
      const code = rc.details?.error ?? 'Unknown';
      await q(`UPDATE push_deliveries SET status='error', error=$2, updated_at=now() WHERE id=$1`, [r.id, `${code}: ${rc.message ?? ''}`]);
      await q(`UPDATE devices SET last_push_status='error', last_push_error=$2 WHERE id=$1`, [r.device_id, code]);
      if (code === 'DeviceNotRegistered') {
        await q(`UPDATE devices SET active=false, inactive_reason='DeviceNotRegistered' WHERE id=$1`, [r.device_id]);
      }
    }
  }
}

export async function createTestNotification(userId: number, deviceId: string) {
  const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const n = await q1<{ id: number }>(
    `INSERT INTO notifications (user_id, kind, title, title_private, body, data)
     VALUES ($1,'test',$2,$2,$3,$4) RETURNING id`,
    [userId, 'Thông báo thử', `Đường gửi push hoạt động · ${now}`, JSON.stringify({ type: 'test', url: 'wooadmin://notifications' })],
  );
  return deliverNotification(n!.id, deviceId).then((s) => ({ notificationId: n!.id, ...s }));
}
