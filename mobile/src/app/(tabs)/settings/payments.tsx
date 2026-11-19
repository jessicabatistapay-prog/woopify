import React, { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { PaymentGateway } from '../../../api/types';
import { colors, space } from '../../../lib/theme';
import { useApi } from '../../../state/session';
import { useResource } from '../../../state/useResource';
import { StatusStrip, useOnline } from '../../../ui/app';
import { Card, Divider, ErrorState, Loading, Txt } from '../../../ui/kit';

export default function Payments() {
  const api = useApi();
  const router = useRouter();
  const online = useOnline();
  const res = useResource<PaymentGateway[]>('store:gateways', () => api.paymentGateways(), [api]);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = (g: PaymentGateway, enabled: boolean) =>
    Alert.alert(enabled ? `Bật “${g.title}”?` : `Tắt “${g.title}”?`, enabled ? 'Khách sẽ thấy phương thức này ở trang thanh toán.' : 'Khách sẽ không chọn được phương thức này nữa.', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: enabled ? 'Bật' : 'Tắt',
        style: enabled ? 'default' : 'destructive',
        onPress: async () => {
          setBusy(g.id);
          try {
            const u = await api.updatePaymentGateway(g.id, { enabled });
            res.setData(res.data!.map((x) => (x.id === g.id ? u : x)));
          } catch (e) {
            Alert.alert('Không lưu được', (e as Error).message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  if (res.loading) return <Loading />;
  if (!res.data) return <ErrorState error={res.error!} onRetry={res.refresh} />;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}>
      <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {res.data.map((g, i) => (
          <View key={g.id}>
            {i > 0 ? <Divider /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
              <Pressable style={{ flex: 1, gap: 2 }} onPress={() => router.push({ pathname: '/settings/payment', params: { id: g.id } })} accessibilityRole="button" accessibilityLabel={`Cài đặt ${g.title}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Txt bold>{g.title || g.methodTitle}</Txt>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
                </View>
                <Txt muted size="xs">
                  {g.methodTitle} · {g.enabled ? 'Đang bật' : 'Đang tắt'}
                </Txt>
              </Pressable>
              <Switch value={g.enabled} onValueChange={(v) => toggle(g, v)} disabled={!online || busy !== null} accessibilityLabel={`Bật ${g.title}`} />
            </View>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}
