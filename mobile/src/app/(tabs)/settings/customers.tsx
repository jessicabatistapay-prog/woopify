import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Customer, Paged } from '../../../api/types';
import { colors, space } from '../../../lib/theme';
import { money } from '../../../lib/format';
import { useApi } from '../../../state/session';
import { useResource } from '../../../state/useResource';
import { StatusStrip } from '../../../ui/app';
import { EmptyState, ErrorState, Loading, SearchBar, Thumb, Txt } from '../../../ui/kit';

export default function Customers() {
  const api = useApi();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search), 350);
    return () => clearTimeout(t);
  }, [search]);
  const res = useResource<Paged<Customer>>(`store:customers:${q}`, () => api.listCustomers(q || undefined), [api, q]);
  if (res.loading) return <Loading />;
  if (!res.data) return <ErrorState error={res.error!} onRetry={res.refresh} />;
  return (
    <FlatList
      data={res.data.items}
      keyExtractor={(c) => String(c.id)}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.sm }}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Tìm tên hoặc email" />
          <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} />
          <Txt muted size="xs">
            Danh sách khách có tài khoản. Khách mua không đăng ký vẫn xem được qua đơn hàng.
          </Txt>
        </View>
      }
      ListEmptyComponent={<EmptyState icon="people-outline" title={q ? `Không có khách khớp “${q}”` : 'Chưa có khách hàng'} />}
      renderItem={({ item: c }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/settings/customer', params: { id: String(c.id) } })}
          accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: space.md, borderWidth: 0.5, borderColor: colors.border, opacity: pressed ? 0.8 : 1 })}
        >
          <Thumb uri={null} label={c.name} size={44} />
          <View style={{ flex: 1 }}>
            <Txt bold>{c.name}</Txt>
            <Txt muted size="xs">
              {c.email}
            </Txt>
            <Txt muted size="xs">
              {[c.billing.city, c.billing.state, c.billing.country].filter(Boolean).join(', ')}
            </Txt>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt bold>{money(c.totalSpent, c.currency)}</Txt>
            <Txt muted size="xs">
              {c.ordersCount} đơn
            </Txt>
          </View>
        </Pressable>
      )}
    />
  );
}
