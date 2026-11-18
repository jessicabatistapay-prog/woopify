import type { Product, ProductPatch } from '../api/types';
import { money } from './format';
import { colors } from './theme';

export const PRODUCT_STATUS: Record<string, string> = { publish: 'Đang bán', draft: 'Bản nháp', pending: 'Chờ duyệt', private: 'Riêng tư' };

export function stockText(p: { manage_stock: string; stock_quantity: number | null; stock_status: string }) {
  if (p.stock_status === 'outofstock') return { text: 'Hết hàng', color: colors.danger };
  if (p.stock_status === 'onbackorder') return { text: 'Cho đặt trước', color: colors.warn };
  if (p.manage_stock !== 'false' && p.stock_quantity !== null) return { text: `Còn ${p.stock_quantity}`, color: p.stock_quantity <= 2 ? colors.warn : colors.textMuted };
  return { text: 'Còn hàng', color: colors.textMuted };
}


export function stockLine(p: Product): string {
  if (p.stockMode === 'status_only') return p.stockStatus === 'outofstock' ? 'Hết hàng' : p.stockStatus === 'onbackorder' ? 'Cho đặt trước' : 'Còn hàng (không theo dõi số lượng)';
  if (p.stockMode === 'parent') return `${p.parentStockQuantity ?? p.stockQuantity ?? 0} (dùng chung của sản phẩm cha)`;
  return `${p.stockQuantity ?? 0}${p.stockStatus === 'outofstock' ? ' · Hết hàng' : ''}`;
}


export interface EditForm {
  regularPrice: string;
  salePrice: string;
  stockQuantity: string;
  stockStatus: 'instock' | 'outofstock' | 'onbackorder';
}

export function formFrom(p: Product): EditForm {
  return {
    regularPrice: p.regularPrice ?? '',
    salePrice: p.salePrice ?? '',
    stockQuantity: String((p.stockMode === 'parent' ? p.parentStockQuantity : p.stockQuantity) ?? 0),
    stockStatus: (p.stockStatus as EditForm['stockStatus']) || 'instock',
  };
}

const normPrice = (s: string) => s.trim().replace(',', '.');

export interface ChangeLine {
  target: string; // "Biến thể TOTE-BRN (Nâu)" | "Sản phẩm cha …"
  field: string;
  from: string;
  to: string;
}

/** So sánh form với giá trị gốc → patch gửi lên + danh sách thay đổi để người dùng xác nhận */
export function buildPatch(p: Product, f: EditForm, currency: string, parentName: string, sharedCount: number) {
  const patch: ProductPatch = {};
  const lines: ChangeLine[] = [];
  const errors: string[] = [];
  const self = p.type === 'variation' ? `Biến thể ${p.sku || ''} (${p.variationLabel})`.replace('  ', ' ') : `Sản phẩm ${p.name}${p.sku ? ` (${p.sku})` : ''}`;
  const reg = normPrice(f.regularPrice);
  const sale = normPrice(f.salePrice);
  const priceRe = /^\d+(\.\d{1,4})?$/;
  if (reg !== '' && !priceRe.test(reg)) errors.push('Giá thường không hợp lệ');
  if (sale !== '' && !priceRe.test(sale)) errors.push('Giá khuyến mãi không hợp lệ');
  if (sale !== '' && reg !== '' && Number(sale) >= Number(reg)) errors.push('Giá khuyến mãi phải thấp hơn giá thường');
  const fmt = (v: string) => (v === '' ? 'Không có' : money(v, currency));
  if (Number(reg || 0) !== Number(p.regularPrice || 0) || (reg === '') !== (p.regularPrice === '')) {
    patch.regularPrice = reg;
    lines.push({ target: self, field: 'Giá thường', from: fmt(p.regularPrice), to: fmt(reg) });
  }
  if (Number(sale || 0) !== Number(p.salePrice || 0) || (sale === '') !== (p.salePrice === '')) {
    patch.salePrice = sale;
    lines.push({ target: self, field: 'Giá khuyến mãi', from: fmt(p.salePrice), to: fmt(sale) });
  }
  if (p.stockMode === 'status_only') {
    if (f.stockStatus !== p.stockStatus) {
      patch.stockStatus = f.stockStatus;
      const L = { instock: 'Còn hàng', outofstock: 'Hết hàng', onbackorder: 'Cho đặt trước' } as Record<string, string>;
      lines.push({ target: self, field: 'Trạng thái kho', from: L[p.stockStatus] ?? p.stockStatus, to: L[f.stockStatus] });
    }
  } else {
    const q = f.stockQuantity.trim();
    if (!/^-?\d+$/.test(q)) errors.push('Tồn kho phải là số nguyên');
    else {
      const cur = p.stockMode === 'parent' ? (p.parentStockQuantity ?? p.stockQuantity ?? 0) : (p.stockQuantity ?? 0);
      if (Number(q) !== cur) {
        patch.stockQuantity = Number(q);
        lines.push({
          target: p.stockMode === 'parent' ? `Sản phẩm cha ${parentName} (dùng chung cho ${sharedCount} biến thể)` : self,
          field: 'Tồn kho',
          from: String(cur),
          to: q,
        });
      }
    }
  }
  return { patch, lines, errors };
}

/** Sau khi mất kết nối lúc lưu: kiểm tra giá trị trên website đã khớp ý định chưa */
export function patchApplied(p: Product, patch: ProductPatch): boolean {
  if (patch.regularPrice !== undefined && Number(patch.regularPrice || 0) !== Number(p.regularPrice || 0)) return false;
  if (patch.salePrice !== undefined && Number(patch.salePrice || 0) !== Number(p.salePrice || 0)) return false;
  if (patch.stockQuantity !== undefined) {
    const cur = p.stockMode === 'parent' ? (p.parentStockQuantity ?? p.stockQuantity) : p.stockQuantity;
    if (cur !== patch.stockQuantity) return false;
  }
  if (patch.stockStatus !== undefined && p.stockStatus !== patch.stockStatus) return false;
  return true;
}
