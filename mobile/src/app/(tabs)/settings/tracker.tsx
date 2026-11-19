import React from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import type { TrackerInfo } from '../../../api/types';
import { colors, space } from '../../../lib/theme';
import { relativeTime } from '../../../lib/format';
import { useApi } from '../../../state/session';
import { useResource } from '../../../state/useResource';
import { StatusStrip } from '../../../ui/app';
import { Banner, Card, ErrorState, Loading, Txt } from '../../../ui/kit';

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <Pressable onPress={() => Clipboard.setStringAsync(value).then(() => Alert.alert('', `Đã sao chép ${label}`))} accessibilityRole="button" accessibilityLabel={`Sao chép ${label}`} style={{ gap: 2, paddingVertical: 8 }}>
      <Txt muted size="xs">
        {label}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Txt bold style={{ flex: 1 }} selectable>
          {value}
        </Txt>
        <Ionicons name="copy-outline" size={18} color={colors.primary} />
      </View>
    </Pressable>
  );
}

export default function TrackerSetup() {
  const api = useApi();
  const res = useResource<TrackerInfo>('tracker', () => api.trackerInfo(), [api]);
  if (res.loading) return <Loading />;
  if (!res.data) return <ErrorState error={res.error!} onRetry={res.refresh} />;
  const t = res.data;
  // "đang hoạt động" nếu lượt gần nhất trong vòng 24 giờ, so với thời điểm tải dữ liệu
  const working = !!t.lastEventAt && (res.updatedAt ?? 0) - new Date(t.lastEventAt).getTime() < 24 * 3600_000;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}>
      <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} />
      <Banner
        tone={working ? 'info' : 'warn'}
        icon={working ? 'pulse' : 'information-circle'}
        title={working ? 'Đang nhận dữ liệu' : 'Chưa nhận lượt truy cập nào'}
        text={working ? `Lượt gần nhất ${relativeTime(t.lastEventAt)} · ${t.sessions} phiên đã ghi nhận.` : 'WooCommerce không ghi lại lượt truy cập. Cài plugin nhỏ “Woo Admin Tracker” để có Live, phễu mua hàng và tỉ lệ chuyển đổi.'}
      />
      <Card style={{ gap: 0 }}>
        <CopyRow label="Endpoint" value={t.endpoint} />
        <CopyRow label="Token" value={t.token} />
      </Card>
      <Card style={{ gap: 6 }}>
        <Txt bold>Cách cài (khoảng 2 phút)</Txt>
        <Txt>1. Tải file woo-admin-tracker.zip (thư mục wordpress-plugin trong mã nguồn).</Txt>
        <Txt>2. WordPress → Plugin → Cài mới → Tải plugin lên → Kích hoạt.</Txt>
        <Txt>3. Cài đặt → Woo Admin Tracker: dán Endpoint và Token ở trên → Lưu.</Txt>
        <Txt>4. Mở website ở chế độ ẩn danh, xem vài trang. Kéo màn hình này để làm mới.</Txt>
        <Txt muted size="xs">
          Plugin chỉ gửi mã phiên ngẫu nhiên, đường dẫn trang, nguồn truy cập và bước mua hàng. Không gửi IP, tên, email hay nội dung giỏ. Tôn trọng Do Not Track. Không đếm lượt xem của quản trị viên.
        </Txt>
      </Card>
    </ScrollView>
  );
}
