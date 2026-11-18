import { DateTime } from 'luxon';
import { q } from '../lib/db.js';
import { toNum } from '../lib/format.js';
import { DRAFT_STATUSES } from './orderStore.js';
import type { ShopRow } from './shop.js';
import { syncStatus } from './sync.js';

/** Trạng thái bị loại khỏi doanh thu — giống mặc định “Excluded statuses” của WooCommerce Analytics */
export const EXCLUDED_STATUSES = new Set(['pending', 'failed', 'cancelled', 'trash', ...DRAFT_STATUSES]);

export type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'custom';

export interface Range {
  key: RangeKey;
  start: DateTime; // bao gồm
  end: DateTime; // không bao gồm
  prevStart: DateTime;
  prevEnd: DateTime;
  granularity: 'hour' | 'day';
  timezone: string;
}

export function computeRange(key: RangeKey, tz: string, now: Date = new Date(), from?: string, to?: string): Range {
  const n = DateTime.fromJSDate(now, { zone: tz });
  if (!n.isValid) throw new Error(`Múi giờ không hợp lệ: ${tz}`);
  const today = n.startOf('day');
  let start: DateTime;
  let end: DateTime;
  switch (key) {
    case 'today':
      start = today;
      end = today.plus({ days: 1 });
      break;
    case 'yesterday':
      start = today.minus({ days: 1 });
      end = today;
      break;
    case '7d':
      start = today.minus({ days: 6 });
      end = today.plus({ days: 1 });
      break;
    case '30d':
      start = today.minus({ days: 29 });
      end = today.plus({ days: 1 });
      break;
    case 'custom': {
      const f = DateTime.fromISO(from ?? '', { zone: tz });
      const t = DateTime.fromISO(to ?? from ?? '', { zone: tz });
      if (!f.isValid || !t.isValid) throw new Error('Khoảng ngày không hợp lệ (YYYY-MM-DD)');
      start = f.startOf('day');
      end = t.startOf('day').plus({ days: 1 });
      if (end <= start) throw new Error('Ngày kết thúc phải sau ngày bắt đầu');
      if (end.diff(start, 'days').days > 366) throw new Error('Tối đa 366 ngày');
      break;
    }
  }
  const days = Math.round(end.diff(start, 'days').days);
  return {
    key,
    start,
    end,
    prevStart: start.minus({ days }),
    prevEnd: start,
    granularity: days <= 1 ? 'hour' : 'day',
    timezone: tz,
  };
}

export interface AggOrder {
  id: number;
  status: string;
  currency: string;
  total: number;
  items_subtotal: number;
  discount_total: number;
  shipping_total: number;
  total_tax: number;
  date_created_gmt: Date;
  date_paid_gmt: Date | null;
}
export interface AggRefund {
  order_id: number;
  currency: string;
  order_status: string;
  amount: number;
  date_created_gmt: Date;
}
export interface AggLine {
  order_id: number;
  product_id: number;
  name: string;
  quantity: number;
  total: number;
  image_url: string | null;
}

export interface CurrencyMetrics {
  currency: string;
  ordersCount: number; // đơn được tính doanh thu, tạo trong kỳ
  newOrders: number; // mọi đơn đã đặt (gồm chờ thanh toán) tạo trong kỳ
  paidOrders: number; // đơn có ngày thanh toán trong kỳ
  grossSales: number;
  coupons: number;
  refunds: number;
  netSales: number;
  shipping: number;
  taxes: number;
  totalSales: number;
  avgOrderValue: number;
  buckets: { start: string; label: string; totalSales: number; orders: number }[];
  topProducts: { productId: number; name: string; quantity: number; netRevenue: number; imageUrl: string | null }[];
}

const inRange = (d: Date | null, s: DateTime, e: DateTime) => !!d && d.getTime() >= s.toMillis() && d.getTime() < e.toMillis();

function bucketKeys(r: Range): DateTime[] {
  const out: DateTime[] = [];
  let c = r.start;
  const step = r.granularity === 'hour' ? { hours: 1 } : { days: 1 };
  while (c < r.end) {
    out.push(c);
    c = c.plus(step);
  }
  return out;
}

export function aggregate(orders: AggOrder[], refunds: AggRefund[], lines: AggLine[], r: Range): CurrencyMetrics[] {
  const currencies = new Set<string>([...orders.map((o) => o.currency), ...refunds.map((x) => x.currency)]);
  const keys = bucketKeys(r);
  const bucketIndex = (d: Date) => {
    const dt = DateTime.fromJSDate(d, { zone: r.timezone }).startOf(r.granularity);
    return keys.findIndex((k) => k.toMillis() === dt.toMillis());
  };
  const counted = new Set(
    orders.filter((o) => !EXCLUDED_STATUSES.has(o.status) && inRange(o.date_created_gmt, r.start, r.end)).map((o) => o.id),
  );
  const out: CurrencyMetrics[] = [];
  for (const cur of currencies) {
    const os = orders.filter((o) => o.currency === cur);
    const co = os.filter((o) => counted.has(o.id));
    const rf = refunds.filter(
      (x) => x.currency === cur && !EXCLUDED_STATUSES.has(x.order_status) && inRange(x.date_created_gmt, r.start, r.end),
    );
    const sum = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) * 10000) / 10000;
    const grossSales = sum(co.map((o) => o.items_subtotal));
    const coupons = sum(co.map((o) => o.discount_total));
    const refundsTotal = sum(rf.map((x) => x.amount));
    const shipping = sum(co.map((o) => o.shipping_total));
    const taxes = sum(co.map((o) => o.total_tax));
    const netSales = sum([grossSales, -coupons, -refundsTotal]);
    const buckets = keys.map((k) => ({
      start: k.toISO()!,
      label: r.granularity === 'hour' ? k.toFormat('HH:mm') : k.toFormat('dd/MM'),
      totalSales: 0,
      orders: 0,
    }));
    for (const o of co) {
      const i = bucketIndex(o.date_created_gmt);
      if (i >= 0) {
        buckets[i].totalSales += o.items_subtotal - o.discount_total + o.shipping_total + o.total_tax;
        buckets[i].orders += 1;
      }
    }
    for (const x of rf) {
      const i = bucketIndex(x.date_created_gmt);
      if (i >= 0) buckets[i].totalSales -= x.amount;
    }
    buckets.forEach((b) => (b.totalSales = Math.round(b.totalSales * 100) / 100));

    const coIds = new Set(co.map((o) => o.id));
    const prod = new Map<number, CurrencyMetrics['topProducts'][number]>();
    for (const li of lines.filter((l) => coIds.has(l.order_id))) {
      const p = prod.get(li.product_id) ?? { productId: li.product_id, name: li.name, quantity: 0, netRevenue: 0, imageUrl: li.image_url };
      p.quantity += li.quantity;
      p.netRevenue = Math.round((p.netRevenue + li.total) * 100) / 100;
      prod.set(li.product_id, p);
    }
    out.push({
      currency: cur,
      ordersCount: co.length,
      newOrders: os.filter((o) => !DRAFT_STATUSES.has(o.status) && o.status !== 'trash' && inRange(o.date_created_gmt, r.start, r.end)).length,
      paidOrders: os.filter((o) => !DRAFT_STATUSES.has(o.status) && inRange(o.date_paid_gmt, r.start, r.end)).length,
      grossSales,
      coupons,
      refunds: refundsTotal,
      netSales,
      shipping,
      taxes,
      totalSales: sum([netSales, shipping, taxes]),
      avgOrderValue: co.length ? Math.round((netSales / co.length) * 100) / 100 : 0,
      buckets,
      topProducts: [...prod.values()].sort((a, b) => b.netRevenue - a.netRevenue || b.quantity - a.quantity).slice(0, 5),
    });
  }
  return out;
}

export const DEFINITIONS = [
  { term: 'Doanh thu (Tổng doanh thu)', text: 'Doanh thu thuần + phí vận chuyển + thuế. Tương ứng “Total sales” của WooCommerce Analytics.' },
  { term: 'Doanh thu thuần', text: 'Tổng tiền hàng trước giảm giá − mã giảm giá − hoàn tiền. Tương ứng “Net sales”.' },
  {
    term: 'Hoàn tiền',
    text: 'Ghi nhận vào ngày hoàn tiền (không phải ngày đặt đơn), kể cả hoàn một phần. Số tiền hoàn được trừ toàn bộ khỏi doanh thu thuần, nên có thể làm doanh thu một ngày âm.',
  },
  { term: 'Phí vận chuyển & thuế', text: 'Cộng vào Tổng doanh thu, không tính vào doanh thu thuần. Phí (fee) phụ thu không được cộng — giống Analytics.' },
  {
    term: 'Đơn được tính',
    text: 'Đơn tạo trong kỳ (theo ngày tạo, múi giờ website), trừ trạng thái Chờ thanh toán, Thất bại, Đã hủy và bản nháp — giống “Excluded statuses” mặc định.',
  },
  { term: 'Đơn mới', text: 'Mọi đơn khách đã gửi trong kỳ, kể cả đang chờ thanh toán. Không gồm bản nháp thanh toán (checkout-draft).' },
  { term: 'Đã thanh toán', text: 'Đơn có ngày thanh toán (date_paid) nằm trong kỳ.' },
  { term: 'Cần xử lý', text: 'Số đơn đang ở trạng thái “Đang xử lý” (đã thanh toán, chờ giao) tại thời điểm hiện tại, không phụ thuộc bộ lọc ngày.' },
  { term: 'Giá trị đơn trung bình', text: 'Doanh thu thuần ÷ số đơn được tính — giống “Average order value”.' },
  { term: 'Nhiều tiền tệ', text: 'Số liệu tách riêng theo từng loại tiền, không quy đổi.' },
];

export async function dashboard(shop: ShopRow, key: RangeKey, from?: string, to?: string, now = new Date()) {
  const r = computeRange(key, shop.timezone, now, from, to);
  const s = r.prevStart.toJSDate();
  const e = r.end.toJSDate();
  const orders = (
    await q<any>(
      `SELECT id, status, currency, total, items_subtotal, discount_total, shipping_total, total_tax, date_created_gmt, date_paid_gmt
       FROM orders WHERE shop_id=$1 AND ((date_created_gmt >= $2 AND date_created_gmt < $3) OR (date_paid_gmt >= $2 AND date_paid_gmt < $3))`,
      [shop.id, s, e],
    )
  ).map((o) => ({ ...o, total: toNum(o.total), items_subtotal: toNum(o.items_subtotal), discount_total: toNum(o.discount_total), shipping_total: toNum(o.shipping_total), total_tax: toNum(o.total_tax) }));
  const refunds = (
    await q<any>(
      `SELECT r.order_id, o.currency, o.status AS order_status, r.amount, r.date_created_gmt FROM refunds r
       JOIN orders o ON o.shop_id=r.shop_id AND o.id=r.order_id WHERE r.shop_id=$1 AND r.date_created_gmt >= $2 AND r.date_created_gmt < $3`,
      [shop.id, s, e],
    )
  ).map((x) => ({ ...x, amount: toNum(x.amount) }));
  const lines = (
    await q<any>(
      `SELECT li.order_id, li.product_id, COALESCE(p.name, li.name) AS name, li.quantity, li.total,
         COALESCE(p.image_url, li.image_url) AS image_url
       FROM order_line_items li JOIN orders o ON o.shop_id=li.shop_id AND o.id=li.order_id
       LEFT JOIN products p ON p.shop_id=li.shop_id AND p.id=li.product_id
       WHERE li.shop_id=$1 AND o.date_created_gmt >= $2 AND o.date_created_gmt < $3`,
      [shop.id, r.start.toJSDate(), e],
    )
  ).map((l) => ({ ...l, total: toNum(l.total) }));

  const current = aggregate(orders, refunds, lines, r);
  const prevRange: Range = { ...r, start: r.prevStart, end: r.prevEnd };
  const previous = aggregate(orders, refunds, [], prevRange);

  const needs = await q<{ status: string; n: number }>(
    `SELECT status, count(*)::int AS n FROM orders WHERE shop_id=$1 AND status IN ('processing','on-hold','pending') GROUP BY status`,
    [shop.id],
  );
  const recent = await q<any>(
    `SELECT id, number, status, currency, total, customer_name, item_count, date_created_gmt, date_paid_gmt FROM orders
     WHERE shop_id=$1 AND status NOT IN ('checkout-draft','draft','auto-draft','trash') ORDER BY date_created_gmt DESC LIMIT 5`,
    [shop.id],
  );
  const sync = await syncStatus(shop.id);
  const completeFrom: Date | null = sync.orders?.completeFrom ?? null;
  const ordered = [...current].sort((a, b) => (a.currency === shop.currency ? -1 : b.currency === shop.currency ? 1 : b.totalSales - a.totalSales));
  if (ordered.length === 0) ordered.push(aggregate([], [], [], r)[0] ?? emptyMetrics(shop.currency, r));

  return {
    range: {
      key: r.key,
      start: r.start.toISO(),
      end: r.end.toISO(),
      granularity: r.granularity,
      label: `${r.start.toFormat('dd/MM/yyyy')}${r.end.minus({ days: 1 }).hasSame(r.start, 'day') ? '' : ` – ${r.end.minus({ days: 1 }).toFormat('dd/MM/yyyy')}`}`,
    },
    timezone: shop.timezone,
    timezoneOffset: r.start.toFormat('ZZ'),
    primaryCurrency: shop.currency,
    currencies: ordered.map((m) => ({
      ...m,
      previous: previous.find((p) => p.currency === m.currency) ?? null,
    })),
    needsProcessing: needs.find((n) => n.status === 'processing')?.n ?? 0,
    onHold: needs.find((n) => n.status === 'on-hold')?.n ?? 0,
    pendingPayment: needs.find((n) => n.status === 'pending')?.n ?? 0,
    recentOrders: recent.map((o) => ({ ...o, total: toNum(o.total) })),
    coverage: {
      complete: !completeFrom || completeFrom.getTime() <= r.start.toMillis(),
      completeFrom,
      syncing: sync.orders?.status === 'running',
      synced: sync.orders?.synced ?? 0,
      total: sync.orders?.total ?? null,
    },
    lastSyncAt: sync.lastSyncAt,
    definitions: DEFINITIONS,
    source: 'local_aggregate',
  };
}

function emptyMetrics(currency: string, r: Range): CurrencyMetrics {
  return {
    currency,
    ordersCount: 0,
    newOrders: 0,
    paidOrders: 0,
    grossSales: 0,
    coupons: 0,
    refunds: 0,
    netSales: 0,
    shipping: 0,
    taxes: 0,
    totalSales: 0,
    avgOrderValue: 0,
    buckets: bucketKeys(r).map((k) => ({ start: k.toISO()!, label: r.granularity === 'hour' ? k.toFormat('HH:mm') : k.toFormat('dd/MM'), totalSales: 0, orders: 0 })),
    topProducts: [],
  };
}
