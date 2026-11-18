import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Diagnostics } from '../../../api/types';
import { colors, space } from '../../../lib/theme';
import { relativeTime } from '../../../lib/format';
import { installationId } from '../../../lib/storage';
import { getPermission, openSystemSettingsHint, registerDevice, type PermissionState } from '../../../lib/push';
import { useApi } from '../../../state/session';
import { StatusStrip } from '../../../ui/app';
import { Banner, Button, Card, Divider, Loading, Row, SectionTitle, Txt } from '../../../ui/kit';

const PERM: Record<PermissionState, { label: string; ok: boolean }> = {
  granted: { label: 'Đã cho phép', ok: true },
  denied: { label: 'Đã từ chối', ok: false },
  undetermined: { label: 'Chưa hỏi', ok: false },
  unsupported: { label: 'Không hỗ trợ (web)', ok: false },
};

const DELIVERY: Record<string, string> = {
  queued: 'Đang chờ gửi',
  retry: 'Đang thử lại',
  sent: 'Đã gửi tới Expo/APNs/FCM',
  delivered: 'APNs/FCM đã nhận',
  error: 'Lỗi',
  local: 'Thông báo cục bộ (demo)',
};

function Status({ ok, text }: { ok: boolean | null; text: string }) {
  const c = ok === null ? colors.textMuted : ok ? '#0F5C2E' : colors.danger;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
      <Ionicons name={ok === null ? 'ellipse-outline' : ok ? 'checkmark-circle' : 'close-circle'} size={18} color={c} />
      <Txt bold style={{ color: c, flexShrink: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

export default function PushCheck() {
  const api = useApi();
  const [perm, setPerm] = useState<PermissionState | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'danger' | 'warn'; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setPerm(await getPermission());
      setDiag(await api.diagnostics(await installationId()));
    } catch (e) {
      setMessage({ tone: 'danger', text: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    const t = setTimeout(refresh, 0); // tải khi mở màn hình
    return () => clearTimeout(t);
  }, [refresh]);

  const reRegister = async (ask: boolean) => {
    setBusy('register');
    setMessage(null);
    try {
      const r = await registerDevice(api, ask);
      if (r.error) setMessage({ tone: 'warn', text: r.error });
      else if (r.permission !== 'granted') setMessage({ tone: 'warn', text: `Chưa có quyền thông báo. Vào ${openSystemSettingsHint()} để bật.` });
      else setMessage({ tone: 'info', text: 'Đã đăng ký thiết bị với backend.' });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy('test');
    setMessage(null);
    try {
      const r = await api.sendTestNotification(await installationId());
      setMessage(
        r.sent
          ? { tone: 'info', text: 'Đã gửi. Thông báo sẽ hiện trong vài giây — hãy khóa màn hình hoặc thoát app để thử chạm mở.' }
          : { tone: 'danger', text: `Không gửi được: ${r.errors.map((e) => e.error).join(', ') || 'thiết bị không nhận loại thông báo này'}` },
      );
      setTimeout(refresh, 3000);
    } catch (e) {
      setMessage({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (!diag || !perm) return <Loading />;
  const d = diag.device;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <StatusStrip />
      {message ? <Banner tone={message.tone} text={message.text} /> : null}

      <SectionTitle>Điện thoại này</SectionTitle>
      <Card style={{ gap: 0 }}>
        <Row label="Quyền thông báo (hệ điều hành)" value={<Status ok={PERM[perm].ok} text={PERM[perm].label} />} />
        <Row label="Đăng ký với backend" value={<Status ok={!!d && d.active} text={!d ? 'Chưa đăng ký' : d.active ? 'Đang hoạt động' : `Đã tắt (${d.inactiveReason})`} />} />
        <Row label="Push token" value={<Status ok={d?.hasPushToken ?? false} text={d?.pushTokenPreview ?? 'Chưa có'} />} />
        <Row label="Lần gửi gần nhất" value={d?.lastPushAt ? `${relativeTime(d.lastPushAt)} · ${d.lastPushStatus === 'error' ? `lỗi ${d.lastPushError}` : 'thành công'}` : '—'} />
        <Divider />
        <View style={{ gap: 8, paddingTop: 8 }}>
          {perm === 'undetermined' ? <Button title="Cho phép thông báo" icon="notifications-outline" onPress={() => reRegister(true)} loading={busy === 'register'} /> : null}
          {perm === 'denied' ? (
            <>
              <Txt muted size="xs">
                Bạn đã tắt thông báo cho app. Lịch sử thông báo trong app vẫn hoạt động. Để nhận push, vào {openSystemSettingsHint()}.
              </Txt>
              <Button title="Mở Cài đặt hệ thống" icon="settings-outline" variant="secondary" onPress={() => Linking.openSettings()} />
            </>
          ) : null}
          <Button title="Đăng ký lại thiết bị" icon="refresh-outline" variant="secondary" onPress={() => reRegister(false)} loading={busy === 'register'} disabled={Platform.OS === 'web'} />
        </View>
      </Card>

      <SectionTitle>1 · Kiểm tra đường gửi push</SectionTitle>
      <Card>
        <Txt muted>Backend gửi thẳng một thông báo tới điện thoại này qua Expo → APNs/FCM. Không cần WooCommerce. Dùng để biết điện thoại có nhận được push không.</Txt>
        <Button title="Gửi thông báo thử" icon="paper-plane-outline" onPress={sendTest} loading={busy === 'test'} disabled={!d?.hasPushToken && api.mode === 'real'} />
        {diag.lastTestPush ? (
          <Txt muted size="xs">
            Lần thử gần nhất: {relativeTime(diag.lastTestPush.created_at)} · {DELIVERY[diag.lastTestPush.status] ?? diag.lastTestPush.status}
            {diag.lastTestPush.error ? ` (${diag.lastTestPush.error})` : ''}
          </Txt>
        ) : null}
        {!d?.hasPushToken && api.mode === 'real' ? <Txt size="xs" style={{ color: colors.danger }}>Cần push token: cấp quyền và dùng bản development build trên điện thoại thật.</Txt> : null}
      </Card>

      <SectionTitle>2 · Kiểm tra toàn bộ luồng bằng đơn thật</SectionTitle>
      <Card style={{ gap: 0 }}>
        <Txt muted>Đặt một đơn thử trên website (checkout bình thường). Trong khoảng 10–30 giây, các mốc dưới đây sẽ lần lượt được cập nhật. Kéo xuống để làm mới.</Txt>
        <Row label="a. Backend nhận webhook" value={diag.lastWebhookAt ? `${relativeTime(diag.lastWebhookAt)} · ${diag.lastWebhookTopic}` : 'Chưa nhận'} />
        {diag.lastBadSignatureAt ? <Banner tone="danger" icon="key-outline" text={`Webhook gần nhất có chữ ký sai (${relativeTime(diag.lastBadSignatureAt)}). Vào Kết nối → “Tạo/sửa webhook tự động”.`} /> : null}
        <Row label="b. Ghi nhận sự kiện đơn" value={diag.lastEvent ? `${diag.lastEvent.type === 'order.paid' ? 'Đã thanh toán' : 'Đơn mới'} #${diag.lastEvent.number ?? diag.lastEvent.order_id}${diag.lastEvent.suppressed ? ' (không báo: đơn cũ)' : ''}` : '—'} />
        <Row label="c. Push tới điện thoại này" value={diag.lastOrderPush ? `${DELIVERY[diag.lastOrderPush.status] ?? diag.lastOrderPush.status} · ${relativeTime(diag.lastOrderPush.created_at)}` : '—'} />
        {diag.lastOrderPush?.error ? <Txt size="xs" style={{ color: colors.danger }}>{diag.lastOrderPush.error}</Txt> : null}
        <Divider />
        <Button title="Làm mới trạng thái" icon="refresh-outline" variant="ghost" onPress={refresh} />
      </Card>
      {!diag.expoAccessTokenConfigured && api.mode === 'real' ? (
        <Txt muted size="xs">
          Gợi ý: đặt EXPO_ACCESS_TOKEN trên backend nếu bạn bật “Enhanced push security” trong tài khoản Expo.
        </Txt>
      ) : null}
    </ScrollView>
  );
}
