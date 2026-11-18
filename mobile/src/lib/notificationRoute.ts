/**
 * Chuyển dữ liệu push → đường dẫn trong app. Dùng chung cho app đang mở, chạy nền và mở lạnh (app đóng).
 * Không tin URL tùy ý: chỉ chấp nhận các đường dẫn đã biết.
 */
export function routeForNotificationData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const orderId = Number(d.orderId);
  if (d.type === 'order' && Number.isInteger(orderId) && orderId > 0) return `/orders/${orderId}`;
  if (typeof d.url === 'string') {
    const m = d.url.match(/^wooadmin:\/\/orders\/(\d+)$/);
    if (m) return `/orders/${m[1]}`;
    if (d.url === 'wooadmin://notifications') return '/notifications';
  }
  if (d.type === 'test') return '/notifications';
  return null;
}
