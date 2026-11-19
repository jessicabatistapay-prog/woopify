import { DateTime } from 'luxon';
import { ApiError } from './client';
import type { DemoOrder, DemoProduct } from './demo';
import type { Category, Coupon, Customer, PaymentGateway, SettingField, SettingGroup, ShippingZone, StoreApi } from './types';

/** Báo cáo, live và quản lý cửa hàng cho chế độ demo — dữ liệu trong bộ nhớ, không gọi mạng */

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const f = (id: string, label: string, type: string, value: unknown, extra: Partial<SettingField> = {}): SettingField => ({
  id,
  label,
  description: '',
  tip: '',
  type,
  value,
  default: null,
  options: null,
  placeholder: '',
  editable: !['title', 'sectionend'].includes(type),
  ...extra,
});

export function createDemoStore(ctx: { orders: DemoOrder[]; products: DemoProduct[]; variations: DemoProduct[]; cats: Category[]; total: (o: DemoOrder) => number; tz: string }): StoreApi {
  const { orders, products, cats, total, tz } = ctx;
  const groups: SettingGroup[] = [
    { id: 'general', label: 'Chung', description: 'Địa chỉ cửa hàng, vùng bán, tiền tệ' },
    { id: 'products', label: 'Sản phẩm', description: 'Tồn kho, đơn vị, đánh giá' },
    { id: 'tax', label: 'Thuế', description: 'Cách tính và hiển thị thuế' },
    { id: 'account', label: 'Tài khoản & quyền riêng tư', description: 'Thanh toán khách vãng lai, tạo tài khoản' },
    { id: 'email', label: 'Email', description: 'Người gửi, email thông báo' },
  ];
  const settings: Record<string, SettingField[]> = {
    general: [
      f('woocommerce_store_address', 'Địa chỉ', 'text', '350 5th Ave'),
      f('woocommerce_store_city', 'Thành phố', 'text', 'New York'),
      f('woocommerce_store_postcode', 'Mã bưu chính', 'text', '10118'),
      f('woocommerce_allowed_countries', 'Bán tới', 'select', 'specific', { options: { all: 'Mọi quốc gia', specific: 'Một số quốc gia', all_except: 'Mọi quốc gia trừ…' } }),
      f('woocommerce_calc_discounts_sequentially', 'Áp dụng mã giảm giá tuần tự', 'checkbox', 'no'),
      f('woocommerce_currency', 'Tiền tệ', 'select', 'USD', { options: { USD: 'Đô la Mỹ ($)', CAD: 'Đô la Canada ($)', EUR: 'Euro (€)' } }),
      f('woocommerce_currency_pos', 'Vị trí ký hiệu tiền', 'select', 'left', { options: { left: 'Trái', right: 'Phải', left_space: 'Trái, có dấu cách', right_space: 'Phải, có dấu cách' } }),
      f('woocommerce_price_num_decimals', 'Số chữ số thập phân', 'number', '2'),
    ],
    products: [
      f('woocommerce_manage_stock', 'Bật quản lý tồn kho', 'checkbox', 'yes'),
      f('woocommerce_notify_low_stock_amount', 'Ngưỡng sắp hết hàng', 'number', '2'),
      f('woocommerce_notify_no_stock_amount', 'Ngưỡng hết hàng', 'number', '0'),
      f('woocommerce_hide_out_of_stock_items', 'Ẩn sản phẩm hết hàng', 'checkbox', 'no'),
      f('woocommerce_enable_reviews', 'Cho phép đánh giá', 'checkbox', 'yes'),
      f('woocommerce_weight_unit', 'Đơn vị cân nặng', 'select', 'lbs', { options: { kg: 'kg', g: 'g', lbs: 'lbs', oz: 'oz' } }),
    ],
    tax: [
      f('woocommerce_prices_include_tax', 'Giá đã gồm thuế', 'radio', 'no', { options: { yes: 'Có, tôi nhập giá đã gồm thuế', no: 'Không, tôi nhập giá chưa gồm thuế' } }),
      f('woocommerce_tax_display_shop', 'Hiển thị giá trong cửa hàng', 'select', 'excl', { options: { incl: 'Gồm thuế', excl: 'Chưa gồm thuế' } }),
    ],
    account: [
      f('woocommerce_enable_guest_checkout', 'Cho phép thanh toán không cần tài khoản', 'checkbox', 'yes'),
      f('woocommerce_enable_signup_and_login_from_checkout', 'Cho phép tạo tài khoản khi thanh toán', 'checkbox', 'yes'),
    ],
    email: [
      f('woocommerce_email_from_name', 'Tên người gửi', 'text', 'Maison Demo'),
      f('woocommerce_email_from_address', 'Địa chỉ người gửi', 'email', 'hello@demo.example'),
      f('woocommerce_email_footer_text', 'Chân email', 'textarea', 'Cảm ơn bạn đã mua sắm!'),
    ],
  };
  const gateways: PaymentGateway[] = [
    { id: 'stripe', title: 'Thẻ tín dụng / Apple Pay', description: 'Thanh toán an toàn bằng thẻ.', enabled: true, order: 1, methodTitle: 'Stripe', methodDescription: 'Thẻ, Apple Pay, Google Pay', settings: [f('title', 'Tiêu đề', 'text', 'Thẻ tín dụng / Apple Pay'), f('description', 'Mô tả', 'textarea', 'Thanh toán an toàn bằng thẻ.'), f('testmode', 'Chế độ thử nghiệm', 'checkbox', 'no')] },
    { id: 'ppcp-gateway', title: 'PayPal', description: '', enabled: true, order: 2, methodTitle: 'PayPal', methodDescription: 'PayPal Checkout', settings: [f('title', 'Tiêu đề', 'text', 'PayPal')] },
    { id: 'bacs', title: 'Chuyển khoản ngân hàng', description: 'Đơn sẽ ở trạng thái Tạm giữ đến khi nhận tiền.', enabled: false, order: 3, methodTitle: 'Chuyển khoản trực tiếp', methodDescription: '', settings: [f('title', 'Tiêu đề', 'text', 'Chuyển khoản ngân hàng'), f('instructions', 'Hướng dẫn', 'textarea', 'Ghi mã đơn khi chuyển khoản.')] },
    { id: 'cod', title: 'Thanh toán khi nhận hàng', description: '', enabled: false, order: 4, methodTitle: 'COD', methodDescription: '', settings: [f('title', 'Tiêu đề', 'text', 'Thanh toán khi nhận hàng')] },
  ];
  const zones: ShippingZone[] = [
    {
      id: 1,
      name: 'Hoa Kỳ',
      order: 0,
      locations: [{ code: 'US', type: 'country' }],
      methods: [
        { instanceId: 1, methodId: 'flat_rate', title: 'USPS Priority Mail', enabled: true, order: 1, settings: [f('title', 'Tên', 'text', 'USPS Priority Mail'), f('cost', 'Phí', 'text', '8.95'), f('tax_status', 'Tính thuế', 'select', 'taxable', { options: { taxable: 'Có', none: 'Không' } })] },
        { instanceId: 2, methodId: 'free_shipping', title: 'Miễn phí vận chuyển', enabled: true, order: 2, settings: [f('title', 'Tên', 'text', 'Miễn phí vận chuyển'), f('min_amount', 'Đơn tối thiểu', 'price', '150')] },
      ],
    },
    { id: 2, name: 'Canada', order: 1, locations: [{ code: 'CA', type: 'country' }], methods: [{ instanceId: 3, methodId: 'flat_rate', title: 'Canada Post', enabled: true, order: 1, settings: [f('cost', 'Phí', 'text', '15')] }] },
    { id: 0, name: 'Các khu vực còn lại', order: 2, locations: [], methods: [] },
  ];
  let couponId = 900;
  const coupons: Coupon[] = [
    { id: ++couponId, code: 'welcome10', status: 'publish', discountType: 'percent', amount: '10', description: 'Khách mới', dateExpires: null, usageCount: 42, usageLimit: null, usageLimitPerUser: 1, minimumAmount: '', individualUse: true, freeShipping: false },
    { id: ++couponId, code: 'freeship', status: 'publish', discountType: 'fixed_cart', amount: '0', description: '', dateExpires: '2026-12-31', usageCount: 17, usageLimit: 200, usageLimitPerUser: null, minimumAmount: '80', individualUse: false, freeShipping: true },
    { id: ++couponId, code: 'summer25', status: 'draft', discountType: 'percent', amount: '25', description: 'Hết mùa', dateExpires: '2026-08-31', usageCount: 88, usageLimit: null, usageLimitPerUser: null, minimumAmount: '', individualUse: false, freeShipping: false },
  ];

  const customerList = (): Customer[] => {
    const by = new Map<string, Customer>();
    let id = 70;
    for (const o of [...orders].reverse()) {
      const email = `${o.customer[0].toLowerCase()}@example.com`;
      const c = by.get(email) ?? {
        id: ++id,
        email,
        firstName: o.customer[0],
        lastName: o.customer[1],
        name: `${o.customer[0]} ${o.customer[1]}`,
        dateCreated: o.created.toISOString(),
        isPayingCustomer: true,
        billing: { city: o.customer[2], state: o.customer[3], postcode: o.customer[4], country: 'US', phone: '+1 (555) 010-2200' },
        shipping: { address_1: `${100 + (o.id % 900)} Market Street`, city: o.customer[2], state: o.customer[3], postcode: o.customer[4], country: 'US' },
        ordersCount: 0,
        totalSpent: 0,
        currency: 'USD',
        lastOrderAt: null,
      };
      if (!['cancelled', 'failed'].includes(o.status)) {
        c.ordersCount++;
        c.totalSpent = Math.round((c.totalSpent + total(o)) * 100) / 100;
        c.lastOrderAt = o.created.toISOString();
      }
      by.set(email, c);
    }
    return [...by.values()].sort((a, b) => b.totalSpent - a.totalSpent);
  };
  const customerEdits = new Map<number, Partial<Customer>>();
  const customers = () => customerList().map((c) => ({ ...c, ...customerEdits.get(c.id) }));

  const apply = (fields: SettingField[], updates: Record<string, unknown>) => fields.forEach((x) => x.id in updates && (x.value = updates[x.id]));

  return {
    async salesReport(range, from, to) {
      await delay();
      const now = DateTime.now().setZone(tz).startOf('day');
      const start = range === 'today' ? now : range === 'yesterday' ? now.minus({ days: 1 }) : range === '7d' ? now.minus({ days: 6 }) : range === 'custom' && from ? DateTime.fromISO(from, { zone: tz }) : now.minus({ days: 29 });
      const end = range === 'yesterday' ? now : range === 'custom' && to ? DateTime.fromISO(to, { zone: tz }).plus({ days: 1 }) : now.plus({ days: 1 });
      const inR = orders.filter((o) => o.currency === 'USD' && o.created >= start.toJSDate() && o.created < end.toJSDate());
      const counted = inR.filter((o) => !['pending', 'failed', 'cancelled'].includes(o.status));
      const agg = <K extends string>(keyOf: (o: DemoOrder) => K[] | K) => {
        const m = new Map<string, { name: string; orders: number; qty: number; revenue: number }>();
        for (const o of counted)
          for (const k of ([] as K[]).concat(keyOf(o))) {
            const v = m.get(k) ?? { name: k, orders: 0, qty: 0, revenue: 0 };
            v.orders++;
            v.revenue = Math.round((v.revenue + total(o)) * 100) / 100;
            m.set(k, v);
          }
        return [...m.values()].sort((a, b) => b.revenue - a.revenue);
      };
      const prod = new Map<number, any>();
      const vari = new Map<number, any>();
      const cat = new Map<number, any>();
      for (const o of counted)
        for (const l of o.lines) {
          const p = products.find((x) => x.id === l.productId)!;
          const r = l.price * l.quantity;
          const pv = prod.get(p.id) ?? { id: p.id, name: p.name, qty: 0, revenue: 0, image_url: null };
          pv.qty += l.quantity;
          pv.revenue += r;
          prod.set(p.id, pv);
          if (l.variationId) {
            const vv = vari.get(l.variationId) ?? { id: l.variationId, product_id: p.id, sku: l.sku, name: l.name, label: l.meta.map((m) => m.value).join(' / '), qty: 0, revenue: 0 };
            vv.qty += l.quantity;
            vv.revenue += r;
            vari.set(l.variationId, vv);
          }
          for (const cid of p.categoryIds) {
            const cv = cat.get(cid) ?? { id: cid, name: cats.find((c) => c.id === cid)?.name ?? '', qty: 0, revenue: 0 };
            cv.qty += l.quantity;
            cv.revenue += r;
            cat.set(cid, cv);
          }
        }
      const sorted = (m: Map<number, any>, k = 'revenue') => [...m.values()].map((x) => ({ ...x, revenue: Math.round(x.revenue * 100) / 100 })).sort((a, b) => b[k] - a[k]);
      const firstOrder = new Map<string, Date>();
      for (const o of orders) {
        const e = o.customer[0];
        if (!firstOrder.has(e) || firstOrder.get(e)! > o.created) firstOrder.set(e, o.created);
      }
      const seen = new Set<string>();
      let nw = 0;
      let rt = 0;
      let nwR = 0;
      let rtR = 0;
      for (const o of counted) {
        const isNew = firstOrder.get(o.customer[0])! >= start.toJSDate();
        if (isNew) nwR += total(o);
        else rtR += total(o);
        if (seen.has(o.customer[0])) continue;
        seen.add(o.customer[0]);
        if (isNew) nw++;
        else rt++;
      }
      const sessions = Math.max(1, Math.round(counted.length / 0.021));
      const funnelCounts = [sessions, Math.round(sessions * 0.46), Math.round(sessions * 0.071), Math.round(sessions * 0.034), counted.length];
      return {
        range: { key: range, start: start.toISO()!, end: end.toISO()!, label: `${start.toFormat('dd/MM')} – ${end.minus({ days: 1 }).toFormat('dd/MM')}` },
        currency: 'USD',
        timezone: tz,
        byProduct: sorted(prod),
        byVariation: sorted(vari, 'qty'),
        byCategory: sorted(cat),
        byCountry: agg(() => 'Hoa Kỳ'),
        byState: agg((o) => o.customer[3]),
        byPayment: agg((o) => (o.status === 'on-hold' ? 'Chuyển khoản ngân hàng' : 'Thẻ tín dụng (Stripe)')),
        byStatus: (() => {
          const m = new Map<string, any>();
          for (const o of inR) {
            const v = m.get(o.status) ?? { status: o.status, name: o.status, orders: 0, revenue: 0 };
            v.orders++;
            v.revenue = Math.round((v.revenue + total(o)) * 100) / 100;
            m.set(o.status, v);
          }
          return [...m.values()].sort((a, b) => b.orders - a.orders);
        })(),
        coupons: [{ code: 'welcome10', orders: counted.filter((o) => o.discount).length, discount: counted.filter((o) => o.discount).length * 10 }],
        customers: { new: nw, returning: rt, newRevenue: Math.round(nwR * 100) / 100, returningRevenue: Math.round(rtR * 100) / 100 },
        attribution: {
          available: true,
          rows: [
            { name: 'google', orders: Math.round(counted.length * 0.38), revenue: 0 },
            { name: 'instagram', orders: Math.round(counted.length * 0.27), revenue: 0 },
            { name: 'Truy cập trực tiếp', orders: Math.round(counted.length * 0.22), revenue: 0 },
            { name: 'facebook', orders: Math.round(counted.length * 0.13), revenue: 0 },
          ].map((r) => ({ ...r, revenue: Math.round(r.orders * 112.4 * 100) / 100 })),
        },
        tracking: {
          enabled: true,
          sessions,
          pageviews: sessions * 3,
          mobileShare: 72.4,
          conversionRate: Math.round((counted.length / sessions) * 10000) / 100,
          ordersPerSession: Math.round((counted.length / sessions) * 10000) / 100,
          funnel: ['Phiên truy cập', 'Xem sản phẩm', 'Thêm vào giỏ', 'Tới trang thanh toán', 'Đặt hàng'].map((label, i) => ({
            key: String(i),
            label,
            count: funnelCounts[i],
            rate: Math.round((funnelCounts[i] / sessions) * 10000) / 100,
          })),
          sources: [
            { name: 'instagram', sessions: Math.round(sessions * 0.34), purchased: Math.round(counted.length * 0.27) },
            { name: 'google.com', sessions: Math.round(sessions * 0.29), purchased: Math.round(counted.length * 0.38) },
            { name: 'Trực tiếp', sessions: Math.round(sessions * 0.25), purchased: Math.round(counted.length * 0.22) },
            { name: 'facebook', sessions: Math.round(sessions * 0.12), purchased: Math.round(counted.length * 0.13) },
          ],
          landing: [
            { name: '/', sessions: Math.round(sessions * 0.41) },
            { name: '/product/tui-tote-da', sessions: Math.round(sessions * 0.22) },
            { name: '/product-category/giay-dep', sessions: Math.round(sessions * 0.14) },
          ],
        },
      };
    },
    async liveReport() {
      await delay(150);
      const n = DateTime.now().setZone(tz);
      const today = n.startOf('day');
      const yd = today.minus({ days: 1 });
      const sumBetween = (a: Date, b: Date) => {
        const os = orders.filter((o) => o.currency === 'USD' && o.created >= a && o.created < b && !['pending', 'failed', 'cancelled'].includes(o.status));
        return { orders: os.length, sales: Math.round(os.reduce((s, o) => s + total(o), 0) * 100) / 100 };
      };
      const cum = (start: DateTime, until: DateTime | null) => {
        const out: number[] = [];
        for (let h = 0; h < 24; h++) {
          if (until && start.plus({ hours: h }) > until) break;
          out.push(sumBetween(start.toJSDate(), start.plus({ hours: h + 1 }).toJSDate()).sales);
        }
        return out;
      };
      const wobble = Math.round(Math.sin(Date.now() / 20000) * 3);
      return {
        now: n.toISO()!,
        timezone: tz,
        currency: 'USD',
        today: sumBetween(today.toJSDate(), new Date()),
        yesterdaySameTime: sumBetween(yd.toJSDate(), n.minus({ days: 1 }).toJSDate()),
        ordersLast30Min: orders.filter((o) => o.created.getTime() > Date.now() - 30 * 60_000).length,
        checkoutsActive: 2,
        cumulativeToday: cum(today, n),
        cumulativeYesterday: cum(yd, null),
        recentOrders: orders
          .filter((o) => o.created >= today.toJSDate())
          .slice(0, 8)
          .map((o) => ({
            id: o.id,
            number: o.number,
            status: o.status,
            currency: o.currency,
            total: total(o),
            customer_name: `${o.customer[0]} ${o.customer[1]}`,
            item_count: o.lines.reduce((s, l) => s + l.quantity, 0),
            date_created_gmt: o.created.toISOString(),
            date_paid_gmt: o.paid?.toISOString() ?? null,
            state: o.customer[3],
            country: 'US',
          })),
        visitors: {
          enabled: true,
          activeNow: 14 + wobble,
          withCart: 4,
          inCheckout: 2,
          sessionsToday: 386,
          conversionToday: 1.81,
          topPages: [
            { name: '/', n: 5 },
            { name: '/product/tui-tote-da', n: 4 },
            { name: '/cart', n: 2 },
          ],
        },
      };
    },
    trackerInfo: async () => ({ endpoint: 'https://demo.example/t/0', token: 'demo-token', lastEventAt: new Date().toISOString(), sessions: 386 }),
    settingGroups: async () => (await delay(), groups),
    settingGroup: async (id) => {
      await delay();
      if (!settings[id]) throw new ApiError('not_found', 'Không có nhóm cài đặt này');
      return settings[id].map((x) => ({ ...x }));
    },
    async updateSettings(group, updates) {
      await delay(400);
      const g = settings[group];
      for (const u of updates) {
        const x = g.find((y) => y.id === u.id);
        if (!x) throw new ApiError('validation', `Không có cài đặt ${u.id}`, 422);
        if (x.type === 'number' && !/^-?\d+(\.\d+)?$/.test(String(u.value))) throw new ApiError('validation', `${x.label}: phải là số`, 422);
        x.value = u.value;
      }
      return g.filter((x) => updates.some((u) => u.id === x.id)).map((x) => ({ ...x }));
    },
    paymentGateways: async () => (await delay(), gateways.map((g) => ({ ...g, settings: g.settings.map((x) => ({ ...x })) }))),
    async updatePaymentGateway(id, body) {
      await delay(400);
      const g = gateways.find((x) => x.id === id)!;
      if (body.enabled !== undefined) g.enabled = body.enabled;
      if (body.settings) {
        apply(g.settings, body.settings);
        if (typeof body.settings.title === 'string') g.title = body.settings.title;
      }
      return { ...g, settings: g.settings.map((x) => ({ ...x })) };
    },
    shippingZones: async () => (await delay(), JSON.parse(JSON.stringify(zones))),
    async updateShippingMethod(zoneId, instanceId, body) {
      await delay(400);
      const m = zones.find((z) => z.id === zoneId)!.methods.find((x) => x.instanceId === instanceId)!;
      if (body.enabled !== undefined) m.enabled = body.enabled;
      if (body.settings) {
        apply(m.settings, body.settings);
        if (typeof body.settings.title === 'string') m.title = body.settings.title;
      }
      return JSON.parse(JSON.stringify(m));
    },
    async listCoupons(q) {
      await delay();
      const items = coupons.filter((c) => !q || c.code.includes(q.toLowerCase()));
      return { items: items.map((c) => ({ ...c })), page: 1, hasMore: false };
    },
    getCoupon: async (id) => {
      const c = coupons.find((x) => x.id === id);
      if (!c) throw new ApiError('not_found', 'Không tìm thấy mã');
      return { ...c };
    },
    async saveCoupon(id, input) {
      await delay(400);
      if (input.amount !== undefined && !/^\d+(\.\d{1,4})?$/.test(input.amount)) throw new ApiError('validation', 'Giá trị giảm không hợp lệ', 400);
      if (!id) {
        const code = (input.code ?? '').trim().toLowerCase();
        if (!code) throw new ApiError('validation', 'Nhập mã giảm giá', 400);
        if (coupons.some((c) => c.code === code)) throw new ApiError('conflict', 'Mã giảm giá đã tồn tại.', 409, 'duplicate_code');
        const c: Coupon = { id: ++couponId, code, status: input.status ?? 'publish', discountType: input.discountType ?? 'percent', amount: input.amount ?? '0', description: input.description ?? '', dateExpires: input.dateExpires ?? null, usageCount: 0, usageLimit: input.usageLimit ?? null, usageLimitPerUser: input.usageLimitPerUser ?? null, minimumAmount: input.minimumAmount ?? '', individualUse: !!input.individualUse, freeShipping: !!input.freeShipping };
        coupons.unshift(c);
        return { ...c };
      }
      const c = coupons.find((x) => x.id === id)!;
      Object.assign(c, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), input.code ? { code: input.code.toLowerCase() } : {});
      return { ...c };
    },
    async deleteCoupon(id) {
      await delay(300);
      const i = coupons.findIndex((x) => x.id === id);
      if (i >= 0) coupons.splice(i, 1);
    },
    async listCustomers(q) {
      await delay();
      const t = q?.toLowerCase();
      return { items: customers().filter((c) => !t || `${c.name} ${c.email}`.toLowerCase().includes(t)), page: 1, hasMore: false };
    },
    async getCustomer(id) {
      await delay();
      const c = customers().find((x) => x.id === id);
      if (!c) throw new ApiError('not_found', 'Không tìm thấy khách');
      const os = orders.filter((o) => `${o.customer[0].toLowerCase()}@example.com` === c.email);
      return {
        ...c,
        orders: os.map((o) => ({ id: o.id, number: o.number, status: o.status, currency: o.currency, total: total(o), customer_name: c.name, item_count: o.lines.length, date_created_gmt: o.created.toISOString(), date_paid_gmt: o.paid?.toISOString() ?? null })),
      };
    },
    async updateCustomer(id, body) {
      await delay(400);
      const prev = customers().find((x) => x.id === id)!;
      const e = customerEdits.get(id) ?? {};
      if (body.firstName !== undefined) e.firstName = body.firstName;
      if (body.lastName !== undefined) e.lastName = body.lastName;
      if (body.email !== undefined) e.email = body.email;
      if (body.billing) e.billing = { ...prev.billing, ...body.billing };
      if (body.shipping) e.shipping = { ...prev.shipping, ...body.shipping };
      e.name = `${e.firstName ?? prev.firstName} ${e.lastName ?? prev.lastName}`.trim();
      customerEdits.set(id, e);
      return this.getCustomer(id);
    },
    async updateProductInfo(id, patch) {
      await delay(400);
      const p = products.find((x) => x.id === id);
      if (!p) throw new ApiError('not_found', 'Không tìm thấy sản phẩm');
      if (patch.expectedModified && patch.expectedModified !== p.dateModified) throw new ApiError('conflict', 'Sản phẩm vừa được sửa.', 409, 'conflict');
      if (patch.name !== undefined) p.name = patch.name;
      if (patch.sku !== undefined) p.sku = patch.sku;
      if (patch.shortDescription !== undefined) p.shortDescription = patch.shortDescription;
      if (patch.description !== undefined) p.description = patch.description;
      if (patch.status) p.status = patch.status;
      if (patch.featured !== undefined) p.featured = patch.featured;
      if (patch.catalogVisibility) p.catalogVisibility = patch.catalogVisibility;
      if (patch.categoryIds) {
        p.categoryIds = patch.categoryIds;
        p.categories = cats.filter((c) => patch.categoryIds!.includes(c.id)).map((c) => ({ id: c.id, name: c.name }));
      }
      p.dateModified = new Date().toISOString().replace(/\.\d+Z$/, '');
      const { categoryIds: _c, ...out } = p;
      return { product: out };
    },
  };
}
