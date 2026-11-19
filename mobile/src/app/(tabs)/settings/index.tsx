import React, { useEffect, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import type { DeviceInfo, DevicePrefs, ShopResponse } from '../../../api/types';
import { colors, space } from '../../../lib/theme';
import { relativeTime, tzLabel } from '../../../lib/format';
import { installationId } from '../../../lib/storage';
import { previewSound, registerDevice, SOUND_CHANNELS } from '../../../lib/push';
import { useApi, useSession } from '../../../state/session';
import { loadShop } from '../../../state/shop';
import { useResource } from '../../../state/useResource';
import { StatusStrip } from '../../../ui/app';
import { Banner, Button, Card, Chip, Divider, ErrorState, Loading, Row, SectionTitle, Txt } from '../../../ui/kit';

export default function Settings() {
  const api = useApi();
  const router = useRouter();
  const { mode, email, baseUrl, signOut } = useSession();
  const shopRes = useResource<ShopResponse>('shop', () => loadShop(api), [api]);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [savingPref, setSavingPref] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const inst = await installationId();
      let d = await api.getDevice(inst).catch(() => null);
      if (!d) {
        await registerDevice(api, false).catch(() => undefined);
        d = await api.getDevice(inst).catch(() => null);
      }
      setDevice(d);
    })();
  }, [api]);

  const setPref = async <K extends keyof DevicePrefs>(k: K, v: DevicePrefs[K]) => {
    if (!device) return;
    setSavingPref(k);
    const prev = device;
    setDevice({ ...device, prefs: { ...device.prefs, [k]: v } });
    try {
      setDevice(await api.updateDevicePrefs(device.installationId, { [k]: v }));
    } catch (e) {
      setDevice(prev);
      Alert.alert('Không lưu được tùy chọn', (e as Error).message);
    } finally {
      setSavingPref(null);
    }
  };

  const logout = () =>
    Alert.alert(mode === 'demo' ? 'Thoát chế độ demo?' : 'Đăng xuất?', mode === 'demo' ? 'Dữ liệu demo sẽ bị xóa khỏi app.' : 'Điện thoại này sẽ ngừng nhận thông báo đơn hàng.', [
      { text: 'Hủy', style: 'cancel' },
      { text: mode === 'demo' ? 'Thoát demo' : 'Đăng xuất', style: 'destructive', onPress: () => signOut() },
    ]);

  if (shopRes.loading) return <Loading />;
  const r = shopRes.data;
  if (!r) return <ErrorState error={shopRes.error!} onRetry={shopRes.refresh} />;
  const check = r.connected ? r.shop.lastCheck : null;
  const failing = check?.steps.filter((s) => s.level === 'error') ?? [];

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={shopRes.refreshing} onRefresh={shopRes.refresh} />}>
      <StatusStrip fromCache={shopRes.fromCache} updatedAt={shopRes.updatedAt} error={shopRes.error} />
      <SectionTitle>Cửa hàng</SectionTitle>
      {!r.connected ? (
        <Card>
          <Banner tone="warn" icon="link-outline" title="Chưa kết nối cửa hàng" text="Nhập URL website và API key WooCommerce để bắt đầu." />
          <Button title="Kết nối cửa hàng" icon="link-outline" onPress={() => router.push('/settings/connection')} />
        </Card>
      ) : (
        <Card style={{ gap: 0 }}>
          <Row label="Tên shop" value={r.shop.name || '—'} />
          <Row label="URL" value={r.shop.url.replace(/^https?:\/\//, '')} />
          <Row label="Múi giờ website" value={tzLabel(r.shop.timezone)} />
          <Row label="Tiền tệ" value={r.shop.currency} />
          <Row label="Đồng bộ lần cuối" value={relativeTime(r.sync.lastSyncAt)} />
          <Row label="Webhook gần nhất" value={relativeTime(r.shop.lastWebhookAt)} />
          <Row
            label="Tình trạng kết nối"
            value={
              <Txt bold style={{ color: !check ? colors.textMuted : failing.length ? colors.danger : '#0F5C2E' }}>
                {!check ? 'Chưa kiểm tra' : failing.length ? `Lỗi: ${failing.map((f) => f.label).join(', ')}` : 'Hoạt động tốt'}
              </Txt>
            }
          />
          {r.sync.orders?.status === 'running' ? (
            <Row label="Đồng bộ lịch sử" value={`${r.sync.orders.synced}${r.sync.orders.total ? `/${r.sync.orders.total}` : ''} đơn`} />
          ) : null}
          <Divider />
          <Row icon="pulse-outline" label="Kết nối & kiểm tra kết nối" onPress={() => router.push('/settings/connection')} />
        </Card>
      )}

      {r.connected ? (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          <Row icon="storefront-outline" label="Quản lý cửa hàng" onPress={() => router.push('/settings/store')} />
          <Divider />
          <Row icon="bar-chart-outline" label="Báo cáo & Live" onPress={() => router.push('/reports')} />
        </Card>
      ) : null}

      <SectionTitle>Thông báo</SectionTitle>
      <Card style={{ gap: 0 }}>
        {!device ? <Txt muted>Đang đăng ký thiết bị…</Txt> : null}
        <PrefRow label="Báo khi có đơn mới" sub="Khi khách gửi đơn thành công (kể cả đang chờ thanh toán)" value={device?.prefs.notifyNewOrder ?? true} onChange={(v) => setPref('notifyNewOrder', v)} disabled={!device || savingPref !== null} />
        <Divider />
        <PrefRow label="Báo khi đơn đã thanh toán" sub="Thông báo riêng, tiêu đề “Đã thanh toán #…”" value={device?.prefs.notifyPaid ?? false} onChange={(v) => setPref('notifyPaid', v)} disabled={!device || savingPref !== null} />
        <Divider />
        <PrefRow label="Ẩn số tiền trên màn hình khóa" sub="Chỉ hiện mã đơn, ví dụ “Đơn mới #10428”" value={device?.prefs.hideAmount ?? false} onChange={(v) => setPref('hideAmount', v)} disabled={!device || savingPref !== null} />
        <Divider />
        <View style={{ paddingVertical: 10, gap: 8 }}>
          <Txt bold>Âm thanh đơn mới</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(Object.keys(SOUND_CHANNELS) as (keyof typeof SOUND_CHANNELS)[]).map((k) => (
              <Chip key={k} label={SOUND_CHANNELS[k].label} selected={(device?.prefs.sound ?? 'kaching') === k} onPress={() => setPref('sound', k)} />
            ))}
          </View>
          <Button
            title="Nghe thử"
            icon="volume-high-outline"
            variant="ghost"
            compact
            style={{ alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: 0 }}
            onPress={() =>
              Platform.OS === 'web'
                ? Alert.alert('', 'Nghe thử chỉ chạy trên app cài trên điện thoại.')
                : previewSound(device?.prefs.sound ?? 'kaching').catch((e) => Alert.alert('Không phát được', (e as Error).message))
            }
          />
          <Txt muted size="xs">
            Thông báo sẽ hiện sau 2 giây. Hãy tắt chế độ im lặng của điện thoại.
          </Txt>
        </View>
        <Divider />
        <Row icon="notifications-outline" label="Kiểm tra thông báo" onPress={() => router.push('/settings/push')} />
        <Row icon="time-outline" label="Lịch sử thông báo" onPress={() => router.push('/notifications')} />
      </Card>
      <Txt muted size="xs">
        Thông báo không bao giờ chứa địa chỉ, số điện thoại hay email của khách.
      </Txt>

      <SectionTitle>Tài khoản</SectionTitle>
      <Card style={{ gap: 0 }}>
        {mode === 'demo' ? <Banner tone="demo" icon="flask-outline" title="Dữ liệu demo" text="Bạn chưa kết nối backend thật." /> : null}
        {email ? <Row label="Email" value={email} /> : null}
        {mode === 'real' && baseUrl ? <Row label="Backend" value={baseUrl.replace(/^https?:\/\//, '')} /> : null}
        <Row label="Phiên bản app" value={`${Constants.expoConfig?.version ?? '1.0.0'} (${Platform.OS})`} />
        <Divider />
        <View style={{ paddingTop: 8 }}>
          <Button title={mode === 'demo' ? 'Thoát demo' : 'Đăng xuất'} icon="log-out-outline" variant="secondary" onPress={logout} />
        </View>
      </Card>
    </ScrollView>
  );
}

function PrefRow({ label, sub, value, onChange, disabled }: { label: string; sub: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      <View style={{ flex: 1 }}>
        <Txt bold>{label}</Txt>
        <Txt muted size="xs">
          {sub}
        </Txt>
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  );
}
