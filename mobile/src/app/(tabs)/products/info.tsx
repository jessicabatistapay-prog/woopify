import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Switch, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Category, Product, ProductDetail, ProductInfoPatch } from '../../../api/types';
import { ApiError } from '../../../api/client';
import { colors, space } from '../../../lib/theme';
import { PRODUCT_STATUS } from '../../../lib/product';
import { useApi } from '../../../state/session';
import { useResource } from '../../../state/useResource';
import { StatusStrip, useOnline } from '../../../ui/app';
import { Sheet } from '../../../ui/sheet';
import { Banner, Button, Card, Chip, ErrorState, Field, Loading, Txt } from '../../../ui/kit';

type Form = { name: string; sku: string; shortDescription: string; description: string; status: NonNullable<ProductInfoPatch['status']>; categoryIds: number[]; featured: boolean; catalogVisibility: NonNullable<ProductInfoPatch['catalogVisibility']> };

const strip = (s: string) => s.replace(/<[^>]+>/g, '').trim();
const formOf = (p: Product): Form => ({
  name: p.name,
  sku: p.sku,
  shortDescription: strip(p.shortDescription),
  description: strip(p.description ?? ''),
  status: (p.status as Form['status']) || 'draft',
  categoryIds: p.categories.map((c) => c.id),
  featured: !!p.featured,
  catalogVisibility: (p.catalogVisibility as Form['catalogVisibility']) || 'visible',
});

const VIS: Record<Form['catalogVisibility'], string> = { visible: 'Cửa hàng & tìm kiếm', catalog: 'Chỉ cửa hàng', search: 'Chỉ tìm kiếm', hidden: 'Ẩn' };

export default function ProductInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const online = useOnline();
  const res = useResource<ProductDetail>(null, () => api.getProduct(Number(id)), [api, id]);
  const cats = useResource<Category[]>('categories', () => api.categories(), [api]);
  const [base, setBase] = useState<Product | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'info' | 'danger' | 'warn'; title: string; text: string } | null>(null);

  if (res.loading) return <Loading label="Đang tải dữ liệu mới nhất từ website…" />;
  if (!res.data) return <ErrorState error={res.error!} onRetry={res.refresh} />;
  if (!base || !form) {
    setBase(res.data.product);
    setForm(formOf(res.data.product));
    return null;
  }
  const orig = formOf(base);
  const catName = (ids: number[]) => ids.map((c) => cats.data?.find((x) => x.id === c)?.name ?? base.categories.find((x) => x.id === c)?.name ?? `#${c}`).join(', ') || '(không có)';
  const changes: { field: keyof Form; label: string; from: string; to: string }[] = [];
  const cmp = (field: keyof Form, label: string, fmt: (v: any) => string = (v) => String(v || '(trống)')) => {
    if (JSON.stringify(orig[field]) !== JSON.stringify(form[field])) changes.push({ field, label, from: fmt(orig[field]), to: fmt(form[field]) });
  };
  cmp('name', 'Tên');
  cmp('sku', 'SKU');
  cmp('status', 'Trạng thái', (v) => PRODUCT_STATUS[v] ?? v);
  cmp('categoryIds', 'Danh mục', catName);
  cmp('shortDescription', 'Mô tả ngắn', (v) => (v ? `${String(v).slice(0, 40)}…` : '(trống)'));
  cmp('description', 'Mô tả chi tiết', (v) => (v ? `${String(v).slice(0, 40)}…` : '(trống)'));
  cmp('featured', 'Nổi bật', (v) => (v ? 'Có' : 'Không'));
  cmp('catalogVisibility', 'Hiển thị', (v) => VIS[v as Form['catalogVisibility']]);
  const set = (p: Partial<Form>) => setForm({ ...form, ...p });

  const save = async () => {
    setSaving(true);
    setPreview(false);
    const patch: ProductInfoPatch = { expectedModified: base.dateModified };
    for (const c of changes) (patch as any)[c.field] = form[c.field];
    // mô tả: giữ xuống dòng khi gửi lên WordPress
    if (patch.shortDescription !== undefined) patch.shortDescription = patch.shortDescription.replace(/\n/g, '<br>');
    if (patch.description !== undefined) patch.description = patch.description.replace(/\n/g, '<br>');
    try {
      const r = await api.updateProductInfo(base.id, patch);
      setBase(r.product);
      setForm(formOf(r.product));
      setMsg({ tone: 'info', title: 'Đã lưu — WooCommerce xác nhận', text: `${r.product.name} · ${PRODUCT_STATUS[r.product.status] ?? r.product.status}` });
    } catch (e) {
      const err = e as ApiError;
      setMsg({ tone: err.kind === 'conflict' ? 'warn' : 'danger', title: 'Chưa lưu', text: `${err.message} Nội dung bạn sửa vẫn được giữ.` });
    } finally {
      setSaving(false);
    }
  };

  const reload = async () => {
    const fresh = await api.getProduct(base.id);
    setBase(fresh.product); // giữ nội dung đang sửa, so sánh lại với bản mới
    setMsg(null);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <StatusStrip />
        {msg ? <Banner tone={msg.tone} icon={msg.tone === 'info' ? 'checkmark-circle' : 'alert-circle'} title={msg.title} text={msg.text} action={msg.tone === 'warn' ? { label: 'Tải lại', onPress: () => reload().catch(() => undefined) } : undefined} /> : null}
        <Card style={{ gap: space.md }}>
          <Field label="Tên sản phẩm" value={form.name} onChangeText={(t) => set({ name: t })} />
          <Field label="SKU" value={form.sku} onChangeText={(t) => set({ sku: t })} autoCapitalize="characters" autoCorrect={false} />
        </Card>
        <Card style={{ gap: space.md }}>
          <Txt bold>Trạng thái</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(['publish', 'draft', 'private', 'pending'] as const).map((s) => (
              <Chip key={s} label={PRODUCT_STATUS[s]} selected={form.status === s} onPress={() => set({ status: s })} />
            ))}
          </View>
          <Txt bold>Hiển thị trong cửa hàng</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(Object.keys(VIS) as Form['catalogVisibility'][]).map((k) => (
              <Chip key={k} label={VIS[k]} selected={form.catalogVisibility === k} onPress={() => set({ catalogVisibility: k })} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Txt bold style={{ flex: 1 }}>
              Sản phẩm nổi bật
            </Txt>
            <Switch value={form.featured} onValueChange={(v) => set({ featured: v })} accessibilityLabel="Sản phẩm nổi bật" />
          </View>
        </Card>
        <Card style={{ gap: space.md }}>
          <Txt bold>Danh mục</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(cats.data ?? []).map((c) => (
              <Chip key={c.id} label={c.name} selected={form.categoryIds.includes(c.id)} onPress={() => set({ categoryIds: form.categoryIds.includes(c.id) ? form.categoryIds.filter((x) => x !== c.id) : [...form.categoryIds, c.id] })} />
            ))}
          </View>
        </Card>
        <Card style={{ gap: space.md }}>
          <Field label="Mô tả ngắn" value={form.shortDescription} onChangeText={(t) => set({ shortDescription: t })} multiline />
          <Field label="Mô tả chi tiết" value={form.description} onChangeText={(t) => set({ description: t })} multiline hint="Định dạng nâng cao (ảnh, bảng) chỉnh trên trang quản trị web." />
        </Card>
        <Button title={changes.length ? `Xem trước ${changes.length} thay đổi` : 'Chưa có thay đổi'} icon="eye-outline" onPress={() => setPreview(true)} disabled={!changes.length || !online || !form.name.trim()} loading={saving} />
      </ScrollView>
      <Sheet visible={preview} onClose={() => setPreview(false)} title="Xác nhận thay đổi">
        <View style={{ gap: space.md }}>
          <Txt muted>Sản phẩm “{base.name}” sẽ được cập nhật:</Txt>
          {changes.map((c) => (
            <Card key={c.field} style={{ gap: 2, padding: space.md }}>
              <Txt bold size="xs">
                {c.label}
              </Txt>
              <Txt>
                <Txt style={{ color: colors.textSubtle }}>{c.from}</Txt> → <Txt bold>{c.to}</Txt>
              </Txt>
            </Card>
          ))}
          <Button title="Lưu lên website" icon="cloud-upload-outline" onPress={save} loading={saving} />
          <Button title="Quay lại sửa" variant="secondary" onPress={() => setPreview(false)} />
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
