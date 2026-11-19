import React, { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ShippingMethod, ShippingZone } from '../../../api/types';
import { colors, space } from '../../../lib/theme';
import { useApi } from '../../../state/session';
import { useResource } from '../../../state/useResource';
import { StatusStrip, useOnline } from '../../../ui/app';
import { Card, Divider, ErrorState, Loading, SectionTitle, Txt } from '../../../ui/kit';

export default function Shipping() {
  const api = useApi();
  const router = useRouter();
  const online = useOnline();
  const res = useResource<ShippingZone[]>('store:zones', () => api.shippingZones(), [api]);
  const [busy, setBusy] = useState(false);

  const toggle = (z: ShippingZone, m: ShippingMethod, enabled: boolean) =>
    Alert.alert(`${enabled ? 'Bật' : 'Tắt'} “${m.title}”?`, `Vùng ${z.name}`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: enabled ? 'Bật' : 'Tắt',
        onPress: async () => {
          setBusy(true);
          try {
            const u = await api.updateShippingMethod(z.id, m.instanceId, { enabled });
            res.setData(res.data!.map((zz) => (zz.id === z.id ? { ...zz, methods: zz.methods.map((x) => (x.instanceId === m.instanceId ? u : x)) } : zz)));
          } catch (e) {
            Alert.alert('Không lưu được', (e as Error).message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  if (res.loading) return <Loading />;
  if (!res.data) return <ErrorState error={res.error!} onRetry={res.refresh} />;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}>
      <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} />
      {res.data.map((z) => (
        <View key={z.id} style={{ gap: 6 }}>
          <SectionTitle>{z.name}</SectionTitle>
          {z.locations.length ? (
            <Txt muted size="xs">
              {z.locations.map((l) => l.code).join(', ')}
            </Txt>
          ) : null}
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {z.methods.length === 0 ? <Txt muted>Chưa có phương thức vận chuyển.</Txt> : null}
            {z.methods.map((m, i) => (
              <View key={m.instanceId}>
                {i > 0 ? <Divider /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
                  <Pressable style={{ flex: 1 }} onPress={() => router.push({ pathname: '/settings/shipping-method', params: { zone: String(z.id), instance: String(m.instanceId) } })} accessibilityRole="button">
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Txt bold>{m.title}</Txt>
                      <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
                    </View>
                    <Txt muted size="xs">
                      {m.methodId} · {m.enabled ? 'Đang bật' : 'Đang tắt'}
                    </Txt>
                  </Pressable>
                  <Switch value={m.enabled} onValueChange={(v) => toggle(z, m, v)} disabled={!online || busy} accessibilityLabel={`Bật ${m.title}`} />
                </View>
              </View>
            ))}
          </Card>
        </View>
      ))}
    </ScrollView>
  );
}
