import { afterEach, describe, expect, it } from 'vitest';
import { registerPhone, setup, type Harness } from './helpers.js';
import { q } from '../src/lib/db.js';

let h: Harness;
afterEach(async () => {
  await h?.close();
});

describe('âm thanh thông báo', () => {
  it('mặc định ka-ching; đổi sang âm hệ thống thì push dùng kênh Android khác', async () => {
    h = await setup();
    await registerPhone(h);
    const o1 = h.woo.makeOrder({ status: 'pending' });
    await h.woo.fire('order.created', o1);
    await h.drain();
    expect(h.expo.messages[0]).toMatchObject({ sound: 'ka_ching.wav', channelId: 'orders_kaching' });
    await h.api('PATCH', '/api/devices/inst-iphone-0001/prefs', { sound: 'default' });
    const o2 = h.woo.makeOrder({ status: 'pending' });
    await h.woo.fire('order.created', o2);
    await h.drain();
    expect(h.expo.messages[1]).toMatchObject({ sound: 'default', channelId: 'orders' });
  });
});

describe('quản lý cửa hàng', () => {
  it('đọc & sửa cài đặt WooCommerce theo nhóm; giá trị sai bị từ chối rõ ràng', async () => {
    h = await setup();
    const groups = await h.api('GET', '/api/store/settings');
    expect(groups.json.map((g: any) => g.id)).toContain('general');
    const g = await h.api('GET', '/api/store/settings/general');
    expect(g.json.find((f: any) => f.id === 'woocommerce_currency')).toMatchObject({ type: 'select', editable: true, value: 'USD' });
    const ok = await h.api('PUT', '/api/store/settings/general', { updates: [{ id: 'woocommerce_store_address', value: '99 Ocean Ave' }] });
    expect(ok.json[0].value).toBe('99 Ocean Ave');
    expect(h.woo.settings.general[0].value).toBe('99 Ocean Ave');
    const bad = await h.api('PUT', '/api/store/settings/general', { updates: [{ id: 'woocommerce_currency', value: 'XYZ' }] });
    expect(bad.status).toBe(422);
    // đổi cài đặt tồn kho → backend cập nhật thông tin shop
    await h.api('PUT', '/api/store/settings/products', { updates: [{ id: 'woocommerce_notify_low_stock_amount', value: '5' }] });
  });

  it('bật/tắt cổng thanh toán và sửa cài đặt cổng', async () => {
    h = await setup();
    const list = await h.api('GET', '/api/store/payment-gateways');
    expect(list.json.map((g: any) => [g.id, g.enabled])).toEqual([
      ['stripe', true],
      ['cod', false],
    ]);
    const r = await h.api('PUT', '/api/store/payment-gateways/cod', { enabled: true, settings: { instructions: 'Trả tiền mặt khi nhận' } });
    expect(r.json.enabled).toBe(true);
    expect(r.json.settings.find((f: any) => f.id === 'instructions').value).toBe('Trả tiền mặt khi nhận');
  });

  it('vùng vận chuyển, sửa phí và tắt phương thức', async () => {
    h = await setup();
    const z = await h.api('GET', '/api/store/shipping-zones');
    expect(z.json[0].methods.map((m: any) => m.title)).toEqual(['USPS Priority', 'Miễn phí']);
    expect(z.json[1].name).toBe('Các khu vực còn lại');
    const r = await h.api('PUT', '/api/store/shipping-zones/1/methods/1', { settings: { cost: '12.50' } });
    expect(r.json.settings[0].value).toBe('12.50');
    const off = await h.api('PUT', '/api/store/shipping-zones/1/methods/2', { enabled: false });
    expect(off.json.enabled).toBe(false);
  });

  it('mã giảm giá: tạo, chặn trùng mã, sửa, xóa', async () => {
    h = await setup();
    const c = await h.api('POST', '/api/store/coupons', { code: 'BLACKFRIDAY', discountType: 'percent', amount: '20', dateExpires: '2026-11-30', usageLimit: 100 });
    expect(c.status).toBe(200);
    expect(c.json).toMatchObject({ code: 'blackfriday', amount: '20', usageLimit: 100, dateExpires: '2026-11-30' });
    const dup = await h.api('POST', '/api/store/coupons', { code: 'blackfriday', amount: '5' });
    expect(dup.status).toBe(409);
    const upd = await h.api('PUT', `/api/store/coupons/${c.json.id}`, { amount: '25', status: 'draft' });
    expect(upd.json).toMatchObject({ amount: '25', status: 'draft' });
    const list = await h.api('GET', '/api/store/coupons?q=black');
    expect(list.json.items).toHaveLength(1);
    await h.api('DELETE', `/api/store/coupons/${c.json.id}`);
    expect(h.woo.coupons.find((x) => x.code === 'blackfriday')).toBeUndefined();
  });

  it('khách hàng: danh sách kèm số đơn & tổng chi từ đơn đã đồng bộ, sửa thông tin', async () => {
    h = await setup();
    const o = h.woo.makeOrder({ status: 'completed' });
    await h.woo.fire('order.created', o);
    await h.drain();
    const list = await h.api('GET', '/api/store/customers');
    expect(list.json.items[0]).toMatchObject({ email: 'emily@example.com', ordersCount: 1, totalSpent: 149 });
    const d = await h.api('GET', '/api/store/customers/71');
    expect(d.json.orders[0].id).toBe(o.id);
    const u = await h.api('PUT', '/api/store/customers/71', { firstName: 'Emma', shipping: { city: 'Dallas' } });
    expect(u.json.firstName).toBe('Emma');
    expect(h.woo.customers[0].shipping.city).toBe('Dallas');
  });

  it('sửa thông tin sản phẩm: tên, trạng thái, danh mục; cảnh báo xung đột', async () => {
    h = await setup({ seed: (w) => w.seedCatalog() });
    const d = await h.api('GET', '/api/products/503');
    const r = await h.api('PUT', '/api/products/503/info', { name: 'Ví mini da bò', status: 'private', categoryIds: [13, 11], expectedModified: d.json.product.dateModified });
    expect(r.json.product).toMatchObject({ name: 'Ví mini da bò', status: 'private' });
    expect(h.woo.products.get(503).categories.map((c: any) => c.id)).toEqual([13, 11]);
    const stale = await h.api('PUT', '/api/products/503/info', { name: 'Khác', expectedModified: d.json.product.dateModified });
    expect(stale.status).toBe(409);
  });
});

describe('báo cáo & live', () => {
  it('báo cáo bán hàng theo sản phẩm, quốc gia, thanh toán, khách mới/quay lại, mã giảm giá', async () => {
    h = await setup({ seed: (w) => w.seedCatalog() });
    const a = h.woo.makeOrder({ status: 'completed', created: new Date(Date.now() - 40 * 86400_000) });
    const b = h.woo.makeOrder({ status: 'processing', extra: { coupon_lines: [{ id: 1, code: 'WELCOME10', discount: '5.00' }] } });
    const c = h.woo.makeOrder({ status: 'processing', extra: { billing: { first_name: 'Mia', last_name: 'Ng', email: 'mia@example.com', country: 'CA' }, shipping: { country: 'CA', state: 'ON' } } });
    for (const o of [a, b, c]) await h.woo.fire('order.created', o);
    await h.drain();
    const r = await h.api('GET', '/api/reports/sales?range=7d');
    expect(r.status).toBe(200);
    expect(r.json.byProduct[0]).toMatchObject({ id: 501, qty: 2 });
    expect(r.json.byCountry.map((x: any) => x.name).sort()).toEqual(['Canada', 'Hoa Kỳ']);
    expect(r.json.customers).toMatchObject({ new: 1, returning: 1 });
    expect(r.json.coupons[0]).toMatchObject({ code: 'welcome10', orders: 1, discount: 5 });
    expect(r.json.byPayment[0].orders).toBe(2);
    expect(r.json.tracking.enabled).toBe(false);
  });

  it('plugin tracker: token sai bị bỏ qua; phễu & tỉ lệ chuyển đổi; live đang xem', async () => {
    h = await setup();
    const t = await h.api('GET', '/api/tracker');
    expect(t.json.endpoint).toMatch(/\/t\/1$/);
    const send = (body: any) => h.app.inject({ method: 'POST', url: '/t/1', payload: JSON.stringify(body), headers: { 'content-type': 'text/plain' } });
    await send({ k: 'sai', sid: 'aaaaaaaaaaaa', t: 'page', p: '/' });
    expect((await q('SELECT count(*)::int n FROM visits'))[0].n).toBe(0);
    const k = t.json.token;
    await send({ k, sid: 'sess00000001', t: 'page', p: '/', r: 'https://www.google.com/search', m: true });
    await send({ k, sid: 'sess00000001', t: 'product', p: '/product/tote' });
    await send({ k, sid: 'sess00000001', t: 'cart', p: '/cart' });
    await send({ k, sid: 'sess00000001', t: 'checkout', p: '/checkout' });
    await send({ k, sid: 'sess00000001', t: 'purchase', p: '/checkout/order-received/10500', o: 10500 });
    for (let i = 2; i <= 4; i++) await send({ k, sid: `sess0000000${i}`, t: 'product', p: '/product/tote', u: 'instagram' });
    const r = await h.api('GET', '/api/reports/sales?range=today');
    expect(r.json.tracking).toMatchObject({ enabled: true, sessions: 4, conversionRate: 25 });
    expect(r.json.tracking.funnel.map((f: any) => f.count)).toEqual([4, 4, 1, 1, 1]);
    expect(r.json.tracking.sources.map((s: any) => s.name)).toEqual(['instagram', 'google.com']);
    const live = await h.api('GET', '/api/reports/live');
    expect(live.json.visitors).toMatchObject({ enabled: true, activeNow: 4, sessionsToday: 4 });
    expect(live.json.cumulativeToday.length).toBeGreaterThan(0);
  });
});
