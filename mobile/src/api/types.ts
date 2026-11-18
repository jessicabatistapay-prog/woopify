export type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'custom';

export interface ShopInfo {
  id: number;
  name: string;
  url: string;
  timezone: string;
  currency: string;
  priceDecimals: number;
  wcVersion: string | null;
  hposEnabled: boolean | null;
  astEnabled: boolean;
  manageStockEnabled: boolean;
  lowStockAmount: number;
  lastWebhookAt: string | null;
  lastWebhookTopic: string | null;
  lastCheck: CheckResult | null;
  lastCheckAt: string | null;
  adminUrl: string;
}

export interface SyncStatus {
  orders: { status: string; phase: string; synced: number; total: number | null; completeFrom: string | null; error: string | null; lastReconcileAt: string | null } | null;
  products: { status: string; synced: number; total: number | null; error: string | null } | null;
  lastSyncAt: string | null;
}

export type ShopResponse = { connected: false } | { connected: true; shop: ShopInfo; sync: SyncStatus };

export interface CheckStep {
  key: 'url' | 'auth' | 'read' | 'write' | 'webhooks' | 'webhook_delivery';
  label: string;
  ok: boolean;
  level: 'ok' | 'warn' | 'error' | 'skipped';
  message: string;
  hint?: string;
}
export interface CheckResult {
  ok: boolean;
  steps: CheckStep[];
}

export interface Bucket {
  start: string;
  label: string;
  totalSales: number;
  orders: number;
}
export interface CurrencyMetrics {
  currency: string;
  ordersCount: number;
  newOrders: number;
  paidOrders: number;
  grossSales: number;
  coupons: number;
  refunds: number;
  netSales: number;
  shipping: number;
  taxes: number;
  totalSales: number;
  avgOrderValue: number;
  buckets: Bucket[];
  topProducts: { productId: number; name: string; quantity: number; netRevenue: number; imageUrl: string | null }[];
  previous: Omit<CurrencyMetrics, 'previous' | 'buckets' | 'topProducts'> | null;
}

export interface OrderSummary {
  id: number;
  number: string;
  status: string;
  currency: string;
  total: number;
  customer_name: string;
  billing_email?: string;
  item_count: number;
  date_created_gmt: string;
  date_paid_gmt: string | null;
  paid?: boolean;
}

export interface Dashboard {
  range: { key: RangeKey; start: string; end: string; granularity: 'hour' | 'day'; label: string };
  timezone: string;
  timezoneOffset: string;
  primaryCurrency: string;
  currencies: CurrencyMetrics[];
  needsProcessing: number;
  onHold: number;
  pendingPayment: number;
  recentOrders: OrderSummary[];
  coverage: { complete: boolean; completeFrom: string | null; syncing: boolean; synced: number; total: number | null };
  lastSyncAt: string | null;
  definitions: { term: string; text: string }[];
}

export interface Paged<T> {
  items: T[];
  page: number;
  hasMore: boolean;
  lastSyncAt?: string | null;
  syncing?: boolean;
}

export interface OrderListParams {
  status?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
}

export interface StatusOption {
  slug: string;
  label: string;
  count: number;
}

export interface OrderNote {
  id: number;
  note: string;
  author: string;
  customerNote: boolean;
  date: string;
}

export interface OrderDetail {
  id: number;
  number: string;
  status: string;
  statusLabel: string;
  paid: boolean;
  currency: string;
  dateCreated: string;
  datePaid: string | null;
  dateModified: string;
  paymentMethod: string;
  transactionId: string | null;
  customerNote: string;
  customer: { name: string; email: string; phone: string };
  shippingAddress: { lines: string[]; isBilling: boolean; phone: string };
  items: {
    id: number;
    name: string;
    sku: string;
    productId: number;
    variationId: number;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    total: number;
    imageUrl: string | null;
    meta: { key: string; value: string }[];
  }[];
  totals: {
    subtotal: number;
    discount: number;
    shipping: number;
    shippingMethods: string[];
    fees: { name: string; total: number }[];
    tax: number;
    total: number;
    refunded: number;
    coupons: string[];
  };
  refunds: { id: number; reason: string; amount: number }[];
  notes?: OrderNote[];
  tracking: { provider: string; number: string; link: string | null; dateShipped: string | null }[] | null;
  trackingSupported: boolean;
  adminUrl: string;
  stale: boolean;
  fetchedAt: string;
}

export interface ProductSummary {
  id: number;
  type: string;
  name: string;
  sku: string;
  status: string;
  price: string;
  regular_price: string;
  sale_price: string;
  manage_stock: 'true' | 'false' | 'parent';
  stock_quantity: number | null;
  stock_status: string;
  image_url: string | null;
  variation_count: number;
  variation_summary: { min: number | null; max: number | null; stock: number | null; out: number } | null;
  matched_variation: { id: number; sku: string; label: string } | null;
}

export interface ProductListParams {
  q?: string;
  category?: number;
  stock?: 'instock' | 'low' | 'outofstock';
  page?: number;
}

export interface Product {
  id: number;
  parentId: number;
  type: string;
  name: string;
  variationLabel: string;
  attributes: { name: string; option: string | null; options: string[] | null }[];
  sku: string;
  status: string;
  price: string;
  regularPrice: string;
  salePrice: string;
  manageStock: 'true' | 'false' | 'parent';
  stockMode: 'product' | 'parent' | 'status_only';
  stockQuantity: number | null;
  parentStockQuantity: number | null;
  stockStatus: string;
  lowStockAmount: number;
  imageUrl: string | null;
  images: string[];
  categories: { id: number; name: string }[];
  shortDescription: string;
  dateModified: string;
  permalink: string | null;
  adminUrl: string;
}

export interface ProductDetail {
  product: Product;
  variations: Product[];
  stale: boolean;
  fetchedAt: string;
}

export interface ProductPatch {
  regularPrice?: string;
  salePrice?: string;
  stockQuantity?: number;
  stockStatus?: 'instock' | 'outofstock' | 'onbackorder';
  expectedModified?: string;
  force?: boolean;
}

export interface CreateProductInput {
  name: string;
  shortDescription?: string;
  sku?: string;
  regularPrice?: string;
  salePrice?: string;
  categoryIds?: number[];
  manageStock?: boolean;
  stockQuantity?: number;
  imageUploadIds?: string[];
}

export interface Category {
  id: number;
  name: string;
  parent: number;
  count: number;
}

export interface DevicePrefs {
  notifyNewOrder: boolean;
  notifyPaid: boolean;
  hideAmount: boolean;
}

export interface DeviceInfo {
  id: string;
  installationId: string;
  platform: string;
  name: string;
  hasPushToken: boolean;
  pushTokenPreview: string | null;
  permission: string;
  active: boolean;
  inactiveReason: string | null;
  prefs: DevicePrefs;
  lastRegisteredAt: string;
  lastPushAt: string | null;
  lastPushStatus: string | null;
  lastPushError: string | null;
}

export interface NotificationItem {
  id: number;
  kind: 'order.placed' | 'order.paid' | 'test';
  order_id: number | null;
  title: string;
  body: string;
  data: { type?: string; orderId?: number; url?: string };
  created_at: string;
  read_at: string | null;
  deliveries: { status: string; error: string | null }[] | null;
}

export interface Diagnostics {
  device: DeviceInfo | null;
  shopConnected: boolean;
  lastWebhookAt: string | null;
  lastWebhookTopic: string | null;
  lastBadSignatureAt: string | null;
  lastOrderWebhook: { topic: string; resource_id: number; received_at: string; status: string } | null;
  lastEvent: { type: string; order_id: number; number: string | null; created_at: string; suppressed: boolean; suppressed_reason: string | null } | null;
  lastOrderPush: { title: string; kind: string; created_at: string; status: string; error: string | null } | null;
  lastTestPush: { created_at: string; status: string; error: string | null } | null;
  expoAccessTokenConfigured: boolean;
}

export interface Api {
  mode: 'real' | 'demo';
  logout(): Promise<void>;
  getShop(): Promise<ShopResponse>;
  testConnection(input: { url: string; consumerKey: string; consumerSecret: string }): Promise<CheckResult>;
  connectShop(input: { url: string; consumerKey: string; consumerSecret: string }): Promise<{ shop: ShopInfo; check: CheckResult }>;
  checkConnection(): Promise<CheckResult>;
  ensureWebhooks(): Promise<{ created: string[]; updated: string[]; check: CheckResult }>;
  syncNow(): Promise<void>;
  getDashboard(range: RangeKey, from?: string, to?: string): Promise<Dashboard>;
  listOrders(p: OrderListParams): Promise<Paged<OrderSummary>>;
  orderStatuses(): Promise<StatusOption[]>;
  getOrder(id: number): Promise<OrderDetail>;
  updateOrderStatus(id: number, status: string, expectedStatus: string): Promise<OrderDetail>;
  addOrderNote(id: number, note: string, customer: boolean, idempotencyKey: string): Promise<OrderNote & { replayed?: boolean }>;
  listProducts(p: ProductListParams): Promise<Paged<ProductSummary>>;
  categories(): Promise<Category[]>;
  getProduct(id: number): Promise<ProductDetail>;
  updateProduct(productId: number, variationId: number | null, patch: ProductPatch): Promise<{ item: Product; changed: Product[] }>;
  createProduct(input: CreateProductInput, idempotencyKey: string): Promise<{ product: Product; replayed?: boolean }>;
  publishProduct(id: number): Promise<{ product: Product }>;
  uploadImage(uri: string, mime: string, name: string): Promise<{ id: string; url: string }>;
  registerDevice(input: { installationId: string; platform: 'ios' | 'android' | 'web'; name?: string; pushToken: string | null; permission: string }): Promise<DeviceInfo>;
  getDevice(installationId: string): Promise<DeviceInfo | null>;
  updateDevicePrefs(installationId: string, prefs: Partial<DevicePrefs>): Promise<DeviceInfo>;
  unregisterDevice(installationId: string): Promise<void>;
  listNotifications(page?: number): Promise<{ items: NotificationItem[]; hasMore: boolean; unread: number }>;
  markNotificationsRead(input: { ids?: number[]; all?: boolean }): Promise<void>;
  sendTestNotification(installationId: string): Promise<{ sent: number; errors: { error: string }[] }>;
  diagnostics(installationId: string): Promise<Diagnostics>;
}
