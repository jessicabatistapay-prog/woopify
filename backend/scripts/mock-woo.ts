/**
 * Chạy WooCommerce giả lập để thử toàn bộ luồng cục bộ khi chưa có website thật.
 *   npx tsx scripts/mock-woo.ts            (cổng 8081)
 * Đặt đơn thử:  curl -X POST localhost:8081/__mock/order -d '{"status":"pending"}'
 */
import http from 'node:http';
import { MockWoo } from '../test/mockWoo.js';

const port = Number(process.env.MOCK_WOO_PORT ?? 8081);
const woo = new MockWoo();
await woo.start();
woo.seedCatalog();
for (let i = 0; i < 40; i++) {
  woo.makeOrder({ status: i % 6 === 0 ? 'processing' : i % 9 === 0 ? 'pending' : 'completed', created: new Date(Date.now() - (i + 1) * 3600_000 * 7) });
}

// proxy cổng cố định → mock (mock tự chọn cổng ngẫu nhiên)
const target = new URL(woo.url);
http
  .createServer(async (req, res) => {
    if (req.url?.startsWith('/__mock/order') && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const o = woo.makeOrder({ status: body.status ?? 'pending' });
      const codes = await woo.fire('order.created', o);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ id: o.id, number: o.number, webhookStatus: codes }));
    }
    const p = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 500, r.headers);
      r.pipe(res);
    });
    req.pipe(p);
  })
  .listen(port, () => {
    // URL trong dữ liệu mock phải trỏ về cổng cố định
    woo.url = `http://127.0.0.1:${port}`;
    console.log(`Mock WooCommerce: http://127.0.0.1:${port}  ck=${woo.opts.consumerKey} cs=${woo.opts.consumerSecret}`);
  });
