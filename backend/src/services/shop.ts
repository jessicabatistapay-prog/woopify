import { config } from '../lib/config.js';
import { decrypt, encrypt, randomToken } from '../lib/crypto.js';
import { q, q1 } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { WooClient, WooError, normalizeStoreUrl } from '../woo/client.js';

export interface ShopRow {
  id: number;
  name: string;
  url: string;
  consumer_key_enc: string;
  consumer_secret_enc: string;
  webhook_secret_enc: string;
  timezone: string;
  currency: string;
  price_decimals: number;
  wc_version: string | null;
  hpos_enabled: boolean | null;
  ast_enabled: boolean;
  manage_stock_enabled: boolean;
  low_stock_amount: number;
  notify_since: Date;
  last_webhook_at: Date | null;
  last_webhook_topic: string | null;
  last_ping_at: Date | null;
  last_bad_signature_at: Date | null;
  last_check: any;
  last_check_at: Date | null;
}

export const WEBHOOK_TOPICS = [
  'order.created',
  'order.updated',
  'order.deleted',
  'order.restored',
  'product.created',
  'product.updated',
  'product.deleted',
] as const;

export async function getShop(): Promise<ShopRow | null> {
  // Bản đầu: một shop duy nhất
  return q1<ShopRow>('SELECT * FROM shops ORDER BY id LIMIT 1');
}

export async function requireShop(): Promise<ShopRow> {
  const s = await getShop();
  if (!s) throw new AppError(409, 'shop_not_connected', 'Chưa kết nối cửa hàng WooCommerce.');
  return s;
}

export async function getShopById(id: number): Promise<ShopRow | null> {
  return q1<ShopRow>('SELECT * FROM shops WHERE id=$1', [id]);
}

export function clientFor(shop: ShopRow): WooClient {
  return new WooClient({
    url: shop.url,
    consumerKey: decrypt(shop.consumer_key_enc),
    consumerSecret: decrypt(shop.consumer_secret_enc),
  });
}

export function webhookSecret(shop: ShopRow): string {
  return decrypt(shop.webhook_secret_enc);
}

export function deliveryUrl(shopId: number): string {
  return `${config().PUBLIC_URL.replace(/\/+$/, '')}/webhooks/woocommerce/${shopId}`;
}

/** IANA từ timezone_string, hoặc "UTC+7"/"UTC-5:30" khi WordPress dùng độ lệch thủ công */
export function resolveTimezone(timezoneString: string | undefined, gmtOffset: number | string | undefined): string {
  if (timezoneString && timezoneString.includes('/')) return timezoneString;
  if (timezoneString === 'UTC') return 'UTC';
  const off = Number(gmtOffset ?? 0);
  if (!off) return 'UTC';
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

export interface ShopMeta {
  name: string;
  timezone: string;
  currency: string;
  priceDecimals: number;
  wcVersion: string | null;
  hposEnabled: boolean | null;
  astEnabled: boolean;
  manageStockEnabled: boolean;
  lowStockAmount: number;
}

export async function fetchShopMeta(client: WooClient): Promise<ShopMeta> {
  const root = (await client.root()).data;
  const namespaces: string[] = root?.namespaces ?? [];
  const general = (await client.get<any[]>('/wc/v3/settings/general')).data;
  const gs = (id: string) => general.find((s) => s.id === id)?.value;
  let manageStock = true;
  let lowStock = 2;
  try {
    const products = (await client.get<any[]>('/wc/v3/settings/products')).data;
    manageStock = (products.find((s) => s.id === 'woocommerce_manage_stock')?.value ?? 'yes') === 'yes';
    lowStock = Number(products.find((s) => s.id === 'woocommerce_notify_low_stock_amount')?.value ?? 2) || 2;
  } catch {
    /* tùy chọn */
  }
  let wcVersion: string | null = null;
  let hpos: boolean | null = null;
  try {
    const ss = (await client.get<any>('/wc/v3/system_status', { _fields: 'environment,settings' })).data;
    wcVersion = ss?.environment?.version ?? null;
    const st = ss?.settings ?? {};
    if (typeof st.hpos_enabled === 'boolean') hpos = st.hpos_enabled;
    else if (typeof st.order_datastore === 'string') hpos = /OrdersTableDataStore/.test(st.order_datastore);
  } catch {
    /* system_status có thể chậm hoặc bị chặn — không bắt buộc */
  }
  return {
    name: root?.name ?? '',
    timezone: resolveTimezone(root?.timezone_string, root?.gmt_offset),
    currency: gs('woocommerce_currency') ?? 'USD',
    priceDecimals: Number(gs('woocommerce_price_num_decimals') ?? 2),
    wcVersion,
    hposEnabled: hpos,
    astEnabled: namespaces.some((n) => n.startsWith('wc-shipment-tracking')),
    manageStockEnabled: manageStock,
    lowStockAmount: lowStock,
  };
}

export async function refreshShopMeta(shop: ShopRow): Promise<ShopRow> {
  const meta = await fetchShopMeta(clientFor(shop));
  const row = await q1<ShopRow>(
    `UPDATE shops SET name=$2, timezone=$3, currency=$4, price_decimals=$5, wc_version=$6, hpos_enabled=$7,
       ast_enabled=$8, manage_stock_enabled=$9, low_stock_amount=$10, updated_at=now() WHERE id=$1 RETURNING *`,
    [shop.id, meta.name, meta.timezone, meta.currency, meta.priceDecimals, meta.wcVersion, meta.hposEnabled,
      meta.astEnabled, meta.manageStockEnabled, meta.lowStockAmount],
  );
  return row!;
}

export async function saveShopConnection(input: {
  url: string;
  consumerKey: string;
  consumerSecret: string;
  webhookSecret?: string;
}): Promise<ShopRow> {
  const url = normalizeStoreUrl(input.url);
  const existing = await getShop();
  const secret = input.webhookSecret || (existing ? webhookSecret(existing) : randomToken(32));
  if (existing) {
    const changedStore = existing.url !== url;
    const row = await q1<ShopRow>(
      `UPDATE shops SET url=$2, consumer_key_enc=$3, consumer_secret_enc=$4, webhook_secret_enc=$5,
        notify_since = CASE WHEN $6 THEN now() ELSE notify_since END, updated_at=now() WHERE id=$1 RETURNING *`,
      [existing.id, url, encrypt(input.consumerKey), encrypt(input.consumerSecret), encrypt(secret), changedStore],
    );
    if (changedStore) {
      // Đổi sang website khác: xóa dữ liệu đệm của website cũ
      await q('DELETE FROM orders WHERE shop_id=$1', [existing.id]);
      await q('DELETE FROM products WHERE shop_id=$1', [existing.id]);
      await q('DELETE FROM product_categories WHERE shop_id=$1', [existing.id]);
      await q('DELETE FROM business_events WHERE shop_id=$1', [existing.id]);
      await q('DELETE FROM sync_state WHERE shop_id=$1', [existing.id]);
    }
    return row!;
  }
  const row = await q1<ShopRow>(
    `INSERT INTO shops (url, consumer_key_enc, consumer_secret_enc, webhook_secret_enc, notify_since)
     VALUES ($1,$2,$3,$4, now()) RETURNING *`,
    [url, encrypt(input.consumerKey), encrypt(input.consumerSecret), encrypt(secret)],
  );
  return row!;
}

export function publicShop(shop: ShopRow) {
  return {
    id: shop.id,
    name: shop.name,
    url: shop.url,
    timezone: shop.timezone,
    currency: shop.currency,
    priceDecimals: shop.price_decimals,
    wcVersion: shop.wc_version,
    hposEnabled: shop.hpos_enabled,
    astEnabled: shop.ast_enabled,
    manageStockEnabled: shop.manage_stock_enabled,
    lowStockAmount: shop.low_stock_amount,
    lastWebhookAt: shop.last_webhook_at,
    lastWebhookTopic: shop.last_webhook_topic,
    lastCheck: shop.last_check,
    lastCheckAt: shop.last_check_at,
    adminUrl: `${shop.url}/wp-admin/`,
  };
}

export function adminOrderUrl(shop: ShopRow, orderId: number): string {
  // HPOS: admin.php?page=wc-orders; bản cũ: post.php (WooCommerce tự chuyển hướng khi HPOS bật)
  return shop.hpos_enabled
    ? `${shop.url}/wp-admin/admin.php?page=wc-orders&action=edit&id=${orderId}`
    : `${shop.url}/wp-admin/post.php?post=${orderId}&action=edit`;
}

export function adminProductUrl(shop: ShopRow, productId: number): string {
  return `${shop.url}/wp-admin/post.php?post=${productId}&action=edit`;
}

// ---------- Kiểm tra kết nối ----------

export type CheckKey = 'url' | 'auth' | 'read' | 'write' | 'webhooks' | 'webhook_delivery';
export interface CheckStep {
  key: CheckKey;
  label: string;
  ok: boolean;
  level: 'ok' | 'warn' | 'error' | 'skipped';
  message: string;
  hint?: string;
}

const LABELS: Record<CheckKey, string> = {
  url: 'URL website',
  auth: 'Xác thực API key',
  read: 'Quyền đọc',
  write: 'Quyền ghi',
  webhooks: 'Webhook trên WooCommerce',
  webhook_delivery: 'Backend nhận webhook',
};

export async function runConnectionCheck(
  creds: { url: string; consumerKey: string; consumerSecret: string },
  shop: ShopRow | null,
): Promise<{ ok: boolean; steps: CheckStep[] }> {
  const steps: CheckStep[] = [];
  const push = (key: CheckKey, level: CheckStep['level'], message: string, hint?: string) =>
    steps.push({ key, label: LABELS[key], ok: level === 'ok' || level === 'warn', level, message, hint });
  const skipRest = (from: CheckKey[]) => from.forEach((k) => push(k, 'skipped', 'Bỏ qua do bước trước lỗi.'));

  let client: WooClient;
  try {
    client = new WooClient(creds);
  } catch (e) {
    push('url', 'error', (e as Error).message, 'Nhập dạng https://shop-cua-ban.com');
    skipRest(['auth', 'read', 'write', 'webhooks', 'webhook_delivery']);
    return { ok: false, steps };
  }

  // 1. URL
  try {
    const root = (await client.root()).data;
    const ns: string[] = root?.namespaces ?? [];
    if (!ns.includes('wc/v3')) {
      push('url', 'error', 'Website trả về WordPress REST nhưng không có WooCommerce (wc/v3).', 'Kiểm tra plugin WooCommerce đã kích hoạt.');
      skipRest(['auth', 'read', 'write', 'webhooks', 'webhook_delivery']);
      return { ok: false, steps };
    }
    push('url', 'ok', `Kết nối được “${root?.name ?? client.baseUrl}”.`);
  } catch (e) {
    const err = e as WooError;
    push('url', 'error', err.message, err.kind === 'network' ? 'Kiểm tra tên miền, DNS và chứng chỉ SSL.' : 'Vào Cài đặt → Đường dẫn tĩnh, chọn khác “Thuần (Plain)”.');
    skipRest(['auth', 'read', 'write', 'webhooks', 'webhook_delivery']);
    return { ok: false, steps };
  }

  // 2+3. Xác thực & quyền đọc
  try {
    await client.get('/wc/v3/orders', { per_page: 1, _fields: 'id' });
    push('auth', 'ok', 'Consumer Key/Secret hợp lệ.');
    push('read', 'ok', 'Đọc được đơn hàng.');
  } catch (e) {
    const err = e as WooError;
    if (err.kind === 'auth') {
      push(
        'auth',
        'error',
        err.message,
        'Kiểm tra lại khóa. Nếu khóa đúng, máy chủ có thể đang chặn header Authorization (thêm SetEnvIf Authorization vào .htaccess — xem README).',
      );
      skipRest(['read', 'write', 'webhooks', 'webhook_delivery']);
    } else {
      push('auth', 'ok', 'Khóa được chấp nhận.');
      push('read', 'error', err.message, 'Tài khoản tạo khóa cần quyền Quản lý cửa hàng (Shop manager) hoặc Quản trị viên.');
      skipRest(['write', 'webhooks', 'webhook_delivery']);
    }
    return { ok: false, steps };
  }

  // 4. Quyền ghi — gọi batch rỗng, không thay đổi dữ liệu
  let canWrite = false;
  try {
    await client.post('/wc/v3/orders/batch', { create: [], update: [], delete: [] });
    canWrite = true;
    push('write', 'ok', 'Có quyền ghi (đổi trạng thái đơn, sửa giá/tồn kho).');
  } catch (e) {
    const err = e as WooError;
    push('write', 'error', err.kind === 'permission' ? err.message : `Không xác nhận được quyền ghi: ${err.message}`, 'Tạo lại khóa với Quyền: Đọc/Ghi.');
  }

  // 5. Webhook
  try {
    const hooks = (await client.get<any[]>('/wc/v3/webhooks', { per_page: 100 })).data;
    const target = shop ? deliveryUrl(shop.id) : null;
    const ours = hooks.filter((h) => target && h.delivery_url === target);
    const active = new Set(ours.filter((h) => h.status === 'active').map((h) => h.topic));
    const disabled = ours.filter((h) => h.status === 'disabled').map((h) => h.topic);
    const missing = ['order.created', 'order.updated'].filter((t) => !active.has(t));
    if (missing.length === 0) {
      push('webhooks', 'ok', `Đã có ${active.size} webhook hoạt động trỏ tới backend.`);
    } else {
      push(
        'webhooks',
        'error',
        disabled.length
          ? `WooCommerce đã tự tắt webhook (${disabled.join(', ')}) — thường do backend trả lỗi nhiều lần.`
          : `Thiếu webhook: ${missing.join(', ')}.`,
        canWrite ? 'Bấm “Tạo/sửa webhook tự động”.' : `Tạo thủ công trong WooCommerce → Cài đặt → Nâng cao → Webhooks, URL: ${target ?? '(lưu kết nối trước)'}`,
      );
    }
  } catch (e) {
    push('webhooks', 'error', `Không đọc được danh sách webhook: ${(e as Error).message}`);
  }

  // 6. Backend có nhận được webhook không
  if (shop?.last_bad_signature_at && (!shop.last_webhook_at || shop.last_bad_signature_at > shop.last_webhook_at)) {
    push('webhook_delivery', 'error', 'Backend nhận webhook nhưng chữ ký không khớp.', 'Secret trong WooCommerce phải trùng secret của backend. Dùng “Tạo/sửa webhook tự động” để đặt lại.');
  } else if (shop?.last_webhook_at) {
    push('webhook_delivery', 'ok', `Nhận webhook gần nhất lúc ${shop.last_webhook_at.toISOString()} (${shop.last_webhook_topic ?? ''}).`);
  } else if (/localhost|127\.0\.0\.1/.test(config().PUBLIC_URL)) {
    push('webhook_delivery', 'warn', 'PUBLIC_URL đang là localhost — WooCommerce không gửi được webhook tới đây.', 'Đặt PUBLIC_URL là địa chỉ HTTPS công khai của backend.');
  } else {
    push('webhook_delivery', 'warn', 'Chưa nhận webhook nào. Hãy đặt một đơn thử hoặc sửa một đơn để kiểm tra.');
  }

  return { ok: steps.every((s) => s.level === 'ok' || s.level === 'warn'), steps };
}

export async function checkShop(shop: ShopRow) {
  const result = await runConnectionCheck(
    { url: shop.url, consumerKey: decrypt(shop.consumer_key_enc), consumerSecret: decrypt(shop.consumer_secret_enc) },
    shop,
  );
  await q('UPDATE shops SET last_check=$2, last_check_at=now() WHERE id=$1', [shop.id, JSON.stringify(result)]);
  return result;
}

/** Tạo hoặc bật lại webhook trỏ về backend với secret của backend */
export async function ensureWebhooks(shop: ShopRow): Promise<{ created: string[]; updated: string[] }> {
  const client = clientFor(shop);
  const target = deliveryUrl(shop.id);
  const secret = webhookSecret(shop);
  const hooks = (await client.get<any[]>('/wc/v3/webhooks', { per_page: 100 })).data;
  const created: string[] = [];
  const updated: string[] = [];
  for (const topic of WEBHOOK_TOPICS) {
    const mine = hooks.filter((h) => h.delivery_url === target && h.topic === topic);
    if (mine.length === 0) {
      await client.post('/wc/v3/webhooks', {
        name: `Woo Admin Mobile — ${topic}`,
        topic,
        delivery_url: target,
        secret,
        status: 'active',
      });
      created.push(topic);
    } else {
      const [first, ...dupes] = mine;
      // luôn đặt lại secret để chắc chắn khớp; bật lại nếu bị WooCommerce tắt
      await client.put(`/wc/v3/webhooks/${first.id}`, { status: 'active', secret });
      updated.push(topic);
      for (const d of dupes) await client.request('DELETE', `/wc/v3/webhooks/${d.id}`, { query: { force: true } });
    }
  }
  return { created, updated };
}
