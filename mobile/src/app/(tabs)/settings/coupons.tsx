import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import type { Coupon, Paged } from '../../../api/types';
import { colors, space } from '../../../lib/theme';
import { useApi } from '../../../state/session';
import { useShopInfo } from '../../../state/shop';
import { useResource } from '../../../state/useResource';
import { StatusStrip } from '../../../ui/app';
import { EmptyState, ErrorState, IconButton, Loading, SearchBar, Txt } from '../../../ui/kit';
import { couponSummary } from '../../../lib/store';

export default function Coupons() {
  const api = useApi();
  const router = useRouter();
  const { shop } = useShopInfo(api);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search), 350);
    return () => clearTimeout(t);
  }, [search]);
  const res = useResource<Paged<Coupon>>(`store:coupons:${q}`, () => api.listCoupons(q || undefined), [api, q]);
  // quay lại từ màn sửa → tải lại để thấy giá trị mới
  const refresh = res.refresh;
  useFocusEffect(
    React.useCallback(() => {
      refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  return (
    <>
      <Stack.Screen options={{ headerRight: () => <IconButton icon="add-circle-outline" label="Tạo mã giảm giá" onPress={() => router.push('/settings/coupon')} /> }} />
      {res.loading ? (
        <Loading />
      ) : !res.data ? (
        <ErrorState error={res.error!} onRetry={res.refresh} />
      ) : (
        <FlatList
          data={res.data.items}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={{ padding: space.lg, gap: space.sm }}
          refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}
          ListHeaderComponent={
            <View style={{ gap: space.md, marginBottom: space.sm }}>
              <SearchBar value={search} onChangeText={setSearch} placeholder="Tìm mã giảm giá" />
              <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} />
            </View>
          }
          ListEmptyComponent={<EmptyState icon="pricetag-outline" title="Chưa có mã giảm giá" action={{ label: 'Tạo mã giảm giá', onPress: () => router.push('/settings/coupon') }} />}
          renderItem={({ item: c }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/settings/coupon', params: { id: String(c.id) } })}
              accessibilityRole="button"
              style={({ pressed }) => ({ backgroundColor: colors.card, borderRadius: 14, padding: space.lg, gap: 4, borderWidth: 0.5, borderColor: colors.border, opacity: pressed ? 0.8 : 1 })}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt bold size="md">
                  {c.code.toUpperCase()}
                </Txt>
                <Txt size="xs" bold style={{ color: c.status === 'publish' ? '#0F5C2E' : colors.warn }}>
                  {c.status === 'publish' ? 'Đang hoạt động' : 'Đã tắt'}
                </Txt>
              </View>
              <Txt muted>{couponSummary(c, shop?.currency ?? 'USD')}</Txt>
              <Txt muted size="xs">
                Đã dùng {c.usageCount}
                {c.usageLimit ? `/${c.usageLimit}` : ''} lần{c.dateExpires ? ` · Hết hạn ${c.dateExpires.split('-').reverse().join('/')}` : ''}
              </Txt>
            </Pressable>
          )}
        />
      )}
    </>
  );
}
