/**
 * Quản lý cửa hàng qua REST API chính thức của WooCommerce (không cần plugin):
 * cài đặt (mọi nhóm trong WooCommerce → Cài đặt), cổng thanh toán, vùng/phương thức vận chuyển,
 * mã giảm giá, khách hàng. Luôn trả về giá trị WooCommerce xác nhận sau khi ghi.
 */
import { q } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { gmt, toNum } from '../lib/format.js';
import { WooError } from '../woo/client.js';
import { clientFor, refreshShopMeta, type ShopRow } from './shop.js';

/** Kiểu trường WooCommerce mà app có thể sửa trực tiếp */
const EDITABLE_TYPES = new Set(['text', 'email', 'number', 'password', 'textarea', 'select', 'multiselect', 'checkbox', 'radio', 'color', 'url', 'safe_text', 'decimal', 'price']);
// Nhóm cài đặt không có ý nghĩa trên điện thoại
const HIDDEN_GROUPS = new Set(['email_preview']);

export interface SettingField {
  id: string;
  label: string;
  description: string;
  tip: string;
  type: string;
  value: unknown;
  default: unknown;
  options: Record<string, string> | null;
  placeholder: string;
  editable: boolean;
}

export function mapField(f: any): SettingField {
  const type = String(f.type ?? 'text');
  return {
    id: String(f.id),
    label: String(f.label ?? f.title ?? f.id).replace(/<[^>]+>/g, ''),
    description: String(f.description ?? '').replace(/<[^>]+>/g, ''),
    tip: String(f.tip ?? f.desc_tip ?? '').replace(/<[^>]+>/g, ''),
    type,
    value: f.value,
    default: f.default ?? null,
    options: f.options && typeof f.options === 'object' && !Array.isArray(f.options) ? f.options : null,
    placeholder: String(f.placeholder ?? ''),
    editable: EDITABLE_TYPES.has(type),
  };
}

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WooError && e.kind === 'invalid') throw new AppError(422, 'woo_invalid', e.message);
    throw e;
  }
};

// ---------- Cài đặt WooCommerce ----------

export async function settingGroups(shop: ShopRow) {
  const groups = (await clientFor(shop).get<any[]>('/wc/v3/settings')).data;
  return groups
    .filter((g) => !g.parent_id && !HIDDEN_GROUPS.has(g.id))
    .map((g) => ({ id: g.id, label: String(g.label), description: String(g.description ?? '') }));
}

export async function settingGroup(shop: ShopRow, group: string) {
  const fields = (await clientFor(shop).get<any[]>(`/wc/v3/settings/${encodeURIComponent(group)}`)).data;
  return fields.map(mapField);
}

export async function updateSettingGroup(shop: ShopRow, group: string, updates: { id: string; value: unknown }[]) {
  if (!updates.length) throw new AppError(400, 'bad_request', 'Không có thay đổi');
  const r = (await wrap(() => clientFor(shop).post<any>(`/wc/v3/settings/${encodeURIComponent(group)}/batch`, { update: updates }))).data;
  const failed = (r.update ?? []).filter((x: any) => x.error);
  if (failed.length) throw new AppError(422, 'woo_invalid', failed.map((x: any) => `${x.id}: ${x.error.message}`).join('; '));
  // tiền tệ, múi giờ, quản lý tồn kho… có thể đổi → cập nhật thông tin shop trong backend
  if (['general', 'products'].includes(group)) await refreshShopMeta(shop).catch(() => undefined);
  return (r.update ?? []).map(mapField);
}

// ---------- Cổng thanh toán ----------

const mapGateway = (g: any) => ({
  id: g.id,
  title: g.title,
  description: g.description ?? '',
  enabled: !!g.enabled,
  order: g.order ?? 0,
  methodTitle: g.method_title ?? g.id,
  methodDescription: String(g.method_description ?? '').replace(/<[^>]+>/g, ''),
  settings: Object.values(g.settings ?? {}).map(mapField),
});

export async function paymentGateways(shop: ShopRow) {
  const r = (await clientFor(shop).get<any[]>('/wc/v3/payment_gateways')).data;
  return r.map(mapGateway).sort((a, b) => Number(a.order) - Number(b.order));
}

export async function updatePaymentGateway(shop: ShopRow, id: string, body: { enabled?: boolean; title?: string; description?: string; settings?: Record<string, unknown> }) {
  const payload: Record<string, unknown> = {};
  if (body.enabled !== undefined) payload.enabled = body.enabled;
  if (body.title !== undefined) payload.title = body.title;
  if (body.description !== undefined) payload.description = body.description;
  if (body.settings) payload.settings = body.settings;
  return mapGateway((await wrap(() => clientFor(shop).put<any>(`/wc/v3/payment_gateways/${encodeURIComponent(id)}`, payload))).data);
}

// ---------- Vận chuyển ----------

const mapMethod = (m: any) => ({
  instanceId: m.instance_id,
  methodId: m.method_id,
  title: m.title,
  enabled: !!m.enabled,
  order: m.order ?? 0,
  settings: Object.values(m.settings ?? {}).map(mapField),
});

export async function shippingZones(shop: ShopRow) {
  const c = clientFor(shop);
  const zones = (await c.get<any[]>('/wc/v3/shipping/zones')).data;
  return Promise.all(
    zones.map(async (z) => {
      const [locations, methods] = await Promise.all([
        z.id === 0 ? Promise.resolve({ data: [] as any[] }) : c.get<any[]>(`/wc/v3/shipping/zones/${z.id}/locations`),
        c.get<any[]>(`/wc/v3/shipping/zones/${z.id}/methods`),
      ]);
      return {
        id: z.id,
        name: z.id === 0 ? 'Các khu vực còn lại' : z.name,
        order: z.order ?? 0,
        locations: locations.data.map((l: any) => ({ code: l.code, type: l.type })),
        methods: methods.data.map(mapMethod),
      };
    }),
  );
}

export async function updateShippingMethod(shop: ShopRow, zoneId: number, instanceId: number, body: { enabled?: boolean; settings?: Record<string, unknown> }) {
  const payload: Record<string, unknown> = {};
  if (body.enabled !== undefined) payload.enabled = body.enabled;
  if (body.settings) payload.settings = body.settings;
  return mapMethod((await wrap(() => clientFor(shop).put<any>(`/wc/v3/shipping/zones/${zoneId}/methods/${instanceId}`, payload))).data);
}

// ---------- Mã giảm giá ----------

export interface CouponInput {
  code?: string;
  discountType?: 'percent' | 'fixed_cart' | 'fixed_product';
  amount?: string;
  description?: string;
  dateExpires?: string | null; // YYYY-MM-DD theo giờ website
  minimumAmount?: string;
  usageLimit?: number | null;
  usageLimitPerUser?: number | null;
  individualUse?: boolean;
  freeShipping?: boolean;
  status?: 'publish' | 'draft';
}

const mapCoupon = (c: any) => ({
  id: c.id,
  code: c.code,
  status: c.status,
  discountType: c.discount_type,
  amount: c.amount,
  description: c.description ?? '',
  dateExpires: c.date_expires ? String(c.date_expires).slice(0, 10) : null,
  usageCount: c.usage_count ?? 0,
  usageLimit: c.usage_limit ?? null,
  usageLimitPerUser: c.usage_limit_per_user ?? null,
  minimumAmount: c.minimum_amount ?? '',
  individualUse: !!c.individual_use,
  freeShipping: !!c.free_shipping,
  dateModified: c.date_modified_gmt,
});

function couponPayload(i: CouponInput) {
  const p: Record<string, unknown> = {};
  if (i.code !== undefined) p.code = i.code.trim();
  if (i.discountType !== undefined) p.discount_type = i.discountType;
  if (i.amount !== undefined) {
    if (!/^\d+(\.\d{1,4})?$/.test(i.amount)) throw new AppError(400, 'invalid_amount', 'Giá trị giảm không hợp lệ');
    p.amount = i.amount;
  }
  if (i.description !== undefined) p.description = i.description;
  if (i.dateExpires !== undefined) p.date_expires = i.dateExpires ? `${i.dateExpires}T23:59:59` : null;
  if (i.minimumAmount !== undefined) p.minimum_amount = i.minimumAmount;
  if (i.usageLimit !== undefined) p.usage_limit = i.usageLimit;
  if (i.usageLimitPerUser !== undefined) p.usage_limit_per_user = i.usageLimitPerUser;
  if (i.individualUse !== undefined) p.individual_use = i.individualUse;
  if (i.freeShipping !== undefined) p.free_shipping = i.freeShipping;
  if (i.status !== undefined) p.status = i.status;
  return p;
}

export async function listCoupons(shop: ShopRow, search?: string, page = 1) {
  const r = await clientFor(shop).get<any[]>('/wc/v3/coupons', { per_page: 30, page, search, status: 'any', orderby: 'date', order: 'desc' });
  return { items: r.data.map(mapCoupon), page, hasMore: page < (r.totalPages ?? 1) };
}

export async function getCoupon(shop: ShopRow, id: number) {
  return mapCoupon((await clientFor(shop).get<any>(`/wc/v3/coupons/${id}`)).data);
}

export async function saveCoupon(shop: ShopRow, id: number | null, input: CouponInput) {
  const c = clientFor(shop);
  if (!id && !input.code?.trim()) throw new AppError(400, 'bad_request', 'Nhập mã giảm giá');
  const body = couponPayload(input);
  try {
    const r = id ? await c.put<any>(`/wc/v3/coupons/${id}`, body) : await c.post<any>('/wc/v3/coupons', { status: 'publish', ...body });
    return mapCoupon(r.data);
  } catch (e) {
    if (e instanceof WooError && /already|exists|tồn tại/i.test(e.message)) throw new AppError(409, 'duplicate_code', 'Mã giảm giá đã tồn tại.');
    if (e instanceof WooError && e.kind === 'invalid') throw new AppError(422, 'woo_invalid', e.message);
    throw e;
  }
}

export async function deleteCoupon(shop: ShopRow, id: number) {
  await clientFor(shop).request('DELETE', `/wc/v3/coupons/${id}`, { query: { force: true } });
  return { ok: true };
}

// ---------- Khách hàng ----------

const mapCustomer = (c: any) => ({
  id: c.id,
  email: c.email,
  firstName: c.first_name,
  lastName: c.last_name,
  name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.username || c.email,
  dateCreated: gmt(c.date_created_gmt),
  isPayingCustomer: !!c.is_paying_customer,
  billing: c.billing ?? {},
  shipping: c.shipping ?? {},
  avatarUrl: c.avatar_url ?? null,
});

export async function listCustomers(shop: ShopRow, search?: string, page = 1) {
  const r = await clientFor(shop).get<any[]>('/wc/v3/customers', { per_page: 30, page, search, orderby: 'registered_date', order: 'desc', role: 'all' });
  const items = r.data.map(mapCustomer);
  const stats = await customerStats(shop.id, items.map((c) => c.email));
  return { items: items.map((c) => ({ ...c, ...(stats.get(c.email.toLowerCase()) ?? { ordersCount: 0, totalSpent: 0, currency: shop.currency, lastOrderAt: null }) })), page, hasMore: page < (r.totalPages ?? 1) };
}

/** Thống kê từ đơn đã đồng bộ (tính được cả khách vãng lai theo email) */
async function customerStats(shopId: number, emails: string[]) {
  const rows = await q<any>(
    `SELECT lower(billing_email) e, count(*)::int n, sum(total) s, max(currency) cur, max(date_created_gmt) last
     FROM orders WHERE shop_id=$1 AND lower(billing_email) = ANY($2) AND status NOT IN ('checkout-draft','trash','cancelled','failed')
     GROUP BY 1`,
    [shopId, emails.map((e) => e.toLowerCase())],
  );
  return new Map(rows.map((r) => [r.e, { ordersCount: r.n, totalSpent: toNum(r.s), currency: r.cur, lastOrderAt: r.last }]));
}

export async function getCustomer(shop: ShopRow, id: number) {
  const c = mapCustomer((await clientFor(shop).get<any>(`/wc/v3/customers/${id}`)).data);
  const stats = (await customerStats(shop.id, [c.email])).get(c.email.toLowerCase());
  const orders = await q<any>(
    `SELECT id, number, status, currency, total, date_created_gmt FROM orders WHERE shop_id=$1 AND lower(billing_email)=lower($2)
     AND status NOT IN ('checkout-draft','trash') ORDER BY date_created_gmt DESC LIMIT 20`,
    [shop.id, c.email],
  );
  return { ...c, ordersCount: stats?.ordersCount ?? 0, totalSpent: stats?.totalSpent ?? 0, currency: stats?.currency ?? shop.currency, orders: orders.map((o) => ({ ...o, total: toNum(o.total) })) };
}

export async function updateCustomer(shop: ShopRow, id: number, body: { firstName?: string; lastName?: string; email?: string; billing?: Record<string, string>; shipping?: Record<string, string> }) {
  const payload: Record<string, unknown> = {};
  if (body.firstName !== undefined) payload.first_name = body.firstName;
  if (body.lastName !== undefined) payload.last_name = body.lastName;
  if (body.email !== undefined) payload.email = body.email;
  if (body.billing) payload.billing = body.billing;
  if (body.shipping) payload.shipping = body.shipping;
  await wrap(() => clientFor(shop).put<any>(`/wc/v3/customers/${id}`, payload));
  return getCustomer(shop, id);
}
