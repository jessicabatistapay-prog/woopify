import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '../../../lib/theme';
import { BellButton } from '../../../ui/bell';

export default function OrdersStack() {
  return (
    <Stack screenOptions={{ headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg }, headerBackTitle: 'Đơn hàng' }}>
      <Stack.Screen name="index" options={{ title: 'Đơn hàng', headerRight: () => <BellButton /> }} />
      <Stack.Screen name="[id]" options={{ title: 'Chi tiết đơn' }} />
    </Stack>
  );
}
