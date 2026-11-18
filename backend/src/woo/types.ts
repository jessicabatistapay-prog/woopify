export interface WooLineItem {
  id: number;
  name: string;
  product_id: number;
  variation_id: number;
  quantity: number;
  subtotal: string;
  subtotal_tax: string;
  total: string;
  total_tax: string;
  sku: string;
  price: number | string;
  meta_data?: { key: string; value: unknown; display_key?: string; display_value?: unknown }[];
  image?: { id?: number | string; src?: string };
}

export interface WooAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface WooOrder {
  id: number;
  number: string;
  status: string;
  currency: string;
  total: string;
  discount_total: string;
  shipping_total: string;
  total_tax: string;
  date_created_gmt: string;
  date_modified_gmt: string;
  date_paid_gmt: string | null;
  date_completed_gmt: string | null;
  payment_method: string;
  payment_method_title: string;
  transaction_id?: string;
  customer_note: string;
  created_via?: string;
  billing: WooAddress;
  shipping: WooAddress;
  line_items: WooLineItem[];
  shipping_lines?: { id: number; method_title: string; total: string }[];
  fee_lines?: { id: number; name: string; total: string }[];
  coupon_lines?: { id: number; code: string; discount: string }[];
  tax_lines?: { id: number; label: string; tax_total: string; shipping_tax_total: string }[];
  refunds?: { id: number; reason: string; total: string }[];
  meta_data?: { id?: number; key: string; value: any }[];
}

export interface WooProduct {
  id: number;
  name: string;
  type: string; // simple | variable | variation | grouped | external
  status: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  manage_stock: boolean | 'parent';
  stock_quantity: number | null;
  stock_status: string;
  low_stock_amount?: number | null;
  date_modified_gmt: string;
  parent_id?: number;
  images?: { id: number; src: string }[];
  image?: { id: number; src: string } | null;
  categories?: { id: number; name: string }[];
  attributes?: { id: number; name: string; option?: string; options?: string[] }[];
  variations?: number[];
  short_description?: string;
  permalink?: string;
}
