import { config } from '../lib/config.js';

export type WooErrorKind =
  | 'network' // không kết nối được (DNS, TLS, timeout)
  | 'url' // URL không phải WordPress/WooCommerce REST
  | 'auth' // Consumer Key/Secret sai hoặc header Authorization bị chặn
  | 'permission' // khóa không có quyền đọc/ghi
  | 'not_found'
  | 'invalid' // dữ liệu gửi lên không hợp lệ
  | 'server';

export class WooError extends Error {
  constructor(
    public kind: WooErrorKind,
    message: string,
    public status?: number,
    public wooCode?: string,
  ) {
    super(message);
  }
}

export interface WooResponse<T> {
  data: T;
  status: number;
  total?: number;
  totalPages?: number;
}

export interface WooCredentials {
  url: string;
  consumerKey: string;
  consumerSecret: string;
}

export function normalizeStoreUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const parsed = new URL(u);
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/+$/, '');
}

type Query = Record<string, string | number | boolean | undefined | null | (string | number)[]>;

export class WooClient {
  readonly baseUrl: string;
  private auth: string;

  constructor(private creds: WooCredentials) {
    this.baseUrl = normalizeStoreUrl(creds.url);
    if (!this.baseUrl.startsWith('https://') && !config().WC_ALLOW_HTTP) {
      throw new WooError('url', 'URL cửa hàng phải dùng HTTPS để bảo vệ Consumer Key/Secret.');
    }
    // Basic auth qua HTTPS — không đưa khóa vào query string để tránh lộ trong log máy chủ
    this.auth = 'Basic ' + Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64');
  }

  url(path: string, query?: Query): string {
    const u = new URL(`${this.baseUrl}/wp-json${path.startsWith('/') ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null || v === '') continue;
      u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    return u.toString();
  }

  async request<T = any>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown; auth?: boolean } = {},
  ): Promise<WooResponse<T>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config().WC_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(this.url(path, opts.query), {
        method,
        headers: {
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.auth === false ? {} : { Authorization: this.auth }),
          'User-Agent': 'WooAdminMobile/1.0',
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
        redirect: 'follow',
      });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      const code = err.cause?.code ?? err.name;
      throw new WooError('network', `Không kết nối được tới ${new URL(this.baseUrl).host} (${code}).`);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      if (res.ok || res.status === 404) {
        throw new WooError(
          'url',
          'Máy chủ không trả về JSON. Kiểm tra URL, permalink của WordPress (không dùng “Plain”) và plugin bảo mật/cache.',
          res.status,
        );
      }
    }

    if (!res.ok) {
      const wooCode: string | undefined = data?.code;
      const msg: string = data?.message ?? `HTTP ${res.status}`;
      if (res.status === 401) {
        if (wooCode === 'woocommerce_rest_authentication_error' && /write|ghi/i.test(msg)) {
          throw new WooError('permission', 'Khóa API chỉ có quyền Đọc. Cần quyền Đọc/Ghi (Read/Write).', 401, wooCode);
        }
        throw new WooError('auth', `Xác thực thất bại: ${msg}`, 401, wooCode);
      }
      if (res.status === 403) throw new WooError('permission', `Không đủ quyền: ${msg}`, 403, wooCode);
      if (res.status === 404) {
        if (wooCode === 'rest_no_route') throw new WooError('url', `Không có endpoint ${path} (WooCommerce chưa bật REST?)`, 404, wooCode);
        throw new WooError('not_found', msg, 404, wooCode);
      }
      if (res.status === 400) throw new WooError('invalid', msg, 400, wooCode);
      throw new WooError('server', `Lỗi máy chủ WooCommerce (${res.status}): ${msg}`, res.status, wooCode);
    }

    const total = res.headers.get('x-wp-total');
    const totalPages = res.headers.get('x-wp-totalpages');
    return {
      data: data as T,
      status: res.status,
      total: total ? Number(total) : undefined,
      totalPages: totalPages ? Number(totalPages) : undefined,
    };
  }

  get<T = any>(path: string, query?: Query) {
    return this.request<T>('GET', path, { query });
  }
  post<T = any>(path: string, body: unknown, query?: Query) {
    return this.request<T>('POST', path, { body, query });
  }
  put<T = any>(path: string, body: unknown) {
    return this.request<T>('PUT', path, { body });
  }

  /** WordPress REST index: tên site, múi giờ, namespaces (không cần xác thực) */
  root() {
    return this.request<any>('GET', '/', { auth: false });
  }
}
