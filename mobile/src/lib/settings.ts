import type { SettingField } from '../api/types';

export const isOn = (v: unknown) => v === 'yes' || v === true || v === 'true' || v === 1;

export function displayValue(f: SettingField, v: unknown): string {
  if (f.type === 'checkbox') return isOn(v) ? 'Bật' : 'Tắt';
  if (f.type === 'password') return v ? '••••••' : '(trống)';
  if (Array.isArray(v)) return v.map((x) => f.options?.[x] ?? x).join(', ') || '(trống)';
  if (f.options && typeof v === 'string') return f.options[v] ?? v;
  const s = v === null || v === undefined ? '' : String(v);
  return s === '' ? '(trống)' : s.length > 60 ? s.slice(0, 60) + '…' : s;
}

