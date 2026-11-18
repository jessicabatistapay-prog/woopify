import { describe, expect, it } from 'vitest';
import { aggregate, computeRange, type AggOrder } from '../src/services/analytics.js';
import { resolveTimezone } from '../src/services/shop.js';
import { formatMoney } from '../src/lib/format.js';

const order = (id: number, createdIso: string, patch: Partial<AggOrder> = {}): AggOrder => ({
  id,
  status: 'processing',
  currency: 'USD',
  total: 110,
  items_subtotal: 100,
  discount_total: 0,
  shipping_total: 10,
  total_tax: 0,
  date_created_gmt: new Date(createdIso),
  date_paid_gmt: new Date(createdIso),
  ...patch,
});

describe('ranh giới ngày theo múi giờ shop', () => {
  // 18/11/2026 10:00 giờ Việt Nam = 17/11 22:00 New York
  const now = new Date('2026-11-18T03:00:00Z');

  it('"Hôm nay" tính theo múi giờ website, không theo giờ điện thoại', () => {
    const r = computeRange('today', 'America/New_York', now);
    expect(r.start.toISO()).toBe('2026-11-17T00:00:00.000-05:00');
    expect(r.end.toISO()).toBe('2026-11-18T00:00:00.000-05:00');
    expect(r.granularity).toBe('hour');
  });

  it('đơn 23:59:30 New York thuộc ngày hôm đó dù UTC đã sang ngày sau', () => {
    const r = computeRange('today', 'America/New_York', now);
    const nearMidnight = order(1, '2026-11-18T04:59:30Z'); // 23:59:30 -05:00 ngày 17
    const afterMidnight = order(2, '2026-11-18T05:00:10Z'); // 00:00:10 ngày 18
    const m = aggregate([nearMidnight, afterMidnight], [], [], r)[0];
    expect(m.ordersCount).toBe(1);
    expect(m.buckets[23].orders).toBe(1);
    const tomorrow = computeRange('custom', 'America/New_York', now, '2026-11-18', '2026-11-18');
    expect(aggregate([nearMidnight, afterMidnight], [], [], tomorrow)[0].ordersCount).toBe(1);
  });

  it('7 ngày gồm hôm nay và 6 ngày trước; có kỳ trước để so sánh', () => {
    const r = computeRange('7d', 'America/New_York', now);
    expect(r.start.toISODate()).toBe('2026-11-11');
    expect(r.prevStart.toISODate()).toBe('2026-11-04');
    expect(r.granularity).toBe('day');
  });

  it('xử lý ngày đổi giờ (DST) — ngày 01/11/2026 dài 25 giờ ở New York', () => {
    const r = computeRange('custom', 'America/New_York', now, '2026-11-01', '2026-11-01');
    expect(r.end.diff(r.start, 'hours').hours).toBe(25);
  });

  it('WordPress dùng độ lệch thủ công (UTC+7) thay vì tên múi giờ', () => {
    expect(resolveTimezone('', 7)).toBe('UTC+7');
    expect(resolveTimezone('', -5.5)).toBe('UTC-5:30');
    expect(resolveTimezone('Asia/Ho_Chi_Minh', 7)).toBe('Asia/Ho_Chi_Minh');
    const r = computeRange('today', 'UTC+7', now);
    expect(r.start.toISO()).toBe('2026-11-18T00:00:00.000+07:00');
  });
});

describe('công thức doanh thu (tương thích WooCommerce Analytics)', () => {
  const r = computeRange('custom', 'America/New_York', new Date('2026-11-18T03:00:00Z'), '2026-11-10', '2026-11-16');

  it('loại trạng thái chờ thanh toán / thất bại / hủy; đếm riêng đơn mới', () => {
    const os = [
      order(1, '2026-11-12T15:00:00Z'),
      order(2, '2026-11-12T16:00:00Z', { status: 'pending', date_paid_gmt: null }),
      order(3, '2026-11-12T17:00:00Z', { status: 'failed', date_paid_gmt: null }),
      order(4, '2026-11-12T18:00:00Z', { status: 'cancelled', date_paid_gmt: null }),
      order(5, '2026-11-12T19:00:00Z', { status: 'checkout-draft', date_paid_gmt: null }),
    ];
    const m = aggregate(os, [], [], r)[0];
    expect(m.ordersCount).toBe(1);
    expect(m.newOrders).toBe(4); // không tính checkout-draft
    expect(m.paidOrders).toBe(1);
    expect(m.totalSales).toBe(110);
  });

  it('hoàn tiền một phần trừ vào ngày hoàn tiền, không phải ngày đặt', () => {
    const os = [order(1, '2026-11-01T15:00:00Z', { items_subtotal: 149, total: 159 }), order(2, '2026-11-12T15:00:00Z')];
    const refunds = [{ order_id: 1, currency: 'USD', order_status: 'processing', amount: 30, date_created_gmt: new Date('2026-11-13T15:00:00Z') }];
    const m = aggregate(os, refunds, [], r)[0];
    expect(m.ordersCount).toBe(1); // đơn 1 đặt ngoài kỳ
    expect(m.grossSales).toBe(100);
    expect(m.refunds).toBe(30);
    expect(m.netSales).toBe(70);
    expect(m.shipping).toBe(10);
    expect(m.totalSales).toBe(80);
    const day13 = m.buckets.find((b) => b.label === '13/11')!;
    expect(day13.totalSales).toBe(-30);
  });

  it('mã giảm giá, phí ship, thuế và giá trị đơn trung bình', () => {
    const os = [
      order(1, '2026-11-12T15:00:00Z', { items_subtotal: 200, discount_total: 20, shipping_total: 15, total_tax: 12 }),
      order(2, '2026-11-12T16:00:00Z', { items_subtotal: 100, discount_total: 0, shipping_total: 5, total_tax: 8 }),
    ];
    const m = aggregate(os, [], [], r)[0];
    expect(m.grossSales).toBe(300);
    expect(m.coupons).toBe(20);
    expect(m.netSales).toBe(280);
    expect(m.totalSales).toBe(280 + 20 + 20);
    expect(m.avgOrderValue).toBe(140);
  });

  it('tách số liệu theo tiền tệ', () => {
    const os = [order(1, '2026-11-12T15:00:00Z'), order(2, '2026-11-12T16:00:00Z', { currency: 'CAD', items_subtotal: 50, shipping_total: 0 })];
    const ms = aggregate(os, [], [], r);
    expect(ms.map((m) => [m.currency, m.totalSales]).sort()).toEqual([
      ['CAD', 50],
      ['USD', 110],
    ]);
  });

  it('định dạng tiền "149,00 USD"', () => {
    expect(formatMoney(149, 'USD')).toBe('149,00 USD');
    expect(formatMoney('1234.5', 'USD')).toBe('1.234,50 USD');
  });
});
