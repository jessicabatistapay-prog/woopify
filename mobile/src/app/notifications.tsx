import React, { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, space } from '../lib/theme';
import { relativeTime } from '../lib/format';
import { routeForNotificationData } from '../lib/notificationRoute';
import { useApi } from '../state/session';
import { unreadStore } from '../state/store';
import { useResource } from '../state/useResource';
import { StatusStrip } from '../ui/app';
import { Button, EmptyState, ErrorState, Loading, Txt } from '../ui/kit';

const ICON: Record<string, { name: any; color: string }> = {
  'order.placed': { name: 'bag-add', color: colors.primary },
  'order.paid': { name: 'card', color: '#0F5C2E' },
  test: { name: 'paper-plane', color: colors.info },
};

export default function NotificationHistory() {
  const api = useApi();
  const router = useRouter();
  const res = useResource('notifications', () => api.listNotifications(1), [api]);

  useEffect(() => {
    if (res.data) unreadStore.set({ count: res.data.unread });
  }, [res.data]);

  const markAll = async () => {
    await api.markNotificationsRead({ all: true });
    unreadStore.set({ count: 0 });
    res.refresh();
  };

  if (res.loading) return <Loading />;
  if (!res.data) return <ErrorState error={res.error!} onRetry={res.refresh} />;

  return (
    <>
      <Stack.Screen options={{ headerRight: () => (res.data!.unread ? <Button title="Đọc hết" variant="ghost" onPress={markAll} style={{ minHeight: 36 }} /> : null) }} />
      <FlatList
        data={res.data.items}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 4 }}>
            <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} />
            <Txt muted size="xs">
              Lịch sử lưu trên backend — vẫn đầy đủ kể cả khi bạn tắt quyền thông báo trên điện thoại.
            </Txt>
          </View>
        }
        ListEmptyComponent={<EmptyState icon="notifications-off-outline" title="Chưa có thông báo" text="Khi khách đặt đơn mới, thông báo sẽ xuất hiện ở đây." />}
        renderItem={({ item: n }) => {
          const route = routeForNotificationData(n.data);
          const ic = ICON[n.kind] ?? ICON.test;
          return (
            <Pressable
              onPress={() => {
                if (!n.read_at) api.markNotificationsRead({ ids: [n.id] }).then(res.refresh).catch(() => undefined);
                if (route && route !== '/notifications') router.push(route as any);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${n.read_at ? '' : 'Chưa đọc. '}${n.title}. ${n.body}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                gap: 12,
                backgroundColor: n.read_at ? colors.card : '#F0F7F3',
                padding: space.md,
                borderRadius: 14,
                borderWidth: 0.5,
                borderColor: colors.border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Ionicons name={ic.name} size={24} color={ic.color} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt bold>{n.title}</Txt>
                <Txt muted>{n.body}</Txt>
                <Txt muted size="xs">
                  {relativeTime(n.created_at)}
                  {n.deliveries?.some((d) => d.status === 'error') ? ' · gửi push lỗi' : !n.deliveries?.length ? ' · chỉ trong app' : ''}
                </Txt>
              </View>
              {!n.read_at ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 }} /> : null}
            </Pressable>
          );
        }}
      />
    </>
  );
}
