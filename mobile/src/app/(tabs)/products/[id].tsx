import React, { useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import type { ProductDetail } from '../../../api/types';
import { colors, space } from '../../../lib/theme';
import { money } from '../../../lib/format';
import { PRODUCT_STATUS, stockLine } from '../../../lib/product';
import { useApi, useSession } from '../../../state/session';
import { useShopInfo } from '../../../state/shop';
import { useResource } from '../../../state/useResource';
import { LastSync, StatusStrip, useOnline } from '../../../ui/app';
import { Banner, Button, Card, Divider, ErrorState, Loading, Row, SectionTitle, Thumb, Txt } from '../../../ui/kit';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = Number(id);
  const api = useApi();
  const router = useRouter();
  const { mode } = useSession();
  const online = useOnline();
  const { shop } = useShopInfo(api);
  const currency = shop?.currency ?? 'USD';
  const res = useResource<ProductDetail>(`product:${productId}`, () => api.getProduct(productId), [api, productId]);
  const [publishing, setPublishing] = useState(false);

  if (res.loading) return <Loading label="Đang tải sản phẩm…" />;
  if (!res.data) return <ErrorState error={res.error ?? { kind: 'server', message: 'Không tải được' }} onRetry={res.refresh} />;
  const { product: p, variations } = res.data;
  const edit = (variationId?: number) => router.push({ pathname: '/products/edit', params: { productId: String(p.id), ...(variationId ? { variationId: String(variationId) } : {}) } });

  const publish = () =>
    Alert.alert('Đăng bán sản phẩm?', `“${p.name}” sẽ hiển thị công khai trên website.`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Đăng bán',
        onPress: async () => {
          setPublishing(true);
          try {
            const r = await api.publishProduct(p.id);
            res.setData({ ...res.data!, product: r.product });
            Alert.alert('', 'Đã đăng bán. WooCommerce đã xác nhận trạng thái “Đang bán”.');
          } catch (e) {
            Alert.alert('Không đăng bán được', (e as Error).message);
          } finally {
            setPublishing(false);
          }
        },
      },
    ]);

  const stockSharedCount = variations.filter((v) => v.stockMode === 'parent').length;

  return (
    <>
      <Stack.Screen options={{ title: p.name }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}>
        <StatusStrip fromCache={res.fromCache || res.data.stale} updatedAt={res.updatedAt} error={res.error ?? (res.data.stale ? { kind: 'woo', message: 'Website tạm không truy cập được.' } : null)} />
        <Card>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Thumb uri={p.imageUrl} label={p.name} size={84} />
            <View style={{ flex: 1, gap: 4 }}>
              <Txt bold size="lg">
                {p.name}
              </Txt>
              {p.sku ? (
                <Txt muted selectable>
                  SKU: {p.sku}
                </Txt>
              ) : null}
              <Txt size="xs" style={{ color: p.status === 'publish' ? '#0F5C2E' : colors.warn, fontWeight: '700' }}>
                {PRODUCT_STATUS[p.status] ?? p.status}
              </Txt>
              {p.categories.length ? (
                <Txt muted size="xs">
                  {p.categories.map((c) => c.name).join(', ')}
                </Txt>
              ) : null}
            </View>
          </View>
          {p.status === 'draft' ? <Button title="Đăng bán" icon="rocket-outline" onPress={publish} loading={publishing} disabled={!online} /> : null}
        </Card>

        {p.type !== 'variable' ? (
          <Card style={{ gap: 0 }}>
            <Row label="Giá thường" value={p.regularPrice ? money(p.regularPrice, currency) : '—'} />
            <Row label="Giá khuyến mãi" value={p.salePrice ? money(p.salePrice, currency) : 'Không có'} />
            <Row label="Tồn kho" value={stockLine(p)} />
            <Divider />
            <Button title="Sửa giá & tồn kho" icon="create-outline" onPress={() => edit()} disabled={!online || res.data.stale} style={{ marginTop: 8 }} />
          </Card>
        ) : (
          <>
            {p.stockMode === 'product' && stockSharedCount > 0 ? (
              <Banner tone="info" icon="layers-outline" text={`Tồn kho do sản phẩm cha quản lý: ${p.stockQuantity ?? 0} sản phẩm, dùng chung cho ${stockSharedCount} biến thể.`} />
            ) : null}
            <SectionTitle>Biến thể ({variations.length})</SectionTitle>
            <Card style={{ gap: 0, paddingVertical: 4 }}>
              {variations.map((v, i) => (
                <View key={v.id}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable
                    onPress={() => edit(v.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Sửa biến thể ${v.variationLabel}`}
                    disabled={!online || res.data!.stale}
                    style={({ pressed }) => ({ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}
                  >
                    <Thumb uri={v.imageUrl ?? p.imageUrl} label={v.variationLabel || p.name} size={48} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt bold>{v.attributes.map((a) => `${a.name}: ${a.option}`).join(' · ') || v.variationLabel}</Txt>
                      <Txt muted size="xs">
                        SKU: {v.sku || '—'}
                      </Txt>
                      <Txt size="xs">
                        {v.salePrice ? (
                          <>
                            <Txt size="xs" style={{ textDecorationLine: 'line-through', color: colors.textSubtle }}>
                              {money(v.regularPrice, currency)}
                            </Txt>{' '}
                            {money(v.salePrice, currency)}
                          </>
                        ) : v.regularPrice ? (
                          money(v.regularPrice, currency)
                        ) : (
                          'Chưa có giá'
                        )}{' '}
                        · Tồn: {stockLine(v)}
                      </Txt>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                  </Pressable>
                </View>
              ))}
            </Card>
          </>
        )}
        <Button
          title="Mở trong WooCommerce Admin"
          icon="open-outline"
          variant="ghost"
          onPress={() => (mode === 'demo' ? Alert.alert('', 'Bản demo không có trang quản trị thật.') : WebBrowser.openBrowserAsync(p.adminUrl).catch(() => Linking.openURL(p.adminUrl)))}
        />
        <LastSync at={res.updatedAt} />
      </ScrollView>
    </>
  );
}
