import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { config } from './lib/config.js';
import { q, q1 } from './lib/db.js';
import { AppError } from './lib/errors.js';
import { WooError } from './woo/client.js';
import { authenticate, login, logout, type AuthContext } from './services/auth.js';
import {
  checkShop,
  ensureWebhooks,
  getShop,
  publicShop,
  refreshShopMeta,
  requireShop,
  runConnectionCheck,
  saveShopConnection,
} from './services/shop.js';
import { dashboard, type RangeKey } from './services/analytics.js';
import { addOrderNote, getOrderDetail, listOrders, statusCounts, updateOrderStatus } from './services/orders.js';
import {
  createDraftProduct,
  getProductDetail,
  listCategories,
  listProducts,
  publishProduct,
  updateProductOrVariation,
} from './services/products.js';
import { getDevice, registerDevice, unregisterDevice, updatePrefs } from './services/devices.js';
import { createTestNotification } from './services/push.js';
import { receiveWebhook } from './services/webhooks.js';
import { startInitialSync, syncStatus } from './services/sync.js';
import { enqueue } from './jobs/queue.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
    rawBody?: Buffer;
  }
}

const wooErrorStatus: Record<string, number> = {
  network: 502,
  url: 502,
  auth: 502,
  permission: 502,
  not_found: 404,
  invalid: 422,
  server: 502,
};

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config().LOG_LEVEL, redact: ['req.headers.authorization'] },
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: true,
  });

  // Giữ raw body để kiểm tra chữ ký webhook
  app.addContentTypeParser(['application/json', 'application/x-www-form-urlencoded'], { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body as Buffer;
    if (req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return done(null, {});
    if ((body as Buffer).length === 0) return done(null, {});
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      if (req.url.startsWith('/webhooks/')) return done(null, {});
      const err = new AppError(400, 'invalid_json', 'JSON không hợp lệ');
      done(err as any, undefined);
    }
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'Accept'],
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'validation', message: 'Dữ liệu không hợp lệ', details: err.issues });
    if (err instanceof WooError) {
      return reply
        .status(wooErrorStatus[err.kind] ?? 502)
        .send({ error: `woo_${err.kind}`, message: err.message, details: { wooCode: err.wooCode, wooStatus: err.status } });
    }
    if (err.statusCode === 429) return reply.status(429).send({ error: 'rate_limited', message: 'Thử lại sau ít phút' });
    req.log.error(err);
    return reply.status(err.statusCode ?? 500).send({ error: 'internal', message: 'Lỗi máy chủ' });
  });

  const authed = async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    req.auth = await authenticate(h?.startsWith('Bearer ') ? h.slice(7) : undefined);
  };

  app.get('/health', async () => {
    await q('SELECT 1');
    return { ok: true, time: new Date().toISOString() };
  });

  // ---------- Webhook WooCommerce ----------
  app.post('/webhooks/woocommerce/:shopId', async (req, reply) => {
    const shopId = Number((req.params as any).shopId);
    const r = await receiveWebhook({ shopId, rawBody: req.rawBody ?? Buffer.alloc(0), headers: req.headers as any });
    return reply.status(r.status).send(r.body);
  });

  // Ảnh tải lên tạm để WooCommerce tải về (sideload) khi tạo sản phẩm
  app.get('/uploads/:id', async (req, reply) => {
    const id = (req.params as any).id as string;
    const u = await q1<any>('SELECT * FROM uploads WHERE id=$1', [id]);
    if (!u) return reply.status(404).send();
    return reply.type(u.mime).send(fs.createReadStream(path.join(config().UPLOAD_DIR, u.id)));
  });

  // ---------- Auth ----------
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req) => {
    const b = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    return login(b.email, b.password);
  });

  app.register(async (api) => {
    api.addHook('preHandler', authed);

    api.post('/api/auth/logout', async (req) => {
      await logout(req.auth);
      return { ok: true };
    });
    api.get('/api/me', async (req) => ({ id: req.auth.userId, email: req.auth.email }));

    // ---------- Shop ----------
    api.get('/api/shop', async () => {
      const shop = await getShop();
      if (!shop) return { connected: false };
      return { connected: true, shop: publicShop(shop), sync: await syncStatus(shop.id) };
    });

    const connectSchema = z.object({ url: z.string().min(4), consumerKey: z.string().min(10), consumerSecret: z.string().min(10) });
    api.post('/api/shop/test', async (req) => {
      const b = connectSchema.parse(req.body);
      return runConnectionCheck(b, await getShop());
    });

    api.post('/api/shop/connect', async (req) => {
      const b = connectSchema.parse(req.body);
      const pre = await runConnectionCheck(b, null);
      const blocking = pre.steps.find((s) => ['url', 'auth', 'read'].includes(s.key) && s.level === 'error');
      if (blocking) throw new AppError(422, 'connection_failed', blocking.message, pre);
      const before = await getShop();
      let shop = await saveShopConnection(b);
      shop = await refreshShopMeta(shop);
      let webhooks: any;
      try {
        webhooks = await ensureWebhooks(shop);
      } catch (e) {
        webhooks = { error: (e as Error).message };
      }
      if (!before || before.url !== shop.url) await startInitialSync(shop);
      const check = await checkShop(shop);
      return { shop: publicShop(shop), webhooks, check };
    });

    api.post('/api/shop/check', async () => {
      let shop = await requireShop();
      try {
        shop = await refreshShopMeta(shop);
      } catch {
        /* lỗi sẽ hiện trong các bước kiểm tra */
      }
      return checkShop(shop);
    });

    api.post('/api/shop/webhooks/ensure', async () => {
      const shop = await requireShop();
      const r = await ensureWebhooks(shop);
      return { ...r, check: await checkShop(shop) };
    });

    api.post('/api/shop/sync', async () => {
      const shop = await requireShop();
      await enqueue('reconcile', { shopId: shop.id }, { dedupeKey: `reconcile:${shop.id}:manual` });
      return { ok: true };
    });

    // ---------- Dashboard ----------
    api.get('/api/dashboard', async (req) => {
      const qy = z
        .object({ range: z.enum(['today', 'yesterday', '7d', '30d', 'custom']).default('today'), from: z.string().optional(), to: z.string().optional() })
        .parse(req.query);
      const shop = await requireShop();
      try {
        return await dashboard(shop, qy.range as RangeKey, qy.from, qy.to);
      } catch (e) {
        if ((e as Error).message.includes('ngày')) throw new AppError(400, 'bad_range', (e as Error).message);
        throw e;
      }
    });

    // ---------- Orders ----------
    api.get('/api/orders', async (req) => {
      const qy = z
        .object({
          status: z.string().optional(),
          q: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          page: z.coerce.number().optional(),
          limit: z.coerce.number().optional(),
        })
        .parse(req.query);
      const shop = await requireShop();
      const sync = await syncStatus(shop.id);
      return { ...(await listOrders(shop, qy)), lastSyncAt: sync.lastSyncAt, syncing: sync.orders?.status === 'running' };
    });

    api.get('/api/orders/statuses', async () => statusCounts(await requireShop()));

    api.get('/api/orders/:id', async (req) => getOrderDetail(await requireShop(), Number((req.params as any).id)));

    api.post('/api/orders/:id/status', async (req) => {
      const b = z.object({ status: z.string().min(1), expectedStatus: z.string().optional(), force: z.boolean().optional() }).parse(req.body);
      return updateOrderStatus(await requireShop(), Number((req.params as any).id), b.status, b.expectedStatus, b.force);
    });

    api.post('/api/orders/:id/notes', async (req) => {
      const b = z.object({ note: z.string().min(1).max(5000), customer: z.boolean().default(false) }).parse(req.body);
      const key = (req.headers['idempotency-key'] as string | undefined) ?? undefined;
      return addOrderNote(await requireShop(), req.auth.userId, Number((req.params as any).id), b.note, b.customer, key);
    });

    // ---------- Products ----------
    api.get('/api/products', async (req) => {
      const qy = z
        .object({
          q: z.string().optional(),
          category: z.coerce.number().optional(),
          stock: z.enum(['instock', 'low', 'outofstock']).optional(),
          page: z.coerce.number().optional(),
          limit: z.coerce.number().optional(),
        })
        .parse(req.query);
      const shop = await requireShop();
      const sync = await syncStatus(shop.id);
      return { ...(await listProducts(shop, qy)), lastSyncAt: sync.lastSyncAt, syncing: sync.products?.status === 'running' };
    });

    api.get('/api/categories', async () => listCategories(await requireShop()));

    api.get('/api/products/:id', async (req) => getProductDetail(await requireShop(), Number((req.params as any).id)));

    const patchSchema = z.object({
      regularPrice: z.string().optional(),
      salePrice: z.string().optional(),
      stockQuantity: z.number().int().optional(),
      stockStatus: z.enum(['instock', 'outofstock', 'onbackorder']).optional(),
      expectedModified: z.string().optional(),
      force: z.boolean().optional(),
    });
    api.patch('/api/products/:id', async (req) =>
      updateProductOrVariation(await requireShop(), Number((req.params as any).id), null, patchSchema.parse(req.body)),
    );
    api.patch('/api/products/:id/variations/:vid', async (req) =>
      updateProductOrVariation(
        await requireShop(),
        Number((req.params as any).id),
        Number((req.params as any).vid),
        patchSchema.parse(req.body),
      ),
    );

    api.post('/api/products', async (req) => {
      const b = z
        .object({
          name: z.string().min(1),
          shortDescription: z.string().optional(),
          sku: z.string().optional(),
          regularPrice: z.string().optional(),
          salePrice: z.string().optional(),
          categoryIds: z.array(z.number()).optional(),
          manageStock: z.boolean().optional(),
          stockQuantity: z.number().int().optional(),
          imageUploadIds: z.array(z.string()).optional(),
        })
        .parse(req.body);
      return createDraftProduct(await requireShop(), req.auth.userId, {
        ...b,
        idempotencyKey: req.headers['idempotency-key'] as string | undefined,
      });
    });

    api.post('/api/products/:id/publish', async (req) => publishProduct(await requireShop(), Number((req.params as any).id)));

    api.post('/api/uploads', async (req) => {
      const file = await req.file();
      if (!file) throw new AppError(400, 'no_file', 'Thiếu ảnh');
      const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' } as Record<string, string>)[file.mimetype];
      if (!ext) throw new AppError(400, 'bad_type', 'Chỉ nhận ảnh JPG/PNG/WebP/HEIC');
      const id = `${crypto.randomBytes(18).toString('base64url')}.${ext}`;
      await fs.promises.mkdir(config().UPLOAD_DIR, { recursive: true });
      await fs.promises.writeFile(path.join(config().UPLOAD_DIR, id), await file.toBuffer());
      await q('INSERT INTO uploads (id, filename, mime) VALUES ($1,$2,$3)', [id, file.filename, file.mimetype]);
      return { id, url: `${config().PUBLIC_URL.replace(/\/+$/, '')}/uploads/${id}` };
    });

    // ---------- Devices & notifications ----------
    const prefsSchema = z.object({ notifyNewOrder: z.boolean().optional(), notifyPaid: z.boolean().optional(), hideAmount: z.boolean().optional() });
    api.put('/api/devices', async (req) => {
      const b = z
        .object({
          installationId: z.string().min(8).max(100),
          platform: z.enum(['ios', 'android', 'web']),
          name: z.string().max(200).optional(),
          pushToken: z.string().max(300).nullable().optional(),
          permission: z.string().max(40).optional(),
          prefs: prefsSchema.optional(),
        })
        .parse(req.body);
      return registerDevice(req.auth, b);
    });
    api.get('/api/devices/:installationId', async (req) => getDevice(req.auth, (req.params as any).installationId));
    api.patch('/api/devices/:installationId/prefs', async (req) => {
      const d = await updatePrefs(req.auth, (req.params as any).installationId, prefsSchema.parse(req.body));
      if (!d) throw new AppError(404, 'not_found', 'Thiết bị chưa đăng ký');
      return d;
    });
    api.delete('/api/devices/:installationId', async (req) => {
      await unregisterDevice(req.auth, (req.params as any).installationId);
      return { ok: true };
    });

    api.get('/api/notifications', async (req) => {
      const qy = z.object({ page: z.coerce.number().default(1) }).parse(req.query);
      const limit = 30;
      const rows = await q<any>(
        `SELECT n.id, n.kind, n.order_id, n.title, n.body, n.data, n.created_at, n.read_at,
           (SELECT json_agg(json_build_object('status', d.status, 'error', d.error)) FROM push_deliveries d WHERE d.notification_id=n.id) AS deliveries
         FROM notifications n WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [req.auth.userId, limit + 1, (qy.page - 1) * limit],
      );
      const unread = await q1<{ n: number }>('SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.auth.userId]);
      return { items: rows.slice(0, limit), hasMore: rows.length > limit, page: qy.page, unread: unread?.n ?? 0 };
    });

    api.post('/api/notifications/read', async (req) => {
      const b = z.object({ ids: z.array(z.number()).optional(), all: z.boolean().optional() }).parse(req.body);
      if (b.all) await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [req.auth.userId]);
      else if (b.ids?.length) await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id = ANY($2)', [req.auth.userId, b.ids]);
      return { ok: true };
    });

    api.post('/api/notifications/test', async (req) => {
      const b = z.object({ installationId: z.string() }).parse(req.body);
      const d = await getDevice(req.auth, b.installationId);
      if (!d) throw new AppError(404, 'device_not_registered', 'Thiết bị chưa đăng ký với backend.');
      if (!d.hasPushToken) throw new AppError(409, 'no_push_token', 'Thiết bị chưa có push token (chưa cấp quyền hoặc đang chạy Expo Go/web).');
      if (!d.active) throw new AppError(409, 'device_inactive', `Thiết bị bị vô hiệu hóa (${d.inactiveReason}).`);
      return createTestNotification(req.auth.userId, d.id);
    });

    api.get('/api/notifications/diagnostics', async (req) => {
      const qy = z.object({ installationId: z.string().optional() }).parse(req.query);
      const shop = await getShop();
      const device = qy.installationId ? await getDevice(req.auth, qy.installationId) : null;
      const lastOrderWebhook = shop
        ? await q1<any>(
            `SELECT topic, resource_id, received_at, status FROM webhook_deliveries WHERE shop_id=$1 AND topic LIKE 'order.%' ORDER BY id DESC LIMIT 1`,
            [shop.id],
          )
        : null;
      const lastEvent = shop
        ? await q1<any>(
            `SELECT e.type, e.order_id, e.created_at, e.suppressed, e.suppressed_reason, o.number FROM business_events e
             LEFT JOIN orders o ON o.shop_id=e.shop_id AND o.id=e.order_id WHERE e.shop_id=$1 ORDER BY e.id DESC LIMIT 1`,
            [shop.id],
          )
        : null;
      const lastOrderPush = device
        ? await q1<any>(
            `SELECT n.title, n.kind, n.created_at, d.status, d.error, d.updated_at FROM push_deliveries d JOIN notifications n ON n.id=d.notification_id
             WHERE d.device_id=$1 AND n.kind <> 'test' ORDER BY d.id DESC LIMIT 1`,
            [device.id],
          )
        : null;
      const lastTestPush = device
        ? await q1<any>(
            `SELECT n.created_at, d.status, d.error, d.updated_at FROM push_deliveries d JOIN notifications n ON n.id=d.notification_id
             WHERE d.device_id=$1 AND n.kind = 'test' ORDER BY d.id DESC LIMIT 1`,
            [device.id],
          )
        : null;
      return {
        device,
        shopConnected: !!shop,
        lastWebhookAt: shop?.last_webhook_at ?? null,
        lastWebhookTopic: shop?.last_webhook_topic ?? null,
        lastBadSignatureAt: shop?.last_bad_signature_at ?? null,
        lastOrderWebhook,
        lastEvent,
        lastOrderPush,
        lastTestPush,
        expoAccessTokenConfigured: !!config().EXPO_ACCESS_TOKEN,
      };
    });
  });

  return app;
}
