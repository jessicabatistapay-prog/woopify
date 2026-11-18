import { useSyncExternalStore } from 'react';

/** Store nhỏ cho trạng thái UI cần giữ khi chuyển màn hình (bộ lọc, từ khóa) */
export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => T)) {
      state = typeof patch === 'function' ? (patch as (s: T) => T)(state) : { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    reset: () => {
      state = initial;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useStore<T>(s: ReturnType<typeof createStore<T>>): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}

export interface OrderFilters {
  status: string; // 'any' | slug | 'a,b'
  q: string;
  dateKey: 'all' | 'today' | '7d' | '30d';
  from?: string;
  to?: string;
  label?: string; // nhãn mô tả khi mở từ dashboard
}
export const orderFilters = createStore<OrderFilters>({ status: 'any', q: '', dateKey: 'all' });

export interface ProductFilters {
  q: string;
  category?: number;
  stock?: 'instock' | 'low' | 'outofstock';
}
export const productFilters = createStore<ProductFilters>({ q: '' });

export const unreadStore = createStore<{ count: number }>({ count: 0 });
