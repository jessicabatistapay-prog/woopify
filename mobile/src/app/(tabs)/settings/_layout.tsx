import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '../../../lib/theme';
import { BellButton } from '../../../ui/bell';

export default function SettingsStack() {
  return (
    <Stack screenOptions={{ headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg }, headerBackTitle: 'Cài đặt' }}>
      <Stack.Screen name="index" options={{ title: 'Cài đặt', headerRight: () => <BellButton /> }} />
      <Stack.Screen name="connection" options={{ title: 'Kết nối cửa hàng' }} />
      <Stack.Screen name="push" options={{ title: 'Kiểm tra thông báo' }} />
    </Stack>
  );
}
