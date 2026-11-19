import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { space } from '../../../lib/theme';
import { useApi } from '../../../state/session';
import { useResource } from '../../../state/useResource';
import { StatusStrip } from '../../../ui/app';
import { ErrorState, Loading } from '../../../ui/kit';
import { SettingsForm } from '../../../ui/settingsForm';

export default function ShippingMethodSettings() {
  const { zone, instance } = useLocalSearchParams<{ zone: string; instance: string }>();
  const api = useApi();
  const res = useResource(
    null,
    async () => {
      const z = (await api.shippingZones()).find((x) => x.id === Number(zone));
      const m = z?.methods.find((x) => x.instanceId === Number(instance));
      return z && m ? { z, m } : null;
    },
    [api, zone, instance],
  );
  const d = res.data;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: d?.m.title ?? 'Vận chuyển' }} />
      {res.loading ? (
        <Loading />
      ) : !d ? (
        <ErrorState error={res.error ?? { kind: 'not_found', message: 'Không tìm thấy phương thức' }} onRetry={res.refresh} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <StatusStrip />
          <SettingsForm
            fields={d.m.settings}
            intro={`Vùng ${d.z.name}. Phí có thể dùng công thức WooCommerce, ví dụ 5 + [qty] * 2.`}
            onSave={async (u) => {
              const r = await api.updateShippingMethod(d.z.id, d.m.instanceId, { settings: Object.fromEntries(u.map((x) => [x.id, x.value])) });
              return r.settings.filter((s) => u.some((x) => x.id === s.id));
            }}
          />
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
