import React, { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';
import { useApi } from '../../state/session';
import { unreadStore } from '../../state/store';
import { BellButton } from '../../ui/bell';

export default function TabsLayout() {
  const api = useApi();
  const refreshUnread = useCallback(() => {
    api
      .listNotifications(1)
      .then((r) => unreadStore.set({ count: r.unread }))
      .catch(() => undefined);
  }, [api]);
  useEffect(() => {
    refreshUnread();
    const s = AppState.addEventListener('change', (st) => st === 'active' && refreshUnread());
    const t = setInterval(refreshUnread, 60_000);
    return () => {
      s.remove();
      clearInterval(t);
    };
  }, [refreshUnread]);

  const icon = (name: React.ComponentProps<typeof Ionicons>['name']) => {
    const TabIcon = ({ color, focused }: { color: any; focused: boolean }) => <Ionicons name={(focused ? name : `${name}-outline`) as any} size={26} color={color} />;
    return TabIcon;
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { minHeight: 60 },
        headerShown: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Tổng quan', tabBarIcon: icon('home'), headerShown: true, headerTitle: 'Tổng quan', headerRight: () => <BellButton /> }} />
      <Tabs.Screen name="orders" options={{ title: 'Đơn hàng', tabBarIcon: icon('receipt') }} />
      <Tabs.Screen name="products" options={{ title: 'Sản phẩm', tabBarIcon: icon('pricetags') }} />
      <Tabs.Screen name="settings" options={{ title: 'Cài đặt', tabBarIcon: icon('settings') }} />
    </Tabs>
  );
}
