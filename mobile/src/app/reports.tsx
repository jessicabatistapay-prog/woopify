import React, { useEffect, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { LiveReport, RangeKey, RevenueRow, SalesReport } from '../api/types';
import { colors, radius, space } from '../lib/theme';
import { money, pctChange, shopTime, statusLabel } from '../lib/format';
import { useApi } from '../state/session';
import { useResource } from '../state/useResource';
import { StatusStrip } from '../ui/app';
import { Banner, Card, Chip, Divider, EmptyState, ErrorState, Loading, SectionTitle, StatusBadge, Txt } from '../ui/kit';

type Tab = 'live' | 'sales' | 'traffic';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Hôm nay' },
  { key: 'yesterday', label: 'Hôm qua' },
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
];

export default function Reports() {
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'live');
  const [range, setRange] = useState<RangeKey>('30d');
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', padding: space.md, gap: 6, backgroundColor: colors.card, borderBottomWidth: 0.5, borderColor: colors.border }}>
        {(
          [
            ['live', 'Live'],
            ['sales', 'Bán hàng'],
            ['traffic', 'Truy cập'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <Pressable
            key={k}
            onPress={() => setTab(k)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }}
            style={{ flex: 1, paddingVertical: 9, borderRadius: radius.md, backgroundColor: tab === k ? colors.primary : colors.bg, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
          >
            {k === 'live' ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tab === k ? '#7CFFB2' : '#12B76A' }} /> : null}
            <Txt bold style={{ color: tab === k ? '#fff' : colors.text }}>
              {l}
            </Txt>
          </Pressable>
        ))}
      </View>
      {tab === 'live' ? <Live /> : <Sales range={range} setRange={setRange} traffic={tab === 'traffic'} />}
    </View>
  );
}

function Live() {
  const api = useApi();
  const router = useRouter();
  const res = useResource<LiveReport>('reports:live', () => api.liveReport(), [api]);
  const { refresh } = res;
  // Tự làm mới 15 giây/lần khi app đang mở
  useEffect(() => {
    let t = setInterval(refresh, 15000);
    const s = AppState.addEventListener('change', (st) => {
      clearInterval(t);
      if (st === 'active') {
        refresh();
        t = setInterval(refresh, 15000);
      }
    });
    return () => {
      clearInterval(t);
      s.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (res.loading) return <Loading />;
  const d = res.data;
  if (!d) return <ErrorState error={res.error!} onRetry={res.refresh} />;
  const ch = pctChange(d.today.sales, d.yesterdaySameTime.sales);
  const v = d.visitors;
  const max = Math.max(1, ...d.cumulativeToday, ...d.cumulativeYesterday);
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}>
      <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#12B76A' }} />
        <Txt muted size="xs">
          Cập nhật {shopTime(d.now, d.timezone, 'HH:mm:ss')} (giờ website) · tự làm mới mỗi 15 giây
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        <Stat label="Đang xem website" value={v.enabled ? String(v.activeNow) : '—'} sub={v.enabled ? '5 phút gần nhất' : 'Cần plugin tracker'} onPress={v.enabled ? undefined : () => router.push('/settings/tracker')} />
        <Stat label="Doanh thu hôm nay" value={money(d.today.sales, d.currency)} sub={ch === null ? `${d.today.orders} đơn` : `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}% so với cùng giờ hôm qua`} tone={ch === null ? undefined : ch >= 0 ? 'good' : 'bad'} />
        <Stat label="Đang thanh toán" value={v.enabled ? String(v.inCheckout) : d.checkoutsActive === null ? '—' : String(d.checkoutsActive)} sub={v.enabled ? `${v.withCart} giỏ hàng đang mở` : 'Checkout Blocks, 30 phút'} />
        <Stat label="Đơn 30 phút qua" value={String(d.ordersLast30Min)} sub={v.enabled ? `Chuyển đổi hôm nay ${v.conversionToday}%` : `${d.today.orders} đơn hôm nay`} />
      </View>

      <Card>
        <Txt bold size="md">
          Doanh thu cộng dồn
        </Txt>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Legend color={colors.primary} text="Hôm nay" />
          <Legend color="#C9CED6" text="Hôm qua" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 2 }} accessibilityLabel="Biểu đồ doanh thu cộng dồn theo giờ">
          {d.cumulativeYesterday.map((y, h) => (
            <View key={h} style={{ flex: 1, height: 120, justifyContent: 'flex-end', flexDirection: 'row', alignItems: 'flex-end', gap: 1 }}>
              <View style={{ flex: 1, height: Math.max(1, (y / max) * 116), backgroundColor: '#C9CED6', borderRadius: 2 }} />
              <View style={{ flex: 1, height: d.cumulativeToday[h] === undefined ? 0 : Math.max(1, (d.cumulativeToday[h] / max) * 116), backgroundColor: colors.primary, borderRadius: 2 }} />
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {['0h', '6h', '12h', '18h', '24h'].map((l) => (
            <Txt key={l} muted size="xs">
              {l}
            </Txt>
          ))}
        </View>
      </Card>

      {v.enabled && v.topPages.length ? (
        <>
          <SectionTitle>Trang đang được xem</SectionTitle>
          <BarList rows={v.topPages.map((p) => ({ name: p.name, value: p.n, display: `${p.n} người` }))} />
        </>
      ) : null}
      {!v.enabled ? (
        <Banner tone="info" icon="analytics-outline" title="Muốn xem số người đang online?" text="WooCommerce không ghi lượt truy cập. Cài plugin Woo Admin Tracker để có Live và tỉ lệ chuyển đổi." action={{ label: 'Cài đặt', onPress: () => router.push('/settings/tracker') }} />
      ) : null}

      <SectionTitle>Đơn hôm nay</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {d.recentOrders.length === 0 ? <EmptyState icon="receipt-outline" title="Chưa có đơn hôm nay" /> : null}
        {d.recentOrders.map((o, i) => (
          <View key={o.id}>
            {i > 0 ? <Divider /> : null}
            <Pressable onPress={() => router.push(`/orders/${o.id}`)} accessibilityRole="button" style={{ paddingVertical: 10, gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt bold>#{o.number}</Txt>
                <Txt bold>{money(o.total, o.currency)}</Txt>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Txt muted size="xs">
                  {shopTime(o.date_created_gmt, d.timezone, 'HH:mm')} · {[o.state, o.country].filter(Boolean).join(', ')}
                </Txt>
                <StatusBadge status={o.status} />
              </View>
            </Pressable>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function Sales({ range, setRange, traffic }: { range: RangeKey; setRange: (r: RangeKey) => void; traffic: boolean }) {
  const api = useApi();
  const router = useRouter();
  const res = useResource<SalesReport>(`reports:sales:${range}`, () => api.salesReport(range), [api, range]);
  const [productView, setProductView] = useState<'product' | 'variation' | 'category'>('product');
  const [geo, setGeo] = useState<'country' | 'state'>('country');
  const d = res.data;
  const cur = d?.currency ?? 'USD';
  const rows = (list: RevenueRow[], showQty = false) =>
    list.map((r) => ({ name: r.label ? `${r.sku || r.name} · ${r.label}` : r.name, value: r.revenue, display: `${money(r.revenue, cur)}${showQty && r.qty ? ` · ${r.qty} SP` : r.orders ? ` · ${r.orders} đơn` : ''}` }));
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} />}>
      <StatusStrip fromCache={res.fromCache} updatedAt={res.updatedAt} error={res.error} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {RANGES.map((r) => (
          <Chip key={r.key} label={r.label} selected={range === r.key} onPress={() => setRange(r.key)} />
        ))}
      </ScrollView>
      {res.loading ? <Loading /> : !d ? <ErrorState error={res.error!} onRetry={res.refresh} /> : traffic ? (
        d.tracking.enabled ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              <Stat label="Tỉ lệ chuyển đổi" value={`${d.tracking.conversionRate}%`} sub="Phiên có đặt hàng ÷ tổng phiên" />
              <Stat label="Phiên truy cập" value={d.tracking.sessions.toLocaleString('vi-VN')} sub={`${d.tracking.pageviews.toLocaleString('vi-VN')} lượt xem trang`} />
              <Stat label="Từ điện thoại" value={`${d.tracking.mobileShare}%`} sub="của số phiên" />
              <Stat label="Đơn / phiên" value={`${d.tracking.ordersPerSession}%`} sub="mọi đơn được tính" />
            </View>
            {d.tracking.trackingSince ? (
              <Txt muted size="xs">
                Tracker ghi nhận từ {shopTime(d.tracking.trackingSince, d.timezone, 'dd/MM/yyyy HH:mm')}. Đơn trước mốc này không tính vào tỉ lệ.
              </Txt>
            ) : null}
            <SectionTitle>Phễu mua hàng</SectionTitle>
            <Card style={{ gap: 10 }}>
              {d.tracking.funnel.map((f, i) => (
                <View key={f.key} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Txt bold={i === 0 || f.key === 'purchased' || f.label === 'Đặt hàng'}>{f.label}</Txt>
                    <Txt bold>
                      {f.count.toLocaleString('vi-VN')} <Txt muted size="xs">({f.rate}%)</Txt>
                    </Txt>
                  </View>
                  <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.bg, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.max(1, f.rate)}%`, height: 10, backgroundColor: colors.primary, borderRadius: 5 }} />
                  </View>
                </View>
              ))}
            </Card>
            <SectionTitle>Nguồn truy cập</SectionTitle>
            <BarList rows={d.tracking.sources.map((s) => ({ name: s.name, value: s.sessions, display: `${s.sessions} phiên · ${s.sessions ? Math.round((s.purchased / s.sessions) * 1000) / 10 : 0}% mua` }))} />
            <SectionTitle>Trang vào đầu tiên</SectionTitle>
            <BarList rows={d.tracking.landing.map((s) => ({ name: s.name || '/', value: s.sessions, display: `${s.sessions} phiên` }))} />
          </>
        ) : (
          <EmptyState icon="analytics-outline" title="Chưa có dữ liệu lượt truy cập" text="WooCommerce không ghi lại lượt truy cập, nên cần plugin nhỏ Woo Admin Tracker để tính tỉ lệ chuyển đổi và phễu mua hàng." action={{ label: 'Hướng dẫn cài', onPress: () => router.push('/settings/tracker') }} />
        )
      ) : (
        <>
          <Txt muted size="xs">
            {d.range.label} · {cur} · cùng cách tính với Tổng quan (không gồm đơn chờ thanh toán, hủy, thất bại)
          </Txt>
          <SectionTitle>Sản phẩm bán chạy</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="Sản phẩm" selected={productView === 'product'} onPress={() => setProductView('product')} />
            <Chip label="Biến thể" selected={productView === 'variation'} onPress={() => setProductView('variation')} />
            <Chip label="Danh mục" selected={productView === 'category'} onPress={() => setProductView('category')} />
          </View>
          <BarList
            rows={rows(productView === 'product' ? d.byProduct : productView === 'variation' ? d.byVariation : d.byCategory, true)}
            onPress={productView === 'category' ? undefined : (i) => router.push(`/products/${productView === 'product' ? d.byProduct[i].id : d.byVariation[i].product_id}`)}
          />
          <SectionTitle>Khách hàng</SectionTitle>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Stat label="Khách mới" value={String(d.customers.new)} sub={money(d.customers.newRevenue, cur)} />
            <Stat label="Khách quay lại" value={String(d.customers.returning)} sub={money(d.customers.returningRevenue, cur)} />
          </View>
          <SectionTitle>Khu vực</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="Quốc gia" selected={geo === 'country'} onPress={() => setGeo('country')} />
            <Chip label="Bang / tỉnh" selected={geo === 'state'} onPress={() => setGeo('state')} />
          </View>
          <BarList rows={rows(geo === 'country' ? d.byCountry : d.byState)} />
          {d.attribution.available ? (
            <>
              <SectionTitle>Nguồn đơn hàng</SectionTitle>
              <Txt muted size="xs">
                Từ tính năng Order Attribution của WooCommerce (8.5+).
              </Txt>
              <BarList rows={d.attribution.rows.map((r) => ({ name: r.name, value: r.revenue, display: `${money(r.revenue, cur)} · ${r.orders} đơn` }))} />
            </>
          ) : null}
          <SectionTitle>Phương thức thanh toán</SectionTitle>
          <BarList rows={rows(d.byPayment)} />
          {d.coupons.length ? (
            <>
              <SectionTitle>Mã giảm giá đã dùng</SectionTitle>
              <BarList rows={d.coupons.map((c) => ({ name: c.code.toUpperCase(), value: c.orders, display: `${c.orders} đơn · −${money(c.discount, cur)}` }))} />
            </>
          ) : null}
          <SectionTitle>Theo trạng thái đơn</SectionTitle>
          <Card style={{ gap: 8 }}>
            {d.byStatus.map((s) => (
              <View key={s.status} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <StatusBadge status={s.status} label={statusLabel(s.status)} />
                <Txt>
                  {s.orders} đơn · {money(s.revenue, cur)}
                </Txt>
              </View>
            ))}
            {d.byStatus.length === 0 ? <Txt muted>Không có đơn trong kỳ.</Txt> : null}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value, sub, tone, onPress }: { label: string; value: string; sub: string; tone?: 'good' | 'bad'; onPress?: () => void }) {
  return (
    <Card onPress={onPress} accessibilityLabel={`${label}: ${value}. ${sub}`} style={{ flexBasis: '47%', flexGrow: 1, gap: 4 }}>
      <Txt muted size="xs" bold>
        {label}
      </Txt>
      <Txt bold size="lg" numberOfLines={1}>
        {value}
      </Txt>
      <Txt size="xs" style={{ color: tone === 'good' ? '#0F5C2E' : tone === 'bad' ? colors.danger : colors.textSubtle }}>
        {sub}
      </Txt>
    </Card>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
      <Txt muted size="xs">
        {text}
      </Txt>
    </View>
  );
}

function BarList({ rows, onPress }: { rows: { name: string; value: number; display: string }[]; onPress?: (i: number) => void }) {
  if (!rows.length) {
    return (
      <Card>
        <Txt muted>Chưa có dữ liệu trong kỳ.</Txt>
      </Card>
    );
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card style={{ gap: 10 }}>
      {rows.slice(0, 10).map((r, i) => {
        const inner = (
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Txt numberOfLines={1} style={{ flex: 1 }}>
                {r.name}
              </Txt>
              <Txt size="xs" bold>
                {r.display}
              </Txt>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.bg }}>
              <View style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: '#5E9C7C' }} />
            </View>
          </View>
        );
        return onPress ? (
          <Pressable key={`${r.name}-${i}`} onPress={() => onPress(i)} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            {inner}
          </Pressable>
        ) : (
          <View key={`${r.name}-${i}`}>{inner}</View>
        );
      })}
    </Card>
  );
}
