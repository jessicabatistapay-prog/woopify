import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL là bắt buộc'),
  /** URL công khai HTTPS của backend, dùng làm delivery URL cho webhook và ảnh tải lên */
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  /** Chuỗi bí mật ≥ 32 ký tự để mã hóa Consumer Key/Secret trong DB */
  APP_SECRET: z.string().min(32, 'APP_SECRET phải dài ít nhất 32 ký tự'),
  SESSION_TTL_DAYS: z.coerce.number().default(60),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  EXPO_PUSH_URL: z.string().default('https://exp.host/--/api/v2/push/send'),
  EXPO_RECEIPTS_URL: z.string().default('https://exp.host/--/api/v2/push/getReceipts'),
  PUSH_COALESCE_SECONDS: z.coerce.number().default(8),
  NOTIFY_MAX_AGE_HOURS: z.coerce.number().default(12),
  RECONCILE_INTERVAL_MINUTES: z.coerce.number().default(10),
  RUN_WORKER: bool(true),
  WORKER_POLL_MS: z.coerce.number().default(1000),
  UPLOAD_DIR: z.string().default('./uploads'),
  /** Chỉ cho môi trường thử nghiệm cục bộ: cho phép shop dùng http:// */
  WC_ALLOW_HTTP: bool(false),
  WC_TIMEOUT_MS: z.coerce.number().default(20000),
  /** Tùy chọn: cấu hình shop từ biến môi trường khi khởi động */
  WC_STORE_URL: z.string().optional(),
  WC_CONSUMER_KEY: z.string().optional(),
  WC_CONSUMER_SECRET: z.string().optional(),
  WC_WEBHOOK_SECRET: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;
export function config(): Config {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Cấu hình không hợp lệ:\n${msg}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function resetConfigForTests() {
  cached = null;
}
