/**
 * Báo cáo chi tiết + Live.
 * - Phần dựa trên đơn hàng (sản phẩm, danh mục, quốc gia, thanh toán, khách mới/quay lại, mã giảm giá, nguồn đơn)
 *   tính từ đơn đã đồng bộ, cùng định nghĩa “đơn được tính” với dashboard.
 * - Lượt truy cập, khách đang xem, tỉ lệ chuyển đổi: WooCommerce không ghi nhận → cần plugin Woo Admin Tracker
 *   (wordpress-plugin/). Không có dữ liệu thì trả `tracking.enabled = false` để app hướng dẫn cài.
 */
import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { q, q1 } from '../lib/db.js';
import { toNum } from '../lib/format.js';
import { computeRange, EXCLUDED_STATUSES, type RangeKey } from './analytics.js';
import { clientFor, webhookSecret, type ShopRow } from './shop.js';

const excluded = [...EXCLUDED_STATUSES];

export function trackerToken(shop: ShopRow): string {
  return crypto.createHmac('sha256', webhookSecret(shop)).update('woo-admin-tracker').digest('base64url').slice(0, 24);
}

const COUNTRY: Record<string, string> = { US: 'Hoa Kỳ', CA: 'Canada', GB: 'Anh', AU: 'Úc', VN: 'Việt Nam', DE: 'Đức', FR: 'Pháp', JP: 'Nhật Bản', MX: 'Mexico' };

function attributionOf(raw: any): string {
  const meta: any[] = raw?.meta_data ?? [];
  const get = (k: string) => meta.find((m) => m.key === k)?.value;
  const type = get('_wc_order_attribution_source_type');
  const src = get('_wc_order_attribution_utm_source');
  if (!type && !src) return '';
  if (type === 'typein') return 'Truy cập trực tiếp';
  if (type === 'admin') return 'Tạo trong trang quản trị';
  if (src) return String(src);
  return String(type);
}

export async function salesReport(shop: ShopRow, key: RangeKey, from?: string, to?: string, currency?: string) {
  const r = computeRange(key, shop.timezone, new Date(), from, to);
  const cur = currency || shop.currency;
  const s = r.start.toJSDate();
  const e = r.end.toJSDate();
  const base = `FROM orders o WHERE o.shop_id=$1 AND o.currency=$2 AND o.date_created_gmt >= $3 AND o.date_created_gmt < $4`;
  const params = [shop.id, cur, s, e];

  const counted = `${base} AND o.status <> ALL($5)`;
  const p5 = [...params, excluded];

  const [byProduct, byVariation, byCategory, byCountry, byState, byPayment, byStatus, coupons, orders] = await Promise.all([
    q<any>(
      `SELECT li.product_id AS id, COALESCE(p.name, max(li.name)) AS name, max(p.image_url) AS image_url, sum(li.quantity)::int qty, sum(li.total) revenue
       FROM order_line_items li JOIN orders o ON o.shop_id=li.shop_id AND o.id=li.order_id
       LEFT JOIN products p ON p.shop_id=li.shop_id AND p.id=li.product_id
       WHERE o.shop_id=$1 AND o.currency=$2 AND o.date_created_gmt >= $3 AND o.date_created_gmt < $4 AND o.status <> ALL($5)
       GROUP BY li.product_id, p.name ORDER BY revenue DESC LIMIT 20`,
      p5,
    ),
    q<any>(
      `SELECT li.variation_id AS id, li.product_id, max(li.sku) sku, max(li.name) AS name, max(v.attributes_label) label, sum(li.quantity)::int qty, sum(li.total) revenue
       FROM order_line_items li JOIN orders o ON o.shop_id=li.shop_id AND o.id=li.order_id
       LEFT JOIN products v ON v.shop_id=li.shop_id AND v.id=li.variation_id
       WHERE o.shop_id=$1 AND o.currency=$2 AND o.date_created_gmt >= $3 AND o.date_created_gmt < $4 AND o.status <> ALL($5) AND li.variation_id > 0
       GROUP BY li.variation_id, li.product_id ORDER BY qty DESC LIMIT 20`,
      p5,
    ),
    q<any>(
      `SELECT c.id, c.name, sum(li.quantity)::int qty, sum(li.total) revenue
       FROM order_line_items li JOIN orders o ON o.shop_id=li.shop_id AND o.id=li.order_id
       JOIN products p ON p.shop_id=li.shop_id AND p.id=li.product_id
       JOIN product_categories c ON c.shop_id=li.shop_id AND c.id = ANY(p.category_ids)
       WHERE o.shop_id=$1 AND o.currency=$2 AND o.date_created_gmt >= $3 AND o.date_created_gmt < $4 AND o.status <> ALL($5)
       GROUP BY c.id, c.name ORDER BY revenue DESC LIMIT 20`,
      p5,
    ),
    q<any>(
      `SELECT COALESCE(NULLIF(o.raw->'shipping'->>'country',''), NULLIF(o.raw->'billing'->>'country',''), '—') AS code, count(*)::int orders, sum(o.total) revenue
       ${counted} GROUP BY 1 ORDER BY revenue DESC LIMIT 15`,
      p5,
    ),
    q<any>(
      `SELECT COALESCE(NULLIF(o.raw->'shipping'->>'state',''), NULLIF(o.raw->'billing'->>'state',''), '—') AS code,
         COALESCE(NULLIF(o.raw->'shipping'->>'country',''), NULLIF(o.raw->'billing'->>'country','')) AS country, count(*)::int orders, sum(o.total) revenue
       ${counted} GROUP BY 1, 2 ORDER BY revenue DESC LIMIT 15`,
      p5,
    ),
    q<any>(`SELECT COALESCE(NULLIF(o.payment_method_title,''),'Khác') AS name, count(*)::int orders, sum(o.total) revenue ${counted} GROUP BY 1 ORDER BY revenue DESC`, p5),
    q<any>(`SELECT o.status, count(*)::int orders, sum(o.total) revenue ${base} AND o.status NOT IN ('checkout-draft','trash') GROUP BY 1 ORDER BY orders DESC`, params),
    q<any>(
      `SELECT lower(c->>'code') code, count(*)::int orders, sum((c->>'discount')::numeric) discount
       ${counted.replace('FROM orders o', 'FROM orders o, jsonb_array_elements(COALESCE(o.raw->\'coupon_lines\', \'[]\'::jsonb)) c')} GROUP BY 1 ORDER BY orders DESC LIMIT 15`,
      p5,
    ),
    q<any>(`SELECT o.id, o.billing_email, o.total, o.raw, o.date_created_gmt ${counted}`, p5),
  ]);

  // Khách mới / quay lại: dựa trên đơn đầu tiên của email trong toàn bộ lịch sử đã đồng bộ
  const emails = [...new Set(orders.map((o) => String(o.billing_email || '').toLowerCase()).filter(Boolean))];
  const firsts = emails.length
    ? await q<any>(
        `SELECT lower(billing_email) e, min(date_created_gmt) first FROM orders WHERE shop_id=$1 AND lower(billing_email) = ANY($2)
         AND status <> ALL($3) GROUP BY 1`,
        [shop.id, emails, excluded],
      )
    : [];
  const firstOf = new Map(firsts.map((f) => [f.e, f.first as Date]));
  let newC = 0;
  let retC = 0;
  let newRev = 0;
  let retRev = 0;
  const seen = new Set<string>();
  for (const o of orders) {
    const em = String(o.billing_email || '').toLowerCase();
    if (!em) continue;
    const isNew = (firstOf.get(em)?.getTime() ?? 0) >= s.getTime();
    if (isNew) newRev += toNum(o.total);
    else retRev += toNum(o.total);
    if (seen.has(em)) continue;
    seen.add(em);
    if (isNew) newC++;
    else retC++;
  }

  const attribution = new Map<string, { orders: number; revenue: number }>();
  let attributed = 0;
  for (const o of orders) {
    const a = attributionOf(o.raw);
    if (!a) continue;
    attributed++;
    const v = attribution.get(a) ?? { orders: 0, revenue: 0 };
    v.orders++;
    v.revenue += toNum(o.total);
    attribution.set(a, v);
  }

  const tracking = await trafficStats(shop, s, e, orders.map((o) => o.date_created_gmt as Date));

  const num = (rows: any[]) => rows.map((x) => ({ ...x, revenue: toNum(x.revenue) }));
  return {
    range: { key: r.key, start: r.start.toISO(), end: r.end.toISO(), label: `${r.start.toFormat('dd/MM')}${r.end.minus({ days: 1 }).hasSame(r.start, 'day') ? '' : ` – ${r.end.minus({ days: 1 }).toFormat('dd/MM')}`}` },
    currency: cur,
    timezone: shop.timezone,
    byProduct: num(byProduct),
    byVariation: num(byVariation),
    byCategory: num(byCategory),
    byCountry: num(byCountry).map((x) => ({ ...x, name: COUNTRY[x.code] ?? x.code })),
    byState: num(byState).map((x) => ({ ...x, name: x.country === 'US' || !x.country ? x.code : `${x.code} (${x.country})` })),
    byPayment: num(byPayment),
    byStatus: num(byStatus),
    coupons: coupons.map((c) => ({ ...c, discount: toNum(c.discount) })),
    customers: { new: newC, returning: retC, newRevenue: Math.round(newRev * 100) / 100, returningRevenue: Math.round(retRev * 100) / 100 },
    attribution: {
      available: attributed > 0,
      rows: [...attribution.entries()].map(([name, v]) => ({ name, ...v, revenue: Math.round(v.revenue * 100) / 100 })).sort((a, b) => b.revenue - a.revenue),
    },
    tracking,
  };
}

async function trafficStats(shop: ShopRow, s: Date, e: Date, orderDates: Date[]) {
  const any = await q1<{ n: number; first: Date }>('SELECT count(*)::int n, min(first_seen) first FROM visits WHERE shop_id=$1', [shop.id]);
  if (!any?.n) return { enabled: false as const };
  // chỉ so đơn với phiên trong cùng khoảng thời gian tracker đã chạy
  const ordersCount = orderDates.filter((d) => d.getTime() >= any.first.getTime()).length;
  const f = await q1<any>(
    `SELECT count(*)::int sessions, count(*) FILTER (WHERE viewed_product)::int product, count(*) FILTER (WHERE added_to_cart)::int cart,
       count(*) FILTER (WHERE reached_checkout)::int checkout, count(*) FILTER (WHERE purchased)::int purchased,
       count(*) FILTER (WHERE device='mobile')::int mobile, sum(pageviews)::int pageviews
     FROM visits WHERE shop_id=$1 AND first_seen >= $2 AND first_seen < $3`,
    [shop.id, s, e],
  );
  const sources = await q<any>(
    `SELECT COALESCE(NULLIF(utm_source,''), NULLIF(referrer_host,''), 'Trực tiếp') name, count(*)::int sessions, count(*) FILTER (WHERE purchased)::int purchased
     FROM visits WHERE shop_id=$1 AND first_seen >= $2 AND first_seen < $3 GROUP BY 1 ORDER BY sessions DESC LIMIT 10`,
    [shop.id, s, e],
  );
  const landing = await q<any>(
    `SELECT landing_path name, count(*)::int sessions FROM visits WHERE shop_id=$1 AND first_seen >= $2 AND first_seen < $3 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    [shop.id, s, e],
  );
  const sessions = f?.sessions ?? 0;
  const rate = (n: number) => (sessions ? Math.round((n / sessions) * 10000) / 100 : 0);
  return {
    enabled: true as const,
    sessions,
    pageviews: f?.pageviews ?? 0,
    mobileShare: rate(f?.mobile ?? 0),
    // Tỉ lệ chuyển đổi = phiên có mua hàng ÷ tổng phiên (cùng cách Shopify)
    conversionRate: rate(f?.purchased ?? 0),
    ordersPerSession: sessions ? Math.round((ordersCount / sessions) * 10000) / 100 : 0,
    trackingSince: any.first,
    funnel: [
      { key: 'sessions', label: 'Phiên truy cập', count: sessions, rate: 100 },
      { key: 'product', label: 'Xem sản phẩm', count: f?.product ?? 0, rate: rate(f?.product ?? 0) },
      { key: 'cart', label: 'Thêm vào giỏ', count: f?.cart ?? 0, rate: rate(f?.cart ?? 0) },
      { key: 'checkout', label: 'Tới trang thanh toán', count: f?.checkout ?? 0, rate: rate(f?.checkout ?? 0) },
      { key: 'purchased', label: 'Đặt hàng', count: f?.purchased ?? 0, rate: rate(f?.purchased ?? 0) },
    ],
    sources,
    landing,
  };
}

/** Live: hoạt động hiện tại, cập nhật vài giây một lần trong app */
export async function liveReport(shop: ShopRow, now = new Date()) {
  const n = DateTime.fromJSDate(now, { zone: shop.timezone });
  const todayStart = n.startOf('day');
  const ydStart = todayStart.minus({ days: 1 });
  const ydSameTime = n.minus({ days: 1 });
  const salesBetween = async (a: Date, b: Date) =>
    q1<any>(
      `SELECT count(*)::int orders, COALESCE(sum(items_subtotal - discount_total + shipping_total + total_tax),0) sales
       FROM orders WHERE shop_id=$1 AND currency=$2 AND date_created_gmt >= $3 AND date_created_gmt < $4 AND status <> ALL($5)`,
      [shop.id, shop.currency, a, b, excluded],
    );
  const [today, yesterday, last30, recent, hourly] = await Promise.all([
    salesBetween(todayStart.toJSDate(), now),
    salesBetween(ydStart.toJSDate(), ydSameTime.toJSDate()),
    q1<any>(`SELECT count(*)::int n FROM orders WHERE shop_id=$1 AND date_created_gmt >= $2 AND status NOT IN ('checkout-draft','trash')`, [
      shop.id,
      new Date(now.getTime() - 30 * 60_000),
    ]),
    q<any>(
      `SELECT id, number, status, currency, total, customer_name, item_count, date_created_gmt,
         COALESCE(NULLIF(raw->'shipping'->>'state',''), raw->'billing'->>'state') state,
         COALESCE(NULLIF(raw->'shipping'->>'country',''), raw->'billing'->>'country') country
       FROM orders WHERE shop_id=$1 AND date_created_gmt >= $2 AND status NOT IN ('checkout-draft','trash') ORDER BY date_created_gmt DESC LIMIT 10`,
      [shop.id, todayStart.toJSDate()],
    ),
    q<any>(
      `SELECT date_created_gmt, items_subtotal - discount_total + shipping_total + total_tax v FROM orders
       WHERE shop_id=$1 AND currency=$2 AND date_created_gmt >= $3 AND status <> ALL($4)`,
      [shop.id, shop.currency, ydStart.toJSDate(), excluded],
    ),
  ]);
  // Doanh thu cộng dồn theo giờ: hôm nay vs hôm qua
  const cumulative = (start: DateTime, until: DateTime | null) => {
    const out: number[] = [];
    let acc = 0;
    for (let h = 0; h < 24; h++) {
      const a = start.plus({ hours: h }).toMillis();
      const b = start.plus({ hours: h + 1 }).toMillis();
      if (until && a > until.toMillis()) break;
      for (const r of hourly) {
        const t = new Date(r.date_created_gmt).getTime();
        if (t >= a && t < b) acc += toNum(r.v);
      }
      out.push(Math.round(acc * 100) / 100);
    }
    return out;
  };

  // Giỏ hàng đang ở bước thanh toán (Checkout Blocks tạo bản nháp) — truy vấn trực tiếp WooCommerce
  let checkoutsActive: number | null;
  try {
    const r = await clientFor(shop).get<any[]>('/wc/v3/orders', {
      status: 'checkout-draft',
      modified_after: new Date(now.getTime() - 30 * 60_000).toISOString().replace(/\.\d+Z$/, ''),
      dates_are_gmt: true,
      per_page: 1,
      _fields: 'id',
    });
    checkoutsActive = r.total ?? r.data.length;
  } catch {
    checkoutsActive = null;
  }

  const anyVisits = await q1<{ n: number }>('SELECT count(*)::int n FROM visits WHERE shop_id=$1', [shop.id]);
  let visitors: any = { enabled: false };
  if (anyVisits?.n) {
    const v = await q1<any>(
      `SELECT count(*) FILTER (WHERE last_seen >= $2)::int active, count(*) FILTER (WHERE last_seen >= $2 AND reached_checkout AND NOT purchased)::int in_checkout,
         count(*) FILTER (WHERE last_seen >= $2 AND added_to_cart AND NOT purchased)::int with_cart,
         count(*) FILTER (WHERE first_seen >= $3)::int sessions_today, count(*) FILTER (WHERE first_seen >= $3 AND purchased)::int purchased_today
       FROM visits WHERE shop_id=$1`,
      [shop.id, new Date(now.getTime() - 5 * 60_000), todayStart.toJSDate()],
    );
    const pages = await q<any>(
      `SELECT last_path name, count(*)::int n FROM visits WHERE shop_id=$1 AND last_seen >= $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      [shop.id, new Date(now.getTime() - 5 * 60_000)],
    );
    visitors = {
      enabled: true,
      activeNow: v.active,
      withCart: v.with_cart,
      inCheckout: v.in_checkout,
      sessionsToday: v.sessions_today,
      conversionToday: v.sessions_today ? Math.round((v.purchased_today / v.sessions_today) * 10000) / 100 : 0,
      topPages: pages,
    };
  }

  return {
    now: n.toISO(),
    timezone: shop.timezone,
    currency: shop.currency,
    today: { orders: today.orders, sales: toNum(today.sales) },
    yesterdaySameTime: { orders: yesterday.orders, sales: toNum(yesterday.sales) },
    ordersLast30Min: last30?.n ?? 0,
    checkoutsActive,
    cumulativeToday: cumulative(todayStart, n),
    cumulativeYesterday: cumulative(ydStart, null),
    recentOrders: recent.map((o) => ({ ...o, total: toNum(o.total) })),
    visitors,
  };
}

// ---------- Thu thập lượt truy cập từ plugin ----------

export interface CollectEvent {
  sid: string;
  t: 'page' | 'product' | 'cart' | 'checkout' | 'purchase';
  p?: string; // đường dẫn (không gồm query)
  r?: string; // referrer
  u?: string; // utm_source
  m?: boolean; // thiết bị di động
  o?: number; // mã đơn khi mua
  c?: boolean; // giỏ hàng có sản phẩm
}

export async function collect(shop: ShopRow, ev: CollectEvent) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(ev.sid)) return;
  const path = String(ev.p ?? '').split('?')[0].slice(0, 200);
  let refHost: string;
  try {
    refHost = ev.r ? new URL(ev.r).hostname.replace(/^www\./, '') : '';
  } catch {
    refHost = '';
  }
  if (refHost && new URL(shop.url).hostname.replace(/^www\./, '') === refHost) refHost = '';
  await q(
    `INSERT INTO visits (shop_id, session_id, landing_path, last_path, referrer_host, utm_source, device, pageviews,
        viewed_product, added_to_cart, reached_checkout, purchased, order_id)
     VALUES ($1,$2,$3,$3,$4,$5,$6,1,$7,$8,$9,$10,$11)
     ON CONFLICT (shop_id, session_id) DO UPDATE SET last_seen=now(), last_path=EXCLUDED.last_path, pageviews=visits.pageviews+1,
       viewed_product = visits.viewed_product OR EXCLUDED.viewed_product,
       added_to_cart = visits.added_to_cart OR EXCLUDED.added_to_cart,
       reached_checkout = visits.reached_checkout OR EXCLUDED.reached_checkout,
       purchased = visits.purchased OR EXCLUDED.purchased,
       order_id = COALESCE(EXCLUDED.order_id, visits.order_id)`,
    [
      shop.id,
      ev.sid,
      path,
      refHost.slice(0, 120),
      String(ev.u ?? '').slice(0, 60),
      ev.m ? 'mobile' : 'desktop',
      ev.t === 'product',
      ev.t === 'cart' || !!ev.c || ev.t === 'checkout',
      ev.t === 'checkout' || ev.t === 'purchase',
      ev.t === 'purchase',
      ev.t === 'purchase' && Number.isInteger(ev.o) ? ev.o : null,
    ],
  );
}

export async function trackerStatus(shop: ShopRow) {
  const last = await q1<any>('SELECT max(last_seen) last, count(*)::int n FROM visits WHERE shop_id=$1', [shop.id]);
  return { lastEventAt: last?.last ?? null, sessions: last?.n ?? 0 };
}
