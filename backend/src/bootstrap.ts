import { config } from './lib/config.js';
import { ensureWebhooks, getShop, refreshShopMeta, saveShopConnection } from './services/shop.js';
import { startInitialSync } from './services/sync.js';
import { normalizeStoreUrl } from './woo/client.js';

/** Nếu có WC_STORE_URL + khóa trong .env: tạo/cập nhật shop khi khởi động (khóa không bao giờ rời server) */
export async function bootstrapShopFromEnv() {
  const c = config();
  if (!c.WC_STORE_URL || !c.WC_CONSUMER_KEY || !c.WC_CONSUMER_SECRET) return;
  const before = await getShop();
  const url = normalizeStoreUrl(c.WC_STORE_URL);
  let shop = await saveShopConnection({
    url,
    consumerKey: c.WC_CONSUMER_KEY,
    consumerSecret: c.WC_CONSUMER_SECRET,
    webhookSecret: c.WC_WEBHOOK_SECRET,
  });
  try {
    shop = await refreshShopMeta(shop);
    await ensureWebhooks(shop).catch((e) => console.warn(`[bootstrap] không tự tạo được webhook: ${e.message}`));
  } catch (e) {
    console.warn(`[bootstrap] chưa kết nối được WooCommerce: ${(e as Error).message}`);
  }
  if (!before || before.url !== url) await startInitialSync(shop);
}
