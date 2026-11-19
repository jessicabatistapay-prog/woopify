import React from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { space } from '../../../lib/theme';
import { StatusStrip } from '../../../ui/app';
import { Card, Divider, Row, Txt } from '../../../ui/kit';

/** Trung tâm quản lý cửa hàng — thay cho phần lớn thao tác trong WooCommerce Admin */
export default function StoreHub() {
  const router = useRouter();
  const go = (p: string) => router.push(p as any);
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }}>
      <StatusStrip />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <Row icon="pricetag-outline" label="Mã giảm giá" onPress={() => go('/settings/coupons')} />
        <Divider />
        <Row icon="people-outline" label="Khách hàng" onPress={() => go('/settings/customers')} />
      </Card>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <Row icon="card-outline" label="Thanh toán" onPress={() => go('/settings/payments')} />
        <Divider />
        <Row icon="car-outline" label="Vận chuyển" onPress={() => go('/settings/shipping')} />
        <Divider />
        <Row icon="options-outline" label="Cài đặt WooCommerce" onPress={() => go('/settings/wc-groups')} />
      </Card>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <Row icon="analytics-outline" label="Theo dõi lượt truy cập (Live, chuyển đổi)" onPress={() => go('/settings/tracker')} />
      </Card>
      <Txt muted size="xs">
        Mọi thay đổi ghi trực tiếp lên WooCommerce qua REST API chính thức và hiển thị giá trị website xác nhận. Plugin bên thứ ba có trang cài đặt riêng vẫn cần mở trang quản trị web.
      </Txt>
    </ScrollView>
  );
}
