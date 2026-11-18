import React, { useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import type { Category, Product } from '../../../api/types';
import { ApiError } from '../../../api/client';
import { colors, radius, space } from '../../../lib/theme';
import { money, randomKey } from '../../../lib/format';
import { useApi } from '../../../state/session';
import { useShopInfo } from '../../../state/shop';
import { useResource } from '../../../state/useResource';
import { StatusStrip, useOnline } from '../../../ui/app';
import { Banner, Button, Card, Chip, Field, Txt } from '../../../ui/kit';

export default function NewProduct() {
  const api = useApi();
  const router = useRouter();
  const online = useOnline();
  const { shop } = useShopInfo(api);
  const currency = shop?.currency ?? 'USD';
  const cats = useResource<Category[]>('categories', () => api.categories(), [api]);
  const [name, setName] = useState('');
  const [shortDescription, setShort] = useState('');
  const [sku, setSku] = useState('');
  const [regularPrice, setRegular] = useState('');
  const [salePrice, setSale] = useState('');
  const [categoryIds, setCats] = useState<number[]>([]);
  const [manageStock, setManage] = useState(true);
  const [stock, setStock] = useState('0');
  const [image, setImage] = useState<{ uri: string; mime: string; name: string; uploadId?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ msg: string; uncertain?: boolean } | null>(null);
  const [created, setCreated] = useState<Product | null>(null);
  const [publishing, setPublishing] = useState(false);
  const key = useRef(randomKey('create')); // giữ nguyên khi thử lại → không tạo trùng

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1] });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      setImage({ uri: a.uri, mime: a.mimeType ?? 'image/jpeg', name: a.fileName ?? 'product.jpg' });
    }
  };

  const valid = name.trim().length > 0 && (!regularPrice || /^\d+([.,]\d{1,4})?$/.test(regularPrice)) && (!salePrice || Number(salePrice.replace(',', '.')) < Number(regularPrice.replace(',', '.')));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      let uploadId = image?.uploadId;
      if (image && !uploadId) {
        uploadId = (await api.uploadImage(image.uri, image.mime, image.name)).id;
        setImage({ ...image, uploadId });
      }
      const r = await api.createProduct(
        {
          name: name.trim(),
          shortDescription: shortDescription.trim() || undefined,
          sku: sku.trim() || undefined,
          regularPrice: regularPrice.replace(',', '.') || undefined,
          salePrice: salePrice.replace(',', '.') || undefined,
          categoryIds,
          manageStock,
          stockQuantity: manageStock ? Number(stock) || 0 : undefined,
          imageUploadIds: uploadId && api.mode === 'real' ? [uploadId] : undefined,
        },
        key.current,
      );
      setCreated(r.product);
    } catch (e) {
      const err = e as ApiError;
      setError({
        msg: err.uncertain ? 'Mất kết nối khi đang tạo. Bấm “Thử lại” — hệ thống kiểm tra trên website trước, không tạo sản phẩm trùng.' : err.message,
        uncertain: err.uncertain,
      });
    } finally {
      setSaving(false);
    }
  };

  const publish = () =>
    Alert.alert('Đăng bán sản phẩm?', `“${created!.name}” sẽ hiển thị công khai trên website.`, [
      { text: 'Để nháp', style: 'cancel' },
      {
        text: 'Đăng bán',
        onPress: async () => {
          setPublishing(true);
          try {
            setCreated((await api.publishProduct(created!.id)).product);
          } catch (e) {
            Alert.alert('Không đăng bán được', (e as Error).message);
          } finally {
            setPublishing(false);
          }
        },
      },
    ]);

  if (created) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <StatusStrip />
        <Card style={{ alignItems: 'center', gap: space.md }}>
          <Ionicons name="checkmark-circle" size={52} color="#0F5C2E" />
          <Txt bold size="lg" style={{ textAlign: 'center' }}>
            {created.status === 'publish' ? 'Đã đăng bán' : 'Đã tạo bản nháp'}
          </Txt>
          <Txt muted style={{ textAlign: 'center' }}>
            {created.name} {created.sku ? `· SKU ${created.sku}` : ''} · {created.regularPrice ? money(created.regularPrice, currency) : 'chưa có giá'}
          </Txt>
          <Txt muted size="xs" style={{ textAlign: 'center' }}>
            WooCommerce xác nhận trạng thái: {created.status === 'publish' ? 'Đang bán' : 'Bản nháp (khách chưa thấy)'}
          </Txt>
        </Card>
        {created.status !== 'publish' ? <Button title="Đăng bán ngay" icon="rocket-outline" onPress={publish} loading={publishing} /> : null}
        <Button title="Xem sản phẩm" variant="secondary" onPress={() => router.replace(`/products/${created.id}`)} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <StatusStrip />
        <Banner tone="info" icon="document-outline" text="Sản phẩm được tạo ở dạng Bản nháp. Đăng bán là bước riêng sau khi bạn kiểm tra." />
        <Card style={{ gap: space.md }}>
          <Pressable onPress={pick} accessibilityRole="button" accessibilityLabel="Chọn ảnh sản phẩm" style={{ alignItems: 'center', justifyContent: 'center', height: 160, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, overflow: 'hidden' }}>
            {image ? (
              <Image source={{ uri: image.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <>
                <Ionicons name="image-outline" size={36} color={colors.textSubtle} />
                <Txt muted>Thêm ảnh</Txt>
              </>
            )}
          </Pressable>
          <Field label="Tên sản phẩm *" value={name} onChangeText={setName} />
          <Field label="Mô tả ngắn" value={shortDescription} onChangeText={setShort} multiline />
          <Field label="SKU" value={sku} onChangeText={setSku} autoCapitalize="characters" autoCorrect={false} />
        </Card>
        <Card style={{ gap: space.md }}>
          <Txt bold>Danh mục</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(cats.data ?? []).map((c) => (
              <Chip key={c.id} label={c.name} selected={categoryIds.includes(c.id)} onPress={() => setCats((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))} />
            ))}
            {!cats.data?.length ? <Txt muted size="xs">Chưa tải được danh mục.</Txt> : null}
          </View>
        </Card>
        <Card style={{ gap: space.md }}>
          <Field label={`Giá thường (${currency})`} value={regularPrice} onChangeText={setRegular} keyboardType="decimal-pad" />
          <Field label={`Giá khuyến mãi (${currency})`} value={salePrice} onChangeText={setSale} keyboardType="decimal-pad" hint="Để trống nếu không giảm giá" />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt bold>Theo dõi số lượng tồn kho</Txt>
            <Switch value={manageStock} onValueChange={setManage} accessibilityLabel="Theo dõi số lượng tồn kho" />
          </View>
          {manageStock ? <Field label="Số lượng" value={stock} onChangeText={setStock} keyboardType="number-pad" /> : null}
        </Card>
        {error ? <Banner tone={error.uncertain ? 'warn' : 'danger'} icon="alert-circle" text={error.msg} /> : null}
        <Button title={error ? 'Thử lại' : 'Lưu bản nháp'} icon="save-outline" onPress={submit} loading={saving} disabled={!valid || !online} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
