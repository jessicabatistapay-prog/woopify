import type pg from 'pg';
import { db, q } from '../lib/db.js';

export interface Job {
  id: number;
  type: string;
  payload: any;
  attempts: number;
  max_attempts: number;
}

export async function enqueue(
  type: string,
  payload: unknown = {},
  opts: { delaySeconds?: number; dedupeKey?: string; maxAttempts?: number; client?: pg.PoolClient } = {},
): Promise<number | null> {
  const runner = opts.client ?? db();
  const r = await runner.query(
    `INSERT INTO jobs (type, payload, run_at, dedupe_key, max_attempts)
     VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running') DO NOTHING
     RETURNING id`,
    [type, JSON.stringify(payload), opts.delaySeconds ?? 0, opts.dedupeKey ?? null, opts.maxAttempts ?? 8],
  );
  return r.rows[0]?.id ?? null;
}

export type Handler = (job: Job) => Promise<void>;

/** Lấy 1 job sẵn sàng (SKIP LOCKED để chạy nhiều worker an toàn) */
export async function claim(): Promise<Job | null> {
  const rows = await q<Job>(
    `UPDATE jobs SET status='running', locked_at=now(), attempts=attempts+1
     WHERE id = (
       SELECT id FROM jobs WHERE status='queued' AND run_at <= now()
       ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1
     ) RETURNING id, type, payload, attempts, max_attempts`,
  );
  return rows[0] ?? null;
}

export class RetryLater extends Error {
  constructor(message: string, public delaySeconds?: number) {
    super(message);
  }
}

export async function runOne(handlers: Record<string, Handler>): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  const handler = handlers[job.type];
  try {
    if (!handler) throw new Error(`Không có handler cho job ${job.type}`);
    await handler(job);
    await q(`UPDATE jobs SET status='done', finished_at=now(), last_error=NULL WHERE id=$1`, [job.id]);
  } catch (e) {
    const err = e as Error;
    const final = job.attempts >= job.max_attempts;
    const delay = e instanceof RetryLater && e.delaySeconds ? e.delaySeconds : Math.min(3600, 5 * 2 ** (job.attempts - 1));
    await q(
      `UPDATE jobs SET status=$2, last_error=$3, locked_at=NULL,
         run_at = CASE WHEN $2='queued' THEN now() + make_interval(secs => $4) ELSE run_at END,
         finished_at = CASE WHEN $2='failed' THEN now() ELSE NULL END
       WHERE id=$1`,
      [job.id, final ? 'failed' : 'queued', err.message.slice(0, 1000), delay],
    );
    if (final) console.error(`[jobs] ${job.type}#${job.id} thất bại hẳn: ${err.message}`);
  }
  return true;
}

/** Job bị kẹt (worker chết giữa chừng) được trả về hàng đợi */
export async function releaseStale(minutes = 10) {
  await q(
    `UPDATE jobs SET status='queued', locked_at=NULL WHERE status='running' AND locked_at < now() - make_interval(mins => $1)`,
    [minutes],
  );
}

/** Chạy hết các job sẵn sàng (dùng trong test) */
export async function drain(handlers: Record<string, Handler>, max = 500): Promise<number> {
  let n = 0;
  while (n < max && (await runOne(handlers))) n++;
  return n;
}
