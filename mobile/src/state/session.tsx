import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createHttpApi, loginRequest } from '../api/client';
import { createDemoApi } from '../api/demo';
import type { Api } from '../api/types';
import { clearCache, setCacheNamespace } from '../lib/cache';
import { installationId, secure } from '../lib/storage';
import { localNotify } from '../lib/push';
import { orderFilters, productFilters } from './store';

type Stored = { mode: 'real'; baseUrl: string; token: string; email: string } | { mode: 'demo' };

interface SessionValue {
  status: 'loading' | 'signedOut' | 'signedIn';
  api: Api | null;
  mode: 'real' | 'demo' | null;
  email: string | null;
  baseUrl: string | null;
  /** Thông báo hiển thị trên màn hình đăng nhập (vd. hết phiên) */
  notice: string | null;
  signIn(baseUrl: string, email: string, password: string): Promise<void>;
  startDemo(): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);
const KEY = 'session_v1';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [status, setStatus] = useState<SessionValue['status']>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [lastBaseUrl, setLastBaseUrl] = useState<string | null>(null);

  const expire = useCallback(async () => {
    await secure.del(KEY);
    setStored(null);
    setStatus('signedOut');
    setNotice('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }, []);

  useEffect(() => {
    (async () => {
      const raw = await secure.get(KEY);
      setLastBaseUrl(await secure.get('last_base_url'));
      if (raw) {
        const s = JSON.parse(raw) as Stored;
        setCacheNamespace(s.mode);
        setStored(s);
        setStatus('signedIn');
      } else setStatus('signedOut');
    })();
  }, []);

  const api = useMemo<Api | null>(() => {
    if (!stored) return null;
    if (stored.mode === 'demo') return createDemoApi({ localNotify });
    return createHttpApi({ baseUrl: stored.baseUrl, token: stored.token, onSessionExpired: expire });
  }, [stored, expire]);

  const value: SessionValue = {
    status,
    api,
    mode: stored?.mode ?? null,
    email: stored?.mode === 'real' ? stored.email : null,
    baseUrl: stored?.mode === 'real' ? stored.baseUrl : lastBaseUrl,
    notice,
    async signIn(baseUrl, email, password) {
      const url = baseUrl.trim().replace(/\/+$/, '');
      const r = await loginRequest(url, email.trim(), password);
      const s: Stored = { mode: 'real', baseUrl: url, token: r.token, email: r.user.email };
      await secure.set(KEY, JSON.stringify(s));
      await secure.set('last_base_url', url);
      setLastBaseUrl(url);
      setCacheNamespace('real');
      setNotice(null);
      setStored(s);
      setStatus('signedIn');
    },
    async startDemo() {
      const s: Stored = { mode: 'demo' };
      await secure.set(KEY, JSON.stringify(s));
      setCacheNamespace('demo');
      setNotice(null);
      setStored(s);
      setStatus('signedIn');
    },
    async signOut() {
      if (api && stored?.mode === 'real') {
        // hủy đăng ký push trước khi xóa phiên; lỗi mạng không chặn đăng xuất (backend cũng tắt thiết bị khi phiên bị thu hồi)
        try {
          await api.unregisterDevice(await installationId());
        } catch {
          /* bỏ qua */
        }
        try {
          await api.logout();
        } catch {
          /* bỏ qua */
        }
        await clearCache();
      }
      orderFilters.reset();
      productFilters.reset();
      await secure.del(KEY);
      setStored(null);
      setStatus('signedOut');
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
}

export function useApi(): Api {
  const { api } = useSession();
  if (!api) throw new Error('Chưa đăng nhập');
  return api;
}
