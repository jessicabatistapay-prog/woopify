import { config } from '../lib/config.js';
import { q, q1 } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { WooError } from '../woo/client.js';
import type { WooProduct } from '../woo/types.js';
import { withIdempotency } from './idempotency.js';
import { attributesLabel, manageStockValue, upsertProduct } from './productStore.js';
import { adminProductUrl, clientFor, type ShopRow } from './shop.js';

export type StockFilter = 'instock' | 'low' | 'outofstock';

export async function listProducts(shop: ShopRow, query: { q?: string; category?: number; stock?: StockFilter; page?: number; limit?: number }) {
  const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const params: unknown[] = [shop.id];
  const where = ['p.shop_id=$1', 'p.parent_id=0', 'NOT p.deleted', `p.status <> 'trash'`];
  let matchSelect = 'NULL::json AS matched_variation';
  if (query.q) {
    const term = query.q.trim().toLowerCase();
    params.push(`%${term.replace(/[%_]/g, '\\$&')}%`);
    const i = params.length;
    params.push(term);
    const j = params.length;
    where.push(`(lower(p.name) LIKE $${i} OR lower(p.sku) LIKE $${i} OR EXISTS (
      SELECT 1 FROM products v WHERE v.shop_id=p.shop_id AND v.parent_id=p.id AND NOT v.deleted AND lower(v.sku) LIKE $${i}))`);
    matchSelect = `(SELECT json_build_object('id', v.id, 'sku', v.sku, 'label', v.attributes_label) FROM products v
      WHERE v.shop_id=p.shop_id AND v.parent_id=p.id AND NOT v.deleted AND lower(v.sku) LIKE $${i}
      ORDER BY (lower(v.sku) = $${j}) DESC, v.id LIMIT 1) AS matched_variation`;
  }
  if (query.category) {
    params.push(query.category);
    where.push(`$${params.length} = ANY(p.category_ids)`);
  }
  const low = `COALESCE(p.low_stock_amount, ${Number(shop.low_stock_amount) || 2})`;
  // Lọc tồn kho tính cả biến thể: sản phẩm biến thể khớp nếu có ít nhất một biến thể khớp
  const stockCond = (alias: string, f: StockFilter) =>
    f === 'outofstock'
      ? `${alias}.stock_status = 'outofstock'`
      : f === 'low'
        ? `${alias}.manage_stock <> 'false' AND ${alias}.stock_quantity IS NOT NULL AND ${alias}.stock_quantity > 0 AND ${alias}.stock_quantity <= ${low.replace(/p\./g, `${alias}.`)}`
        : `${alias}.stock_status IN ('instock','onbackorder')`;
  if (query.stock) {
    where.push(`((p.type <> 'variable' AND ${stockCond('p', query.stock)}) OR (p.type = 'variable' AND EXISTS (
      SELECT 1 FROM products v WHERE v.shop_id=p.shop_id AND v.parent_id=p.id AND NOT v.deleted AND ${stockCond('v', query.stock)})))`);
  }
  params.push(limit + 1, (page - 1) * limit);
  const rows = await q<any>(
    `SELECT p.id, p.type, p.name, p.sku, p.status, p.price, p.regular_price, p.sale_price, p.manage_stock, p.stock_quantity,
       p.stock_status, p.image_url, p.date_modified_gmt,
       (SELECT count(*)::int FROM products v WHERE v.shop_id=p.shop_id AND v.parent_id=p.id AND NOT v.deleted) AS variation_count,
       (SELECT json_build_object('min', min(NULLIF(v.price,'')::numeric), 'max', max(NULLIF(v.price,'')::numeric),
          'stock', sum(v.stock_quantity), 'out', count(*) FILTER (WHERE v.stock_status='outofstock'))
        FROM products v WHERE v.shop_id=p.shop_id AND v.parent_id=p.id AND NOT v.deleted) AS variation_summary,
       ${matchSelect}
     FROM products p WHERE ${where.join(' AND ')} ORDER BY p.date_modified_gmt DESC NULLS LAST, p.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.slice(0, limit), page, hasMore: rows.length > limit };
}

export async function listCategories(shop: ShopRow) {
  return q('SELECT id, name, parent, count FROM product_categories WHERE shop_id=$1 ORDER BY name', [shop.id]);
}

export function presentProduct(shop: ShopRow, p: WooProduct, parent?: WooProduct) {
  const ms = manageStockValue(p);
  // Nơi tồn kho thực sự được quản lý (để app hiển thị và gửi đúng chỗ)
  let stockMode: 'product' | 'parent' | 'status_only';
  if (!shop.manage_stock_enabled) stockMode = 'status_only';
  else if (ms === 'true') stockMode = 'product';
  else if (ms === 'parent' || (p.type === 'variation' && parent?.manage_stock === true)) stockMode = 'parent';
  else stockMode = 'status_only';
  return {
    id: p.id,
    parentId: p.type === 'variation' ? (parent?.id ?? p.parent_id ?? 0) : 0,
    type: p.type,
    name: p.type === 'variation' ? `${parent?.name ?? ''}`.trim() : p.name,
    variationLabel: attributesLabel(p),
    attributes: (p.attributes ?? []).map((a) => ({ name: a.name, option: a.option ?? null, options: a.options ?? null })),
    sku: p.sku,
    status: p.status,
    price: p.price,
    regularPrice: p.regular_price,
    salePrice: p.sale_price,
    manageStock: ms,
    stockMode,
    stockQuantity: p.stock_quantity,
    parentStockQuantity: stockMode === 'parent' ? (parent?.stock_quantity ?? null) : null,
    stockStatus: p.stock_status,
    lowStockAmount: p.low_stock_amount ?? shop.low_stock_amount,
    imageUrl: p.type === 'variation' ? (p.image?.src ?? null) : (p.images?.[0]?.src ?? null),
    images: (p.images ?? []).map((i) => i.src),
    categories: p.categories ?? [],
    shortDescription: p.short_description ?? '',
    dateModified: p.date_modified_gmt,
    permalink: p.permalink ?? null,
    adminUrl: adminProductUrl(shop, p.type === 'variation' ? (parent?.id ?? p.parent_id ?? p.id) : p.id),
  };
}

async function fetchVariations(shop: ShopRow, id: number): Promise<WooProduct[]> {
  const out: WooProduct[] = [];
  for (let page = 1; ; page++) {
    const r = await clientFor(shop).get<WooProduct[]>(`/wc/v3/products/${id}/variations`, { per_page: 100, page });
    out.push(...r.data.map((v) => ({ ...v, type: 'variation', parent_id: id })));
    if (r.data.length < 100) break;
  }
  return out;
}

export async function getProductDetail(shop: ShopRow, id: number) {
  try {
    const p = (await clientFor(shop).get<WooProduct>(`/wc/v3/products/${id}`)).data;
    if (p.type === 'variation' && p.parent_id) return getProductDetail(shop, p.parent_id);
    await upsertProduct(shop.id, p);
    const variations = p.type === 'variable' ? await fetchVariations(shop, id) : [];
    for (const v of variations) await upsertProduct(shop.id, v, id);
    return { product: presentProduct(shop, p), variations: variations.map((v) => presentProduct(shop, v, p)), stale: false, fetchedAt: new Date() };
  } catch (e) {
    if (e instanceof WooError && e.kind === 'not_found') throw new AppError(404, 'not_found', 'Sản phẩm không còn trên website.');
    const row = await q1<any>('SELECT raw, updated_at FROM products WHERE shop_id=$1 AND id=$2', [shop.id, id]);
    if (!row) throw e;
    const vars = await q<any>('SELECT raw FROM products WHERE shop_id=$1 AND parent_id=$2 AND NOT deleted ORDER BY id', [shop.id, id]);
    return {
      product: presentProduct(shop, row.raw),
      variations: vars.map((v) => presentProduct(shop, v.raw, row.raw)),
      stale: true,
      fetchedAt: row.updated_at,
    };
  }
}

export interface ProductPatch {
  regularPrice?: string;
  salePrice?: string; // "" = bỏ giảm giá
  stockQuantity?: number;
  stockStatus?: 'instock' | 'outofstock' | 'onbackorder';
  expectedModified?: string; // date_modified_gmt khi người dùng mở form
  force?: boolean;
}

const money = /^\d+(\.\d{1,4})?$/;

function validatePatch(p: ProductPatch, current: WooProduct) {
  if (p.regularPrice !== undefined && p.regularPrice !== '' && !money.test(p.regularPrice)) throw new AppError(400, 'invalid_price', 'Giá thường không hợp lệ');
  if (p.salePrice !== undefined && p.salePrice !== '' && !money.test(p.salePrice)) throw new AppError(400, 'invalid_price', 'Giá khuyến mãi không hợp lệ');
  const reg = Number(p.regularPrice ?? current.regular_price);
  if (p.salePrice && reg && Number(p.salePrice) >= reg) throw new AppError(400, 'invalid_price', 'Giá khuyến mãi phải thấp hơn giá thường');
  if (p.stockQuantity !== undefined && (!Number.isInteger(p.stockQuantity) || Math.abs(p.stockQuantity) > 1_000_000)) {
    throw new AppError(400, 'invalid_stock', 'Tồn kho phải là số nguyên');
  }
}

/**
 * Sửa giá/tồn kho cho sản phẩm hoặc biến thể. Tôn trọng nơi quản lý tồn kho:
 * - biến thể tự quản lý → ghi stock_quantity của biến thể
 * - biến thể kế thừa sản phẩm cha (manage_stock = "parent") → ghi stock_quantity của sản phẩm cha
 * - không quản lý số lượng → chỉ ghi stock_status
 * Trả về các bản ghi đã được WooCommerce xác nhận.
 */
export async function updateProductOrVariation(shop: ShopRow, productId: number, variationId: number | null, patch: ProductPatch) {
  const client = clientFor(shop);
  const parent = (await client.get<WooProduct>(`/wc/v3/products/${productId}`)).data;
  const path = variationId ? `/wc/v3/products/${productId}/variations/${variationId}` : `/wc/v3/products/${productId}`;
  const current = variationId ? { ...(await client.get<WooProduct>(path)).data, type: 'variation', parent_id: productId } : parent;

  if (!patch.force && patch.expectedModified && current.date_modified_gmt !== patch.expectedModified) {
    await upsertProduct(shop.id, current, variationId ? productId : 0);
    throw new AppError(409, 'conflict', 'Dữ liệu vừa được sửa trên website sau khi bạn mở. Tải lại để xem giá trị mới trước khi ghi đè.', {
      current: presentProduct(shop, current, variationId ? parent : undefined),
    });
  }
  validatePatch(patch, current);
  const info = presentProduct(shop, current, variationId ? parent : undefined);

  const body: Record<string, unknown> = {};
  if (patch.regularPrice !== undefined) body.regular_price = patch.regularPrice;
  if (patch.salePrice !== undefined) body.sale_price = patch.salePrice;
  let parentBody: Record<string, unknown> | null = null;
  if (patch.stockQuantity !== undefined) {
    if (info.stockMode === 'product') body.stock_quantity = patch.stockQuantity;
    else if (info.stockMode === 'parent') parentBody = { stock_quantity: patch.stockQuantity };
    else throw new AppError(400, 'stock_not_managed', 'Sản phẩm này chỉ theo dõi trạng thái còn/hết hàng, không theo dõi số lượng.');
  }
  if (patch.stockStatus !== undefined) {
    if (info.stockMode !== 'status_only') throw new AppError(400, 'stock_managed', 'Trạng thái kho được WooCommerce tự tính từ số lượng.');
    body.stock_status = patch.stockStatus;
  }

  const changed: ReturnType<typeof presentProduct>[] = [];
  let parentAfter = parent;
  if (parentBody) {
    parentAfter = (await client.put<WooProduct>(`/wc/v3/products/${productId}`, parentBody)).data;
    await upsertProduct(shop.id, parentAfter);
    changed.push(presentProduct(shop, parentAfter));
  }
  let after = current;
  if (Object.keys(body).length) {
    after = (await client.put<WooProduct>(path, body)).data;
    if (variationId) after = { ...after, type: 'variation', parent_id: productId };
    await upsertProduct(shop.id, after, variationId ? productId : 0);
  } else if (variationId && parentBody) {
    after = { ...(await client.get<WooProduct>(path)).data, type: 'variation', parent_id: productId };
    await upsertProduct(shop.id, after, productId);
  }
  const confirmed = presentProduct(shop, after, variationId ? parentAfter : undefined);
  if (!changed.length || variationId) changed.push(confirmed);
  return { item: confirmed, changed };
}

export interface CreateProductInput {
  name: string;
  shortDescription?: string;
  sku?: string;
  regularPrice?: string;
  salePrice?: string;
  categoryIds?: number[];
  manageStock?: boolean;
  stockQuantity?: number;
  imageUploadIds?: string[];
  idempotencyKey?: string;
}

export async function createDraftProduct(shop: ShopRow, userId: number, input: CreateProductInput) {
  if (!input.name?.trim()) throw new AppError(400, 'bad_request', 'Tên sản phẩm là bắt buộc');
  if (input.regularPrice && !money.test(input.regularPrice)) throw new AppError(400, 'invalid_price', 'Giá không hợp lệ');
  const client = clientFor(shop);
  const images = (input.imageUploadIds ?? []).map((id) => ({ src: `${config().PUBLIC_URL.replace(/\/+$/, '')}/uploads/${encodeURIComponent(id)}` }));
  const body = {
    name: input.name.trim(),
    type: 'simple',
    status: 'draft',
    short_description: input.shortDescription ?? '',
    sku: input.sku?.trim() || undefined,
    regular_price: input.regularPrice ?? '',
    sale_price: input.salePrice ?? '',
    categories: (input.categoryIds ?? []).map((id) => ({ id })),
    manage_stock: !!input.manageStock && shop.manage_stock_enabled,
    stock_quantity: input.manageStock ? (input.stockQuantity ?? 0) : undefined,
    images,
  };
  return withIdempotency(
    input.idempotencyKey,
    userId,
    'product.create',
    body,
    async () => {
      try {
        const p = (await client.post<WooProduct>('/wc/v3/products', body)).data;
        await upsertProduct(shop.id, p);
        return { product: presentProduct(shop, p) };
      } catch (e) {
        if (e instanceof WooError && e.wooCode === 'product_invalid_sku') {
          throw new AppError(409, 'duplicate_sku', 'SKU đã tồn tại trên website.');
        }
        throw e;
      }
    },
    async (since) => {
      // Lần trước mất kết nối: tìm sản phẩm nháp vừa tạo theo SKU hoặc tên
      const found = input.sku
        ? (await client.get<WooProduct[]>('/wc/v3/products', { sku: input.sku.trim(), status: 'any' })).data
        : (await client.get<WooProduct[]>('/wc/v3/products', { search: input.name.trim(), status: 'draft', after: since.toISOString().replace(/\.\d+Z$/, ''), dates_are_gmt: true })).data.filter(
            (p) => p.name === input.name.trim(),
          );
      return found[0] ? { product: presentProduct(shop, found[0]) } : null;
    },
  );
}

export async function publishProduct(shop: ShopRow, id: number) {
  const p = (await clientFor(shop).put<WooProduct>(`/wc/v3/products/${id}`, { status: 'publish' })).data;
  await upsertProduct(shop.id, p);
  return { product: presentProduct(shop, p) };
}
