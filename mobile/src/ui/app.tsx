import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius } from '../lib/theme';
import { compactMoney, relativeTime } from '../lib/format';
import { useSession } from '../state/session';
import type { Bucket } from '../api/types';
import { Banner } from './kit';

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(
    () =>
      NetInfo.addEventListener((s) => {
        setOnline(s.isConnected !== false && s.isInternetReachable !== false);
      }),
    [],
  );
  return online;
}

/**
 * Dải trạng thái đầu màn hình: demo, mất mạng, đang dùng dữ liệu đã lưu (kèm thời điểm đồng bộ), lỗi.
 */
export function StatusStrip({ fromCache, updatedAt, error, syncing }: { fromCache?: boolean; updatedAt?: number | string | null; error?: { kind: string; message: string } | null; syncing?: boolean }) {
  const { mode } = useSession();
  const online = useOnline();
  const at = updatedAt ? new Date(updatedAt).toISOString() : null;
  return (
    <View style={{ gap: 8 }}>
      {mode === 'demo' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.demoSoft, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12, alignSelf: 'flex-start' }} accessibilityLabel="Dữ liệu demo">
          <Ionicons name="flask-outline" size={15} color={colors.demo} />
          <Text style={{ color: colors.demo, fontWeight: '700', fontSize: font.xs }}>Dữ liệu demo · không ảnh hưởng website</Text>
        </View>
      ) : null}
      {!online ? (
        <Banner tone="warn" icon="cloud-offline-outline" title="Mất mạng" text={`Đang hiển thị dữ liệu đã lưu · đồng bộ ${relativeTime(at)}. Các thao tác lưu tạm khóa.`} />
      ) : fromCache && error ? (
        <Banner
          tone={error.kind === 'woo' ? 'danger' : 'warn'}
          icon="time-outline"
          title={error.kind === 'woo' ? 'Không kết nối được website' : 'Không tải được dữ liệu mới'}
          text={`${error.message} Đang hiển thị dữ liệu đồng bộ ${relativeTime(at)}.`}
        />
      ) : null}
      {syncing ? <Banner tone="info" icon="sync-outline" text="Đang tải lịch sử đơn hàng ở nền. Đơn mới nhất đã có sẵn." /> : null}
    </View>
  );
}

export function LastSync({ at }: { at: number | string | null | undefined }) {
  if (!at) return null;
  return (
    <Text style={{ color: colors.textSubtle, fontSize: font.xs, textAlign: 'center', paddingVertical: 8 }}>
      Đồng bộ lần cuối: {relativeTime(new Date(at).toISOString())}
    </Text>
  );
}

/** Biểu đồ cột thuần View — nhẹ, chạy trên iOS/Android/web */
export function BarChart({ buckets, currency, onSelect, selected }: { buckets: Bucket[]; currency: string; onSelect?: (i: number | null) => void; selected?: number | null }) {
  const max = Math.max(1, ...buckets.map((b) => Math.abs(b.totalSales)));
  const height = 140;
  const showEvery = buckets.length > 14 ? Math.ceil(buckets.length / 6) : buckets.length > 8 ? 2 : 1;
  return (
    <View accessibilityLabel={`Biểu đồ doanh thu ${buckets.length} mốc`}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 2 }}>
        {buckets.map((b, i) => {
          const h = Math.max(2, (Math.abs(b.totalSales) / max) * (height - 8));
          const active = selected === i;
          return (
            <Pressable
              key={b.start}
              onPress={() => onSelect?.(active ? null : i)}
              accessibilityRole="button"
              accessibilityLabel={`${b.label}: ${compactMoney(b.totalSales, currency)}, ${b.orders} đơn`}
              style={{ flex: 1, height, justifyContent: 'flex-end' }}
            >
              <View
                style={{
                  height: b.totalSales === 0 ? 2 : h,
                  borderRadius: 4,
                  backgroundColor: b.totalSales < 0 ? colors.danger : active ? colors.primary : b.totalSales === 0 ? colors.border : '#5E9C7C',
                }}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        {buckets.map((b, i) => (
          <Text key={b.start} style={{ flex: 1, fontSize: 10, color: colors.textSubtle, textAlign: 'center' }} numberOfLines={1}>
            {i % showEvery === 0 ? b.label.replace(':00', 'h') : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function Pill({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'good' | 'bad' }) {
  const c = tone === 'good' ? ['#DDF3E4', '#0F5C2E'] : tone === 'bad' ? ['#FDE2E1', '#9F1C14'] : ['#F2F4F7', '#475467'];
  return (
    <View style={{ backgroundColor: c[0], borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: c[1], fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}
