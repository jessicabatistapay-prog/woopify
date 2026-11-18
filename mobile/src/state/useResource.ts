import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { readCache, writeCache } from '../lib/cache';

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean; // lần tải đầu, chưa có gì để hiển thị
  refreshing: boolean;
  /** dữ liệu đang hiển thị là bản đã lưu (mất mạng hoặc lỗi) */
  fromCache: boolean;
  updatedAt: number | null;
  refresh: () => Promise<void>;
  setData: (d: T) => void;
}

function toApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError('server', (e as Error)?.message ?? 'Lỗi không xác định');
}

/** Tải dữ liệu + hiển thị bản đã lưu khi không tải được (kèm thời điểm đồng bộ gần nhất). */
export function useResource<T>(cacheKey: string | null, fetcher: () => Promise<T>, deps: unknown[] = []): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const seq = useRef(0);
  const fetchRef = useRef(fetcher);
  useLayoutEffect(() => {
    fetchRef.current = fetcher;
  });
  const depKey = JSON.stringify([cacheKey, ...deps.map((d) => (typeof d === 'object' && d !== null ? 'obj' : d))]);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const my = ++seq.current;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const d = await fetchRef.current();
        if (my !== seq.current) return;
        setData(d);
        setError(null);
        setFromCache(false);
        setUpdatedAt(Date.now());
        if (cacheKey) writeCache(cacheKey, d);
      } catch (e) {
        if (my !== seq.current) return;
        const err = toApiError(e);
        setError(err);
        if (cacheKey) {
          const c = await readCache<T>(cacheKey);
          if (c && my === seq.current) {
            setData((cur) => cur ?? c.data);
            setFromCache(true);
            setUpdatedAt((u) => u ?? c.savedAt);
          }
        }
      } finally {
        if (my === seq.current) {
          setLoadedKey(keyRef.current);
          setRefreshing(false);
        }
      }
    },
    [cacheKey],
  );

  const keyRef = useRef(depKey);
  useEffect(() => {
    keyRef.current = depKey;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải khi mount; setState chỉ chạy sau await
    load('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, ...deps]);

  return {
    data,
    error,
    loading: loadedKey !== depKey && data === null,
    refreshing,
    fromCache,
    updatedAt,
    refresh: () => load('refresh'),
    setData: (d: T) => {
      setData(d);
      setUpdatedAt(Date.now());
      setFromCache(false);
      if (cacheKey) writeCache(cacheKey, d);
    },
  };
}
