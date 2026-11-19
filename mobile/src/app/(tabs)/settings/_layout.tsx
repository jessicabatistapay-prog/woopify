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
      <Stack.Screen name="store" options={{ title: 'Quản lý cửa hàng' }} />
      <Stack.Screen name="wc-groups" options={{ title: 'Cài đặt WooCommerce' }} />
      <Stack.Screen name="wc-group" options={{ title: 'Cài đặt' }} />
      <Stack.Screen name="payments" options={{ title: 'Thanh toán' }} />
      <Stack.Screen name="payment" options={{ title: 'Cổng thanh toán' }} />
      <Stack.Screen name="shipping" options={{ title: 'Vận chuyển' }} />
      <Stack.Screen name="shipping-method" options={{ title: 'Phương thức vận chuyển' }} />
      <Stack.Screen name="coupons" options={{ title: 'Mã giảm giá' }} />
      <Stack.Screen name="coupon" options={{ title: 'Mã giảm giá' }} />
      <Stack.Screen name="customers" options={{ title: 'Khách hàng' }} />
      <Stack.Screen name="customer" options={{ title: 'Khách hàng' }} />
      <Stack.Screen name="tracker" options={{ title: 'Theo dõi lượt truy cập' }} />
    </Stack>
  );
}
