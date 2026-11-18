import { routeForNotificationData } from '../src/lib/notificationRoute';
import { money } from '../src/lib/format';
import { buildPatch, formFrom, patchApplied } from '../src/lib/product';
import { createHttpApi, ApiError } from '../src/api/client';
import { createDemoApi } from '../src/api/demo';
import type { Product } from '../src/api/types';

describe('chạm thông báo → đúng màn hình', () => {
  it('mở đúng đơn từ dữ liệu push (dùng cho cả mở lạnh khi app đóng)', () => {
    expect(routeForNotificationData({ type: 'order', orderId: 10428, url: 'wooadmin://orders/10428' })).toBe('/orders/10428');
    expect(routeForNotificationData({ url: 'wooadmin://orders/77' })).toBe('/orders/77');
    expect(routeForNotificationData({ type: 'test', url: 'wooadmin://notifications' })).toBe('/notifications');
  });
  it('bỏ qua dữ liệu lạ', () => {
    expect(routeForNotificationData(null)).toBeNull();
    expect(routeForNotificationData({ url: 'https://evil.example' })).toBeNull();
    expect(routeForNotificationData({ type: 'order', orderId: 'abc' })).toBeNull();
  });
});

describe('định dạng', () => {
  it('tiền tệ kiểu Việt Nam, giữ mã tiền website', () => {
    expect(money(149, 'USD')).toBe('149,00 USD');
    expect(money('1234.5', 'USD')).toBe('1.234,50 USD');
    expect(money(-30, 'CAD')).toBe('−30,00 CAD');
  });
});

const variation = (p: Partial<Product>): Product => ({
  id: 602, parentId: 501, type: 'variation', name: 'Túi tote da', variationLabel: 'Nâu', attributes: [], sku: 'TOTE-BRN', status: 'publish',
  price: '119.00', regularPrice: '119.00', salePrice: '', manageStock: 'true', stockMode: 'product', stockQuantity: 1, parentStockQuantity: null,
  stockStatus: 'instock', lowStockAmount: 2, imageUrl: null, images: [], categories: [], shortDescription: '', dateModified: '2026-11-18T01:00:00',
  permalink: null, adminUrl: '', ...p,
});

describe('xem trước thay đổi biến thể', () => {
  it('chỉ gửi trường đã đổi và mô tả rõ biến thể nào', () => {
    const v = variation({});
    const r = buildPatch(v, { ...formFrom(v), regularPrice: '129,00', stockQuantity: '4' }, 'USD', 'Túi tote da', 0);
    expect(r.errors).toEqual([]);
    expect(r.patch).toEqual({ regularPrice: '129.00', stockQuantity: 4 });
    expect(r.lines.map((l) => `${l.target}|${l.field}|${l.from}→${l.to}`)).toEqual([
      'Biến thể TOTE-BRN (Nâu)|Giá thường|119,00 USD→129,00 USD',
      'Biến thể TOTE-BRN (Nâu)|Tồn kho|1→4',
    ]);
  });
  it('tồn kho dùng chung → ghi rõ sản phẩm cha bị ảnh hưởng', () => {
    const v = variation({ stockMode: 'parent', manageStock: 'parent', stockQuantity: 12, parentStockQuantity: 12 });
    const r = buildPatch(v, { ...formFrom(v), stockQuantity: '20' }, 'USD', 'Giày loafer', 4);
    expect(r.lines[0].target).toBe('Sản phẩm cha Giày loafer (dùng chung cho 4 biến thể)');
  });
  it('chặn giá khuyến mãi ≥ giá thường', () => {
    const v = variation({});
    expect(buildPatch(v, { ...formFrom(v), salePrice: '130' }, 'USD', '', 0).errors).toContain('Giá khuyến mãi phải thấp hơn giá thường');
  });
  it('xác minh sau khi mất mạng lúc lưu', () => {
    expect(patchApplied(variation({ regularPrice: '129.00', stockQuantity: 4 }), { regularPrice: '129.00', stockQuantity: 4 })).toBe(true);
    expect(patchApplied(variation({}), { regularPrice: '129.00' })).toBe(false);
  });
});

describe('client backend', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => (globalThis.fetch = origFetch));

  it('mất mạng khi đang ghi → lỗi "chưa chắc chắn" để app kiểm tra lại website', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as any;
    const api = createHttpApi({ baseUrl: 'https://api.test', token: 't', onSessionExpired: () => undefined });
    const e = await api.updateProduct(501, 602, { regularPrice: '129.00' }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.kind).toBe('network');
    expect(e.uncertain).toBe(true);
    const r = await api.getOrder(1).catch((x) => x);
    expect(r.uncertain).toBe(false);
  });

  it('hết phiên (401) → gọi onSessionExpired', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '{"error":"session_expired","message":"Phiên đăng nhập đã hết hạn."}' }) as any;
    const expired = jest.fn();
    const api = createHttpApi({ baseUrl: 'https://api.test', token: 't', onSessionExpired: expired });
    await expect(api.getShop()).rejects.toMatchObject({ kind: 'session' });
    expect(expired).toHaveBeenCalled();
  });

  it('gửi Idempotency-Key cho thao tác thêm ghi chú', async () => {
    const f = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":1}' });
    globalThis.fetch = f as any;
    const api = createHttpApi({ baseUrl: 'https://api.test/', token: 't', onSessionExpired: () => undefined });
    await api.addOrderNote(5, 'hi', false, 'note-abc-123');
    expect(f.mock.calls[0][0]).toBe('https://api.test/api/orders/5/notes');
    expect(f.mock.calls[0][1].headers['Idempotency-Key']).toBe('note-abc-123');
  });
});

describe('chế độ demo', () => {
  it('có đơn túi/giày/phụ kiện, tìm theo SKU biến thể, cảnh báo xung đột', async () => {
    const api = createDemoApi();
    const shop = await api.getShop();
    expect(shop.connected && shop.shop.name).toContain('demo');
    const list = await api.listProducts({ q: 'tote-brn' });
    expect(list.items[0].matched_variation?.sku).toBe('TOTE-BRN');
    const d = await api.getProduct(101);
    const v = d.variations.find((x) => x.sku === 'TOTE-BRN')!;
    const r = await api.updateProduct(101, v.id, { regularPrice: '129.00', expectedModified: v.dateModified });
    expect(r.item.regularPrice).toBe('129.00');
    await expect(api.updateProduct(101, v.id, { regularPrice: '139.00', expectedModified: '2000-01-01T00:00:00' })).rejects.toMatchObject({ kind: 'conflict' });
    const dash = await api.getDashboard('30d');
    expect(dash.currencies.map((c) => c.currency)).toEqual(['USD', 'CAD']);
    expect(dash.timezone).toBe('America/New_York');
    const processing = await api.listOrders({ status: 'processing' });
    expect(processing.items.every((o) => o.status === 'processing')).toBe(true);
  }, 20000);
});
