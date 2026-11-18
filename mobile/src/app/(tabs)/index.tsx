import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DateTime } from 'luxon';
import type { CurrencyMetrics, Dashboard, RangeKey } from '../../api/types';
import { colors, space } from '../../lib/theme';
import { money, pctChange, shopTime, tzLabel } from '../../lib/format';
import { useApi } from '../../state/session';
import { orderFilters } from '../../state/store';
import { useResource } from '../../state/useResource';
import { BarChart, LastSync, Pill, StatusStrip } from '../../ui/app';
import { Sheet } from '../../ui/sheet';
import { Banner, Button, Card, Chip, Divider, EmptyState, ErrorState, Field, Loading, Row, SectionTitle, StatusBadge, Thumb, Txt } from '../../ui/kit';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Hôm nay' },
  { key: 'yesterday', label: 'Hôm qua' },
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
  { key: 'custom', label: 'Tùy chọn' },
];

export default function Overview() {
  const api = useApi();
  const router = useRouter();
  const [range, setRange] = useState<RangeKey>('today');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [currency, setCurrency] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'breakdown' | 'definitions' | null>(null);
  const [selectedBar, setSelectedBar] = useState<number | null>(null);

  const res = useResource<Dashboard>(
    `dashboard:${range}:${custom?.from ?? ''}:${custom?.to ?? ''}`,
    () => api.getDashboard(range, custom?.from, custom?.to),
    [api, range, custom?.from, custom?.to],
  );
  const d = res.data;
  const m: CurrencyMetrics | undefined = d?.currencies.find((c) => c.currency === currency) ?? d?.currencies[0];

  const openOrders = (patch: { status: string; label: string; withRange?: boolean }) => {
    orderFilters.set({
      status: patch.status,
      q: '',
      dateKey: 'all',
      from: patch.withRange && d ? d.range.start : undefined,
      to: patch.withRange && d ? d.range.end : undefined,
      label: patch.label,
    });
    router.navigate('/orders');
  };

  const pickRange = (k: RangeKey) => {
    setSelectedBar(null);
    if (k === 'custom') return setCustomOpen(true);
    setRange(k);
  };

  if (res.loading) return <Loading label="Đang tải số liệu…" />;
  if (!d || !m) return <ErrorState error={res.error ?? { kind: 'server', message: 'Không có dữ liệu' }} onRetry={res.refresh} />;

  const change = pctChange(m.totalSales, m.previous?.totalSales);
  const bar = selectedBar !== null ? m.buckets[selectedBar] : null;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}
    >
      <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {RANGES.map((r) => (
          <Chip key={r.key} label={r.key === 'custom' && custom && range === 'custom' ? `${custom.from.slice(5)} → ${custom.to.slice(5)}` : r.label} selected={range === r.key} onPress={() => pickRange(r.key)} />
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="globe-outline" size={16} color={colors.textMuted} />
        <Txt muted size="xs" style={{ flex: 1 }}>
          {d.range.label} · Giờ website: {tzLabel(d.timezone, d.timezoneOffset)}. Ngày được tính theo giờ này, không theo giờ điện thoại.
        </Txt>
      </View>

      {!d.coverage.complete ? (
        <Banner
          tone="info"
          icon="sync-outline"
          title="Đang đồng bộ lịch sử lần đầu"
          text={`Đã tải ${d.coverage.synced}${d.coverage.total ? `/${d.coverage.total}` : ''} đơn. Số liệu đầy đủ từ ${shopTime(d.coverage.completeFrom, d.timezone, 'dd/MM/yyyy HH:mm')} đến nay; trước mốc này có thể còn thiếu.`}
        />
      ) : null}

      {d.currencies.length > 1 ? (
        <View style={{ gap: 6 }}>
          <Txt muted size="xs">
            Shop có đơn bằng nhiều loại tiền — số liệu tách riêng, không quy đổi:
          </Txt>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {d.currencies.map((c) => (
              <Chip key={c.currency} label={c.currency} selected={c.currency === m.currency} onPress={() => setCurrency(c.currency)} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        <Kpi
          label="Doanh thu"
          value={money(m.totalSales, m.currency)}
          sub={change === null ? 'Chạm để xem cách tính' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% so với kỳ trước`}
          tone={change === null ? undefined : change >= 0 ? 'good' : 'bad'}
          onPress={() => setSheet('breakdown')}
          hint="Mở chi tiết doanh thu, hoàn tiền, phí vận chuyển và thuế"
        />
        <Kpi label="Đơn mới" value={String(m.newOrders)} sub={`${m.paidOrders} đã thanh toán`} onPress={() => openOrders({ status: 'any', label: `Đơn tạo ${d.range.label}`, withRange: true })} hint="Mở danh sách đơn trong kỳ" />
        <Kpi
          label="Cần xử lý"
          value={String(d.needsProcessing)}
          sub="Đang xử lý · hiện tại"
          highlight={d.needsProcessing > 0}
          onPress={() => openOrders({ status: 'processing', label: 'Đơn cần xử lý (Đang xử lý)' })}
          hint="Mở danh sách đơn đang chờ xử lý"
        />
        <Kpi label="Giá trị đơn TB" value={money(m.avgOrderValue, m.currency)} sub={`${m.ordersCount} đơn được tính`} onPress={() => setSheet('definitions')} hint="Xem định nghĩa" />
      </View>

      {d.pendingPayment || d.onHold ? (
        <Card style={{ paddingVertical: 4 }}>
          {d.pendingPayment ? <Row icon="time-outline" label="Chờ thanh toán (hiện tại)" value={String(d.pendingPayment)} onPress={() => openOrders({ status: 'pending', label: 'Đơn chờ thanh toán' })} /> : null}
          {d.pendingPayment && d.onHold ? <Divider /> : null}
          {d.onHold ? <Row icon="pause-circle-outline" label="Tạm giữ (hiện tại)" value={String(d.onHold)} onPress={() => openOrders({ status: 'on-hold', label: 'Đơn tạm giữ' })} /> : null}
        </Card>
      ) : null}

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt bold size="md">
            Doanh thu theo {d.range.granularity === 'hour' ? 'giờ' : 'ngày'}
          </Txt>
          <Pressable onPress={() => setSheet('definitions')} accessibilityRole="button" accessibilityLabel="Cách tính số liệu" hitSlop={10}>
            <Ionicons name="information-circle-outline" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
        <Txt muted size="xs">
          {bar ? `${bar.label}: ${money(bar.totalSales, m.currency)} · ${bar.orders} đơn` : 'Chạm vào cột để xem số liệu'}
        </Txt>
        <BarChart buckets={m.buckets} currency={m.currency} selected={selectedBar} onSelect={setSelectedBar} />
      </Card>

      <SectionTitle right={<Button title="Tất cả" variant="ghost" onPress={() => openOrders({ status: 'any', label: '' })} style={{ minHeight: 36 }} />}>Đơn gần nhất</SectionTitle>
      <Card style={{ paddingVertical: 4, gap: 0 }}>
        {d.recentOrders.length === 0 ? <EmptyState icon="receipt-outline" title="Chưa có đơn" /> : null}
        {d.recentOrders.map((o, i) => (
          <View key={o.id}>
            {i > 0 ? <Divider /> : null}
            <Pressable onPress={() => router.push(`/orders/${o.id}`)} accessibilityRole="button" accessibilityLabel={`Đơn ${o.number}`} style={{ paddingVertical: 10, gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt bold>#{o.number}</Txt>
                <Txt bold>{money(o.total, o.currency)}</Txt>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt muted size="xs">
                  {o.customer_name} · {shopTime(o.date_created_gmt, d.timezone, 'dd/MM HH:mm')}
                </Txt>
                <StatusBadge status={o.status} />
              </View>
            </Pressable>
          </View>
        ))}
      </Card>

      <SectionTitle>Bán chạy trong kỳ</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {m.topProducts.length === 0 ? <EmptyState icon="pricetags-outline" title="Chưa có sản phẩm bán ra trong kỳ" /> : null}
        {m.topProducts.map((p, i) => (
          <View key={p.productId}>
            {i > 0 ? <Divider /> : null}
            <Pressable onPress={() => router.push(`/products/${p.productId}`)} accessibilityRole="button" style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10 }}>
              <Thumb uri={p.imageUrl} label={p.name} size={44} />
              <View style={{ flex: 1 }}>
                <Txt bold numberOfLines={1}>
                  {p.name}
                </Txt>
                <Txt muted size="xs">
                  {p.quantity} đã bán
                </Txt>
              </View>
              <Txt bold>{money(p.netRevenue, m.currency)}</Txt>
            </Pressable>
          </View>
        ))}
      </Card>
      <Button title="Cách tính số liệu" icon="help-circle-outline" variant="ghost" onPress={() => setSheet('definitions')} />
      <LastSync at={d.lastSyncAt ?? res.updatedAt} />

      <Sheet visible={sheet !== null} onClose={() => setSheet(null)} title={sheet === 'breakdown' ? `Doanh thu · ${d.range.label}` : 'Cách tính số liệu'}>
        {sheet === 'breakdown' ? (
          <View>
            <Row label="Tiền hàng (trước giảm giá)" value={money(m.grossSales, m.currency)} />
            <Row label="Mã giảm giá" value={`− ${money(m.coupons, m.currency)}`} />
            <Row label="Hoàn tiền (theo ngày hoàn)" value={`− ${money(m.refunds, m.currency)}`} />
            <Divider />
            <Row label="Doanh thu thuần" value={money(m.netSales, m.currency)} strong />
            <Row label="Phí vận chuyển" value={`+ ${money(m.shipping, m.currency)}`} />
            <Row label="Thuế" value={`+ ${money(m.taxes, m.currency)}`} />
            <Divider />
            <Row label="Tổng doanh thu" value={money(m.totalSales, m.currency)} strong />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <Pill text={`${m.ordersCount} đơn được tính`} />
              <Pill text={`${m.newOrders} đơn mới`} />
              <Pill text={`${m.paidOrders} đã thanh toán`} tone="good" />
            </View>
            <Txt muted size="xs" style={{ marginTop: 12 }}>
              Không tính đơn Chờ thanh toán, Thất bại, Đã hủy, bản nháp. Ngày ghi nhận là ngày tạo đơn theo giờ website; hoàn tiền (kể cả một phần) trừ vào ngày hoàn.
            </Txt>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {d.definitions.map((x) => (
              <View key={x.term} style={{ gap: 2 }}>
                <Txt bold>{x.term}</Txt>
                <Txt muted>{x.text}</Txt>
              </View>
            ))}
          </View>
        )}
      </Sheet>

      <CustomRangeSheet
        visible={customOpen}
        tz={d.timezone}
        onClose={() => setCustomOpen(false)}
        onApply={(r) => {
          setCustom(r);
          setRange('custom');
          setCustomOpen(false);
        }}
      />
    </ScrollView>
  );
}

function Kpi({ label, value, sub, onPress, hint, tone, highlight }: { label: string; value: string; sub: string; onPress: () => void; hint: string; tone?: 'good' | 'bad'; highlight?: boolean }) {
  return (
    <Card onPress={onPress} accessibilityLabel={`${label}: ${value}. ${sub}`} style={{ flexBasis: '47%', flexGrow: 1, gap: 4, borderColor: highlight ? colors.primary : colors.border, borderWidth: highlight ? 1.5 : undefined }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt muted size="xs" bold>
          {label}
        </Txt>
        <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} accessibilityHint={hint} />
      </View>
      <Txt bold size="lg" numberOfLines={1}>
        {value}
      </Txt>
      <Txt size="xs" style={{ color: tone === 'good' ? '#0F5C2E' : tone === 'bad' ? colors.danger : colors.textSubtle }}>
        {sub}
      </Txt>
    </Card>
  );
}

function CustomRangeSheet({ visible, tz, onClose, onApply }: { visible: boolean; tz: string; onClose: () => void; onApply: (r: { from: string; to: string }) => void }) {
  const today = DateTime.now().setZone(tz);
  const [from, setFrom] = useState(today.minus({ days: 13 }).toISODate()!);
  const [to, setTo] = useState(today.toISODate()!);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const quick = (label: string, f: DateTime, t: DateTime) => <Chip label={label} onPress={() => (setFrom(f.toISODate()!), setTo(t.toISODate()!))} />;
  return (
    <Sheet visible={visible} onClose={onClose} title="Khoảng ngày tùy chọn">
      <View style={{ gap: space.md }}>
        <Txt muted size="xs">
          Ngày tính theo giờ website ({tz}).
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {quick('Tháng này', today.startOf('month'), today)}
          {quick('Tháng trước', today.minus({ months: 1 }).startOf('month'), today.minus({ months: 1 }).endOf('month'))}
          {quick('90 ngày', today.minus({ days: 89 }), today)}
        </View>
        <Field label="Từ ngày (YYYY-MM-DD)" value={from} onChangeText={setFrom} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
        <Field label="Đến ngày (YYYY-MM-DD)" value={to} onChangeText={setTo} autoCapitalize="none" keyboardType="numbers-and-punctuation" error={valid ? undefined : 'Ngày không hợp lệ'} />
        <Button title="Áp dụng" onPress={() => onApply({ from, to })} disabled={!valid} />
      </View>
    </Sheet>
  );
}
