import { q, q1 } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

/**
 * Thao tác ghi không lặp an toàn (thêm ghi chú, tạo sản phẩm). Client tạo khóa một lần cho mỗi ý định;
 * nếu lần trước mất kết nối giữa chừng, lần gửi lại chạy `verify` để kiểm tra trên website trước khi tạo lần nữa.
 */
export async function withIdempotency<T extends object>(
  key: string | undefined,
  userId: number,
  operation: string,
  request: unknown,
  run: () => Promise<T>,
  verify: (since: Date) => Promise<T | null>,
): Promise<T & { replayed?: boolean }> {
  if (!key) return (await run()) as T & { replayed?: boolean };
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new AppError(400, 'bad_idempotency_key', 'Idempotency-Key không hợp lệ');
  const inserted = await q1(
    `INSERT INTO idempotency_keys (key, user_id, operation, request) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING RETURNING key`,
    [key, userId, operation, JSON.stringify(request)],
  );
  if (!inserted) {
    const ex = await q1<any>('SELECT * FROM idempotency_keys WHERE key=$1', [key]);
    if (ex.operation !== operation || ex.user_id !== userId) throw new AppError(409, 'idempotency_conflict', 'Khóa đã dùng cho thao tác khác');
    if (ex.status === 'done') return { ...(ex.response as T), replayed: true };
    // Lần trước chưa rõ kết quả → kiểm tra trên WooCommerce trước khi gửi lại
    const found = await verify(new Date(ex.created_at.getTime() - 60_000));
    if (found) {
      await q(`UPDATE idempotency_keys SET status='done', response=$2, updated_at=now() WHERE key=$1`, [key, JSON.stringify(found)]);
      return { ...found, replayed: true };
    }
  }
  const out = await run();
  await q(`UPDATE idempotency_keys SET status='done', response=$2, updated_at=now() WHERE key=$1`, [key, JSON.stringify(out)]);
  return out as T & { replayed?: boolean };
}
