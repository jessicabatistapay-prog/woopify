import { q, q1 } from '../lib/db.js';
import { enqueue } from '../jobs/queue.js';
import type { WooOrder, WooProduct } from '../woo/types.js';
import { processOrderSnapshot } from './events.js';
import { markProductDeleted, upsertCategories, upsertProduct } from './productStore.js';
import { clientFor, getShopById, type ShopRow } from './shop.js';
import { gmt } from '../lib/format.js';

const ORDER_PAGE = 50;

/** Khóa chống trùng theo trang: job tiếp nối và job khôi phục sau khởi động lại gộp làm một */
function syncKey(resource: string, shopId: number, phase: string, page: number) {
  return `sync.${resource}:${shopId}:${phase}:${page}`;
}
const PRODUCT_PAGE = 50;

export async function startInitialSync(shop: ShopRow) {
  const now = new Date();
  for (const resource of ['orders', 'products']) {
    await q(
      `INSERT INTO sync_state (shop_id, resource, status, phase, snapshot_before, next_page, synced_items, started_at, updated_at)
       VALUES ($1,$2,'running',$3,$4,1,0,now(),now())
       ON CONFLICT (shop_id, resource) DO UPDATE SET status='running', phase=EXCLUDED.phase, snapshot_before=EXCLUDED.snapshot_before,
         next_page=1, synced_items=0, total_pages=NULL, total_items=NULL, oldest_synced_at=NULL, started_at=now(),
         finished_at=NULL, last_error=NULL, last_reconcile_at=COALESCE(sync_state.last_reconcile_at, EXCLUDED.snapshot_before), updated_at=now()`,
      [shop.id, resource, resource === 'orders' ? 'open' : 'all', now],
    );
    await q(`UPDATE sync_state SET last_reconcile_at=$3 WHERE shop_id=$1 AND resource=$2`, [shop.id, resource, now]);
  }
  await enqueue('sync.orders', { shopId: shop.id }, { dedupeKey: syncKey('orders', shop.id, 'open', 1) });
  await enqueue('sync.products', { shopId: shop.id }, { dedupeKey: syncKey('products', shop.id, 'all', 1) });
}

/** Sau khi backend khởi động lại: đảm bảo đồng bộ đang dở có job tiếp tục */
export async function resumeSyncs() {
  const rows = await q<{ shop_id: number; resource: string; phase: string; next_page: number }>(
    `SELECT shop_id, resource, phase, next_page FROM sync_state WHERE status='running'`,
  );
  for (const r of rows) {
    await enqueue(`sync.${r.resource}`, { shopId: r.shop_id }, { dedupeKey: syncKey(r.resource, r.shop_id, r.phase, r.next_page) });
  }
}

/**
 * Một trang đồng bộ đơn. Pha "open": đơn đang mở (processing/on-hold/pending) để danh sách “Cần xử lý” đủ ngay.
 * Pha "history": toàn bộ đơn, mới nhất trước, cố định mốc before=thời điểm bắt đầu để phân trang ổn định
 * (đơn mới phát sinh trong lúc đồng bộ đến qua webhook). Tiến độ lưu trong sync_state → tiếp tục được sau khi khởi động lại.
 */
export async function syncOrdersPage(shopId: number): Promise<'continue' | 'done' | 'idle'> {
  const shop = await getShopById(shopId);
  const st = await q1<any>(`SELECT * FROM sync_state WHERE shop_id=$1 AND resource='orders'`, [shopId]);
  if (!shop || !st || st.status !== 'running') return 'idle';
  const client = clientFor(shop);
  const query: Record<string, any> = {
    per_page: ORDER_PAGE,
    page: st.next_page,
    orderby: 'date',
    order: 'desc',
    before: st.snapshot_before.toISOString().replace(/\.\d+Z$/, ''),
    dates_are_gmt: true,
  };
  if (st.phase === 'open') query.status = 'processing,on-hold,pending';
  try {
    const res = await client.get<WooOrder[]>('/wc/v3/orders', query);
    for (const o of res.data) await processOrderSnapshot(shop, o, 'initial');
    const totalPages = res.totalPages ?? (res.data.length < ORDER_PAGE ? st.next_page : st.next_page + 1);
    const oldest = res.data.length ? gmt(res.data[res.data.length - 1].date_created_gmt) : null;
    const finishedPhase = res.data.length === 0 || st.next_page >= totalPages;
    if (st.phase === 'history') {
      await q(
        `UPDATE sync_state SET next_page=next_page+1, total_pages=$2, total_items=$3, synced_items=synced_items+$4,
          oldest_synced_at=LEAST(COALESCE(oldest_synced_at,$5),$5), updated_at=now() WHERE shop_id=$1 AND resource='orders'`,
        [shopId, totalPages, res.total ?? null, res.data.length, oldest ?? st.snapshot_before],
      );
    } else {
      await q(`UPDATE sync_state SET next_page=next_page+1, updated_at=now() WHERE shop_id=$1 AND resource='orders'`, [shopId]);
    }
    let nextPhase = st.phase;
    let nextPage = st.next_page + 1;
    if (finishedPhase) {
      if (st.phase === 'open') {
        nextPhase = 'history';
        nextPage = 1;
        await q(`UPDATE sync_state SET phase='history', next_page=1, updated_at=now() WHERE shop_id=$1 AND resource='orders'`, [shopId]);
      } else {
        await q(
          `UPDATE sync_state SET status='done', finished_at=now(), oldest_synced_at=NULL, updated_at=now() WHERE shop_id=$1 AND resource='orders'`,
          [shopId],
        );
        return 'done';
      }
    }
    await enqueue('sync.orders', { shopId }, { dedupeKey: syncKey('orders', shopId, nextPhase, nextPage) });
    return 'continue';
  } catch (e) {
    await q(`UPDATE sync_state SET last_error=$2, updated_at=now() WHERE shop_id=$1 AND resource='orders'`, [shopId, (e as Error).message]);
    throw e;
  }
}

async function syncVariations(shop: ShopRow, productId: number) {
  const client = clientFor(shop);
  let page = 1;
  for (;;) {
    const res = await client.get<WooProduct[]>(`/wc/v3/products/${productId}/variations`, { per_page: 100, page });
    for (const v of res.data) await upsertProduct(shop.id, { ...v, type: 'variation' }, productId);
    if (res.data.length < 100 || page >= (res.totalPages ?? page)) break;
    page++;
  }
}

export async function syncProductsPage(shopId: number): Promise<'continue' | 'done' | 'idle'> {
  const shop = await getShopById(shopId);
  const st = await q1<any>(`SELECT * FROM sync_state WHERE shop_id=$1 AND resource='products'`, [shopId]);
  if (!shop || !st || st.status !== 'running') return 'idle';
  const client = clientFor(shop);
  try {
    if (st.next_page === 1) {
      let page = 1;
      for (;;) {
        const cats = await client.get<any[]>('/wc/v3/products/categories', { per_page: 100, page });
        await upsertCategories(shopId, cats.data);
        if (cats.data.length < 100) break;
        page++;
      }
    }
    const res = await client.get<WooProduct[]>('/wc/v3/products', { per_page: PRODUCT_PAGE, page: st.next_page, orderby: 'id', order: 'desc' });
    for (const p of res.data) {
      await upsertProduct(shopId, p);
      if (p.type === 'variable') await syncVariations(shop, p.id);
    }
    const totalPages = res.totalPages ?? st.next_page;
    await q(
      `UPDATE sync_state SET next_page=next_page+1, total_pages=$2, total_items=$3, synced_items=synced_items+$4, updated_at=now()
       WHERE shop_id=$1 AND resource='products'`,
      [shopId, totalPages, res.total ?? null, res.data.length],
    );
    if (res.data.length === 0 || st.next_page >= totalPages) {
      await q(`UPDATE sync_state SET status='done', finished_at=now() WHERE shop_id=$1 AND resource='products'`, [shopId]);
      return 'done';
    }
    await enqueue('sync.products', { shopId }, { dedupeKey: syncKey('products', shopId, 'all', st.next_page + 1) });
    return 'continue';
  } catch (e) {
    await q(`UPDATE sync_state SET last_error=$2 WHERE shop_id=$1 AND resource='products'`, [shopId, (e as Error).message]);
    throw e;
  }
}

/** Đối soát định kỳ: lấy đơn/sản phẩm sửa đổi sau lần đối soát trước để bù webhook bị lỡ */
export async function reconcile(shopId: number) {
  const shop = await getShopById(shopId);
  if (!shop) return;
  const client = clientFor(shop);
  const startedAt = new Date();
  for (const resource of ['orders', 'products'] as const) {
    const st = await q1<any>(`SELECT last_reconcile_at FROM sync_state WHERE shop_id=$1 AND resource=$2`, [shopId, resource]);
    const since = new Date((st?.last_reconcile_at ?? new Date(Date.now() - 3600_000)).getTime() - 5 * 60_000);
    let page = 1;
    for (;;) {
      const res = await client.get<any[]>(`/wc/v3/${resource}`, {
        per_page: 100,
        page,
        modified_after: since.toISOString().replace(/\.\d+Z$/, ''),
        dates_are_gmt: true,
        orderby: 'modified',
        order: 'asc',
      });
      for (const item of res.data) {
        if (resource === 'orders') await processOrderSnapshot(shop, item, 'reconcile');
        else {
          await upsertProduct(shopId, item);
          if (item.type === 'variable') await syncVariations(shop, item.id);
        }
      }
      if (res.data.length < 100 || page >= (res.totalPages ?? page)) break;
      page++;
    }
    await q(
      `INSERT INTO sync_state (shop_id, resource, status, last_reconcile_at) VALUES ($1,$2,'done',$3)
       ON CONFLICT (shop_id, resource) DO UPDATE SET last_reconcile_at=$3, updated_at=now()`,
      [shopId, resource, startedAt],
    );
  }
}

export async function handleProductPayload(shop: ShopRow, topic: string, p: WooProduct) {
  if (topic === 'product.deleted') return markProductDeleted(shop.id, p.id);
  if (p.type === 'variation' || (p.parent_id && p.parent_id > 0)) {
    await upsertProduct(shop.id, { ...p, type: 'variation' }, p.parent_id);
    return;
  }
  await upsertProduct(shop.id, p);
  if (p.type === 'variable') await syncVariations(shop, p.id);
}

export async function syncStatus(shopId: number) {
  const rows = await q<any>(`SELECT * FROM sync_state WHERE shop_id=$1`, [shopId]);
  const by = Object.fromEntries(rows.map((r) => [r.resource, r]));
  const o = by.orders;
  const p = by.products;
  const lastSyncAt = [o?.last_reconcile_at, p?.last_reconcile_at, o?.finished_at].filter(Boolean).sort().pop() ?? null;
  return {
    orders: o
      ? {
          status: o.status,
          phase: o.phase,
          synced: o.synced_items,
          total: o.total_items,
          // Đã có đủ dữ liệu từ mốc này đến hiện tại (null = đầy đủ hoặc chưa bắt đầu pha lịch sử)
          completeFrom: o.status === 'done' ? null : (o.oldest_synced_at ?? o.snapshot_before),
          error: o.last_error,
          lastReconcileAt: o.last_reconcile_at,
        }
      : null,
    products: p ? { status: p.status, synced: p.synced_items, total: p.total_items, error: p.last_error } : null,
    lastSyncAt,
  };
}
