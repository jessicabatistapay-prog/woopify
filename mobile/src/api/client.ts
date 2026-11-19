import type { Api, OrderListParams, ProductListParams } from './types';

export type ApiErrorKind = 'network' | 'timeout' | 'session' | 'conflict' | 'validation' | 'woo' | 'server' | 'not_found';

/** Lỗi API thống nhất cho giao diện. `uncertain` = yêu cầu ghi có thể đã tới website nhưng không nhận được phản hồi. */
export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public status = 0,
    public code = '',
    public details?: any,
    public uncertain = false,
  ) {
    super(message);
  }
}

const qs = (o: Record<string, unknown>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

export function createHttpApi(opts: { baseUrl: string; token: string; onSessionExpired: () => void; timeoutMs?: number }): Api {
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000);
    const isWrite = method !== 'GET';
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${opts.token}`,
          ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      throw new ApiError(
        aborted ? 'timeout' : 'network',
        aborted ? 'Máy chủ phản hồi quá lâu.' : 'Không kết nối được tới máy chủ. Kiểm tra mạng.',
        0,
        '',
        undefined,
        isWrite,
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) return json as T;
    const message = json?.message ?? `Lỗi ${res.status}`;
    const code = json?.error ?? '';
    if (res.status === 401) {
      opts.onSessionExpired();
      throw new ApiError('session', message, 401, code);
    }
    if (res.status === 409) throw new ApiError('conflict', message, 409, code, json?.details);
    if (res.status === 404) throw new ApiError('not_found', message, 404, code);
    if (res.status === 400 || res.status === 422) throw new ApiError('validation', message, res.status, code, json?.details);
    if (code.startsWith('woo_')) {
      // woo_network khi đang ghi: website có thể đã lưu → coi là chưa chắc chắn
      throw new ApiError('woo', message, res.status, code, json?.details, isWrite && code === 'woo_network');
    }
    throw new ApiError('server', message, res.status, code, json?.details, isWrite && res.status >= 500);
  }

  return {
    mode: 'real',
    logout: () => req('POST', '/api/auth/logout').then(() => undefined),
    getShop: () => req('GET', '/api/shop'),
    testConnection: (b) => req('POST', '/api/shop/test', b),
    connectShop: (b) => req('POST', '/api/shop/connect', b),
    checkConnection: () => req('POST', '/api/shop/check'),
    ensureWebhooks: () => req('POST', '/api/shop/webhooks/ensure'),
    syncNow: () => req('POST', '/api/shop/sync').then(() => undefined),
    getDashboard: (range, from, to) => req('GET', `/api/dashboard?${qs({ range, from, to })}`),
    listOrders: (p: OrderListParams) => req('GET', `/api/orders?${qs({ ...p })}`),
    orderStatuses: () => req('GET', '/api/orders/statuses'),
    getOrder: (id) => req('GET', `/api/orders/${id}`),
    updateOrderStatus: (id, status, expectedStatus) => req('POST', `/api/orders/${id}/status`, { status, expectedStatus }),
    addOrderNote: (id, note, customer, key) => req('POST', `/api/orders/${id}/notes`, { note, customer }, { 'Idempotency-Key': key }),
    listProducts: (p: ProductListParams) => req('GET', `/api/products?${qs({ ...p })}`),
    categories: () => req('GET', '/api/categories'),
    getProduct: (id) => req('GET', `/api/products/${id}`),
    updateProduct: (pid, vid, patch) => req('PATCH', vid ? `/api/products/${pid}/variations/${vid}` : `/api/products/${pid}`, patch),
    createProduct: (input, key) => req('POST', '/api/products', input, { 'Idempotency-Key': key }),
    publishProduct: (id) => req('POST', `/api/products/${id}/publish`),
    uploadImage: (uri, mime, name) => {
      const fd = new FormData();
      fd.append('file', { uri, type: mime, name } as any);
      return req('POST', '/api/uploads', fd);
    },
    registerDevice: (b) => req('PUT', '/api/devices', b),
    getDevice: (inst) => req('GET', `/api/devices/${encodeURIComponent(inst)}`),
    updateDevicePrefs: (inst, prefs) => req('PATCH', `/api/devices/${encodeURIComponent(inst)}/prefs`, prefs),
    unregisterDevice: (inst) => req('DELETE', `/api/devices/${encodeURIComponent(inst)}`).then(() => undefined),
    listNotifications: (page = 1) => req('GET', `/api/notifications?page=${page}`),
    markNotificationsRead: (b) => req('POST', '/api/notifications/read', b).then(() => undefined),
    sendTestNotification: (inst) => req('POST', '/api/notifications/test', { installationId: inst }),
    diagnostics: (inst) => req('GET', `/api/notifications/diagnostics?installationId=${encodeURIComponent(inst)}`),
    salesReport: (range, from, to, currency) => req('GET', `/api/reports/sales?${qs({ range, from, to, currency })}`),
    liveReport: () => req('GET', '/api/reports/live'),
    trackerInfo: () => req('GET', '/api/tracker'),
    settingGroups: () => req('GET', '/api/store/settings'),
    settingGroup: (id) => req('GET', `/api/store/settings/${encodeURIComponent(id)}`),
    updateSettings: (group, updates) => req('PUT', `/api/store/settings/${encodeURIComponent(group)}`, { updates }),
    paymentGateways: () => req('GET', '/api/store/payment-gateways'),
    updatePaymentGateway: (id, body) => req('PUT', `/api/store/payment-gateways/${encodeURIComponent(id)}`, body),
    shippingZones: () => req('GET', '/api/store/shipping-zones'),
    updateShippingMethod: (z, i, body) => req('PUT', `/api/store/shipping-zones/${z}/methods/${i}`, body),
    listCoupons: (q, page = 1) => req('GET', `/api/store/coupons?${qs({ q, page })}`),
    getCoupon: (id) => req('GET', `/api/store/coupons/${id}`),
    saveCoupon: (id, input) => (id ? req('PUT', `/api/store/coupons/${id}`, input) : req('POST', '/api/store/coupons', input)),
    deleteCoupon: (id) => req('DELETE', `/api/store/coupons/${id}`).then(() => undefined),
    listCustomers: (q, page = 1) => req('GET', `/api/store/customers?${qs({ q, page })}`),
    getCustomer: (id) => req('GET', `/api/store/customers/${id}`),
    updateCustomer: (id, body) => req('PUT', `/api/store/customers/${id}`, body),
    updateProductInfo: (id, patch) => req('PUT', `/api/products/${id}/info`, patch),
  };
}

export async function loginRequest(baseUrl: string, email: string, password: string) {
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new ApiError('network', 'Không kết nối được tới máy chủ. Kiểm tra địa chỉ backend và mạng.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status === 401 ? 'validation' : 'server', json?.message ?? `Lỗi ${res.status}`, res.status, json?.error);
  return json as { token: string; expiresAt: string; user: { id: number; email: string; name: string } };
}
