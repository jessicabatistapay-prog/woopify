import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Product, ProductDetail } from '../../../api/types';
import { ApiError } from '../../../api/client';
import { colors, space } from '../../../lib/theme';
import { money, shopTime } from '../../../lib/format';
import { buildPatch, formFrom, patchApplied, stockLine, type ChangeLine, type EditForm } from '../../../lib/product';
import { useApi } from '../../../state/session';
import { useShopInfo } from '../../../state/shop';
import { useResource } from '../../../state/useResource';
import { StatusStrip, useOnline } from '../../../ui/app';
import { Sheet } from '../../../ui/sheet';
import { Banner, Button, Card, Chip, ErrorState, Field, Loading, Row, Thumb, Txt } from '../../../ui/kit';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saved'; confirmed: Product[]; verified?: boolean }
  | { kind: 'conflict'; current: Product; message: string }
  | { kind: 'error'; message: string; uncertain?: boolean };

export default function EditPriceStock() {
  const { productId, variationId } = useLocalSearchParams<{ productId: string; variationId?: string }>();
  const pid = Number(productId);
  const vid = variationId ? Number(variationId) : null;
  const api = useApi();
  const router = useRouter();
  const online = useOnline();
  const { shop } = useShopInfo(api);
  const currency = shop?.currency ?? 'USD';
  const tz = shop?.timezone ?? 'UTC';
  const res = useResource<ProductDetail>(null, () => api.getProduct(pid), [api, pid]);

  const target: Product | undefined = res.data ? (vid ? res.data.variations.find((v) => v.id === vid) : res.data.product) : undefined;
  const [base, setBase] = useState<Product | null>(null); // giá trị gốc lúc mở form
  const [form, setForm] = useState<EditForm | null>(null);
  const [preview, setPreview] = useState<ChangeLine[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  if (target && !base) {
    // giá trị gốc = dữ liệu mới nhất từ website lúc mở form
    setBase(target);
    setForm(formFrom(target));
  }

  if (res.loading) return <Loading label="Đang tải dữ liệu mới nhất từ website…" />;
  if (!res.data || !target || !base || !form) return <ErrorState error={res.error ?? { kind: 'not_found', message: 'Không tìm thấy biến thể' }} onRetry={res.refresh} />;

  const parent = res.data.product;
  const shared = res.data.variations.filter((v) => v.stockMode === 'parent').length;
  const { patch, lines, errors } = buildPatch(base, form, currency, parent.name, shared);
  const set = (p: Partial<EditForm>) => {
    setForm({ ...form, ...p });
    if (state.kind === 'saved') setState({ kind: 'idle' });
  };

  const reload = async (keepInput: boolean) => {
    const fresh = await api.getProduct(pid);
    res.setData(fresh);
    const t = vid ? fresh.variations.find((v) => v.id === vid) : fresh.product;
    if (t) {
      setBase(t);
      if (!keepInput) setForm(formFrom(t));
    }
    setState({ kind: 'idle' });
  };

  const save = async (force = false) => {
    setPreview(null);
    setSaving(true);
    try {
      const r = await api.updateProduct(pid, vid, { ...patch, expectedModified: base.dateModified, force });
      setBase(r.item);
      setForm(formFrom(r.item));
      setState({ kind: 'saved', confirmed: r.changed });
      api.getProduct(pid).then(res.setData).catch(() => undefined);
    } catch (e) {
      const err = e as ApiError;
      if (err.kind === 'conflict' && err.details?.current) {
        setState({ kind: 'conflict', current: err.details.current, message: err.message });
      } else if (err.uncertain) {
        // Mất kết nối đúng lúc lưu: đọc lại từ website trước khi cho gửi lần nữa
        try {
          const fresh = await api.getProduct(pid);
          const t = vid ? fresh.variations.find((v) => v.id === vid) : fresh.product;
          if (t && patchApplied(t, patch)) {
            res.setData(fresh);
            setBase(t);
            setForm(formFrom(t));
            setState({ kind: 'saved', confirmed: [t], verified: true });
          } else setState({ kind: 'error', message: 'Website chưa nhận thay đổi. Nội dung bạn nhập vẫn được giữ — bấm Lưu để thử lại.' });
        } catch {
          setState({ kind: 'error', uncertain: true, message: 'Mất kết nối khi đang lưu và chưa kiểm tra lại được website. Nội dung vẫn được giữ; khi có mạng hãy bấm “Kiểm tra lại”.' });
        }
      } else setState({ kind: 'error', message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const title = target.type === 'variation' ? `${parent.name} — ${target.variationLabel}` : target.name;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: target.type === 'variation' ? 'Sửa biến thể' : 'Sửa sản phẩm' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <StatusStrip />
        <Card>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Thumb uri={target.imageUrl ?? parent.imageUrl} label={title} size={64} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt muted size="xs">
                Đang sửa
              </Txt>
              <Txt bold size="md">
                {title}
              </Txt>
              <Txt muted selectable>
                SKU: {target.sku || '—'}
              </Txt>
            </View>
          </View>
          <Txt muted size="xs">
            Dữ liệu tải từ website lúc {shopTime(res.data.fetchedAt, tz, 'HH:mm:ss')} · sửa lần cuối {shopTime(base.dateModified, tz, 'dd/MM HH:mm')}
          </Txt>
        </Card>

        {state.kind === 'saved' ? (
          <Card style={{ borderColor: '#0F5C2E', borderWidth: 1.5 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Ionicons name="checkmark-circle" size={22} color="#0F5C2E" />
              <Txt bold style={{ color: '#0F5C2E' }}>
                {state.verified ? 'Đã lưu (đã kiểm tra lại trên website)' : 'Đã lưu — WooCommerce xác nhận'}
              </Txt>
            </View>
            {state.confirmed.map((c) => (
              <View key={c.id} style={{ gap: 0 }}>
                <Txt bold size="xs">
                  {c.type === 'variation' ? `Biến thể ${c.sku} (${c.variationLabel})` : `${c.name}${c.sku ? ` (${c.sku})` : ''}`}
                </Txt>
                <Row label="Giá thường" value={c.regularPrice ? money(c.regularPrice, currency) : '—'} />
                <Row label="Giá khuyến mãi" value={c.salePrice ? money(c.salePrice, currency) : 'Không có'} />
                <Row label="Giá đang bán" value={c.price ? money(c.price, currency) : '—'} />
                <Row label="Tồn kho" value={stockLine(c)} />
              </View>
            ))}
          </Card>
        ) : null}

        {state.kind === 'conflict' ? (
          <Card style={{ borderColor: colors.warn, borderWidth: 1.5 }}>
            <Banner tone="warn" icon="git-compare-outline" title="Dữ liệu vừa được sửa trên website" text={state.message} />
            <Txt bold size="xs">
              Giá trị hiện tại trên website:
            </Txt>
            <Row label="Giá thường" value={state.current.regularPrice ? money(state.current.regularPrice, currency) : '—'} />
            <Row label="Giá khuyến mãi" value={state.current.salePrice ? money(state.current.salePrice, currency) : 'Không có'} />
            <Row label="Tồn kho" value={stockLine(state.current)} />
            <Button title="Tải lại giá trị mới (bỏ nội dung đang nhập)" variant="secondary" onPress={() => reload(false)} />
            <Button title="Giữ nội dung đang nhập, so sánh lại" variant="secondary" onPress={() => reload(true)} />
          </Card>
        ) : null}

        {state.kind === 'error' ? (
          <Banner
            tone={state.uncertain ? 'warn' : 'danger'}
            icon="alert-circle"
            title="Chưa lưu"
            text={state.message}
            action={state.uncertain ? { label: 'Kiểm tra lại', onPress: () => reload(true).catch(() => undefined) } : undefined}
          />
        ) : null}

        <Card style={{ gap: space.md }}>
          <Txt bold size="md">
            Giá ({currency})
          </Txt>
          <Field label="Giá thường" value={form.regularPrice} onChangeText={(v) => set({ regularPrice: v })} keyboardType="decimal-pad" placeholder="0.00" />
          <Field label="Giá khuyến mãi" value={form.salePrice} onChangeText={(v) => set({ salePrice: v })} keyboardType="decimal-pad" placeholder="Để trống = không giảm giá" hint="Để trống để bỏ khuyến mãi." />
        </Card>

        <Card style={{ gap: space.md }}>
          <Txt bold size="md">
            Tồn kho
          </Txt>
          {base.stockMode === 'parent' ? (
            <Banner tone="info" icon="layers-outline" text={`Biến thể này dùng tồn kho của sản phẩm cha “${parent.name}”. Thay đổi áp dụng cho ${shared} biến thể dùng chung.`} />
          ) : null}
          {base.stockMode === 'status_only' ? (
            <>
              <Txt muted size="xs">
                {shop && !shop.manageStockEnabled ? 'Shop đang tắt quản lý tồn kho — chỉ chọn còn/hết hàng.' : 'Sản phẩm này không theo dõi số lượng — chỉ chọn trạng thái.'}
              </Txt>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Chip label="Còn hàng" selected={form.stockStatus === 'instock'} onPress={() => set({ stockStatus: 'instock' })} />
                <Chip label="Hết hàng" selected={form.stockStatus === 'outofstock'} onPress={() => set({ stockStatus: 'outofstock' })} />
                <Chip label="Cho đặt trước" selected={form.stockStatus === 'onbackorder'} onPress={() => set({ stockStatus: 'onbackorder' })} />
              </View>
            </>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <Button title="−1" variant="secondary" onPress={() => set({ stockQuantity: String((Number(form.stockQuantity) || 0) - 1) })} style={{ width: 64 }} />
              <View style={{ flex: 1 }}>
                <Field label={base.stockMode === 'parent' ? 'Số lượng (sản phẩm cha)' : 'Số lượng'} value={form.stockQuantity} onChangeText={(v) => set({ stockQuantity: v })} keyboardType="number-pad" />
              </View>
              <Button title="+1" variant="secondary" onPress={() => set({ stockQuantity: String((Number(form.stockQuantity) || 0) + 1) })} style={{ width: 64 }} />
            </View>
          )}
        </Card>

        {errors.length ? <Banner tone="danger" icon="alert-circle" text={errors.join('. ')} /> : null}
        {!online ? <Banner tone="warn" icon="cloud-offline-outline" text="Mất mạng — không thể lưu lúc này. Nội dung bạn nhập vẫn được giữ." /> : null}
        <Button
          title={lines.length ? `Xem trước ${lines.length} thay đổi` : 'Chưa có thay đổi'}
          icon="eye-outline"
          onPress={() => setPreview(lines)}
          disabled={!lines.length || errors.length > 0 || !online || state.kind === 'conflict'}
          loading={saving}
        />
        {state.kind === 'saved' ? <Button title="Xong" variant="secondary" onPress={() => router.back()} /> : null}
      </ScrollView>

      <Sheet visible={!!preview} onClose={() => setPreview(null)} title="Xác nhận thay đổi">
        <View style={{ gap: space.md }}>
          <Txt muted>Các thay đổi sau sẽ được ghi lên WooCommerce:</Txt>
          {preview?.map((l, i) => (
            <Card key={i} style={{ gap: 2, padding: space.md }}>
              <Txt bold size="xs">
                {l.target}
              </Txt>
              <Txt>
                {l.field}: <Txt style={{ color: colors.textSubtle }}>{l.from}</Txt> → <Txt bold>{l.to}</Txt>
              </Txt>
            </Card>
          ))}
          <Button title="Lưu lên website" icon="cloud-upload-outline" onPress={() => save(false)} loading={saving} />
          <Button title="Quay lại sửa" variant="secondary" onPress={() => setPreview(null)} />
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
