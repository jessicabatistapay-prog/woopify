import { DateTime } from 'luxon';

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Chờ thanh toán',
  processing: 'Đang xử lý',
  'on-hold': 'Tạm giữ',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
  refunded: 'Đã hoàn tiền',
  failed: 'Thất bại',
  'checkout-draft': 'Bản nháp thanh toán',
};

/** Màu + chữ cho trạng thái — không dùng màu làm tín hiệu duy nhất */
export const STATUS_TONE: Record<string, { bg: string; fg: string; icon: string }> = {
  pending: { bg: '#FFF4D6', fg: '#7A5200', icon: 'time-outline' },
  processing: { bg: '#DDF3E4', fg: '#0F5C2E', icon: 'cube-outline' },
  'on-hold': { bg: '#FDE7D3', fg: '#8A3D00', icon: 'pause-circle-outline' },
  completed: { bg: '#E4E7EC', fg: '#344054', icon: 'checkmark-circle-outline' },
  cancelled: { bg: '#F2F4F7', fg: '#667085', icon: 'close-circle-outline' },
  refunded: { bg: '#EFE6FB', fg: '#5B2A9E', icon: 'return-down-back-outline' },
  failed: { bg: '#FDE2E1', fg: '#9F1C14', icon: 'alert-circle-outline' },
};

export const statusLabel = (s: string, custom?: Record<string, string>) => custom?.[s] ?? STATUS_LABELS[s] ?? s;

/** "149,00 USD" — số kiểu Việt Nam, mã tiền tệ giữ nguyên của website */
export function money(amount: number | string | null | undefined, currency: string, decimals = 2): string {
  const n = Number(amount ?? 0);
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '−' : ''}${grouped}${dec ? ',' + dec : ''} ${currency}`;
}

export function compactMoney(n: number, currency: string) {
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(1).replace('.', ',')}k ${currency}`;
  return money(n, currency, n % 1 === 0 ? 0 : 2);
}

/** Thời gian hiển thị theo múi giờ website (tz) */
export function shopTime(isoStr: string | null | undefined, tz: string, fmt = 'dd/MM/yyyy HH:mm') {
  if (!isoStr) return '—';
  const d = DateTime.fromISO(isoStr.endsWith('Z') || /[+-]\d\d:\d\d$/.test(isoStr) ? isoStr : isoStr + 'Z', { zone: tz });
  return d.isValid ? d.toFormat(fmt) : '—';
}

export function relativeTime(isoStr: string | null | undefined, now = Date.now()) {
  if (!isoStr) return 'chưa có';
  const t = new Date(isoStr).getTime();
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'vừa xong';
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  return `${Math.round(s / 86400)} ngày trước`;
}

export function tzLabel(tz: string, offset?: string) {
  const off = offset ?? DateTime.now().setZone(tz).toFormat('ZZ');
  return `${tz.replace('_', ' ')} (GMT${off})`;
}

export function pctChange(cur: number, prev: number | undefined | null) {
  if (prev === undefined || prev === null || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}

export function randomKey(prefix = 'k') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
