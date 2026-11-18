export const STATUS_LABELS: Record<string, string> = {
  pending: 'Chờ thanh toán',
  processing: 'Đang xử lý',
  'on-hold': 'Tạm giữ',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
  refunded: 'Đã hoàn tiền',
  failed: 'Thất bại',
  'checkout-draft': 'Bản nháp thanh toán',
  trash: 'Thùng rác',
};

export function statusLabel(slug: string, custom?: Record<string, string>): string {
  return custom?.[slug] ?? STATUS_LABELS[slug] ?? slug;
}

/** "149,00 USD" — số theo kiểu Việt Nam, giữ mã tiền tệ của website */
export function formatMoney(amount: number | string, currency: string, decimals = 2): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  const s = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
    Number.isFinite(n) ? n : 0,
  );
  return `${s} ${currency}`;
}

export function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** WooCommerce trả "2026-11-18T03:04:05" (GMT, không có Z) */
export function gmt(v: string | null | undefined): Date | null {
  if (!v) return null;
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
}
