import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import type { CustomerDetail } from '../../../api/types';
import { space } from '../../../lib/theme';
import { money, shopTime } from '../../../lib/format';
import { useApi } from '../../../state/session';
import { useShopInfo } from '../../../state/shop';
import { useResource } from '../../../state/useResource';
import { StatusStrip, useOnline } from '../../../ui/app';
import { Banner, Button, Card, Divider, ErrorState, Field, Loading, Row, SectionTitle, StatusBadge, Txt } from '../../../ui/kit';

const ADDR: [string, string][] = [
  ['address_1', 'Địa chỉ'],
  ['address_2', 'Căn hộ, tầng…'],
  ['city', 'Thành phố'],
  ['state', 'Bang (VD: TX)'],
  ['postcode', 'ZIP'],
  ['country', 'Quốc gia (VD: US)'],
  ['phone', 'Điện thoại'],
];

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const router = useRouter();
  const online = useOnline();
  const { tz } = useShopInfo(api);
  const res = useResource<CustomerDetail>(null, () => api.getCustomer(Number(id)), [api, id]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{ firstName: string; lastName: string; email: string; shipping: Record<string, string> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (res.loading) return <Loading />;
  const c = res.data;
  if (!c) return <ErrorState error={res.error!} onRetry={res.refresh} />;
  const addrLines = [c.shipping.address_1, c.shipping.address_2, [c.shipping.city, c.shipping.state, c.shipping.postcode].filter(Boolean).join(', '), c.shipping.country].filter(Boolean);

  const startEdit = () => {
    setForm({ firstName: c.firstName, lastName: c.lastName, email: c.email, shipping: { ...c.shipping } });
    setEditing(true);
    setMsg(null);
  };
  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const u = await api.updateCustomer(c.id, { firstName: form.firstName, lastName: form.lastName, email: form.email, shipping: form.shipping });
      res.setData(u);
      setEditing(false);
      setMsg({ ok: true, text: 'Đã lưu — WooCommerce xác nhận.' });
    } catch (e) {
      setMsg({ ok: false, text: `${(e as Error).message} Nội dung vẫn được giữ.` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: c.name }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <StatusStrip />
        {msg ? <Banner tone={msg.ok ? 'info' : 'danger'} icon={msg.ok ? 'checkmark-circle' : 'alert-circle'} text={msg.text} /> : null}
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Card style={{ flex: 1, gap: 2 }}>
            <Txt muted size="xs">
              Tổng chi
            </Txt>
            <Txt bold size="lg">
              {money(c.totalSpent, c.currency)}
            </Txt>
          </Card>
          <Card style={{ flex: 1, gap: 2 }}>
            <Txt muted size="xs">
              Số đơn
            </Txt>
            <Txt bold size="lg">
              {c.ordersCount}
            </Txt>
          </Card>
        </View>
        {!editing ? (
          <Card style={{ gap: 0 }}>
            <Row icon="mail-outline" label={c.email} onPress={() => Clipboard.setStringAsync(c.email).then(() => Alert.alert('', 'Đã sao chép email'))} />
            {c.billing.phone ? <Row icon="call-outline" label={c.billing.phone} onPress={() => Linking.openURL(`tel:${c.billing.phone.replace(/[^\d+]/g, '')}`)} /> : null}
            <Row icon="calendar-outline" label="Khách từ" value={shopTime(c.dateCreated, tz, 'dd/MM/yyyy')} />
            <Divider />
            <Txt bold style={{ marginTop: 8 }}>
              Địa chỉ giao hàng
            </Txt>
            <Txt selectable>{addrLines.length ? addrLines.join('\n') : '(chưa có)'}</Txt>
            <Button title="Sửa thông tin khách" icon="create-outline" variant="secondary" onPress={startEdit} disabled={!online} style={{ marginTop: 12 }} />
          </Card>
        ) : form ? (
          <Card style={{ gap: space.md }}>
            <Field label="Tên" value={form.firstName} onChangeText={(t) => setForm({ ...form, firstName: t })} />
            <Field label="Họ" value={form.lastName} onChangeText={(t) => setForm({ ...form, lastName: t })} />
            <Field label="Email" value={form.email} onChangeText={(t) => setForm({ ...form, email: t })} keyboardType="email-address" autoCapitalize="none" />
            <Txt bold>Địa chỉ giao hàng</Txt>
            {ADDR.map(([k, label]) => (
              <Field key={k} label={label} value={form.shipping[k] ?? ''} onChangeText={(t) => setForm({ ...form, shipping: { ...form.shipping, [k]: t } })} autoCapitalize={k === 'country' || k === 'state' ? 'characters' : 'words'} />
            ))}
            <Button title="Lưu lên website" icon="cloud-upload-outline" onPress={save} loading={saving} disabled={!online} />
            <Button title="Hủy" variant="secondary" onPress={() => setEditing(false)} disabled={saving} />
          </Card>
        ) : null}
        <SectionTitle>Đơn gần đây</SectionTitle>
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {c.orders.length === 0 ? <Txt muted>Chưa có đơn.</Txt> : null}
          {c.orders.map((o, i) => (
            <View key={o.id}>
              {i > 0 ? <Divider /> : null}
              <Pressable onPress={() => router.push(`/orders/${o.id}`)} accessibilityRole="button" style={{ paddingVertical: 10, gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Txt bold>#{o.number}</Txt>
                  <Txt bold>{money(o.total, o.currency)}</Txt>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Txt muted size="xs">
                    {shopTime(o.date_created_gmt, tz, 'dd/MM/yyyy HH:mm')}
                  </Txt>
                  <StatusBadge status={o.status} />
                </View>
              </Pressable>
            </View>
          ))}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
