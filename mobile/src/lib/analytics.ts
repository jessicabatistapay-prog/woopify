import { DateTime } from 'luxon';
import type { Bucket, CurrencyMetrics, RangeKey } from '../api/types';

/**
 * Bản sao công thức của backend (backend/src/services/analytics.ts) — chỉ dùng cho chế độ demo.
 * Ranh giới ngày tính theo múi giờ website.
 */
export const EXCLUDED = new Set(['pending', 'failed', 'cancelled', 'trash', 'checkout-draft']);

export function computeRange(key: RangeKey, tz: string, now = new Date(), from?: string, to?: string) {
  const today = DateTime.fromJSDate(now, { zone: tz }).startOf('day');
  let start = today;
  let end = today.plus({ days: 1 });
  if (key === 'yesterday') [start, end] = [today.minus({ days: 1 }), today];
  if (key === '7d') start = today.minus({ days: 6 });
  if (key === '30d') start = today.minus({ days: 29 });
  if (key === 'custom') {
    start = DateTime.fromISO(from ?? '', { zone: tz }).startOf('day');
    end = DateTime.fromISO(to ?? from ?? '', { zone: tz }).startOf('day').plus({ days: 1 });
    if (!start.isValid || !end.isValid || end <= start) throw new Error('Khoảng ngày không hợp lệ');
  }
  const days = Math.round(end.diff(start, 'days').days);
  return { key, start, end, prevStart: start.minus({ days }), granularity: (days <= 1 ? 'hour' : 'day') as 'hour' | 'day', tz };
}

export interface DemoAggOrder {
  id: number;
  status: string;
  currency: string;
  itemsSubtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  created: Date;
  paid: Date | null;
  lines: { productId: number; name: string; quantity: number; total: number }[];
}
export interface DemoAggRefund {
  orderId: number;
  amount: number;
  date: Date;
}

export function aggregate(orders: DemoAggOrder[], refunds: DemoAggRefund[], start: DateTime, end: DateTime, gran: 'hour' | 'day', tz: string) {
  const inR = (d: Date | null) => !!d && d.getTime() >= start.toMillis() && d.getTime() < end.toMillis();
  const keys: DateTime[] = [];
  for (let c = start; c < end; c = c.plus(gran === 'hour' ? { hours: 1 } : { days: 1 })) keys.push(c);
  const idx = (d: Date) => keys.findIndex((k) => k.toMillis() === DateTime.fromJSDate(d, { zone: tz }).startOf(gran).toMillis());
  const byId = new Map(orders.map((o) => [o.id, o]));
  const currencies = [...new Set(orders.map((o) => o.currency))];
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return currencies.map((cur) => {
    const os = orders.filter((o) => o.currency === cur);
    const co = os.filter((o) => !EXCLUDED.has(o.status) && inR(o.created));
    const rf = refunds.filter((r) => byId.get(r.orderId)?.currency === cur && !EXCLUDED.has(byId.get(r.orderId)!.status) && inR(r.date));
    const sum = (a: number[]) => r2(a.reduce((x, y) => x + y, 0));
    const grossSales = sum(co.map((o) => o.itemsSubtotal));
    const coupons = sum(co.map((o) => o.discount));
    const refundsT = sum(rf.map((r) => r.amount));
    const shipping = sum(co.map((o) => o.shipping));
    const taxes = sum(co.map((o) => o.tax));
    const netSales = r2(grossSales - coupons - refundsT);
    const buckets: Bucket[] = keys.map((k) => ({ start: k.toISO()!, label: gran === 'hour' ? k.toFormat('HH:mm') : k.toFormat('dd/MM'), totalSales: 0, orders: 0 }));
    for (const o of co) {
      const i = idx(o.created);
      if (i >= 0) {
        buckets[i].totalSales = r2(buckets[i].totalSales + o.itemsSubtotal - o.discount + o.shipping + o.tax);
        buckets[i].orders++;
      }
    }
    for (const r of rf) {
      const i = idx(r.date);
      if (i >= 0) buckets[i].totalSales = r2(buckets[i].totalSales - r.amount);
    }
    const prod = new Map<number, CurrencyMetrics['topProducts'][number]>();
    for (const o of co)
      for (const l of o.lines) {
        const p = prod.get(l.productId) ?? { productId: l.productId, name: l.name, quantity: 0, netRevenue: 0, imageUrl: null };
        p.quantity += l.quantity;
        p.netRevenue = r2(p.netRevenue + l.total);
        prod.set(l.productId, p);
      }
    const m: Omit<CurrencyMetrics, 'previous'> = {
      currency: cur,
      ordersCount: co.length,
      newOrders: os.filter((o) => o.status !== 'checkout-draft' && inR(o.created)).length,
      paidOrders: os.filter((o) => inR(o.paid)).length,
      grossSales,
      coupons,
      refunds: refundsT,
      netSales,
      shipping,
      taxes,
      totalSales: r2(netSales + shipping + taxes),
      avgOrderValue: co.length ? r2(netSales / co.length) : 0,
      buckets,
      topProducts: [...prod.values()].sort((a, b) => b.netRevenue - a.netRevenue).slice(0, 5),
    };
    return m;
  });
}
