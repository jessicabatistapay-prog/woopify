import React from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { space } from '../../../lib/theme';
import { useApi } from '../../../state/session';
import { useResource } from '../../../state/useResource';
import { StatusStrip } from '../../../ui/app';
import { Card, Divider, ErrorState, Loading, Row } from '../../../ui/kit';

export default function WcGroups() {
  const api = useApi();
  const router = useRouter();
  const res = useResource('store:groups', () => api.settingGroups(), [api]);
  if (res.loading) return <Loading />;
  if (!res.data) return <ErrorState error={res.error!} onRetry={res.refresh} />;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}>
      <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} />
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {res.data.map((g, i) => (
          <View key={g.id}>
            {i > 0 ? <Divider /> : null}
            <Row label={g.label} onPress={() => router.push({ pathname: '/settings/wc-group', params: { id: g.id, label: g.label } })} />
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}
