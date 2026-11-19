import crypto from 'node:crypto';
import { q, q1 } from '../lib/db.js';
import type { AuthContext } from './auth.js';

export interface DeviceInput {
  installationId: string;
  platform: 'ios' | 'android' | 'web';
  name?: string;
  pushToken?: string | null;
  permission?: string;
  prefs?: { notifyNewOrder?: boolean; notifyPaid?: boolean; hideAmount?: boolean; sound?: 'kaching' | 'default' };
}

/** Đăng ký/cập nhật thiết bị. Token đổi → ghi đè; token trùng ở bản ghi khác → tắt bản ghi cũ. */
export async function registerDevice(ctx: AuthContext, d: DeviceInput) {
  const row = await q1<any>(
    `INSERT INTO devices (id, user_id, session_id, installation_id, platform, name, push_token, permission,
        notify_new_order, notify_paid, hide_amount, sound, active, inactive_reason, last_registered_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9,true), COALESCE($10,false), COALESCE($11,false), COALESCE($12,'kaching'), true, NULL, now())
     ON CONFLICT (installation_id) DO UPDATE SET user_id=EXCLUDED.user_id, session_id=EXCLUDED.session_id, platform=EXCLUDED.platform,
       name=EXCLUDED.name, push_token=EXCLUDED.push_token, permission=EXCLUDED.permission,
       notify_new_order=COALESCE($9, devices.notify_new_order), notify_paid=COALESCE($10, devices.notify_paid),
       hide_amount=COALESCE($11, devices.hide_amount), sound=COALESCE($12, devices.sound), active=true, inactive_reason=NULL, last_registered_at=now()
     RETURNING *`,
    [crypto.randomUUID(), ctx.userId, ctx.sessionId, d.installationId, d.platform, d.name ?? '', d.pushToken ?? null,
      d.permission ?? 'undetermined', d.prefs?.notifyNewOrder ?? null, d.prefs?.notifyPaid ?? null, d.prefs?.hideAmount ?? null,
      d.prefs?.sound ?? null],
  );
  if (d.pushToken) {
    await q(`UPDATE devices SET active=false, inactive_reason='token_moved' WHERE push_token=$1 AND id<>$2 AND active`, [d.pushToken, row.id]);
  }
  return presentDevice(row);
}

export async function updatePrefs(ctx: AuthContext, installationId: string, prefs: NonNullable<DeviceInput['prefs']>) {
  const row = await q1<any>(
    `UPDATE devices SET notify_new_order=COALESCE($3,notify_new_order), notify_paid=COALESCE($4,notify_paid), hide_amount=COALESCE($5,hide_amount),
       sound=COALESCE($6,sound)
     WHERE installation_id=$1 AND user_id=$2 RETURNING *`,
    [installationId, ctx.userId, prefs.notifyNewOrder ?? null, prefs.notifyPaid ?? null, prefs.hideAmount ?? null, prefs.sound ?? null],
  );
  return row ? presentDevice(row) : null;
}

export async function getDevice(ctx: AuthContext, installationId: string) {
  const row = await q1<any>('SELECT * FROM devices WHERE installation_id=$1 AND user_id=$2', [installationId, ctx.userId]);
  return row ? presentDevice(row) : null;
}

export async function unregisterDevice(ctx: AuthContext, installationId: string) {
  await q(`UPDATE devices SET active=false, inactive_reason='unregistered', push_token=NULL WHERE installation_id=$1 AND user_id=$2`, [
    installationId,
    ctx.userId,
  ]);
}

export function presentDevice(r: any) {
  return {
    id: r.id,
    installationId: r.installation_id,
    platform: r.platform,
    name: r.name,
    hasPushToken: !!r.push_token,
    pushTokenPreview: r.push_token ? `${String(r.push_token).slice(0, 22)}…` : null,
    permission: r.permission,
    active: r.active,
    inactiveReason: r.inactive_reason,
    prefs: { notifyNewOrder: r.notify_new_order, notifyPaid: r.notify_paid, hideAmount: r.hide_amount, sound: r.sound ?? 'kaching' },
    lastRegisteredAt: r.last_registered_at,
    lastPushAt: r.last_push_at,
    lastPushStatus: r.last_push_status,
    lastPushError: r.last_push_error,
  };
}
