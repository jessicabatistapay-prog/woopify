import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import type { CheckResult, ShopResponse } from '../../../api/types';
import { CheckList } from '../../../ui/checklist';
import { space } from '../../../lib/theme';
import { relativeTime, shopTime, tzLabel } from '../../../lib/format';
import { useApi } from '../../../state/session';
import { loadShop } from '../../../state/shop';
import { useResource } from '../../../state/useResource';
import { StatusStrip, useOnline } from '../../../ui/app';
import { Banner, Button, Card, Field, Loading, Row, SectionTitle, Txt } from '../../../ui/kit';

export default function Connection() {
  const api = useApi();
  const online = useOnline();
  const res = useResource<ShopResponse>('shop', () => loadShop(api), [api]);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [ck, setCk] = useState('');
  const [cs, setCs] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (res.loading) return <Loading />;
  const r = res.data;
  const connected = r?.connected === true;
  const showForm = !connected || editing;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const err = e as any;
      setError(err.message);
      if (err.details?.steps) setResult(err.details);
    } finally {
      setBusy(null);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} />
        {connected && r.connected ? (
          <Card style={{ gap: 0 }}>
            <Row label="Website" value={r.shop.url.replace(/^https?:\/\//, '')} />
            <Row label="Múi giờ" value={tzLabel(r.shop.timezone)} />
            <Row label="Tiền tệ" value={r.shop.currency} />
            <Row label="WooCommerce" value={r.shop.wcVersion ?? '—'} />
            <Row label="Lưu đơn HPOS" value={r.shop.hposEnabled === null ? 'Không rõ' : r.shop.hposEnabled ? 'Bật' : 'Tắt'} />
            <Row label="Tracking (AST)" value={r.shop.astEnabled ? 'Đã phát hiện' : 'Không có'} />
            <Row label="Quản lý tồn kho" value={r.shop.manageStockEnabled ? 'Bật' : 'Tắt (chỉ còn/hết hàng)'} />
            <Row label="Webhook gần nhất" value={r.shop.lastWebhookAt ? `${relativeTime(r.shop.lastWebhookAt)} · ${r.shop.lastWebhookTopic}` : 'Chưa nhận'} />
            <Row label="Đối soát gần nhất" value={relativeTime(r.sync.orders?.lastReconcileAt)} />
            {r.sync.orders?.status === 'running' ? (
              <Row label="Đồng bộ lịch sử" value={`${r.sync.orders.synced}${r.sync.orders.total ? `/${r.sync.orders.total}` : ''} đơn · đủ từ ${shopTime(r.sync.orders.completeFrom, r.shop.timezone, 'dd/MM')}`} />
            ) : null}
          </Card>
        ) : null}

        {connected ? (
          <View style={{ gap: space.sm }}>
            <Button
              title="Kiểm tra kết nối"
              icon="pulse-outline"
              loading={busy === 'check'}
              disabled={!online || !!busy}
              onPress={() =>
                run('check', async () => {
                  setResult(await api.checkConnection());
                  res.refresh();
                })
              }
            />
            <Button
              title="Tạo/sửa webhook tự động"
              icon="git-network-outline"
              variant="secondary"
              loading={busy === 'hooks'}
              disabled={!online || !!busy}
              onPress={() =>
                run('hooks', async () => {
                  const x = await api.ensureWebhooks();
                  setResult(x.check);
                  Alert.alert('Webhook', `Tạo mới: ${x.created.length}, cập nhật: ${x.updated.length}.`);
                })
              }
            />
            <Button
              title="Đồng bộ ngay"
              icon="sync-outline"
              variant="secondary"
              loading={busy === 'sync'}
              disabled={!online || !!busy}
              onPress={() =>
                run('sync', async () => {
                  await api.syncNow();
                  Alert.alert('', 'Đã yêu cầu đối soát. Dữ liệu mới sẽ có sau ít giây.');
                })
              }
            />
            {!editing ? <Button title="Đổi thông tin kết nối" variant="ghost" onPress={() => setEditing(true)} /> : null}
          </View>
        ) : null}

        {result ? (
          <Card>
            <Txt bold size="md">
              Kết quả kiểm tra {result.ok ? '— hoạt động' : '— cần xử lý'}
            </Txt>
            <CheckList result={result} />
          </Card>
        ) : null}
        {error ? <Banner tone="danger" icon="alert-circle" text={error} /> : null}

        {showForm ? (
          <>
            <SectionTitle>{connected ? 'Đổi thông tin kết nối' : 'Kết nối cửa hàng WooCommerce'}</SectionTitle>
            <Banner
              tone="info"
              icon="shield-checkmark-outline"
              text="Consumer Key/Secret được gửi một lần qua HTTPS tới backend của bạn và lưu mã hóa ở đó. App không lưu khóa trên điện thoại."
            />
            <Card style={{ gap: space.md }}>
              <Field label="URL website" value={url} onChangeText={setUrl} placeholder="https://shop-cua-ban.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
              <Field label="Consumer Key" value={ck} onChangeText={setCk} placeholder="ck_…" autoCapitalize="none" autoCorrect={false} />
              <Field label="Consumer Secret" value={cs} onChangeText={setCs} placeholder="cs_…" autoCapitalize="none" autoCorrect={false} secureTextEntry />
              <Txt muted size="xs">
                Tạo khóa tại WooCommerce → Cài đặt → Nâng cao → REST API, quyền Đọc/Ghi. Xem README.
              </Txt>
              <Button
                title="Kiểm tra trước"
                variant="secondary"
                icon="pulse-outline"
                loading={busy === 'test'}
                disabled={!url || !ck || !cs || !!busy || !online}
                onPress={() => run('test', async () => setResult(await api.testConnection({ url, consumerKey: ck, consumerSecret: cs })))}
              />
              <Button
                title="Lưu & kết nối"
                icon="link-outline"
                loading={busy === 'connect'}
                disabled={!url || !ck || !cs || !!busy || !online}
                onPress={() =>
                  run('connect', async () => {
                    const x = await api.connectShop({ url, consumerKey: ck, consumerSecret: cs });
                    setResult(x.check);
                    setCk('');
                    setCs('');
                    setEditing(false);
                    res.refresh();
                    Alert.alert('Đã kết nối', 'Đang tải đơn mới nhất trước, lịch sử tiếp tục ở nền. Đơn cũ sẽ không gửi thông báo.');
                  })
                }
              />
            </Card>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
