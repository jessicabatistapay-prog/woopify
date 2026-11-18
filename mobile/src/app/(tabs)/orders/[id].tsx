import React, { useRef, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import type { OrderDetail, StatusOption } from '../../../api/types';
import { ApiError } from '../../../api/client';
import { colors, space } from '../../../lib/theme';
import { money, randomKey, shopTime, statusLabel } from '../../../lib/format';
import { useApi, useSession } from '../../../state/session';
import { useShopInfo } from '../../../state/shop';
import { useResource } from '../../../state/useResource';
import { emitOrderUpdated } from '../../../state/events';
import { LastSync, StatusStrip, useOnline } from '../../../ui/app';
import { Sheet } from '../../../ui/sheet';
import { Banner, Button, Card, Divider, ErrorState, Field, Loading, PaidBadge, Row, SectionTitle, StatusBadge, Thumb, Txt } from '../../../ui/kit';

function confirm(title: string, message: string, okLabel: string, destructive = false): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Hủy', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]);
  });
}

function toast(msg: string) {
  Alert.alert('', msg);
}

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);
  const api = useApi();
  const { mode } = useSession();
  const { tz } = useShopInfo(api);
  const online = useOnline();
  const res = useResource<OrderDetail>(`order:${orderId}`, () => api.getOrder(orderId), [api, orderId]);
  const o = res.data;

  const [statusSheet, setStatusSheet] = useState(false);
  const [statuses, setStatuses] = useState<StatusOption[] | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [noteMode, setNoteMode] = useState<'private' | 'customer' | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteError, setNoteError] = useState<{ msg: string; uncertain: boolean } | null>(null);
  const noteKey = useRef<string>(randomKey('note'));

  if (res.loading) return <Loading label="Đang tải đơn…" />;
  if (!o) return <ErrorState error={res.error ?? { kind: 'server', message: 'Không tải được đơn' }} onRetry={res.refresh} />;

  const copy = async (text: string, what: string) => {
    await Clipboard.setStringAsync(text);
    toast(`Đã sao chép ${what}`);
  };

  const openStatus = async () => {
    setTarget(null);
    setStatusSheet(true);
    if (!statuses) api.orderStatuses().then(setStatuses).catch(() => setStatuses(null));
  };

  const applyStatus = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const updated = await api.updateOrderStatus(o.id, target, o.status);
      res.setData({ ...updated, notes: updated.notes ?? o.notes, tracking: updated.tracking ?? o.tracking, trackingSupported: o.trackingSupported });
      emitOrderUpdated({ id: updated.id, status: updated.status, paid: updated.paid });
      setStatusSheet(false);
      toast(`Đã đổi sang “${updated.statusLabel}”. WooCommerce đã xác nhận.`);
      res.refresh();
    } catch (e) {
      const err = e as ApiError;
      if (err.kind === 'conflict') {
        setStatusSheet(false);
        Alert.alert('Đơn vừa thay đổi trên website', `${err.message} Đã tải lại đơn — kiểm tra rồi thử lại nếu cần.`);
        res.refresh();
      } else if (err.uncertain) {
        // Mất kết nối đúng lúc lưu → kiểm tra lại trạng thái thật trên website
        try {
          const fresh = await api.getOrder(o.id);
          res.setData(fresh);
          emitOrderUpdated({ id: fresh.id, status: fresh.status, paid: fresh.paid });
          setStatusSheet(false);
          if (fresh.status === target) toast('Kết nối bị gián đoạn nhưng website đã lưu trạng thái mới.');
          else Alert.alert('Chưa lưu', 'Website chưa nhận thay đổi. Bạn có thể thử lại.');
        } catch {
          Alert.alert('Không rõ kết quả', 'Mất kết nối khi đang lưu. Hãy kéo để tải lại đơn và kiểm tra trạng thái trước khi thử lại.');
        }
      } else Alert.alert('Không đổi được trạng thái', err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitNote = async () => {
    if (!noteMode || !noteText.trim()) return;
    if (noteMode === 'customer') {
      const ok = await confirm(
        'Gửi ghi chú cho khách?',
        `Nội dung sẽ được WooCommerce gửi qua email tới ${o.customer.email || 'khách hàng'} và hiển thị trong tài khoản của khách.\n\n“${noteText.trim()}”`,
        'Gửi cho khách',
      );
      if (!ok) return;
    }
    setSaving(true);
    setNoteError(null);
    try {
      const n = await api.addOrderNote(o.id, noteText.trim(), noteMode === 'customer', noteKey.current);
      res.setData({ ...o, notes: [n, ...(o.notes ?? []).filter((x) => x.id !== n.id)] });
      setNoteMode(null);
      setNoteText('');
      noteKey.current = randomKey('note');
      toast(n.replayed ? 'Ghi chú đã có trên website (không tạo trùng).' : noteMode === 'customer' ? 'Đã gửi ghi chú cho khách.' : 'Đã thêm ghi chú nội bộ.');
    } catch (e) {
      const err = e as ApiError;
      // giữ nguyên nội dung và khóa idempotency để thử lại an toàn
      setNoteError({
        msg: err.uncertain ? 'Mất kết nối khi đang lưu. Bấm “Thử lại” — hệ thống sẽ kiểm tra trên website trước để không tạo ghi chú trùng.' : err.message,
        uncertain: !!err.uncertain,
      });
    } finally {
      setSaving(false);
    }
  };

  const addressText = o.shippingAddress.lines.join('\n');
  const canWrite = online && !o.stale;

  return (
    <>
      <Stack.Screen options={{ title: `Đơn #${o.number}` }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}>
        <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} />
        {o.stale ? <Banner tone="warn" icon="time-outline" title="Website tạm không truy cập được" text={`Đang hiển thị dữ liệu đã lưu lúc ${shopTime(o.fetchedAt, tz, 'dd/MM HH:mm')}. Thao tác sửa tạm khóa.`} /> : null}

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt bold size="xl" selectable>
              #{o.number}
            </Txt>
            <Pressable onPress={() => copy(o.number, 'mã đơn')} accessibilityRole="button" accessibilityLabel="Sao chép mã đơn" hitSlop={10} style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
              <Ionicons name="copy-outline" size={20} color={colors.primary} />
              <Txt style={{ color: colors.primary }} bold>
                Sao chép
              </Txt>
            </Pressable>
          </View>
          <Txt muted>Đặt lúc {shopTime(o.dateCreated, tz)} (giờ website)</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <StatusBadge status={o.status} label={o.statusLabel} large />
            <PaidBadge paid={o.paid} />
          </View>
          <Txt bold size="lg">
            {money(o.totals.total, o.currency)}
          </Txt>
        </Card>

        <View style={{ gap: space.sm }}>
          <Button title="Đổi trạng thái đơn" icon="swap-horizontal" onPress={openStatus} disabled={!canWrite} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Ghi chú nội bộ" icon="create-outline" variant="secondary" onPress={() => (setNoteMode('private'), setNoteError(null))} disabled={!canWrite} style={{ flex: 1 }} compact />
            <Button title="Gửi cho khách" icon="mail-outline" variant="secondary" onPress={() => (setNoteMode('customer'), setNoteError(null))} disabled={!canWrite} style={{ flex: 1 }} compact />
          </View>
          <Button
            title="Mở trong WooCommerce Admin"
            icon="open-outline"
            variant="ghost"
            onPress={() => (mode === 'demo' ? toast('Bản demo không có trang quản trị thật.') : WebBrowser.openBrowserAsync(o.adminUrl).catch(() => Linking.openURL(o.adminUrl)))}
          />
        </View>

        <SectionTitle>Sản phẩm ({o.items.reduce((s, i) => s + i.quantity, 0)})</SectionTitle>
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {o.items.map((it, i) => (
            <View key={it.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 12 }}>
                <Thumb uri={it.imageUrl} label={it.name} size={52} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt bold>{it.name}</Txt>
                  {it.sku ? (
                    <Txt muted size="xs" selectable>
                      SKU: {it.sku}
                    </Txt>
                  ) : null}
                  {it.meta.map((m) => (
                    <Txt key={m.key} muted size="xs">
                      {m.key}: {m.value}
                    </Txt>
                  ))}
                  <Txt size="xs">
                    {it.quantity} × {money(it.unitPrice, o.currency)}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt bold>{money(it.total, o.currency)}</Txt>
                  {it.subtotal > it.total ? (
                    <Txt muted size="xs" style={{ textDecorationLine: 'line-through' }}>
                      {money(it.subtotal, o.currency)}
                    </Txt>
                  ) : null}
                </View>
              </View>
            </View>
          ))}
        </Card>

        <SectionTitle>Thanh toán</SectionTitle>
        <Card style={{ gap: 0 }}>
          <Row label="Tạm tính" value={money(o.totals.subtotal, o.currency)} />
          {o.totals.discount ? <Row label={`Giảm giá${o.totals.coupons.length ? ` (${o.totals.coupons.join(', ')})` : ''}`} value={`− ${money(o.totals.discount, o.currency)}`} /> : null}
          <Row label={`Vận chuyển${o.totals.shippingMethods.length ? ` · ${o.totals.shippingMethods.join(', ')}` : ''}`} value={money(o.totals.shipping, o.currency)} />
          {o.totals.fees.map((f) => (
            <Row key={f.name} label={f.name} value={money(f.total, o.currency)} />
          ))}
          <Row label="Thuế" value={money(o.totals.tax, o.currency)} />
          <Divider />
          <Row label="Tổng thanh toán" value={money(o.totals.total, o.currency)} strong />
          {o.totals.refunded ? (
            <>
              <Row label="Đã hoàn tiền" value={`− ${money(o.totals.refunded, o.currency)}`} />
              <Row label="Còn lại" value={money(o.totals.total - o.totals.refunded, o.currency)} strong />
            </>
          ) : null}
          <Divider />
          <Row label="Phương thức" value={o.paymentMethod || '—'} />
          <Row label="Thanh toán lúc" value={o.datePaid ? shopTime(o.datePaid, tz) : 'Chưa thanh toán'} />
          {o.transactionId ? <Row label="Mã giao dịch" value={o.transactionId} /> : null}
        </Card>

        {o.customerNote ? (
          <Banner tone="info" icon="chatbubble-ellipses-outline" title="Ghi chú của khách" text={o.customerNote} />
        ) : null}

        <SectionTitle
          right={
            <Button title="Sao chép địa chỉ" icon="copy-outline" variant="ghost" onPress={() => copy(addressText, 'địa chỉ giao hàng')} style={{ minHeight: 36, paddingHorizontal: 4 }} />
          }
        >
          Giao hàng
        </SectionTitle>
        <Card>
          {o.shippingAddress.isBilling ? (
            <Txt muted size="xs">
              (Đơn không có địa chỉ giao hàng riêng — dùng địa chỉ thanh toán)
            </Txt>
          ) : null}
          <Txt selectable>{addressText}</Txt>
          {o.shippingAddress.phone ? <Row icon="call-outline" label={o.shippingAddress.phone} onPress={() => Linking.openURL(`tel:${o.shippingAddress.phone.replace(/[^\d+]/g, '')}`)} /> : null}
          {o.customer.email ? <Row icon="mail-outline" label={o.customer.email} onPress={() => copy(o.customer.email, 'email')} /> : null}
        </Card>

        {o.trackingSupported ? (
          <>
            <SectionTitle>Vận đơn (tracking)</SectionTitle>
            <Card style={{ gap: 0 }}>
              {!o.tracking || o.tracking.length === 0 ? <Txt muted>Chưa có mã tracking.</Txt> : null}
              {o.tracking?.map((t, i) => (
                <View key={`${t.number}-${i}`}>
                  {i > 0 ? <Divider /> : null}
                  <Row
                    icon="cube-outline"
                    label={`${o.tracking!.length > 1 ? `Kiện ${i + 1} · ` : ''}${t.provider || 'Hãng vận chuyển'}`}
                    value={t.number}
                    onPress={t.link ? () => WebBrowser.openBrowserAsync(t.link!) : () => copy(t.number, 'mã tracking')}
                  />
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <SectionTitle>Ghi chú đơn hàng</SectionTitle>
        <Card style={{ gap: 0 }}>
          {o.notes === undefined ? <Txt muted>Không tải được ghi chú.</Txt> : o.notes.length === 0 ? <Txt muted>Chưa có ghi chú.</Txt> : null}
          {o.notes?.map((n, i) => (
            <View key={n.id} style={{ paddingVertical: 10, gap: 4 }}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Ionicons name={n.customerNote ? 'mail' : 'lock-closed'} size={14} color={n.customerNote ? colors.info : colors.textSubtle} />
                <Txt muted size="xs">
                  {n.customerNote ? 'Đã gửi cho khách' : 'Nội bộ'} · {shopTime(n.date, tz, 'dd/MM HH:mm')} · {n.author}
                </Txt>
              </View>
              <Txt>{n.note.replace(/<[^>]+>/g, '')}</Txt>
            </View>
          ))}
        </Card>
        <LastSync at={res.updatedAt} />
      </ScrollView>

      <Sheet visible={statusSheet} onClose={() => setStatusSheet(false)} title={target ? 'Xác nhận đổi trạng thái' : 'Chọn trạng thái mới'}>
        {!target ? (
          <View style={{ gap: 8 }}>
            {(statuses ?? ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'].map((slug) => ({ slug, label: statusLabel(slug), count: 0 })))
              .filter((s) => s.slug !== o.status && s.slug !== 'checkout-draft')
              .map((s) => (
                <Pressable key={s.slug} onPress={() => setTarget(s.slug)} accessibilityRole="button" style={{ paddingVertical: 8 }}>
                  <StatusBadge status={s.slug} label={s.label} large />
                </Pressable>
              ))}
            <Txt muted size="xs">
              Đổi sang “Đã hoàn tiền” không hoàn tiền qua cổng thanh toán. Dùng WooCommerce Admin để hoàn tiền thật.
            </Txt>
          </View>
        ) : (
          <View style={{ gap: space.lg }}>
            <View style={{ alignItems: 'center', gap: 10 }}>
              <Txt muted>Trạng thái hiện tại</Txt>
              <StatusBadge status={o.status} label={o.statusLabel} large center />
              <Ionicons name="arrow-down" size={24} color={colors.textMuted} />
              <Txt muted>Trạng thái mới</Txt>
              <StatusBadge status={target} large center />
            </View>
            {target === 'completed' || target === 'refunded' || target === 'cancelled' ? (
              <Banner tone="warn" icon="mail-outline" text="WooCommerce có thể tự gửi email cho khách khi chuyển sang trạng thái này (tùy cài đặt email của shop)." />
            ) : null}
            <Button title={`Đổi sang “${statusLabel(target)}”`} onPress={applyStatus} loading={saving} />
            <Button title="Chọn lại" variant="secondary" onPress={() => setTarget(null)} disabled={saving} />
          </View>
        )}
      </Sheet>

      <Sheet visible={noteMode !== null} onClose={() => !saving && setNoteMode(null)} title={noteMode === 'customer' ? 'Gửi ghi chú cho khách' : 'Thêm ghi chú nội bộ'}>
        <View style={{ gap: space.md }}>
          {noteMode === 'customer' ? (
            <Banner tone="warn" icon="mail-outline" text={`Khách (${o.customer.email || 'không có email'}) sẽ nhận được nội dung này qua email.`} />
          ) : (
            <Txt muted size="xs">
              Chỉ quản trị viên thấy ghi chú nội bộ. Khách không nhận được.
            </Txt>
          )}
          <Field label="Nội dung" value={noteText} onChangeText={setNoteText} multiline autoFocus />
          {noteError ? <Banner tone={noteError.uncertain ? 'warn' : 'danger'} icon="alert-circle" text={noteError.msg} /> : null}
          <Button
            title={noteError ? 'Thử lại' : noteMode === 'customer' ? 'Tiếp tục…' : 'Lưu ghi chú'}
            icon={noteMode === 'customer' ? 'send-outline' : 'save-outline'}
            onPress={submitNote}
            loading={saving}
            disabled={!noteText.trim() || !online}
          />
        </View>
      </Sheet>
    </>
  );
}
