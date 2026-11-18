import net from 'node:net';
import type { FastifyInstance } from 'fastify';
import { MockExpo, MockWoo, type MockOptions } from './mockWoo.js';

export async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

export interface Harness {
  app: FastifyInstance;
  woo: MockWoo;
  expo: MockExpo;
  token: string;
  api: (method: string, url: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; json: any }>;
  drain: () => Promise<number>;
  close: () => Promise<void>;
}

export async function setup(opts: { woo?: MockOptions; connect?: boolean; seed?: (w: MockWoo) => void } = {}): Promise<Harness> {
  const port = await freePort();
  const expo = await new MockExpo().start();
  const woo = await new MockWoo(opts.woo).start();
  opts.seed?.(woo);

  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://woo:woo@127.0.0.1:5432/wooadmin_test';
  process.env.APP_SECRET = 'test-secret-test-secret-test-secret-123';
  process.env.PUBLIC_URL = `http://127.0.0.1:${port}`;
  process.env.WC_ALLOW_HTTP = 'true';
  process.env.EXPO_PUSH_URL = `${expo.url}/push/send`;
  process.env.EXPO_RECEIPTS_URL = `${expo.url}/push/getReceipts`;
  process.env.PUSH_COALESCE_SECONDS = '0';
  process.env.LOG_LEVEL = 'silent';

  const { resetConfigForTests } = await import('../src/lib/config.js');
  resetConfigForTests();
  const { db, closeDb } = await import('../src/lib/db.js');
  await closeDb();
  await db().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const { migrate } = await import('../src/lib/migrate.js');
  await migrate(() => undefined);
  const { createUser } = await import('../src/services/auth.js');
  await createUser('owner@example.com', 'mat-khau-rat-manh', 'Chủ shop');
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp({ logger: false });
  await app.listen({ port, host: '127.0.0.1' });
  const { drain } = await import('../src/jobs/queue.js');
  const { handlers } = await import('../src/jobs/handlers.js');

  let token = '';
  const api: Harness['api'] = async (method, url, body, headers = {}) => {
    const r = await app.inject({
      method: method as any,
      url,
      payload: body as any,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    });
    let json: any;
    try {
      json = r.json();
    } catch {
      json = r.body;
    }
    return { status: r.statusCode, json };
  };
  const login = await api('POST', '/api/auth/login', { email: 'owner@example.com', password: 'mat-khau-rat-manh' });
  token = login.json.token;

  const h: Harness = {
    app,
    woo,
    expo,
    get token() {
      return token;
    },
    set token(t: string) {
      token = t;
    },
    api,
    drain: () => drain(handlers),
    close: async () => {
      await app.close();
      await woo.stop();
      await expo.stop();
      await closeDb();
    },
  } as Harness;

  if (opts.connect !== false) {
    const r = await api('POST', '/api/shop/connect', { url: woo.url, consumerKey: woo.opts.consumerKey, consumerSecret: woo.opts.consumerSecret });
    if (r.status !== 200) throw new Error(`connect failed: ${JSON.stringify(r.json)}`);
    await h.drain();
  }
  return h;
}

export async function registerPhone(h: Harness, installationId = 'inst-iphone-0001', token = 'ExponentPushToken[iphone-1]', prefs?: any) {
  const r = await h.api('PUT', '/api/devices', { installationId, platform: 'ios', name: 'iPhone', pushToken: token, permission: 'granted', prefs });
  if (r.status !== 200) throw new Error(JSON.stringify(r.json));
  return r.json;
}
