/**
 * Máy chủ WooCommerce giả lập (REST /wc/v3 + WP index + AST) cho test tích hợp và chạy thử cục bộ.
 * Hành vi bám theo WooCommerce thật ở những điểm backend phụ thuộc: Basic auth, quyền read/write,
 * X-WP-Total(Pages), before/modified_after (GMT), date_modified_gmt tăng khi sửa, chữ ký webhook HMAC-SHA256.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface MockOptions {
  consumerKey?: string;
  consumerSecret?: string;
  permissions?: 'read' | 'write' | 'read_write';
  timezone?: string;
  currency?: string;
  ast?: boolean;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, '');

export class MockWoo {
  server!: http.Server;
  url = '';
  orders = new Map<number, any>();
  products = new Map<number, any>();
  variations = new Map<number, any>(); // id -> variation (có parent_id)
  notes = new Map<number, any[]>();
  refunds = new Map<number, any[]>();
  webhooks: any[] = [];
  categories = [
    { id: 11, name: 'Túi xách', parent: 0, count: 2 },
    { id: 12, name: 'Giày dép', parent: 0, count: 1 },
    { id: 13, name: 'Phụ kiện', parent: 0, count: 1 },
  ];
  tracking = new Map<number, any[]>();
  requests: { method: string; path: string; body?: any }[] = [];
  /** Lần ghi tiếp theo khớp predicate: thực thi rồi cắt kết nối (mô phỏng mất mạng sau khi website đã lưu) */
  dropAfterWrite: ((method: string, path: string) => boolean) | null = null;
  clock = Date.now();
  nextId = 10400;
  opts: Required<MockOptions>;

  constructor(opts: MockOptions = {}) {
    this.opts = {
      consumerKey: 'ck_test_1234567890',
      consumerSecret: 'cs_test_1234567890',
      permissions: 'read_write',
      timezone: 'America/New_York',
      currency: 'USD',
      ast: true,
      ...opts,
    };
  }

  tick(ms = 1000) {
    // đồng hồ không bao giờ chậm hơn giờ thật (như WooCommerce thật), nhưng luôn tăng giữa các lần ghi
    this.clock = Math.max(this.clock + ms, Date.now());
    return new Date(this.clock);
  }

  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => this.send(res, 500, { code: 'internal', message: e.message })));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    this.server.closeAllConnections?.();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  // ---------- dữ liệu ----------
  makeOrder(p: Partial<any> & { status: string; created?: Date }) {
    const id = p.id ?? this.nextId++;
    const created = p.created ?? this.tick(0);
    const items = p.line_items ?? [
      { id: id * 10 + 1, name: 'Túi tote da — Đen', product_id: 501, variation_id: 601, quantity: 1, subtotal: '119.00', total: '119.00', sku: 'TOTE-BLK', price: 119, image: { src: 'https://img.example/tote.jpg' }, meta_data: [{ key: 'pa_color', value: 'black', display_key: 'Màu', display_value: 'Đen' }] },
      { id: id * 10 + 2, name: 'Ví mini', product_id: 503, variation_id: 0, quantity: 1, subtotal: '20.00', total: '20.00', sku: 'WAL-MINI', price: 20, image: { src: '' } },
    ];
    const subtotal = items.reduce((s: number, li: any) => s + Number(li.subtotal), 0);
    const shipping = Number(p.shipping_total ?? 10);
    const tax = Number(p.total_tax ?? 0);
    const discount = Number(p.discount_total ?? 0);
    const o = {
      id,
      number: String(p.number ?? id),
      status: p.status,
      currency: p.currency ?? this.opts.currency,
      total: (subtotal - discount + shipping + tax).toFixed(2),
      discount_total: discount.toFixed(2),
      shipping_total: shipping.toFixed(2),
      total_tax: tax.toFixed(2),
      date_created_gmt: iso(created),
      date_modified_gmt: iso(created),
      date_paid_gmt: p.date_paid_gmt ?? (['processing', 'completed'].includes(p.status) ? iso(created) : null),
      date_completed_gmt: null,
      payment_method: 'stripe',
      payment_method_title: p.payment_method_title ?? 'Thẻ tín dụng (Stripe)',
      customer_note: p.customer_note ?? '',
      created_via: p.created_via ?? 'checkout',
      billing: { first_name: 'Emily', last_name: 'Carter', email: 'emily@example.com', phone: '+1 555 0100', address_1: '12 Main St', city: 'Austin', state: 'TX', postcode: '78701', country: 'US' },
      shipping: { first_name: 'Emily', last_name: 'Carter', address_1: '12 Main St', address_2: 'Apt 4', city: 'Austin', state: 'TX', postcode: '78701', country: 'US' },
      line_items: items,
      shipping_lines: [{ id: 1, method_title: 'USPS Priority', total: shipping.toFixed(2) }],
      fee_lines: [],
      coupon_lines: [],
      tax_lines: [],
      refunds: [],
      meta_data: [],
      ...p.extra,
    };
    this.orders.set(id, o);
    return o;
  }

  updateOrder(id: number, patch: any) {
    const o = this.orders.get(id);
    const now = this.tick();
    Object.assign(o, patch, { date_modified_gmt: iso(now) });
    if (['processing', 'completed'].includes(o.status) && !o.date_paid_gmt) o.date_paid_gmt = iso(now);
    return o;
  }

  addRefund(orderId: number, amount: number, reason = 'Hoàn một phần', at = this.tick()) {
    const list = this.refunds.get(orderId) ?? [];
    const r = { id: this.nextId++, amount: amount.toFixed(2), reason, date_created_gmt: iso(at) };
    list.push(r);
    this.refunds.set(orderId, list);
    const o = this.orders.get(orderId);
    o.refunds = list.map((x) => ({ id: x.id, reason: x.reason, total: `-${x.amount}` }));
    o.date_modified_gmt = iso(at);
    return r;
  }

  seedCatalog() {
    const t = iso(new Date(this.clock));
    this.products.set(501, {
      id: 501, name: 'Túi tote da', type: 'variable', status: 'publish', sku: 'TOTE', price: '119.00', regular_price: '', sale_price: '',
      manage_stock: false, stock_quantity: null, stock_status: 'instock', date_modified_gmt: t, images: [{ id: 1, src: 'https://img.example/tote.jpg' }],
      categories: [{ id: 11, name: 'Túi xách' }], variations: [601, 602, 603], attributes: [{ id: 1, name: 'Màu', options: ['Đen', 'Nâu', 'Kem'] }],
    });
    const v = (id: number, sku: string, color: string, qty: number | null, manage: boolean | 'parent') =>
      this.variations.set(id, {
        id, parent_id: 501, sku, price: '119.00', regular_price: '119.00', sale_price: '', manage_stock: manage, stock_quantity: qty,
        stock_status: qty === 0 ? 'outofstock' : 'instock', date_modified_gmt: t, image: { id: 2, src: `https://img.example/tote-${sku}.jpg` },
        attributes: [{ id: 1, name: 'Màu', option: color }], status: 'publish',
      });
    v(601, 'TOTE-BLK', 'Đen', 5, true);
    v(602, 'TOTE-BRN', 'Nâu', 1, true);
    v(603, 'TOTE-CRM', 'Kem', 0, true);
    // Giày: tồn kho quản lý ở sản phẩm cha, biến thể kế thừa ("parent")
    this.products.set(502, {
      id: 502, name: 'Giày loafer', type: 'variable', status: 'publish', sku: 'LOAF', price: '89.00', regular_price: '', sale_price: '',
      manage_stock: true, stock_quantity: 12, stock_status: 'instock', date_modified_gmt: t, images: [], categories: [{ id: 12, name: 'Giày dép' }],
      variations: [611, 612],
    });
    const sv = (id: number, sku: string, size: string) =>
      this.variations.set(id, {
        id, parent_id: 502, sku, price: '89.00', regular_price: '89.00', sale_price: '', manage_stock: 'parent', stock_quantity: 12,
        stock_status: 'instock', date_modified_gmt: t, image: null, attributes: [{ id: 2, name: 'Size', option: size }], status: 'publish',
      });
    sv(611, 'LOAF-38', '38');
    sv(612, 'LOAF-39', '39');
    this.products.set(503, {
      id: 503, name: 'Ví mini', type: 'simple', status: 'publish', sku: 'WAL-MINI', price: '20.00', regular_price: '20.00', sale_price: '',
      manage_stock: false, stock_quantity: null, stock_status: 'instock', date_modified_gmt: t, images: [], categories: [{ id: 13, name: 'Phụ kiện' }],
    });
  }

  // ---------- webhook ----------
  async fire(topic: string, resource: any, opts: { deliveryId?: number; secret?: string } = {}) {
    const hooks = this.webhooks.filter((h) => h.topic === topic && h.status === 'active');
    const results: number[] = [];
    for (const h of hooks) {
      const body = JSON.stringify(resource);
      const sig = crypto.createHmac('sha256', opts.secret ?? h.secret).update(body).digest('base64');
      const res = await fetch(h.delivery_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-WC-Webhook-Source': `${this.url}/`,
          'X-WC-Webhook-Topic': topic,
          'X-WC-Webhook-Resource': topic.split('.')[0],
          'X-WC-Webhook-Event': topic.split('.')[1],
          'X-WC-Webhook-Signature': sig,
          'X-WC-Webhook-ID': String(h.id),
          'X-WC-Webhook-Delivery-ID': String(opts.deliveryId ?? this.nextId++),
        },
        body,
      });
      results.push(res.status);
    }
    return results;
  }

  // ---------- HTTP ----------
  private send(res: http.ServerResponse, status: number, data: any, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(data));
  }

  private page<T>(res: http.ServerResponse, items: T[], qs: URLSearchParams) {
    const per = Number(qs.get('per_page') ?? 10);
    const page = Number(qs.get('page') ?? 1);
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / per));
    this.send(res, 200, items.slice((page - 1) * per, page * per), { 'X-WP-Total': String(total), 'X-WP-TotalPages': String(pages) });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const u = new URL(req.url!, this.url);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const p = u.pathname.replace(/^\/wp-json/, '');
    const method = req.method!;
    this.requests.push({ method, path: p, body });

    if (p === '/' || p === '') {
      return this.send(res, 200, {
        name: 'Maison Demo Store',
        url: this.url,
        timezone_string: this.opts.timezone,
        gmt_offset: -5,
        namespaces: ['wp/v2', 'wc/v3', ...(this.opts.ast ? ['wc-shipment-tracking/v3'] : [])],
      });
    }

    // Basic auth
    const auth = req.headers.authorization ?? '';
    const [ck, cs] = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString().split(':');
    if (ck !== this.opts.consumerKey || cs !== this.opts.consumerSecret) {
      return this.send(res, 401, { code: 'woocommerce_rest_cannot_view', message: 'Sorry, you cannot list resources.', data: { status: 401 } });
    }
    if (method !== 'GET' && this.opts.permissions === 'read') {
      return this.send(res, 401, { code: 'woocommerce_rest_authentication_error', message: 'The API key provided does not have write permissions.', data: { status: 401 } });
    }

    const drop = method !== 'GET' && this.dropAfterWrite?.(method, p);
    const reply = (status: number, data: any, headers?: Record<string, string>) => {
      if (drop) {
        this.dropAfterWrite = null;
        req.socket.destroy(); // đã ghi nhưng client không nhận được phản hồi
        return;
      }
      this.send(res, status, data, headers);
    };
    const qs = u.searchParams;
    let m: RegExpMatchArray | null;

    if (p === '/wc/v3/settings/general') {
      return reply(200, [
        { id: 'woocommerce_currency', value: this.opts.currency },
        { id: 'woocommerce_price_num_decimals', value: '2' },
      ]);
    }
    if (p === '/wc/v3/settings/products') {
      return reply(200, [
        { id: 'woocommerce_manage_stock', value: 'yes' },
        { id: 'woocommerce_notify_low_stock_amount', value: '2' },
      ]);
    }
    if (p === '/wc/v3/system_status') return reply(200, { environment: { version: '9.4.0' }, settings: { hpos_enabled: true } });
    if (p === '/wc/v3/reports/orders/totals') {
      return reply(200, ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'].map((slug) => ({ slug, name: slug, total: 0 })));
    }
    if (p === '/wc/v3/orders/batch' && method === 'POST') return reply(200, { create: [], update: [], delete: [] });

    if (p === '/wc/v3/orders' && method === 'GET') {
      let list = [...this.orders.values()].filter((o) => o.status !== 'checkout-draft');
      const st = qs.get('status');
      if (st && st !== 'any') list = list.filter((o) => st.split(',').includes(o.status));
      const before = qs.get('before');
      if (before) list = list.filter((o) => o.date_created_gmt < before);
      const ma = qs.get('modified_after');
      if (ma) list = list.filter((o) => o.date_modified_gmt > ma);
      const orderby = qs.get('orderby') ?? 'date';
      const dir = qs.get('order') === 'asc' ? 1 : -1;
      list.sort((a, b) => (orderby === 'modified' ? a.date_modified_gmt.localeCompare(b.date_modified_gmt) : a.date_created_gmt.localeCompare(b.date_created_gmt) || a.id - b.id) * dir);
      return this.page(res, list, qs);
    }
    if ((m = p.match(/^\/wc\/v3\/orders\/(\d+)$/))) {
      const o = this.orders.get(Number(m[1]));
      if (!o) return reply(404, { code: 'woocommerce_rest_shop_order_invalid_id', message: 'ID không hợp lệ.' });
      if (method === 'PUT') this.updateOrder(o.id, body);
      return reply(200, o);
    }
    if ((m = p.match(/^\/wc\/v3\/orders\/(\d+)\/notes$/))) {
      const id = Number(m[1]);
      const list = this.notes.get(id) ?? [];
      if (method === 'POST') {
        const n = { id: this.nextId++, author: 'WooCommerce', date_created_gmt: iso(this.tick()), note: body.note, customer_note: !!body.customer_note };
        list.unshift(n);
        this.notes.set(id, list);
        return reply(201, n);
      }
      return reply(200, list);
    }
    if ((m = p.match(/^\/wc\/v3\/orders\/(\d+)\/refunds$/))) return reply(200, this.refunds.get(Number(m[1])) ?? []);
    if ((m = p.match(/^\/wc-shipment-tracking\/v3\/orders\/(\d+)\/shipment-trackings$/))) return reply(200, this.tracking.get(Number(m[1])) ?? []);

    if (p === '/wc/v3/products/categories') return this.page(res, this.categories, qs);
    if (p === '/wc/v3/products' && method === 'GET') {
      let list = [...this.products.values()];
      const sku = qs.get('sku');
      if (sku) list = list.filter((x) => x.sku === sku);
      const search = qs.get('search');
      if (search) list = list.filter((x) => x.name.includes(search));
      const st = qs.get('status');
      if (st && st !== 'any') list = list.filter((x) => x.status === st);
      const ma = qs.get('modified_after');
      if (ma) list = list.filter((x) => x.date_modified_gmt > ma);
      list.sort((a, b) => b.id - a.id);
      return this.page(res, list, qs);
    }
    if (p === '/wc/v3/products' && method === 'POST') {
      if (body.sku && [...this.products.values()].some((x) => x.sku === body.sku)) {
        return reply(400, { code: 'product_invalid_sku', message: 'SKU không hợp lệ hoặc trùng.' });
      }
      const id = this.nextId++;
      const prod = {
        id, type: 'simple', price: body.regular_price ?? '', stock_status: 'instock', stock_quantity: body.stock_quantity ?? null,
        date_modified_gmt: iso(this.tick()), images: (body.images ?? []).map((i: any, k: number) => ({ id: k + 1, src: i.src })),
        categories: (body.categories ?? []).map((c: any) => this.categories.find((x) => x.id === c.id)), ...body,
      };
      prod.images = (body.images ?? []).map((i: any, k: number) => ({ id: k + 1, src: i.src }));
      this.products.set(id, prod);
      return reply(201, prod);
    }
    if ((m = p.match(/^\/wc\/v3\/products\/(\d+)$/))) {
      const prod = this.products.get(Number(m[1]));
      if (!prod) return reply(404, { code: 'woocommerce_rest_product_invalid_id', message: 'ID không hợp lệ.' });
      if (method === 'PUT') {
        Object.assign(prod, body, { date_modified_gmt: iso(this.tick()) });
        if (body.regular_price !== undefined || body.sale_price !== undefined) prod.price = prod.sale_price || prod.regular_price;
        if (body.stock_quantity !== undefined) {
          prod.stock_status = prod.stock_quantity > 0 ? 'instock' : 'outofstock';
          // biến thể kế thừa tồn kho của cha
          for (const v of this.variations.values()) if (v.parent_id === prod.id && v.manage_stock === 'parent') { v.stock_quantity = prod.stock_quantity; v.stock_status = prod.stock_status; }
        }
      }
      return reply(200, prod);
    }
    if ((m = p.match(/^\/wc\/v3\/products\/(\d+)\/variations$/))) {
      return this.page(res, [...this.variations.values()].filter((v) => v.parent_id === Number(m![1])), qs);
    }
    if ((m = p.match(/^\/wc\/v3\/products\/(\d+)\/variations\/(\d+)$/))) {
      const v = this.variations.get(Number(m[2]));
      if (!v || v.parent_id !== Number(m[1])) return reply(404, { code: 'woocommerce_rest_product_variation_invalid_id', message: 'ID không hợp lệ.' });
      if (method === 'PUT') {
        Object.assign(v, body, { date_modified_gmt: iso(this.tick()) });
        v.price = v.sale_price || v.regular_price;
        if (body.stock_quantity !== undefined) v.stock_status = v.stock_quantity > 0 ? 'instock' : 'outofstock';
      }
      return reply(200, v);
    }

    if (p === '/wc/v3/webhooks') {
      if (method === 'POST') {
        const h = { id: this.nextId++, status: 'active', ...body };
        this.webhooks.push(h);
        return reply(201, h);
      }
      return this.page(res, this.webhooks, qs);
    }
    if ((m = p.match(/^\/wc\/v3\/webhooks\/(\d+)$/))) {
      const i = this.webhooks.findIndex((h) => h.id === Number(m![1]));
      if (i < 0) return reply(404, { code: 'not_found', message: 'x' });
      if (method === 'DELETE') return reply(200, this.webhooks.splice(i, 1)[0]);
      Object.assign(this.webhooks[i], body);
      return reply(200, this.webhooks[i]);
    }
    return reply(404, { code: 'rest_no_route', message: 'Không tìm thấy route phù hợp với URL.' });
  }
}

/** Expo Push giả lập */
export class MockExpo {
  server!: http.Server;
  url = '';
  messages: any[] = [];
  /** token -> lỗi trả về trong ticket */
  ticketErrors = new Map<string, string>();
  failNext = 0; // số request tiếp theo trả 503
  receipts = new Map<string, any>();

  async start() {
    this.server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      res.setHeader('Content-Type', 'application/json');
      if (req.url!.includes('getReceipts')) {
        const data: Record<string, any> = {};
        for (const id of body.ids) data[id] = this.receipts.get(id) ?? { status: 'ok' };
        return res.end(JSON.stringify({ data }));
      }
      if (this.failNext > 0) {
        this.failNext--;
        res.statusCode = 503;
        return res.end('{"errors":[{"code":"INTERNAL"}]}');
      }
      const msgs = Array.isArray(body) ? body : [body];
      const data = msgs.map((m) => {
        const err = this.ticketErrors.get(m.to);
        if (err) return { status: 'error', message: err, details: { error: err } };
        this.messages.push(m);
        return { status: 'ok', id: crypto.randomUUID() };
      });
      res.end(JSON.stringify({ data }));
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    this.server.closeAllConnections?.();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
