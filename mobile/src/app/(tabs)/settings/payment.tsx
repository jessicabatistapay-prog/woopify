import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { space } from '../../../lib/theme';
import { useApi } from '../../../state/session';
import { useResource } from '../../../state/useResource';
import { StatusStrip } from '../../../ui/app';
import { ErrorState, Loading, Txt } from '../../../ui/kit';
import { SettingsForm } from '../../../ui/settingsForm';

export default function PaymentSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const res = useResource(null, async () => (await api.paymentGateways()).find((g) => g.id === id) ?? null, [api, id]);
  const g = res.data;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: g?.methodTitle ?? 'Thanh toán' }} />
      {res.loading ? (
        <Loading />
      ) : !g ? (
        <ErrorState error={res.error ?? { kind: 'not_found', message: 'Không tìm thấy cổng thanh toán' }} onRetry={res.refresh} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <StatusStrip />
          {g.methodDescription ? <Txt muted size="xs">{g.methodDescription}</Txt> : null}
          <SettingsForm
            fields={g.settings}
            onSave={async (u) => {
              const r = await api.updatePaymentGateway(g.id, { settings: Object.fromEntries(u.map((x) => [x.id, x.value])) });
              return r.settings.filter((s) => u.some((x) => x.id === s.id));
            }}
          />
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
