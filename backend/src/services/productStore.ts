import { q } from '../lib/db.js';
import { gmt } from '../lib/format.js';
import type { WooProduct } from '../woo/types.js';

export function attributesLabel(p: WooProduct): string {
  if (p.type !== 'variation') return '';
  return (p.attributes ?? [])
    .map((a) => a.option)
    .filter(Boolean)
    .join(' / ');
}

export function manageStockValue(p: WooProduct): 'true' | 'false' | 'parent' {
  if (p.manage_stock === 'parent') return 'parent';
  return p.manage_stock ? 'true' : 'false';
}

export async function upsertProduct(shopId: number, p: WooProduct, parentId = 0) {
  const image = p.type === 'variation' ? p.image?.src : p.images?.[0]?.src;
  const modified = gmt(p.date_modified_gmt);
  await q(
    `INSERT INTO products (shop_id, id, parent_id, type, name, sku, status, price, regular_price, sale_price, manage_stock,
       stock_quantity, stock_status, low_stock_amount, image_url, category_ids, attributes_label, date_modified_gmt, raw, deleted, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,false, now())
     ON CONFLICT (shop_id, id) DO UPDATE SET parent_id=EXCLUDED.parent_id, type=EXCLUDED.type, name=EXCLUDED.name, sku=EXCLUDED.sku,
       status=EXCLUDED.status, price=EXCLUDED.price, regular_price=EXCLUDED.regular_price, sale_price=EXCLUDED.sale_price,
       manage_stock=EXCLUDED.manage_stock, stock_quantity=EXCLUDED.stock_quantity, stock_status=EXCLUDED.stock_status,
       low_stock_amount=EXCLUDED.low_stock_amount, image_url=EXCLUDED.image_url, category_ids=EXCLUDED.category_ids,
       attributes_label=EXCLUDED.attributes_label, date_modified_gmt=EXCLUDED.date_modified_gmt, raw=EXCLUDED.raw, deleted=false, updated_at=now()
     WHERE products.date_modified_gmt IS NULL OR EXCLUDED.date_modified_gmt IS NULL OR products.date_modified_gmt <= EXCLUDED.date_modified_gmt`,
    [shopId, p.id, p.type === 'variation' ? parentId || p.parent_id || 0 : 0, p.type, p.name ?? '', p.sku ?? '', p.status ?? '',
      p.price ?? '', p.regular_price ?? '', p.sale_price ?? '', manageStockValue(p), p.stock_quantity ?? null, p.stock_status ?? 'instock',
      p.low_stock_amount ?? null, image ?? null, (p.categories ?? []).map((c) => c.id), attributesLabel(p), modified, JSON.stringify(p)],
  );
}

export async function markProductDeleted(shopId: number, id: number) {
  await q('UPDATE products SET deleted=true, updated_at=now() WHERE shop_id=$1 AND (id=$2 OR parent_id=$2)', [shopId, id]);
}

export async function upsertCategories(shopId: number, cats: { id: number; name: string; parent: number; count: number }[]) {
  for (const c of cats) {
    await q(
      `INSERT INTO product_categories (shop_id, id, name, parent, count) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (shop_id, id) DO UPDATE SET name=EXCLUDED.name, parent=EXCLUDED.parent, count=EXCLUDED.count`,
      [shopId, c.id, c.name, c.parent, c.count],
    );
  }
}
