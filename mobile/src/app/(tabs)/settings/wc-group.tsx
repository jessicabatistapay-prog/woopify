import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { space } from '../../../lib/theme';
import { useApi } from '../../../state/session';
import { useResource } from '../../../state/useResource';
import { StatusStrip } from '../../../ui/app';
import { ErrorState, Loading } from '../../../ui/kit';
import { SettingsForm } from '../../../ui/settingsForm';

export default function WcGroup() {
  const { id, label } = useLocalSearchParams<{ id: string; label?: string }>();
  const api = useApi();
  const res = useResource(null, () => api.settingGroup(id), [api, id]);
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: label ?? 'Cài đặt' }} />
      {res.loading ? (
        <Loading label="Đang tải cài đặt từ website…" />
      ) : !res.data ? (
        <ErrorState error={res.error!} onRetry={res.refresh} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <StatusStrip />
          <SettingsForm key={JSON.stringify(res.data.map((f) => f.id))} fields={res.data} onSave={(u) => api.updateSettings(id, u)} intro="Giống WooCommerce → Cài đặt. Trường đổi màu viền là trường bạn đã sửa." />
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
