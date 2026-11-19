import { DateTime } from 'luxon';
import { aggregate, computeRange, type DemoAggOrder } from '../lib/analytics';
import { STATUS_LABELS } from '../lib/format';
import { ApiError } from './client';
import { createDemoStore } from './demoStore';
import type {
  StoreApi,
  Api,
  Category,
  CheckResult,
  DeviceInfo,
  NotificationItem,
  OrderDetail,
  OrderNote,
  Product,
  ProductSummary,
  ShopInfo,
} from './types';

/**
 * Chế độ demo: dữ liệu túi xách / giày / phụ kiện nằm hoàn toàn trong bộ nhớ của app.
 * Không gọi mạng, không chạm vào kết nối shop thật. Mọi thay đổi mất khi thoát demo.
 */

const TZ = 'America/New_York';
const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, '');

// PRNG cố định để dữ liệu demo ổn định giữa các lần mở
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export interface DemoProduct extends Product {
  categoryIds: number[];
}

const CATS: Category[] = [
  { id: 1, name: 'Túi xách', parent: 0, count: 2 },
  { id: 2, name: 'Giày dép', parent: 0, count: 2 },
  { id: 3, name: 'Phụ kiện', parent: 0, count: 3 },
];

function baseProduct(p: Partial<DemoProduct> & { id: number; name: string; type: string }): DemoProduct {
  return {
    parentId: 0,
    variationLabel: '',
    attributes: [],
    sku: '',
    status: 'publish',
    price: '',
    regularPrice: '',
    salePrice: '',
    manageStock: 'false',
    stockMode: 'status_only',
    stockQuantity: null,
    parentStockQuantity: null,
    stockStatus: 'instock',
    lowStockAmount: 2,
    imageUrl: null,
    images: [],
    categories: [],
    shortDescription: '',
    dateModified: iso(new Date(Date.now() - 86400_000 * 3)),
    permalink: null,
    adminUrl: 'https://demo.example/wp-admin/post.php?post=' + p.id + '&action=edit',
    categoryIds: [],
    ...p,
  };
}

function buildCatalog() {
  const products: DemoProduct[] = [];
  const variations: DemoProduct[] = [];
  const cat = (id: number) => CATS.filter((c) => c.id === id).map((c) => ({ id: c.id, name: c.name }));
  const variable = (id: number, name: string, sku: string, catId: number, price: string, attr: string, opts: [string, string, number | null][], parentStock: number | null) => {
    const parentManaged = parentStock !== null;
    products.push(
      baseProduct({ id, name, type: 'variable', sku, price, categoryIds: [catId], categories: cat(catId), manageStock: parentManaged ? 'true' : 'false', stockMode: parentManaged ? 'product' : 'status_only', stockQuantity: parentStock }),
    );
    opts.forEach(([option, vsku, qty], i) => {
      const own = qty !== null;
      variations.push(
        baseProduct({
          id: id * 10 + i + 1,
          parentId: id,
          name,
          type: 'variation',
          sku: vsku,
          variationLabel: option,
          attributes: [{ name: attr, option, options: null }],
          price,
          regularPrice: price,
          manageStock: own ? 'true' : 'parent',
          stockMode: own ? 'product' : 'parent',
          stockQuantity: own ? qty : parentStock,
          parentStockQuantity: own ? null : parentStock,
          stockStatus: (own ? qty : parentStock)! > 0 ? 'instock' : 'outofstock',
          categoryIds: [catId],
        }),
      );
    });
  };
  variable(101, 'Túi tote da', 'TOTE', 1, '119.00', 'Màu', [['Đen', 'TOTE-BLK', 5], ['Nâu', 'TOTE-BRN', 1], ['Kem', 'TOTE-CRM', 0]], null);
  variable(102, 'Túi đeo chéo mini', 'XB-MINI', 1, '79.00', 'Màu', [['Đỏ', 'XB-MINI-RED', 7], ['Đen', 'XB-MINI-BLK', 4]], null);
  variable(103, 'Giày loafer da', 'LOAF', 2, '89.00', 'Size', [['37', 'LOAF-37', null], ['38', 'LOAF-38', null], ['39', 'LOAF-39', null], ['40', 'LOAF-40', null]], 12);
  variable(104, 'Sneaker trắng', 'SNK-WHT', 2, '99.00', 'Size', [['US 6', 'SNK-WHT-6', 3], ['US 7', 'SNK-WHT-7', 2], ['US 8', 'SNK-WHT-8', 6], ['US 9', 'SNK-WHT-9', 0]], null);
  products.push(baseProduct({ id: 105, name: 'Ví mini', type: 'simple', sku: 'WAL-MINI', price: '20.00', regularPrice: '20.00', categoryIds: [3], categories: cat(3) }));
  products.push(
    baseProduct({ id: 106, name: 'Khăn lụa họa tiết', type: 'simple', sku: 'SCARF-SILK', price: '35.00', regularPrice: '35.00', manageStock: 'true', stockMode: 'product', stockQuantity: 2, categoryIds: [3], categories: cat(3) }),
  );
  products.push(
    baseProduct({ id: 107, name: 'Kính mát gọng tròn', type: 'simple', sku: 'SUN-RND', price: '45.00', regularPrice: '45.00', manageStock: 'true', stockMode: 'product', stockQuantity: 0, stockStatus: 'outofstock', categoryIds: [3], categories: cat(3) }),
  );
  return { products, variations };
}

const CUSTOMERS = [
  ['Emily', 'Carter', 'Austin', 'TX', '78701'],
  ['Jessica', 'Nguyen', 'San Jose', 'CA', '95112'],
  ['Ashley', 'Brooks', 'Brooklyn', 'NY', '11201'],
  ['Sarah', 'Kim', 'Seattle', 'WA', '98101'],
  ['Megan', 'Lopez', 'Miami', 'FL', '33130'],
  ['Olivia', 'Turner', 'Denver', 'CO', '80202'],
  ['Hannah', 'Patel', 'Chicago', 'IL', '60601'],
  ['Lauren', 'Reed', 'Portland', 'OR', '97205'],
];

export interface DemoOrder {
  id: number;
  number: string;
  status: string;
  currency: string;
  created: Date;
  paid: Date | null;
  modified: Date;
  customer: string[];
  lines: { id: number; productId: number; variationId: number; name: string; sku: string; quantity: number; price: number; meta: { key: string; value: string }[] }[];
  shipping: number;
  tax: number;
  discount: number;
  refunds: { id: number; amount: number; reason: string; date: Date }[];
  notes: OrderNote[];
  tracking: OrderDetail['tracking'];
  customerNote: string;
}

function buildOrders(products: DemoProduct[], variations: DemoProduct[]): DemoOrder[] {
  const rand = rng(42);
  const now = Date.now();
  const sellables = [...products.filter((p) => p.type === 'simple'), ...variations];
  const orders: DemoOrder[] = [];
  let num = 10380;
  const nowNY = DateTime.now().setZone(TZ);
  for (let i = 0; i < 64; i++) {
    const ageH = i < 6 ? [0.2, 0.9, 2.5, 4, 7, 9][i] : 10 + i * 12 + rand() * 8;
    let created = new Date(now - ageH * 3600_000);
    if (i === 10) created = nowNY.minus({ days: 1 }).set({ hour: 23, minute: 58, second: 40 }).toJSDate(); // sát nửa đêm giờ shop
    const n = 1 + Math.floor(rand() * 2);
    const lines = Array.from({ length: n }, (_, k) => {
      const s = sellables[Math.floor(rand() * sellables.length)];
      const parent = products.find((p) => p.id === s.parentId);
      return {
        id: (i + 1) * 100 + k,
        productId: s.parentId || s.id,
        variationId: s.parentId ? s.id : 0,
        name: parent ? `${parent.name} - ${s.variationLabel}` : s.name,
        sku: s.sku,
        quantity: rand() > 0.85 ? 2 : 1,
        price: Number(s.price),
        meta: parent ? s.attributes.map((a) => ({ key: a.name, value: a.option ?? '' })) : [],
      };
    });
    const status =
      i === 0 ? 'pending' : i < 4 ? 'processing' : i === 5 ? 'on-hold' : i < 12 ? (rand() > 0.3 ? 'processing' : 'completed') : rand() > 0.93 ? 'cancelled' : rand() > 0.96 ? 'refunded' : 'completed';
    const paid = ['processing', 'completed', 'refunded'].includes(status) ? new Date(created.getTime() + 60_000) : null;
    const c = CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)];
    const o: DemoOrder = {
      id: 5000 + i,
      number: String(num + 64 - i),
      status,
      currency: i === 20 || i === 33 ? 'CAD' : 'USD',
      created,
      paid,
      modified: created,
      customer: c,
      lines,
      shipping: rand() > 0.5 ? 0 : 8.95,
      tax: 0,
      discount: rand() > 0.85 ? 10 : 0,
      refunds: [],
      notes: [],
      tracking: null,
      customerNote: i === 2 ? 'Vui lòng gói quà giúp mình.' : '',
    };
    if (status === 'completed' && rand() > 0.5) {
      o.tracking = [{ provider: 'USPS', number: `9400 1000 0000 ${1000 + i}`, link: 'https://tools.usps.com/go/TrackConfirmAction', dateShipped: iso(new Date(created.getTime() + 86400_000)) }];
      if (i % 7 === 0) o.tracking.push({ provider: 'UPS', number: `1Z999AA1012345${i}`, link: null, dateShipped: o.tracking[0].dateShipped });
    }
    if (i === 14) o.refunds.push({ id: 9001, amount: 30, reason: 'Hoàn một phần — trầy nhẹ', date: new Date(now - 2 * 3600_000) });
    if (status === 'refunded') o.refunds.push({ id: 9100 + i, amount: total(o), reason: 'Khách trả hàng', date: new Date(created.getTime() + 3 * 86400_000) });
    num--;
    orders.push(o);
  }
  return orders;
}

function subtotal(o: DemoOrder) {
  return o.lines.reduce((s, l) => s + l.price * l.quantity, 0);
}
function total(o: DemoOrder) {
  return Math.round((subtotal(o) - o.discount + o.shipping + o.tax) * 100) / 100;
}

const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;

export function createDemoApi(hooks: { localNotify?: (title: string, body: string, data: Record<string, unknown>) => Promise<void> } = {}): Api {
  const { products, variations } = buildCatalog();
  const orders = buildOrders(products, variations);
  const notifications: NotificationItem[] = orders.slice(0, 5).map((o, i) => ({
    id: 100 - i,
    kind: 'order.placed',
    order_id: o.id,
    title: `Đơn mới #${o.number} · ${total(o).toFixed(2).replace('.', ',')} ${o.currency}`,
    body: `${o.lines.reduce((s, l) => s + l.quantity, 0)} sản phẩm · ${o.paid ? 'Đã thanh toán' : statusLabel(o.status)}`,
    data: { type: 'order', orderId: o.id, url: `wooadmin://orders/${o.id}` },
    created_at: o.created.toISOString(),
    read_at: i > 1 ? o.created.toISOString() : null,
    deliveries: [{ status: 'delivered', error: null }],
  }));
  let device: DeviceInfo | null = null;
  const lastWebhook = new Date(Date.now() - 12 * 60_000).toISOString();

  const shop: ShopInfo = {
    id: 0,
    name: 'Maison Demo (Dữ liệu demo)',
    url: 'https://demo.example',
    timezone: TZ,
    currency: 'USD',
    priceDecimals: 2,
    wcVersion: '9.4.0',
    hposEnabled: true,
    astEnabled: true,
    manageStockEnabled: true,
    lowStockAmount: 2,
    lastWebhookAt: lastWebhook,
    lastWebhookTopic: 'order.created',
    lastCheck: null,
    lastCheckAt: null,
    adminUrl: 'https://demo.example/wp-admin/',
  };

  const summary = (o: DemoOrder) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    currency: o.currency,
    total: total(o),
    customer_name: `${o.customer[0]} ${o.customer[1]}`,
    billing_email: `${o.customer[0].toLowerCase()}@example.com`,
    item_count: o.lines.reduce((s, l) => s + l.quantity, 0),
    date_created_gmt: o.created.toISOString(),
    date_paid_gmt: o.paid?.toISOString() ?? null,
    paid: !!o.paid,
  });

  const detail = (o: DemoOrder): OrderDetail => ({
    id: o.id,
    number: o.number,
    status: o.status,
    statusLabel: statusLabel(o.status),
    paid: !!o.paid,
    currency: o.currency,
    dateCreated: o.created.toISOString(),
    datePaid: o.paid?.toISOString() ?? null,
    dateModified: iso(o.modified),
    paymentMethod: o.status === 'on-hold' ? 'Chuyển khoản ngân hàng' : 'Thẻ tín dụng (Stripe)',
    transactionId: o.paid ? `pi_demo_${o.id}` : null,
    customerNote: o.customerNote,
    customer: { name: `${o.customer[0]} ${o.customer[1]}`, email: `${o.customer[0].toLowerCase()}@example.com`, phone: '+1 (555) 010-2200' },
    shippingAddress: {
      lines: [`${o.customer[0]} ${o.customer[1]}`, `${100 + (o.id % 900)} Market Street`, 'Apt 4B', `${o.customer[2]}, ${o.customer[3]} ${o.customer[4]}`, 'US'],
      isBilling: false,
      phone: '+1 (555) 010-2200',
    },
    items: o.lines.map((l) => ({
      id: l.id,
      name: l.name,
      sku: l.sku,
      productId: l.productId,
      variationId: l.variationId,
      quantity: l.quantity,
      unitPrice: l.price,
      subtotal: l.price * l.quantity,
      total: l.price * l.quantity,
      imageUrl: null,
      meta: l.meta,
    })),
    totals: {
      subtotal: subtotal(o),
      discount: o.discount,
      shipping: o.shipping,
      shippingMethods: [o.shipping ? 'USPS Priority Mail' : 'Miễn phí vận chuyển'],
      fees: [],
      tax: o.tax,
      total: total(o),
      refunded: o.refunds.reduce((s, r) => s + r.amount, 0),
      coupons: o.discount ? ['WELCOME10'] : [],
    },
    refunds: o.refunds.map((r) => ({ id: r.id, reason: r.reason, amount: r.amount })),
    notes: o.notes,
    tracking: o.tracking ?? [],
    trackingSupported: true,
    adminUrl: `https://demo.example/wp-admin/admin.php?page=wc-orders&action=edit&id=${o.id}`,
    stale: false,
    fetchedAt: new Date().toISOString(),
  });

  const findOrder = (id: number) => {
    const o = orders.find((x) => x.id === id);
    if (!o) throw new ApiError('not_found', 'Không tìm thấy đơn');
    return o;
  };
  const findProduct = (id: number) => {
    const p = products.find((x) => x.id === id);
    if (!p) throw new ApiError('not_found', 'Không tìm thấy sản phẩm');
    return p;
  };
  const strip = ({ categoryIds: _c, ...p }: DemoProduct): Product => p;
  const touch = (p: DemoProduct) => (p.dateModified = iso(new Date()));

  const productSummary = (p: DemoProduct, q?: string): ProductSummary => {
    const vars = variations.filter((v) => v.parentId === p.id);
    const prices = vars.map((v) => Number(v.price)).filter((n) => n > 0);
    const match = q ? vars.find((v) => v.sku.toLowerCase().includes(q)) : undefined;
    return {
      id: p.id,
      type: p.type,
      name: p.name,
      sku: p.sku,
      status: p.status,
      price: p.price,
      regular_price: p.regularPrice,
      sale_price: p.salePrice,
      manage_stock: p.manageStock,
      stock_quantity: p.stockQuantity,
      stock_status: p.stockStatus,
      image_url: p.imageUrl,
      variation_count: vars.length,
      variation_summary: vars.length
        ? { min: Math.min(...prices), max: Math.max(...prices), stock: vars.reduce((s, v) => s + (v.stockQuantity ?? 0), 0), out: vars.filter((v) => v.stockStatus === 'outofstock').length }
        : null,
      matched_variation: match ? { id: match.id, sku: match.sku, label: match.variationLabel } : null,
    };
  };

  const stockMatch = (p: DemoProduct, f: string) => {
    const test = (x: DemoProduct) =>
      f === 'outofstock' ? x.stockStatus === 'outofstock' : f === 'low' ? x.stockQuantity !== null && x.stockQuantity > 0 && x.stockQuantity <= x.lowStockAmount : x.stockStatus !== 'outofstock';
    return p.type === 'variable' ? variations.filter((v) => v.parentId === p.id).some(test) : test(p);
  };

  const check: CheckResult = {
    ok: true,
    steps: [
      { key: 'url', label: 'URL website', ok: true, level: 'ok', message: 'Dữ liệu demo — không kết nối website thật.' },
      { key: 'auth', label: 'Xác thực API key', ok: true, level: 'ok', message: 'Demo' },
      { key: 'read', label: 'Quyền đọc', ok: true, level: 'ok', message: 'Demo' },
      { key: 'write', label: 'Quyền ghi', ok: true, level: 'ok', message: 'Demo (chỉ lưu trong bộ nhớ app)' },
      { key: 'webhooks', label: 'Webhook trên WooCommerce', ok: true, level: 'ok', message: 'Demo' },
      { key: 'webhook_delivery', label: 'Backend nhận webhook', ok: true, level: 'ok', message: `Demo — webhook gần nhất ${lastWebhook}` },
    ],
  };

  const base: Omit<Api, keyof StoreApi> = {
    mode: 'demo' as const,
    logout: async () => undefined,
    getShop: async () => ({
      connected: true,
      shop,
      sync: {
        orders: { status: 'done', phase: 'history', synced: orders.length, total: orders.length, completeFrom: null, error: null, lastReconcileAt: new Date().toISOString() },
        products: { status: 'done', synced: products.length, total: products.length, error: null },
        lastSyncAt: new Date().toISOString(),
      },
    }),
    testConnection: async () => check,
    connectShop: async () => {
      throw new ApiError('validation', 'Đang ở chế độ demo. Đăng xuất demo và đăng nhập backend để kết nối shop thật.');
    },
    checkConnection: async () => (await delay(), check),
    ensureWebhooks: async () => ({ created: [], updated: [], check }),
    syncNow: async () => {
      await delay();
    },
    async getDashboard(range, from, to) {
      await delay();
      const r = computeRange(range, TZ, new Date(), from, to);
      const agg: DemoAggOrder[] = orders.map((o) => ({
        id: o.id,
        status: o.status,
        currency: o.currency,
        itemsSubtotal: subtotal(o),
        discount: o.discount,
        shipping: o.shipping,
        tax: o.tax,
        created: o.created,
        paid: o.paid,
        lines: o.lines.map((l) => ({ productId: l.productId, name: findProduct(l.productId).name, quantity: l.quantity, total: l.price * l.quantity })),
      }));
      const refunds = orders.flatMap((o) => o.refunds.map((x) => ({ orderId: o.id, amount: x.amount, date: x.date })));
      const cur = aggregate(agg, refunds, r.start, r.end, r.granularity, TZ);
      const prev = aggregate(agg, refunds, r.prevStart, r.start, r.granularity, TZ);
      const sorted = cur.sort((a, b) => (a.currency === 'USD' ? -1 : b.currency === 'USD' ? 1 : 0));
      if (sorted.length === 0) sorted.push(aggregate([{ ...agg[0], created: new Date(0) }], [], r.start, r.end, r.granularity, TZ)[0]);
      return {
        range: {
          key: range,
          start: r.start.toISO()!,
          end: r.end.toISO()!,
          granularity: r.granularity,
          label: r.start.toFormat('dd/MM/yyyy') + (Math.round(r.end.diff(r.start, 'days').days) > 1 ? ` – ${r.end.minus({ days: 1 }).toFormat('dd/MM/yyyy')}` : ''),
        },
        timezone: TZ,
        timezoneOffset: r.start.toFormat('ZZ'),
        primaryCurrency: 'USD',
        currencies: sorted.map((m) => {
          const p = prev.find((x) => x.currency === m.currency);
          return { ...m, previous: p ? { ...p } : null } as any;
        }),
        needsProcessing: orders.filter((o) => o.status === 'processing').length,
        onHold: orders.filter((o) => o.status === 'on-hold').length,
        pendingPayment: orders.filter((o) => o.status === 'pending').length,
        recentOrders: orders.slice(0, 5).map(summary),
        coverage: { complete: true, completeFrom: null, syncing: false, synced: orders.length, total: orders.length },
        lastSyncAt: new Date().toISOString(),
        definitions: DEFINITIONS,
      };
    },
    async listOrders(p) {
      await delay();
      let list = [...orders];
      if (p.status && p.status !== 'any') list = list.filter((o) => p.status!.split(',').includes(o.status));
      if (p.q) {
        const t = p.q.toLowerCase().replace(/^#/, '');
        list = list.filter((o) => [o.number, o.customer[0], o.customer[1], `${o.customer[0].toLowerCase()}@example.com`].join(' ').toLowerCase().includes(t));
      }
      if (p.from) list = list.filter((o) => o.created >= new Date(p.from!));
      if (p.to) list = list.filter((o) => o.created < new Date(p.to!));
      const page = p.page ?? 1;
      const per = 20;
      return { items: list.slice((page - 1) * per, page * per).map(summary), page, hasMore: list.length > page * per, lastSyncAt: new Date().toISOString() };
    },
    orderStatuses: async () =>
      ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'].map((slug) => ({ slug, label: statusLabel(slug), count: orders.filter((o) => o.status === slug).length })),
    getOrder: async (id) => (await delay(), detail(findOrder(id))),
    async updateOrderStatus(id, status, expected) {
      await delay(400);
      const o = findOrder(id);
      if (o.status !== expected) throw new ApiError('conflict', `Trạng thái đã đổi thành “${statusLabel(o.status)}”.`, 409, 'conflict', { current: detail(o) });
      o.status = status;
      o.modified = new Date();
      if (['processing', 'completed'].includes(status) && !o.paid) o.paid = new Date();
      o.notes.unshift({ id: Date.now(), note: `Trạng thái đơn đổi từ ${statusLabel(expected)} sang ${statusLabel(status)}.`, author: 'system', customerNote: false, date: new Date().toISOString() });
      return detail(o);
    },
    async addOrderNote(id, note, customer) {
      await delay(400);
      const n = { id: Date.now(), note, author: 'Chủ shop', customerNote: customer, date: new Date().toISOString() };
      findOrder(id).notes.unshift(n);
      return n;
    },
    async listProducts(p) {
      await delay();
      const q = p.q?.toLowerCase().trim();
      let list = products.filter((x) => x.status !== 'trash');
      if (q) list = list.filter((x) => x.name.toLowerCase().includes(q) || x.sku.toLowerCase().includes(q) || variations.some((v) => v.parentId === x.id && v.sku.toLowerCase().includes(q)));
      if (p.category) list = list.filter((x) => x.categoryIds.includes(p.category!));
      if (p.stock) list = list.filter((x) => stockMatch(x, p.stock!));
      list.sort((a, b) => b.dateModified.localeCompare(a.dateModified));
      return { items: list.map((x) => productSummary(x, q)), page: 1, hasMore: false, lastSyncAt: new Date().toISOString() };
    },
    categories: async () => CATS,
    async getProduct(id) {
      await delay();
      const p = findProduct(id);
      return { product: strip(p), variations: variations.filter((v) => v.parentId === id).map(strip), stale: false, fetchedAt: new Date().toISOString() };
    },
    async updateProduct(pid, vid, patch) {
      await delay(500);
      const parent = findProduct(pid);
      const target = vid ? variations.find((v) => v.id === vid && v.parentId === pid) : parent;
      if (!target) throw new ApiError('not_found', 'Không tìm thấy');
      if (!patch.force && patch.expectedModified && patch.expectedModified !== target.dateModified) {
        throw new ApiError('conflict', 'Dữ liệu vừa được sửa trên website.', 409, 'conflict', { current: strip(target) });
      }
      if (patch.salePrice && Number(patch.salePrice) >= Number(patch.regularPrice ?? target.regularPrice)) {
        throw new ApiError('validation', 'Giá khuyến mãi phải thấp hơn giá thường', 400);
      }
      const changed: Product[] = [];
      if (patch.regularPrice !== undefined) target.regularPrice = patch.regularPrice;
      if (patch.salePrice !== undefined) target.salePrice = patch.salePrice;
      target.price = target.salePrice || target.regularPrice;
      if (patch.stockQuantity !== undefined) {
        if (target.stockMode === 'parent') {
          parent.stockQuantity = patch.stockQuantity;
          parent.stockStatus = patch.stockQuantity > 0 ? 'instock' : 'outofstock';
          touch(parent);
          for (const v of variations.filter((x) => x.parentId === pid && x.stockMode === 'parent')) {
            v.stockQuantity = patch.stockQuantity;
            v.parentStockQuantity = patch.stockQuantity;
            v.stockStatus = parent.stockStatus;
          }
          changed.push(strip(parent));
        } else if (target.stockMode === 'product') {
          target.stockQuantity = patch.stockQuantity;
          target.stockStatus = patch.stockQuantity > 0 ? 'instock' : 'outofstock';
        } else throw new ApiError('validation', 'Sản phẩm chỉ theo dõi còn/hết hàng', 400);
      }
      if (patch.stockStatus) target.stockStatus = patch.stockStatus;
      touch(target);
      changed.push(strip(target));
      return { item: strip(target), changed };
    },
    async createProduct(input) {
      await delay(600);
      if (input.sku && [...products, ...variations].some((p) => p.sku === input.sku)) throw new ApiError('conflict', 'SKU đã tồn tại trên website.', 409, 'duplicate_sku');
      const p = baseProduct({
        id: 200 + products.length,
        name: input.name,
        type: 'simple',
        status: 'draft',
        sku: input.sku ?? '',
        price: input.regularPrice ?? '',
        regularPrice: input.regularPrice ?? '',
        salePrice: input.salePrice ?? '',
        shortDescription: input.shortDescription ?? '',
        manageStock: input.manageStock ? 'true' : 'false',
        stockMode: input.manageStock ? 'product' : 'status_only',
        stockQuantity: input.manageStock ? (input.stockQuantity ?? 0) : null,
        categoryIds: input.categoryIds ?? [],
        categories: CATS.filter((c) => input.categoryIds?.includes(c.id)).map((c) => ({ id: c.id, name: c.name })),
        dateModified: iso(new Date()),
      });
      products.unshift(p);
      return { product: strip(p) };
    },
    async publishProduct(id) {
      await delay(400);
      const p = findProduct(id);
      p.status = 'publish';
      touch(p);
      return { product: strip(p) };
    },
    uploadImage: async (uri) => ({ id: 'demo', url: uri }),
    async registerDevice(input) {
      device = {
        id: 'demo-device',
        installationId: input.installationId,
        platform: input.platform,
        name: input.name ?? '',
        hasPushToken: !!input.pushToken,
        pushTokenPreview: input.pushToken ? input.pushToken.slice(0, 22) + '…' : null,
        permission: input.permission,
        active: true,
        inactiveReason: null,
        prefs: device?.prefs ?? { notifyNewOrder: true, notifyPaid: false, hideAmount: false, sound: 'kaching' },
        lastRegisteredAt: new Date().toISOString(),
        lastPushAt: null,
        lastPushStatus: null,
        lastPushError: null,
      };
      return device;
    },
    getDevice: async () => device,
    async updateDevicePrefs(_i, prefs) {
      if (!device) throw new ApiError('not_found', 'Thiết bị chưa đăng ký');
      device.prefs = { ...device.prefs, ...prefs };
      return device;
    },
    unregisterDevice: async () => {
      device = null;
    },
    listNotifications: async () => ({ items: notifications, hasMore: false, unread: notifications.filter((n) => !n.read_at).length }),
    async markNotificationsRead(b) {
      for (const n of notifications) if (b.all || b.ids?.includes(n.id)) n.read_at = new Date().toISOString();
    },
    async sendTestNotification() {
      // Demo: dùng thông báo cục bộ (không qua backend/APNs/FCM) để thử thao tác chạm mở đơn
      const o = orders[0];
      const item: NotificationItem = {
        id: Date.now(),
        kind: 'test',
        order_id: o.id,
        title: `Đơn mới #${o.number} · ${total(o).toFixed(2).replace('.', ',')} USD`,
        body: '(Demo) Chạm để mở đơn',
        data: { type: 'order', orderId: o.id, url: `wooadmin://orders/${o.id}` },
        created_at: new Date().toISOString(),
        read_at: null,
        deliveries: [{ status: 'local', error: null }],
      };
      notifications.unshift(item);
      if (hooks.localNotify) await hooks.localNotify(item.title, item.body, item.data);
      return { sent: hooks.localNotify ? 1 : 0, errors: [] };
    },
    diagnostics: async () => ({
      device,
      shopConnected: true,
      lastWebhookAt: lastWebhook,
      lastWebhookTopic: 'order.created',
      lastBadSignatureAt: null,
      lastOrderWebhook: { topic: 'order.created', resource_id: orders[0].id, received_at: lastWebhook, status: 'processed' },
      lastEvent: { type: 'order.placed', order_id: orders[0].id, number: orders[0].number, created_at: lastWebhook, suppressed: false, suppressed_reason: null },
      lastOrderPush: { title: notifications[0]?.title ?? '', kind: 'order.placed', created_at: lastWebhook, status: 'delivered', error: null },
      lastTestPush: null,
      expoAccessTokenConfigured: false,
    }),
  };
  return { ...base, ...createDemoStore({ orders, products, variations, cats: CATS, total, tz: TZ }) };
}

export const DEFINITIONS = [
  { term: 'Doanh thu (Tổng doanh thu)', text: 'Doanh thu thuần + phí vận chuyển + thuế. Tương ứng “Total sales” của WooCommerce Analytics.' },
  { term: 'Doanh thu thuần', text: 'Tổng tiền hàng trước giảm giá − mã giảm giá − hoàn tiền. Tương ứng “Net sales”.' },
  { term: 'Hoàn tiền', text: 'Ghi nhận vào ngày hoàn tiền (không phải ngày đặt đơn), kể cả hoàn một phần. Có thể làm doanh thu một ngày âm.' },
  { term: 'Phí vận chuyển & thuế', text: 'Cộng vào Tổng doanh thu, không tính vào doanh thu thuần.' },
  { term: 'Đơn được tính', text: 'Đơn tạo trong kỳ theo múi giờ website, trừ Chờ thanh toán, Thất bại, Đã hủy và bản nháp.' },
  { term: 'Đơn mới', text: 'Mọi đơn khách đã gửi trong kỳ, kể cả đang chờ thanh toán. Không gồm bản nháp thanh toán.' },
  { term: 'Cần xử lý', text: 'Số đơn “Đang xử lý” hiện tại (đã thanh toán, chờ giao), không phụ thuộc bộ lọc ngày.' },
  { term: 'Giá trị đơn trung bình', text: 'Doanh thu thuần ÷ số đơn được tính.' },
];
