import AsyncStorage from '@react-native-async-storage/async-storage';

/** Bộ đệm dữ liệu đã tải (không chứa token/khóa). Tách namespace theo chế độ để demo không lẫn với shop thật. */
let namespace = 'real';
export const setCacheNamespace = (ns: string) => (namespace = ns);

export async function readCache<T>(key: string): Promise<{ data: T; savedAt: number } | null> {
  if (namespace === 'demo') return null;
  try {
    const raw = await AsyncStorage.getItem(`cache:${namespace}:${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T) {
  if (namespace === 'demo') return;
  try {
    await AsyncStorage.setItem(`cache:${namespace}:${key}`, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    /* bỏ qua */
  }
}

export async function clearCache() {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('cache:'));
  await AsyncStorage.multiRemove(keys);
}
