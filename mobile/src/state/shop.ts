import { useEffect } from 'react';
import type { Api, ShopInfo } from '../api/types';
import { readCache, writeCache } from '../lib/cache';
import { createStore, useStore } from './store';

const shopStore = createStore<{ shop: ShopInfo | null; connected: boolean | null; forApi: Api | null }>({ shop: null, connected: null, forApi: null });

export async function loadShop(api: Api) {
  try {
    const r = await api.getShop();
    shopStore.set({ shop: r.connected ? r.shop : null, connected: r.connected, forApi: api });
    writeCache('shop', r);
    return r;
  } catch (e) {
    const c = await readCache<any>('shop');
    if (c) shopStore.set({ shop: c.data.connected ? c.data.shop : null, connected: c.data.connected, forApi: api });
    throw e;
  }
}

/** Thông tin shop (múi giờ, tiền tệ) dùng chung cho mọi màn hình */
export function useShopInfo(api: Api) {
  const s = useStore(shopStore);
  useEffect(() => {
    if (s.forApi !== api) loadShop(api).catch(() => undefined);
  }, [api, s.forApi]);
  return { shop: s.forApi === api ? s.shop : null, connected: s.forApi === api ? s.connected : null, tz: (s.forApi === api && s.shop?.timezone) || 'UTC' };
}
