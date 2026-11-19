import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Coupon, CouponInput } from '../../../api/types';
import { space } from '../../../lib/theme';
import { couponSummary } from '../../../lib/store';
import { useApi } from '../../../state/session';
import { useShopInfo } from '../../../state/shop';
import { useResource } from '../../../state/useResource';
import { StatusStrip, useOnline } from '../../../ui/app';
import { Banner, Button, Card, Chip, ErrorState, Field, Loading, Txt } from '../../../ui/kit';

type Form = { code: string; discountType: Coupon['discountType']; amount: string; description: string; dateExpires: string; minimumAmount: string; usageLimit: string; usageLimitPerUser: string; individualUse: boolean; freeShipping: boolean; active: boolean };

const fromCoupon = (c?: Coupon | null): Form => ({
  code: c?.code ?? '',
  discountType: c?.discountType ?? 'percent',
  amount: c?.amount ?? '',
  description: c?.description ?? '',
  dateExpires: c?.dateExpires ?? '',
  minimumAmount: c?.minimumAmount ?? '',
  usageLimit: c?.usageLimit ? String(c.usageLimit) : '',
  usageLimitPerUser: c?.usageLimitPerUser ? String(c.usageLimitPerUser) : '',
  individualUse: c?.individualUse ?? false,
  freeShipping: c?.freeShipping ?? false,
  active: c ? c.status === 'publish' : true,
});

export default function CouponEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const cid = id ? Number(id) : null;
  const api = useApi();
  const router = useRouter();
  const online = useOnline();
  const { shop } = useShopInfo(api);
  const currency = shop?.currency ?? 'USD';
  const res = useResource(null, () => (cid ? api.getCoupon(cid) : Promise.resolve(null)), [api, cid]);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<Coupon | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (res.loading) return <Loading />;
  if (cid && !res.data) return <ErrorState error={res.error!} onRetry={res.refresh} />;
  if (!form) {
    setForm(fromCoupon(res.data));
    return null;
  }
  const set = (p: Partial<Form>) => (setForm({ ...form, ...p }), setSaved(null));
  const num = (s: string) => (s.trim() ? Number(s) : null);
  const amountOk = /^\d+([.,]\d{1,4})?$/.test(form.amount.trim()) || (form.freeShipping && !form.amount.trim());
  const dateOk = !form.dateExpires || /^\d{4}-\d{2}-\d{2}$/.test(form.dateExpires);
  const valid = !!form.code.trim() && amountOk && dateOk && (form.discountType !== 'percent' || Number(form.amount || 0) <= 100);

  const save = async () => {
    setSaving(true);
    setError(null);
    const input: CouponInput = {
      code: form.code.trim(),
      discountType: form.discountType,
      amount: (form.amount.trim() || '0').replace(',', '.'),
      description: form.description,
      dateExpires: form.dateExpires || null,
      minimumAmount: form.minimumAmount.replace(',', '.'),
      usageLimit: num(form.usageLimit),
      usageLimitPerUser: num(form.usageLimitPerUser),
      individualUse: form.individualUse,
      freeShipping: form.freeShipping,
      status: form.active ? 'publish' : 'draft',
    };
    try {
      const c = await api.saveCoupon(cid, input);
      setSaved(c);
      setForm(fromCoupon(c));
      if (!cid) router.setParams({ id: String(c.id) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    Alert.alert(`Xóa mã ${form.code.toUpperCase()}?`, 'Khách sẽ không dùng được mã này nữa. Không thể hoàn tác.', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteCoupon(cid!);
            router.back();
          } catch (e) {
            Alert.alert('Không xóa được', (e as Error).message);
          }
        },
      },
    ]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: cid ? 'Sửa mã giảm giá' : 'Tạo mã giảm giá' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <StatusStrip />
        {saved ? <Banner tone="info" icon="checkmark-circle" title="Đã lưu — WooCommerce xác nhận" text={`${saved.code.toUpperCase()}: ${couponSummary(saved, currency)} · ${saved.status === 'publish' ? 'đang hoạt động' : 'đã tắt'}`} /> : null}
        {error ? <Banner tone="danger" icon="alert-circle" title="Chưa lưu" text={`${error} Nội dung vẫn được giữ.`} /> : null}
        <Card style={{ gap: space.md }}>
          <Field label="Mã" value={form.code} onChangeText={(t) => set({ code: t })} autoCapitalize="characters" autoCorrect={false} placeholder="VD: BLACKFRIDAY" />
          <Txt bold>Loại giảm giá</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label="Phần trăm" selected={form.discountType === 'percent'} onPress={() => set({ discountType: 'percent' })} />
            <Chip label={`Số tiền cố định (${currency})`} selected={form.discountType === 'fixed_cart'} onPress={() => set({ discountType: 'fixed_cart' })} />
            <Chip label="Theo sản phẩm" selected={form.discountType === 'fixed_product'} onPress={() => set({ discountType: 'fixed_product' })} />
          </View>
          <Field label={form.discountType === 'percent' ? 'Giảm (%)' : `Giảm (${currency})`} value={form.amount} onChangeText={(t) => set({ amount: t })} keyboardType="decimal-pad" error={form.amount && !amountOk ? 'Không hợp lệ' : undefined} />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Txt bold style={{ flex: 1 }}>
              Miễn phí vận chuyển
            </Txt>
            <Switch value={form.freeShipping} onValueChange={(v) => set({ freeShipping: v })} accessibilityLabel="Miễn phí vận chuyển" />
          </View>
        </Card>
        <Card style={{ gap: space.md }}>
          <Field label="Hết hạn (YYYY-MM-DD, giờ website)" value={form.dateExpires} onChangeText={(t) => set({ dateExpires: t })} placeholder="Để trống = không hết hạn" error={dateOk ? undefined : 'Ngày không hợp lệ'} />
          <Field label={`Đơn tối thiểu (${currency})`} value={form.minimumAmount} onChangeText={(t) => set({ minimumAmount: t })} keyboardType="decimal-pad" />
          <Field label="Giới hạn tổng số lần dùng" value={form.usageLimit} onChangeText={(t) => set({ usageLimit: t.replace(/\D/g, '') })} keyboardType="number-pad" placeholder="Không giới hạn" />
          <Field label="Giới hạn mỗi khách" value={form.usageLimitPerUser} onChangeText={(t) => set({ usageLimitPerUser: t.replace(/\D/g, '') })} keyboardType="number-pad" placeholder="Không giới hạn" />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Txt bold style={{ flex: 1 }}>
              Không dùng chung với mã khác
            </Txt>
            <Switch value={form.individualUse} onValueChange={(v) => set({ individualUse: v })} accessibilityLabel="Không dùng chung với mã khác" />
          </View>
          <Field label="Mô tả nội bộ" value={form.description} onChangeText={(t) => set({ description: t })} multiline />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Txt bold style={{ flex: 1 }}>
              Đang hoạt động
            </Txt>
            <Switch value={form.active} onValueChange={(v) => set({ active: v })} accessibilityLabel="Mã đang hoạt động" />
          </View>
        </Card>
        <Txt muted>Xem trước: {couponSummary({ ...form, amount: form.amount || '0' } as any, currency)}</Txt>
        <Button title={cid ? 'Lưu thay đổi' : 'Tạo mã giảm giá'} icon="save-outline" onPress={save} loading={saving} disabled={!valid || !online} />
        {cid ? <Button title="Xóa mã" icon="trash-outline" variant="ghost" onPress={remove} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
