import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Category, Paged, ProductSummary } from '../../../api/types';
import { colors, space } from '../../../lib/theme';
import { money } from '../../../lib/format';
import { useApi } from '../../../state/session';
import { useShopInfo } from '../../../state/shop';
import { productFilters, useStore } from '../../../state/store';
import { useResource } from '../../../state/useResource';
import { LastSync, StatusStrip } from '../../../ui/app';
import { PRODUCT_STATUS, stockText } from '../../../lib/product';
import { BellButton } from '../../../ui/bell';
import { Chip, EmptyState, ErrorState, IconButton, Loading, SearchBar, Thumb, Txt } from '../../../ui/kit';

const STOCK = [
  { key: undefined, label: 'Mọi tồn kho' },
  { key: 'instock', label: 'Còn hàng' },
  { key: 'low', label: 'Sắp hết' },
  { key: 'outofstock', label: 'Hết hàng' },
] as const;

export default function ProductsList() {
  const api = useApi();
  const router = useRouter();
  const { shop } = useShopInfo(api);
  const currency = shop?.currency ?? 'USD';
  const f = useStore(productFilters);
  const [search, setSearch] = useState(f.q);
  const [page, setPage] = useState(1);
  const [extra, setExtra] = useState<ProductSummary[]>([]);
  const [more, setMore] = useState<{ hasMore: boolean; loading: boolean }>({ hasMore: false, loading: false });
  const cats = useResource<Category[]>('categories', () => api.categories(), [api]);

  useEffect(() => {
    const t = setTimeout(() => search !== f.q && productFilters.set({ q: search }), 350);
    return () => clearTimeout(t);
  }, [search, f.q]);

  const res = useResource<Paged<ProductSummary>>(
    `products:${f.q}:${f.category ?? ''}:${f.stock ?? ''}`,
    () => api.listProducts({ q: f.q || undefined, category: f.category, stock: f.stock, page: 1 }),
    [api, f.q, f.category, f.stock],
  );
  const [prevData, setPrevData] = useState(res.data);
  if (prevData !== res.data) {
    // trang 1 vừa tải lại → bỏ các trang đã nối thêm
    setPrevData(res.data);
    setPage(1);
    setExtra([]);
    setMore({ hasMore: !!res.data?.hasMore, loading: false });
  }

  const loadMore = async () => {
    if (!more.hasMore || more.loading) return;
    setMore((m) => ({ ...m, loading: true }));
    try {
      const r = await api.listProducts({ q: f.q || undefined, category: f.category, stock: f.stock, page: page + 1 });
      setExtra((e) => [...e, ...r.items]);
      setPage(page + 1);
      setMore({ hasMore: r.hasMore, loading: false });
    } catch {
      setMore((m) => ({ ...m, loading: false }));
    }
  };

  const items = [...(res.data?.items ?? []), ...extra];

  const open = (p: ProductSummary) => {
    if (p.matched_variation) router.push({ pathname: '/products/edit', params: { productId: String(p.id), variationId: String(p.matched_variation.id) } });
    else router.push(`/products/${p.id}`);
  };

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Tìm tên, SKU hoặc SKU biến thể" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {STOCK.map((s) => (
          <Chip key={s.label} label={s.label} selected={f.stock === s.key} onPress={() => productFilters.set({ stock: s.key })} />
        ))}
      </ScrollView>
      {cats.data?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Chip label="Mọi danh mục" selected={!f.category} onPress={() => productFilters.set({ category: undefined })} />
          {cats.data.map((c) => (
            <Chip key={c.id} label={c.name} selected={f.category === c.id} onPress={() => productFilters.set({ category: c.id })} />
          ))}
        </ScrollView>
      ) : null}
      <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} syncing={res.data?.syncing} />
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <IconButton icon="add-circle-outline" label="Tạo sản phẩm nháp" onPress={() => router.push('/products/new')} />
              <BellButton />
            </View>
          ),
        }}
      />
      {res.loading ? (
        <View style={{ flex: 1, padding: space.lg }}>
          {header}
          <Loading label="Đang tải sản phẩm…" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 40 }}
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            res.error && !res.data ? (
              <ErrorState error={res.error} onRetry={res.refresh} />
            ) : (
              <EmptyState
                icon="pricetags-outline"
                title={f.q ? `Không có sản phẩm khớp “${f.q}”` : 'Chưa có sản phẩm'}
                text={f.q ? 'Tìm được theo tên, SKU sản phẩm và SKU từng biến thể.' : undefined}
                action={f.q || f.stock || f.category ? { label: 'Xóa bộ lọc', onPress: () => (productFilters.reset(), setSearch('')) } : { label: 'Tạo sản phẩm nháp', onPress: () => router.push('/products/new') }}
              />
            )
          }
          ListFooterComponent={more.loading ? <Loading label="Đang tải thêm…" /> : items.length ? <LastSync at={res.updatedAt} /> : undefined}
          renderItem={({ item: p }) => {
            const vs = p.variation_summary;
            const price = p.type === 'variable' && vs?.min != null ? (vs.min === vs.max ? money(vs.min, currency) : `${money(vs.min, currency)} – ${money(vs.max, currency)}`) : p.price ? money(p.price, currency) : 'Chưa có giá';
            const stock = p.type === 'variable' && vs ? { text: `${p.variation_count} biến thể${vs.out ? ` · ${vs.out} hết hàng` : ''}`, color: vs.out ? colors.warn : colors.textMuted } : stockText(p);
            return (
              <Pressable
                onPress={() => open(p)}
                accessibilityRole="button"
                accessibilityLabel={`${p.name}${p.matched_variation ? `, biến thể ${p.matched_variation.label}` : ''}`}
                style={({ pressed }) => ({ backgroundColor: colors.card, borderRadius: 14, padding: space.md, flexDirection: 'row', gap: 12, borderWidth: 0.5, borderColor: colors.border, opacity: pressed ? 0.8 : 1 })}
              >
                <Thumb uri={p.image_url} label={p.name} size={60} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt bold numberOfLines={2}>
                    {p.name}
                  </Txt>
                  {p.sku ? (
                    <Txt muted size="xs">
                      SKU: {p.sku}
                    </Txt>
                  ) : null}
                  <Txt size="sm">{price}</Txt>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Txt size="xs" style={{ color: stock.color, fontWeight: '600' }}>
                      {stock.text}
                    </Txt>
                    <Txt size="xs" style={{ color: p.status === 'publish' ? '#0F5C2E' : colors.warn, fontWeight: '600' }}>
                      · {PRODUCT_STATUS[p.status] ?? p.status}
                    </Txt>
                  </View>
                  {p.matched_variation ? (
                    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 8, padding: 6, marginTop: 4 }}>
                      <Ionicons name="git-branch-outline" size={14} color={colors.primary} />
                      <Txt size="xs" style={{ color: colors.primary, fontWeight: '700', flex: 1 }}>
                        Khớp biến thể {p.matched_variation.sku} · {p.matched_variation.label} — chạm để sửa
                      </Txt>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </>
  );
}
