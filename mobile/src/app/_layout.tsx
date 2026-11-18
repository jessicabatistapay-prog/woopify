import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { SessionProvider, useSession } from '../state/session';
import { configureNotifications, registerDevice, watchTokenChanges } from '../lib/push';
import { routeForNotificationData } from '../lib/notificationRoute';
import { colors } from '../lib/theme';
import { Loading } from '../ui/kit';

configureNotifications();

/**
 * Chạm thông báo → mở đúng màn hình, trong cả ba trường hợp:
 * - app đang mở / chạy nền: addNotificationResponseReceivedListener
 * - app đã đóng hẳn (mở lạnh): getLastNotificationResponse() khi phiên đăng nhập sẵn sàng
 * - chưa đăng nhập: giữ đường dẫn, mở sau khi đăng nhập
 */
function NotificationRouter() {
  const router = useRouter();
  const { status, api } = useSession();
  const pending = useRef<string | null>(null);
  const handled = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handle = (r: Notifications.NotificationResponse | null) => {
      if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const id = r.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);
      const data = r.notification.request.content.data;
      const route = routeForNotificationData(data);
      const nid = Number((data as any)?.notificationId);
      if (nid && api) api.markNotificationsRead({ ids: [nid] }).catch(() => undefined);
      if (!route) return;
      if (status !== 'signedIn') pending.current = route;
      else router.push(route as any);
    };
    if (status === 'signedIn') handle(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [status, api, router]);

  useEffect(() => {
    if (status === 'signedIn' && pending.current) {
      const r = pending.current;
      pending.current = null;
      setTimeout(() => router.push(r as any), 50);
    }
  }, [status, router]);

  // Đăng ký thiết bị sau khi đăng nhập; theo dõi token thay đổi
  useEffect(() => {
    if (status !== 'signedIn' || !api || Platform.OS === 'web') return;
    registerDevice(api, true).catch(() => undefined);
    return watchTokenChanges(api);
  }, [status, api]);

  return null;
}

function RootStack() {
  const { status } = useSession();
  if (status === 'loading') return <Loading label="Đang mở…" />;
  const signedIn = status === 'signedIn';
  return (
    <>
      <NotificationRouter />
      <Stack screenOptions={{ headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg }, headerBackTitle: 'Quay lại' }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="notifications" options={{ title: 'Thông báo', presentation: 'card' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <RootStack />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
