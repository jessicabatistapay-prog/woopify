import type { Coupon } from '../api/types';
import { money } from './format';

export function couponSummary(c: Pick<Coupon, 'discountType' | 'amount' | 'freeShipping' | 'minimumAmount'>, currency: string): string {
  const amount = Number(c.amount || 0);
  const parts: string[] = [];
  if (amount > 0) parts.push(c.discountType === 'percent' ? `Giảm ${amount}%` : c.discountType === 'fixed_product' ? `Giảm ${money(amount, currency)} mỗi sản phẩm` : `Giảm ${money(amount, currency)} cho đơn`);
  if (c.freeShipping) parts.push('miễn phí vận chuyển');
  if (c.minimumAmount && Number(c.minimumAmount) > 0) parts.push(`đơn từ ${money(c.minimumAmount, currency)}`);
  return parts.join(' · ') || 'Chưa đặt mức giảm';
}
