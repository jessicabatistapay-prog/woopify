import crypto from 'node:crypto';
import { config } from '../lib/config.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { q, q1 } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

export interface AuthContext {
  userId: number;
  sessionId: string;
  email: string;
}

export async function createUser(email: string, password: string, name = '') {
  if (password.length < 10) throw new Error('Mật khẩu cần ít nhất 10 ký tự');
  const hash = await hashPassword(password);
  const row = await q1<{ id: number }>(
    `INSERT INTO users (email, name, password_hash) VALUES (lower($1), $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, name=EXCLUDED.name RETURNING id`,
    [email.trim(), name, hash],
  );
  // đổi mật khẩu → thu hồi mọi phiên cũ (vd. khi mất điện thoại)
  await q('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [row!.id]);
  await q(`UPDATE devices SET active=false, inactive_reason='password_changed' WHERE user_id=$1`, [row!.id]);
  return row;
}

export async function login(email: string, password: string) {
  const user = await q1<any>('SELECT * FROM users WHERE email=lower($1)', [email.trim()]);
  // vẫn băm khi không có user để tránh dò email qua thời gian phản hồi
  const ok = user ? await verifyPassword(password, user.password_hash) : (await hashPassword(password), false);
  if (!user || !ok) throw new AppError(401, 'invalid_credentials', 'Email hoặc mật khẩu không đúng');
  const token = randomToken(32);
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + config().SESSION_TTL_DAYS * 86400_000);
  await q('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)', [id, user.id, sha256(token), expires]);
  return { token, expiresAt: expires, user: { id: user.id, email: user.email, name: user.name } };
}

export async function authenticate(token: string | undefined): Promise<AuthContext> {
  if (!token) throw new AppError(401, 'unauthenticated', 'Chưa đăng nhập');
  const s = await q1<any>(
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1`,
    [sha256(token)],
  );
  if (!s || s.revoked_at || s.expires_at < new Date()) {
    throw new AppError(401, 'session_expired', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }
  // gia hạn trượt
  await q(`UPDATE sessions SET last_used_at=now(), expires_at=GREATEST(expires_at, now() + make_interval(days => $2)) WHERE id=$1`, [
    s.id,
    config().SESSION_TTL_DAYS,
  ]);
  return { userId: s.user_id, sessionId: s.id, email: s.email };
}

export async function logout(ctx: AuthContext) {
  await q('UPDATE sessions SET revoked_at=now() WHERE id=$1', [ctx.sessionId]);
  // thiết bị gắn với phiên này không nhận push nữa
  await q(`UPDATE devices SET active=false, inactive_reason='logout' WHERE session_id=$1`, [ctx.sessionId]);
}
