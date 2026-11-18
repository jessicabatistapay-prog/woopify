import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** Kho an toàn của hệ điều hành (Keychain / Keystore). Web chỉ dùng cho bản xem thử giao diện. */
export const secure = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string) {
    if (Platform.OS === 'web') return globalThis.localStorage?.setItem(key, value);
    return SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  },
  async del(key: string) {
    if (Platform.OS === 'web') return globalThis.localStorage?.removeItem(key);
    return SecureStore.deleteItemAsync(key);
  },
};

export async function installationId(): Promise<string> {
  let id = await secure.get('installation_id');
  if (!id) {
    id = `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    await secure.set('installation_id', id);
  }
  return id;
}
