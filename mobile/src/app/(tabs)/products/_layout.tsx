import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '../../../lib/theme';
import { BellButton } from '../../../ui/bell';

export default function ProductsStack() {
  return (
    <Stack screenOptions={{ headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg }, headerBackTitle: 'Quay lại' }}>
      <Stack.Screen name="index" options={{ title: 'Sản phẩm', headerRight: () => <BellButton /> }} />
      <Stack.Screen name="[id]" options={{ title: 'Chi tiết sản phẩm' }} />
      <Stack.Screen name="edit" options={{ title: 'Sửa giá & tồn kho' }} />
      <Stack.Screen name="new" options={{ title: 'Tạo sản phẩm nháp' }} />
      <Stack.Screen name="info" options={{ title: 'Thông tin sản phẩm' }} />
    </Stack>
  );
}
