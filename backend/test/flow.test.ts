import { afterEach, describe, expect, it } from 'vitest';
import { registerPhone, setup, type Harness } from './helpers.js';
import { q } from '../src/lib/db.js';

let h: Harness;
afterEach(async () => {
  await h?.close();
});

const pushesFor = (h: Harness, orderId: number) => h.expo.messages.filter((m) => m.data?.orderId === orderId);

describe('kết nối shop & kiểm tra kết nối', () => {
  it('kiểm tra từng bước và tự tạo webhook có secret', async () => {
    h = await setup();
    expect(h.woo.webhooks.map((w) => w.topic)).toContain('order.created');
    expect(h.woo.webhooks.every((w) => w.delivery_url.endsWith('/webhooks/woocommerce/1') && w.secret.length > 20)).toBe(true);
    const shop = await h.api('GET', '/api/shop');
    expect(shop.json.shop.timezone).toBe('America/New_York');
    expect(shop.json.shop.currency).toBe('USD');
    expect(shop.json.shop.astEnabled).toBe(true);
    expect(JSON.stringify(shop.json)).not.toContain('cs_test'); // không lộ secret
    const check = await h.api('POST', '/api/shop/check');
    const byKey = Object.fromEntries(check.json.steps.map((s: any) => [s.key, s.level]));
    expect(byKey).toMatchObject({ url: 'ok', auth: 'ok', read: 'ok', write: 'ok', webhooks: 'ok' });
  });

  it('báo rõ lỗi xác thực và lỗi thiếu quyền ghi', async () => {
    h = await setup({ connect: false, woo: { permissions: 'read' } });
    const bad = await h.api('POST', '/api/shop/test', { url: h.woo.url, consumerKey: 'ck_wrong_123456', consumerSecret: 'cs_wrong_123456' });
    expect(bad.json.steps.find((s: any) => s.key === 'auth').level).toBe('error');
    const ro = await h.api('POST', '/api/shop/test', { url: h.woo.url, consumerKey: h.woo.opts.consumerKey, consumerSecret: h.woo.opts.consumerSecret });
    const steps = Object.fromEntries(ro.json.steps.map((s: any) => [s.key, s]));
    expect(steps.read.level).toBe('ok');
    expect(steps.write.level).toBe('error');
    expect(steps.write.message).toMatch(/Đọc\/Ghi/);
    const url = await h.api('POST', '/api/shop/test', { url: 'http://127.0.0.1:1', consumerKey: 'ck_x_1234567890', consumerSecret: 'cs_x_1234567890' });
    expect(url.json.steps[0]).toMatchObject({ key: 'url', level: 'error' });
  });
});

describe('đồng bộ lần đầu', () => {
  it('tải đơn cũ nhưng không báo hàng loạt; đơn mở được tải trước', async () => {
    h = await setup({
      seed: (w) => {
        for (let i = 0; i < 120; i++) w.makeOrder({ status: i % 10 === 0 ? 'processing' : 'completed', created: new Date(Date.now() - (i + 1) * 3600_000 * 5) });
      },
    });
    await registerPhone(h);
    await h.drain();
    const count = await q('SELECT count(*)::int n FROM orders');
    expect(count[0].n).toBe(120);
    const st = await h.api('GET', '/api/shop');
    expect(st.json.sync.orders.status).toBe('done');
    expect(h.expo.messages.length).toBe(0);
    const notifs = await h.api('GET', '/api/notifications');
    expect(notifs.json.items.length).toBe(0);
    const suppressed = await q('SELECT count(*)::int n FROM business_events WHERE suppressed');
    expect(suppressed[0].n).toBeGreaterThan(0);
    // Đơn "Đang xử lý" được tải trong pha đầu tiên
    const first = h.woo.requests.find((r) => r.path === '/wc/v3/orders' && r.method === 'GET');
    expect(first).toBeTruthy();
  });

  it('tiếp tục được sau khi backend khởi động lại; đơn mới phát sinh trong lúc đồng bộ vẫn được báo', async () => {
    h = await setup({
      connect: false,
      seed: (w) => {
        for (let i = 0; i < 160; i++) w.makeOrder({ status: 'completed', created: new Date(Date.now() - (i + 1) * 3600_000 * 3) });
      },
    });
    await h.api('POST', '/api/shop/connect', { url: h.woo.url, consumerKey: h.woo.opts.consumerKey, consumerSecret: h.woo.opts.consumerSecret });
    await registerPhone(h);
    const { runOne } = await import('../src/jobs/queue.js');
    const { handlers } = await import('../src/jobs/handlers.js');
    await runOne(handlers);
    await runOne(handlers);
    // mô phỏng backend chết: mất toàn bộ job trong hàng đợi
    await q(`DELETE FROM jobs WHERE status='queued'`);
    const mid = await h.api('GET', '/api/dashboard?range=30d');
    expect(mid.json.coverage.syncing).toBe(true);
    const fresh = h.woo.makeOrder({ status: 'pending', number: 'NEW-1' });
    await h.woo.fire('order.created', fresh);
    const { resumeSyncs } = await import('../src/services/sync.js');
    await resumeSyncs();
    await h.drain();
    expect((await q('SELECT count(*)::int n FROM orders'))[0].n).toBe(161);
    expect(h.expo.messages.map((m) => m.data.orderId)).toEqual([fresh.id]);
  });
});

describe('webhook → push', () => {
  it('đơn mới chờ thanh toán: đúng nội dung, không có dữ liệu cá nhân, chạm mở đúng đơn', async () => {
    h = await setup();
    await registerPhone(h);
    const o = h.woo.makeOrder({ status: 'pending', number: '10428' });
    expect(await h.woo.fire('order.created', o)).toEqual([200]);
    await h.drain();
    const msgs = pushesFor(h, o.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].title).toBe('Đơn mới #10428 · 149,00 USD');
    expect(msgs[0].body).toBe('2 sản phẩm · Chờ thanh toán');
    expect(msgs[0].data.url).toBe(`wooadmin://orders/${o.id}`);
    const raw = JSON.stringify(msgs[0]);
    expect(raw).not.toMatch(/emily|Main St|555/i);
    const list = await h.api('GET', '/api/notifications');
    expect(list.json.items[0]).toMatchObject({ kind: 'order.placed', order_id: o.id });
    expect(list.json.unread).toBe(1);
  });

  it('thanh toán ngay + bật cả hai tùy chọn: hai thông báo với nội dung khác nhau', async () => {
    h = await setup();
    await registerPhone(h, 'inst-iphone-0001', 'ExponentPushToken[iphone-1]', { notifyNewOrder: true, notifyPaid: true });
    const o = h.woo.makeOrder({ status: 'processing', number: '10429' });
    await h.woo.fire('order.created', o);
    await h.drain();
    const msgs = pushesFor(h, o.id);
    expect(msgs.map((m) => m.title).sort()).toEqual(['Đã thanh toán #10429 · 149,00 USD', 'Đơn mới #10429 · 149,00 USD']);
    expect(msgs.find((m) => m.title.startsWith('Đơn mới'))!.body).toBe('2 sản phẩm · Đã thanh toán');
  });

  it('ẩn số tiền trên màn hình khóa', async () => {
    h = await setup();
    await registerPhone(h, 'inst-iphone-0001', 'ExponentPushToken[iphone-1]', { hideAmount: true });
    const o = h.woo.makeOrder({ status: 'pending', number: '10430' });
    await h.woo.fire('order.created', o);
    await h.drain();
    expect(pushesFor(h, o.id)[0].title).toBe('Đơn mới #10430');
  });

  it('checkout draft (Checkout Blocks) không báo; chuyển sang đơn hợp lệ qua order.updated thì báo đúng một lần', async () => {
    h = await setup();
    await registerPhone(h);
    const o = h.woo.makeOrder({ status: 'checkout-draft', number: '10431' });
    await h.woo.fire('order.created', o);
    await h.woo.fire('order.updated', h.woo.updateOrder(o.id, { billing: { ...o.billing, first_name: 'Em' } }));
    await h.drain();
    expect(pushesFor(h, o.id)).toHaveLength(0);
    await h.woo.fire('order.updated', h.woo.updateOrder(o.id, { status: 'processing' }));
    await h.woo.fire('order.updated', h.woo.updateOrder(o.id, { customer_note: 'gói quà' }));
    await h.drain();
    expect(pushesFor(h, o.id)).toHaveLength(1);
    expect(pushesFor(h, o.id)[0].title).toMatch(/^Đơn mới #10431/);
  });

  it('webhook gửi trùng (cùng delivery ID) và nhiều cập nhật cho cùng đơn → một thông báo', async () => {
    h = await setup();
    await registerPhone(h);
    const o = h.woo.makeOrder({ status: 'pending', number: '10432' });
    await h.woo.fire('order.created', o, { deliveryId: 777 });
    await h.woo.fire('order.created', o, { deliveryId: 777 });
    await h.woo.fire('order.updated', h.woo.updateOrder(o.id, { customer_note: 'a' }));
    await h.woo.fire('order.updated', h.woo.updateOrder(o.id, { customer_note: 'b' }));
    await h.drain();
    expect(pushesFor(h, o.id)).toHaveLength(1);
    const dup = await q(`SELECT count(*)::int n FROM webhook_deliveries WHERE delivery_id='777'`);
    expect(dup[0].n).toBe(1);
  });

  it('webhook đến sai thứ tự không ghi đè dữ liệu mới bằng dữ liệu cũ', async () => {
    h = await setup();
    await registerPhone(h, 'inst-iphone-0001', 'ExponentPushToken[iphone-1]', { notifyPaid: true });
    const o = h.woo.makeOrder({ status: 'pending', number: '10433' });
    const created = structuredClone(o);
    const paid = structuredClone(h.woo.updateOrder(o.id, { status: 'processing' }));
    await h.woo.fire('order.updated', paid);
    await h.woo.fire('order.created', created);
    await h.drain();
    const row = await q('SELECT status FROM orders WHERE id=$1', [o.id]);
    expect(row[0].status).toBe('processing');
    expect(pushesFor(h, o.id).map((m) => m.title.split(' #')[0]).sort()).toEqual(['Đã thanh toán', 'Đơn mới']);
  });

  it('chữ ký sai bị từ chối và hiện trong kiểm tra kết nối', async () => {
    h = await setup();
    await registerPhone(h);
    const o = h.woo.makeOrder({ status: 'pending' });
    expect(await h.woo.fire('order.created', o, { secret: 'wrong' })).toEqual([401]);
    await h.drain();
    expect(pushesFor(h, o.id)).toHaveLength(0);
    const check = await h.api('POST', '/api/shop/check');
    expect(check.json.steps.find((s: any) => s.key === 'webhook_delivery').level).toBe('error');
  });

  it('webhook bị lỡ được bù bằng đối soát định kỳ', async () => {
    h = await setup();
    await registerPhone(h);
    const o = h.woo.makeOrder({ status: 'processing', number: '10434' });
    const { enqueue } = await import('../src/jobs/queue.js');
    await enqueue('reconcile', { shopId: 1 });
    await h.drain();
    expect(pushesFor(h, o.id)).toHaveLength(1);
  });

  it('lỗi tạm thời từ dịch vụ push được thử lại, không gửi trùng', async () => {
    h = await setup();
    await registerPhone(h);
    h.expo.failNext = 1;
    const o = h.woo.makeOrder({ status: 'pending' });
    await h.woo.fire('order.created', o);
    await h.drain();
    expect(pushesFor(h, o.id)).toHaveLength(0);
    await q(`UPDATE jobs SET run_at=now() WHERE status='queued' AND type='push.notification'`);
    await h.drain();
    await q(`UPDATE jobs SET run_at=now() WHERE status='queued' AND type='push.notification'`);
    await h.drain();
    expect(pushesFor(h, o.id)).toHaveLength(1);
  });

  it('token thay đổi, token chết (DeviceNotRegistered) và đăng xuất', async () => {
    h = await setup();
    await registerPhone(h, 'inst-iphone-0001', 'ExponentPushToken[old]');
    await registerPhone(h, 'inst-iphone-0001', 'ExponentPushToken[new]');
    const o1 = h.woo.makeOrder({ status: 'pending' });
    await h.woo.fire('order.created', o1);
    await h.drain();
    expect(pushesFor(h, o1.id).map((m) => m.to)).toEqual(['ExponentPushToken[new]']);

    h.expo.ticketErrors.set('ExponentPushToken[new]', 'DeviceNotRegistered');
    const o2 = h.woo.makeOrder({ status: 'pending' });
    await h.woo.fire('order.created', o2);
    await h.drain();
    const dev = await h.api('GET', '/api/devices/inst-iphone-0001');
    expect(dev.json).toMatchObject({ active: false, inactiveReason: 'DeviceNotRegistered' });

    h.expo.ticketErrors.clear();
    await registerPhone(h, 'inst-iphone-0001', 'ExponentPushToken[new2]');
    await h.api('POST', '/api/auth/logout');
    const o3 = h.woo.makeOrder({ status: 'pending' });
    await h.woo.fire('order.created', o3);
    await h.drain();
    expect(pushesFor(h, o3.id)).toHaveLength(0);
    // hết phiên: API trả 401 session_expired
    const after = await h.api('GET', '/api/me');
    expect(after.status).toBe(401);
    expect(after.json.error).toBe('session_expired');
  });

  it('quyền push bị từ chối: lịch sử thông báo vẫn có', async () => {
    h = await setup();
    await h.api('PUT', '/api/devices', { installationId: 'inst-android-01', platform: 'android', pushToken: null, permission: 'denied' });
    const o = h.woo.makeOrder({ status: 'pending' });
    await h.woo.fire('order.created', o);
    await h.drain();
    expect(h.expo.messages).toHaveLength(0);
    const list = await h.api('GET', '/api/notifications');
    expect(list.json.items).toHaveLength(1);
  });

  it('gửi thông báo thử tới đúng thiết bị', async () => {
    h = await setup();
    await registerPhone(h);
    const r = await h.api('POST', '/api/notifications/test', { installationId: 'inst-iphone-0001' });
    expect(r.json.sent).toBe(1);
    expect(h.expo.messages[0].title).toBe('Thông báo thử');
    const diag = await h.api('GET', '/api/notifications/diagnostics?installationId=inst-iphone-0001');
    expect(diag.json.lastTestPush.status).toBe('sent');
  });
});

describe('đơn hàng', () => {
  it('danh sách, tìm, lọc; chi tiết có tracking AST nhiều kiện; đổi trạng thái có kiểm tra xung đột', async () => {
    h = await setup();
    const o = h.woo.makeOrder({ status: 'processing', number: 'US-10440' });
    h.woo.makeOrder({ status: 'completed' });
    h.woo.tracking.set(o.id, [
      { tracking_id: 'a', tracking_provider: 'usps', formatted_tracking_provider: 'USPS', tracking_number: '9400111', formatted_tracking_link: 'https://usps.example/9400111', date_shipped: '1763337600' },
      { tracking_id: 'b', tracking_provider: 'ups', formatted_tracking_provider: 'UPS', tracking_number: '1Z999', date_shipped: '1763337600' },
    ]);
    await h.woo.fire('order.created', o);
    await h.drain();
    const list = await h.api('GET', '/api/orders?status=processing');
    expect(list.json.items.map((x: any) => x.number)).toEqual(['US-10440']);
    const byEmail = await h.api('GET', '/api/orders?q=emily@example');
    expect(byEmail.json.items.length).toBeGreaterThan(0);
    const byNum = await h.api('GET', '/api/orders?q=%23US-10440');
    expect(byNum.json.items[0].id).toBe(o.id);

    const d = await h.api('GET', `/api/orders/${o.id}`);
    expect(d.json.tracking.map((t: any) => t.provider)).toEqual(['USPS', 'UPS']);
    expect(d.json.items[0]).toMatchObject({ sku: 'TOTE-BLK', meta: [{ key: 'Màu', value: 'Đen' }] });
    expect(d.json.shippingAddress.lines).toContain('12 Main St');
    expect(d.json.adminUrl).toContain(`page=wc-orders&action=edit&id=${o.id}`);

    // ai đó vừa đổi trên website → 409
    h.woo.updateOrder(o.id, { status: 'on-hold' });
    const conflict = await h.api('POST', `/api/orders/${o.id}/status`, { status: 'completed', expectedStatus: 'processing' });
    expect(conflict.status).toBe(409);
    const ok = await h.api('POST', `/api/orders/${o.id}/status`, { status: 'completed', expectedStatus: 'on-hold' });
    expect(ok.json.status).toBe('completed');
    expect(h.woo.orders.get(o.id).status).toBe('completed'); // WooCommerce Admin thấy thay đổi
  });

  it('mất mạng khi thêm ghi chú: gửi lại với cùng khóa không tạo ghi chú trùng', async () => {
    h = await setup();
    const o = h.woo.makeOrder({ status: 'processing' });
    h.woo.dropAfterWrite = (m, p) => m === 'POST' && p.endsWith('/notes');
    const first = await h.api('POST', `/api/orders/${o.id}/notes`, { note: 'Đã gọi khách xác nhận size', customer: false }, { 'idempotency-key': 'note-key-0001' });
    expect(first.status).toBe(502);
    const retry = await h.api('POST', `/api/orders/${o.id}/notes`, { note: 'Đã gọi khách xác nhận size', customer: false }, { 'idempotency-key': 'note-key-0001' });
    expect(retry.status).toBe(200);
    expect(retry.json.replayed).toBe(true);
    expect(h.woo.notes.get(o.id)).toHaveLength(1);
    const customer = await h.api('POST', `/api/orders/${o.id}/notes`, { note: 'Cảm ơn bạn!', customer: true }, { 'idempotency-key': 'note-key-0002' });
    expect(customer.json.customerNote).toBe(true);
  });
});

describe('sản phẩm & biến thể', () => {
  const seed = (w: any) => w.seedCatalog();

  it('tìm theo SKU biến thể → sửa giá một biến thể → giá trị WooCommerce xác nhận', async () => {
    h = await setup({ seed });
    const s = await h.api('GET', '/api/products?q=tote-brn');
    expect(s.json.items).toHaveLength(1);
    expect(s.json.items[0].matched_variation).toMatchObject({ id: 602, sku: 'TOTE-BRN', label: 'Nâu' });
    const d = await h.api('GET', '/api/products/501');
    const v = d.json.variations.find((x: any) => x.id === 602);
    expect(v).toMatchObject({ stockMode: 'product', stockQuantity: 1, regularPrice: '119.00' });
    const r = await h.api('PATCH', '/api/products/501/variations/602', { regularPrice: '129.00', salePrice: '99.00', stockQuantity: 4, expectedModified: v.dateModified });
    expect(r.status).toBe(200);
    expect(r.json.item).toMatchObject({ id: 602, regularPrice: '129.00', salePrice: '99.00', price: '99.00', stockQuantity: 4 });
    expect(h.woo.variations.get(602)).toMatchObject({ regular_price: '129.00', sale_price: '99.00', stock_quantity: 4 });
    expect(h.woo.variations.get(601).regular_price).toBe('119.00'); // biến thể khác không đổi
  });

  it('cảnh báo khi dữ liệu vừa sửa trên website', async () => {
    h = await setup({ seed });
    const d = await h.api('GET', '/api/products/501');
    const v = d.json.variations.find((x: any) => x.id === 601);
    h.woo.tick(5000);
    h.woo.variations.get(601).regular_price = '125.00';
    h.woo.variations.get(601).date_modified_gmt = new Date(h.woo.clock).toISOString().replace(/\.\d+Z$/, '');
    const r = await h.api('PATCH', '/api/products/501/variations/601', { regularPrice: '130.00', expectedModified: v.dateModified });
    expect(r.status).toBe(409);
    expect(r.json.details.current.regularPrice).toBe('125.00');
    expect(h.woo.variations.get(601).regular_price).toBe('125.00');
  });

  it('tồn kho do sản phẩm cha quản lý: ghi vào sản phẩm cha và báo rõ', async () => {
    h = await setup({ seed });
    const d = await h.api('GET', '/api/products/502');
    const v = d.json.variations.find((x: any) => x.id === 611);
    expect(v.stockMode).toBe('parent');
    const r = await h.api('PATCH', '/api/products/502/variations/611', { stockQuantity: 20, expectedModified: v.dateModified });
    expect(r.status).toBe(200);
    expect(h.woo.products.get(502).stock_quantity).toBe(20);
    expect(r.json.changed.map((c: any) => c.id).sort()).toEqual([502, 611]);
  });

  it('chỉ theo dõi còn/hết hàng: không cho ghi số lượng', async () => {
    h = await setup({ seed });
    const bad = await h.api('PATCH', '/api/products/503', { stockQuantity: 3 });
    expect(bad.status).toBe(400);
    const ok = await h.api('PATCH', '/api/products/503', { stockStatus: 'outofstock' });
    expect(ok.json.item.stockStatus).toBe('outofstock');
  });

  it('lọc sắp hết / hết hàng tính cả biến thể', async () => {
    h = await setup({ seed });
    const low = await h.api('GET', '/api/products?stock=low');
    expect(low.json.items.map((p: any) => p.id)).toEqual([501]);
    const out = await h.api('GET', '/api/products?stock=outofstock');
    expect(out.json.items.map((p: any) => p.id)).toEqual([501]);
    const cat = await h.api('GET', '/api/products?category=12');
    expect(cat.json.items.map((p: any) => p.id)).toEqual([502]);
  });

  it('tạo sản phẩm nháp khi mất mạng giữa chừng không tạo trùng; đăng bán là thao tác riêng', async () => {
    h = await setup({ seed });
    h.woo.dropAfterWrite = (m, p) => m === 'POST' && p === '/wc/v3/products';
    const body = { name: 'Túi đeo chéo canvas', sku: 'XBODY-CNV', regularPrice: '59.00', categoryIds: [11], manageStock: true, stockQuantity: 8 };
    const first = await h.api('POST', '/api/products', body, { 'idempotency-key': 'create-key-0001' });
    expect(first.status).toBe(502);
    const retry = await h.api('POST', '/api/products', body, { 'idempotency-key': 'create-key-0001' });
    expect(retry.status).toBe(200);
    expect([...h.woo.products.values()].filter((p) => p.sku === 'XBODY-CNV')).toHaveLength(1);
    expect(retry.json.product.status).toBe('draft');
    const pub = await h.api('POST', `/api/products/${retry.json.product.id}/publish`);
    expect(pub.json.product.status).toBe('publish');
  });
});

describe('dashboard', () => {
  it('doanh thu hôm nay theo múi giờ shop, hoàn tiền một phần, cần xử lý', async () => {
    h = await setup();
    const a = h.woo.makeOrder({ status: 'processing' });
    const b = h.woo.makeOrder({ status: 'pending' });
    await h.woo.fire('order.created', a);
    await h.woo.fire('order.created', b);
    h.woo.addRefund(a.id, 30);
    await h.woo.fire('order.updated', h.woo.orders.get(a.id));
    await h.drain();
    const d = await h.api('GET', '/api/dashboard?range=today');
    expect(d.status).toBe(200);
    expect(d.json.timezone).toBe('America/New_York');
    const usd = d.json.currencies[0];
    expect(usd).toMatchObject({ currency: 'USD', ordersCount: 1, newOrders: 2, paidOrders: 1, grossSales: 139, refunds: 30, netSales: 109, shipping: 10, totalSales: 119 });
    expect(d.json.needsProcessing).toBe(1);
    expect(d.json.pendingPayment).toBe(1);
    expect(d.json.coverage.complete).toBe(true);
    expect(d.json.definitions.length).toBeGreaterThan(5);
  });
});
