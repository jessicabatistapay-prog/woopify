import React, { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SettingField } from '../api/types';
import { colors, space } from '../lib/theme';
import { displayValue, isOn } from '../lib/settings';
import { useOnline } from './app';
import { Sheet } from './sheet';
import { Banner, Button, Card, Chip, Divider, Field, SearchBar, Txt } from './kit';

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

/**
 * Form cài đặt dùng chung cho mọi nhóm cài đặt WooCommerce, cổng thanh toán và phương thức vận chuyển.
 * Hiện danh sách thay đổi (cũ → mới) trước khi lưu; sau khi lưu hiển thị giá trị WooCommerce trả về.
 */
export function SettingsForm({ fields, onSave, intro }: { fields: SettingField[]; onSave: (updates: { id: string; value: unknown }[]) => Promise<SettingField[]>; intro?: string }) {
  const online = useOnline();
  const [base, setBase] = useState(fields);
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.map((f) => [f.id, f.value])));
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SettingField[] | null>(null);
  const [picker, setPicker] = useState<SettingField | null>(null);
  const [pickerQ, setPickerQ] = useState('');

  const changes = base.filter((f) => f.editable && !same(f.value, values[f.id]));
  const set = (id: string, v: unknown) => {
    setValues((s) => ({ ...s, [id]: v }));
    setSaved(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const confirmed = await onSave(changes.map((f) => ({ id: f.id, value: values[f.id] })));
      const byId = new Map(confirmed.map((c) => [c.id, c]));
      const next = base.map((f) => (byId.has(f.id) ? { ...f, value: byId.get(f.id)!.value } : f));
      setBase(next);
      setValues(Object.fromEntries(next.map((f) => [f.id, f.value])));
      setSaved(confirmed);
      setPreview(false);
    } catch (e) {
      setError((e as Error).message); // giữ nguyên nội dung đang sửa
      setPreview(false);
    } finally {
      setSaving(false);
    }
  };

  const renderField = (f: SettingField) => {
    if (f.type === 'title') {
      return (
        <Txt key={f.id} bold size="md" style={{ marginTop: space.md }}>
          {f.label}
        </Txt>
      );
    }
    if (f.type === 'sectionend') return null;
    const help = f.description || f.tip;
    if (!f.editable) {
      return (
        <Card key={f.id} style={{ gap: 4 }}>
          <Txt bold>{f.label}</Txt>
          <Txt muted size="xs">
            {displayValue(f, values[f.id])} · Loại trường này chỉnh trên trang quản trị web.
          </Txt>
        </Card>
      );
    }
    const changed = !same(f.value, values[f.id]);
    const wrap = (child: React.ReactNode) => (
      <Card key={f.id} style={{ gap: 8, borderColor: changed ? colors.primary : colors.border, borderWidth: changed ? 1.5 : undefined }}>
        {child}
        {help ? (
          <Txt muted size="xs">
            {help}
          </Txt>
        ) : null}
      </Card>
    );
    const v = values[f.id];
    switch (f.type) {
      case 'checkbox':
        return wrap(
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Txt bold style={{ flex: 1 }}>
              {f.label}
            </Txt>
            <Switch value={isOn(v)} onValueChange={(on) => set(f.id, on ? 'yes' : 'no')} accessibilityLabel={f.label} />
          </View>,
        );
      case 'select':
      case 'radio': {
        const opts = Object.entries(f.options ?? {});
        if (opts.length <= 6) {
          return wrap(
            <>
              <Txt bold>{f.label}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {opts.map(([k, label]) => (
                  <Chip key={k} label={label} selected={String(v) === k} onPress={() => set(f.id, k)} />
                ))}
              </View>
            </>,
          );
        }
        return wrap(
          <Pressable onPress={() => (setPicker(f), setPickerQ(''))} accessibilityRole="button" accessibilityLabel={`${f.label}: ${displayValue(f, v)}`} style={{ gap: 4 }}>
            <Txt bold>{f.label}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Txt style={{ flex: 1 }}>{displayValue(f, v)}</Txt>
              <Ionicons name="chevron-down" size={18} color={colors.textSubtle} />
            </View>
          </Pressable>,
        );
      }
      case 'multiselect': {
        const arr = Array.isArray(v) ? (v as string[]) : [];
        return wrap(
          <Pressable onPress={() => (setPicker(f), setPickerQ(''))} accessibilityRole="button" style={{ gap: 4 }}>
            <Txt bold>{f.label}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Txt style={{ flex: 1 }} numberOfLines={2}>
                {arr.length ? `${arr.length} mục: ${displayValue(f, arr)}` : '(chưa chọn)'}
              </Txt>
              <Ionicons name="chevron-down" size={18} color={colors.textSubtle} />
            </View>
          </Pressable>,
        );
      }
      default:
        return wrap(
          <Field
            label={f.label}
            value={v === null || v === undefined ? '' : String(v)}
            onChangeText={(t) => set(f.id, t)}
            placeholder={f.placeholder}
            multiline={f.type === 'textarea'}
            secureTextEntry={f.type === 'password'}
            keyboardType={['number', 'decimal', 'price'].includes(f.type) ? 'decimal-pad' : f.type === 'email' ? 'email-address' : f.type === 'url' ? 'url' : 'default'}
            autoCapitalize={['email', 'url', 'password'].includes(f.type) ? 'none' : 'sentences'}
          />,
        );
    }
  };

  const opts = Object.entries(picker?.options ?? {}).filter(([k, l]) => !pickerQ || `${k} ${l}`.toLowerCase().includes(pickerQ.toLowerCase()));
  const multi = picker?.type === 'multiselect';
  const pv = picker ? values[picker.id] : null;

  return (
    <View style={{ gap: space.md }}>
      {intro ? (
        <Txt muted size="xs">
          {intro}
        </Txt>
      ) : null}
      {saved ? (
        <Card style={{ borderColor: '#0F5C2E', borderWidth: 1.5 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Ionicons name="checkmark-circle" size={22} color="#0F5C2E" />
            <Txt bold style={{ color: '#0F5C2E' }}>
              Đã lưu — WooCommerce xác nhận
            </Txt>
          </View>
          {saved.map((c) => (
            <Txt key={c.id} size="xs">
              {c.label}: <Txt bold size="xs">{displayValue(c, c.value)}</Txt>
            </Txt>
          ))}
        </Card>
      ) : null}
      {error ? <Banner tone="danger" icon="alert-circle" title="Chưa lưu" text={`${error} Nội dung bạn sửa vẫn được giữ.`} /> : null}
      {changes.length ? (
        <Button title={`Xem trước ${changes.length} thay đổi`} icon="eye-outline" variant="secondary" onPress={() => setPreview(true)} disabled={!online} />
      ) : null}
      {base.map(renderField)}
      <Button
        title={changes.length ? `Xem trước ${changes.length} thay đổi` : 'Chưa có thay đổi'}
        icon="eye-outline"
        onPress={() => setPreview(true)}
        disabled={!changes.length || !online}
      />

      <Sheet visible={preview} onClose={() => !saving && setPreview(false)} title="Xác nhận thay đổi">
        <View style={{ gap: space.md }}>
          <Txt muted>Các cài đặt sau sẽ được ghi lên WooCommerce:</Txt>
          {changes.map((c) => (
            <Card key={c.id} style={{ gap: 2, padding: space.md }}>
              <Txt bold size="xs">
                {c.label}
              </Txt>
              <Txt>
                <Txt style={{ color: colors.textSubtle }}>{displayValue(c, c.value)}</Txt> → <Txt bold>{displayValue(c, values[c.id])}</Txt>
              </Txt>
            </Card>
          ))}
          <Button title="Lưu lên website" icon="cloud-upload-outline" onPress={save} loading={saving} />
          <Button title="Quay lại sửa" variant="secondary" onPress={() => setPreview(false)} disabled={saving} />
        </View>
      </Sheet>

      <Sheet visible={!!picker} onClose={() => setPicker(null)} title={picker?.label ?? ''}>
        <View style={{ gap: 8 }}>
          {Object.keys(picker?.options ?? {}).length > 8 ? <SearchBar value={pickerQ} onChangeText={setPickerQ} placeholder="Tìm…" /> : null}
          {opts.slice(0, 200).map(([k, label], i) => {
            const sel = multi ? Array.isArray(pv) && (pv as string[]).includes(k) : String(pv) === k;
            return (
              <View key={k}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() => {
                    if (!picker) return;
                    if (multi) {
                      const arr = Array.isArray(pv) ? (pv as string[]) : [];
                      set(picker.id, sel ? arr.filter((x) => x !== k) : [...arr, k]);
                    } else {
                      set(picker.id, k);
                      setPicker(null);
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sel }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8 }}
                >
                  <Txt style={{ flex: 1 }}>{label}</Txt>
                  {sel ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                </Pressable>
              </View>
            );
          })}
          {multi ? <Button title="Xong" onPress={() => setPicker(null)} /> : null}
        </View>
      </Sheet>
    </View>
  );
}
