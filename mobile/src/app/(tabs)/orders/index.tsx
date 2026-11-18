import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { DateTime } from 'luxon';
import type { OrderSummary } from '../../../api/types';
import { ApiError } from '../../../api/client';
import { colors, space } from '../../../lib/theme';
import { money, shopTime } from '../../../lib/format';
import { readCache, writeCache } from '../../../lib/cache';
import { useApi } from '../../../state/session';
import { useShopInfo } from '../../../state/shop';
import { orderFilters, useStore, type OrderFilters } from '../../../state/store';
import { onOrderUpdated } from '../../../state/events';
import { LastSync, StatusStrip } from '../../../ui/app';
import { Banner, Chip, EmptyState, ErrorState, Loading, PaidBadge, SearchBar, StatusBadge, Txt } from '../../../ui/kit';

const STATUS_CHIPS = [
  { slug: 'any', label: 'Tất cả' },
  { slug: 'processing', label: 'Cần xử lý' },
  { slug: 'pending', label: 'Chờ thanh toán' },
  { slug: 'on-hold', label: 'Tạm giữ' },
  { slug: 'completed', label: 'Hoàn thành' },
  { slug: 'cancelled', label: 'Đã hủy' },
  { slug: 'refunded', label: 'Hoàn tiền' },
  { slug: 'failed', label: 'Thất bại' },
];
const DATE_CHIPS: { key: OrderFilters['dateKey']; label: string }[] = [
  { key: 'all', label: 'Mọi ngày' },
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
];

function dateBounds(f: OrderFilters, tz: string): { from?: string; to?: string } {
  if (f.from || f.to) return { from: f.from, to: f.to };
  if (f.dateKey === 'all') return {};
  const today = DateTime.now().setZone(tz).startOf('day');
  const start = f.dateKey === 'today' ? today : today.minus({ days: f.dateKey === '7d' ? 6 : 29 });
  return { from: start.toUTC().toISO()!, to: today.plus({ days: 1 }).toUTC().toISO()! };
}

export default function OrdersList() {
  const api = useApi();
  const router = useRouter();
  const { tz } = useShopInfo(api);
  const f = useStore(orderFilters);
  const [search, setSearch] = useState(f.q);
  const [items, setItems] = useState<OrderSummary[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const seq = useRef(0);

  // Ô tìm kiếm: chờ người dùng ngừng gõ rồi mới áp dụng
  useEffect(() => {
    const t = setTimeout(() => search !== f.q && orderFilters.set({ q: search }), 350);
    return () => clearTimeout(t);
  }, [search, f.q]);
  const [prevQ, setPrevQ] = useState(f.q);
  if (prevQ !== f.q) {
    // bộ lọc bị đổi từ nơi khác (vd. Tổng quan) → đồng bộ ô tìm kiếm
    setPrevQ(f.q);
    setSearch(f.q);
  }

  const key = `orders:${f.status}:${f.q}:${f.dateKey}:${f.from ?? ''}:${f.to ?? ''}`;

  const load = useCallback(
    async (p: number, mode: 'initial' | 'refresh' | 'more') => {
      const my = ++seq.current;
      if (mode === 'more') setLoadingMore(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const r = await api.listOrders({ status: f.status, q: f.q || undefined, ...dateBounds(f, tz), page: p });
        if (my !== seq.current) return;
        setItems((cur) => (p === 1 ? r.items : [...cur, ...r.items.filter((x) => !cur.some((c) => c.id === x.id))]));
        setPage(p);
        setHasMore(r.hasMore);
        setError(null);
        setFromCache(false);
        setUpdatedAt(r.lastSyncAt ?? Date.now());
        setSyncing(!!r.syncing);
        if (p === 1) writeCache(key, r);
      } catch (e) {
        if (my !== seq.current) return;
        setError(e as ApiError);
        if (p === 1) {
          const c = await readCache<any>(key);
          if (c && my === seq.current) {
            setItems(c.data.items);
            setHasMore(false);
            setFromCache(true);
            setUpdatedAt(c.savedAt);
          }
        }
      } finally {
        if (my === seq.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, key, tz],
  );

  // cập nhật tại chỗ khi một đơn vừa đổi trạng thái → giữ nguyên vị trí cuộn
  useEffect(() => onOrderUpdated((u) => setItems((cur) => cur.map((x) => (x.id === u.id ? { ...x, status: u.status, paid: u.paid } : x)))), []);

  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    setLoading(true);
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải khi đổi bộ lọc; setState chỉ chạy sau await
    load(1, 'initial');
  }, [load]);

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Tìm mã đơn, email, tên khách" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {STATUS_CHIPS.map((c) => (
          <Chip key={c.slug} label={c.label} selected={f.status === c.slug} onPress={() => orderFilters.set({ status: c.slug, label: undefined })} />
        ))}
      </ScrollView>
      {f.from || f.to ? (
        <Banner
          tone="info"
          icon="funnel-outline"
          text={`Đang lọc: ${f.label || 'khoảng ngày từ Tổng quan'}`}
          action={{ label: 'Bỏ lọc ngày', onPress: () => orderFilters.set({ from: undefined, to: undefined, label: undefined }) }}
        />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {DATE_CHIPS.map((c) => (
            <Chip key={c.key} label={c.label} selected={f.dateKey === c.key} onPress={() => orderFilters.set({ dateKey: c.key })} />
          ))}
        </ScrollView>
      )}
      {f.label && !(f.from || f.to) ? (
        <Txt muted size="xs">
          {f.label}
        </Txt>
      ) : null}
      <StatusStrip fromCache={fromCache} updatedAt={updatedAt} error={error} syncing={syncing} />
    </View>
  );

  if (loading && items.length === 0) {
    return (
      <View style={{ flex: 1, padding: space.lg }}>
        {header}
        <Loading label="Đang tải đơn hàng…" />
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(o) => String(o.id)}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 40 }}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, 'refresh')} />}
      onEndReachedThreshold={0.4}
      onEndReached={() => hasMore && !loadingMore && !error && load(page + 1, 'more')}
      ListEmptyComponent={
        error && !fromCache ? (
          <ErrorState error={error} onRetry={() => load(1, 'initial')} />
        ) : (
          <EmptyState
            icon="receipt-outline"
            title={f.q ? `Không có đơn khớp “${f.q}”` : 'Chưa có đơn nào'}
            text={f.status !== 'any' || f.dateKey !== 'all' || f.from ? 'Thử bỏ bớt bộ lọc.' : 'Đơn mới sẽ xuất hiện tại đây ngay khi khách đặt.'}
            action={f.status !== 'any' || f.q || f.from || f.dateKey !== 'all' ? { label: 'Xóa bộ lọc', onPress: () => orderFilters.reset() } : undefined}
          />
        )
      }
      ListFooterComponent={loadingMore ? <Loading label="Đang tải thêm…" /> : items.length ? <LastSync at={updatedAt} /> : undefined}
      renderItem={({ item: o }) => (
        <Pressable
          onPress={() => router.push(`/orders/${o.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Đơn ${o.number}, ${o.customer_name}, ${money(o.total, o.currency)}`}
          style={({ pressed }) => ({
            backgroundColor: colors.card,
            borderRadius: 14,
            padding: space.lg,
            gap: 6,
            borderWidth: 0.5,
            borderColor: colors.border,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Txt bold size="md">
              #{o.number}
            </Txt>
            <Txt bold size="md">
              {money(o.total, o.currency)}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt muted numberOfLines={1} style={{ flex: 1 }}>
              {o.customer_name}
            </Txt>
            <Txt muted size="xs">
              {shopTime(o.date_created_gmt, tz, 'dd/MM HH:mm')} · {o.item_count} SP
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <StatusBadge status={o.status} />
            {o.paid !== undefined && o.status !== 'cancelled' && o.status !== 'failed' ? <PaidBadge paid={!!o.paid} /> : null}
          </View>
        </Pressable>
      )}
    />
  );
}
