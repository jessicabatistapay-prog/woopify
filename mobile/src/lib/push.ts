import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
/* eslint-disable import/namespace -- enum Android* được export lúc chạy qua `export *` từ *.types.js */
import * as Notifications from 'expo-notifications';
import type { Api } from '../api/types';
import { installationId } from './storage';

/** Kênh Android: âm thanh của kênh cố định sau khi tạo, nên mỗi âm thanh là một kênh riêng (khớp backend SOUNDS) */
export const SOUND_CHANNELS = {
  kaching: { channel: 'orders_kaching', file: 'ka_ching.wav', label: 'Ka-ching (tiền về)' },
  default: { channel: 'orders', file: 'default', label: 'Âm mặc định của máy' },
} as const;
export const ORDER_CHANNEL = SOUND_CHANNELS.kaching.channel;

let configured = false;
export function configureNotifications() {
  if (configured || Platform.OS === 'web') return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(SOUND_CHANNELS.kaching.channel, {
      name: 'Đơn hàng (ka-ching)',
      description: 'Đơn mới và đơn đã thanh toán',
      importance: Notifications.AndroidImportance.HIGH,
      sound: SOUND_CHANNELS.kaching.file,
      vibrationPattern: [0, 120, 80, 120],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    }).catch(() => undefined);
    Notifications.setNotificationChannelAsync(SOUND_CHANNELS.default.channel, {
      name: 'Đơn hàng (âm mặc định)',
      description: 'Đơn mới và đơn đã thanh toán',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    }).catch(() => undefined);
  }
}

export function easProjectId(): string | undefined {
  return (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function getPermission(): Promise<PermissionState> {
  if (Platform.OS === 'web') return 'unsupported';
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

export interface RegisterResult {
  permission: PermissionState;
  token: string | null;
  error?: string;
}

/**
 * Xin quyền (nếu `ask`), lấy Expo push token và đăng ký thiết bị với backend.
 * Không có quyền vẫn đăng ký (token null) để backend biết trạng thái; lịch sử thông báo trong app vẫn hoạt động.
 */
export async function registerDevice(api: Api, ask: boolean): Promise<RegisterResult> {
  configureNotifications();
  const inst = await installationId();
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  let permission = await getPermission();
  let token: string | null = null;
  let error: string | undefined;
  if (permission === 'undetermined' && ask) {
    const r = await Notifications.requestPermissionsAsync();
    permission = r.granted ? 'granted' : r.canAskAgain ? 'undetermined' : 'denied';
  }
  if (permission === 'granted') {
    if (!Device.isDevice) error = 'Máy ảo không nhận được push thật. Hãy dùng điện thoại thật.';
    else {
      const projectId = easProjectId();
      if (!projectId) error = 'Thiếu EAS projectId (EXPO_PUBLIC_EAS_PROJECT_ID). Xem README mục cấu hình push.';
      else {
        try {
          token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        } catch (e) {
          error = `Không lấy được push token: ${(e as Error).message}`;
        }
      }
    }
  }
  await api.registerDevice({
    installationId: inst,
    platform,
    name: Device.deviceName ?? Device.modelName ?? platform,
    pushToken: token,
    permission,
  });
  return { permission, token, error };
}

/** Token APNs/FCM có thể đổi khi cài lại/khôi phục → đăng ký lại */
export function watchTokenChanges(api: Api) {
  if (Platform.OS === 'web') return () => undefined;
  const sub = Notifications.addPushTokenListener(() => {
    registerDevice(api, false).catch(() => undefined);
  });
  return () => sub.remove();
}

export async function localNotify(title: string, body: string, data: Record<string, unknown>, sound: keyof typeof SOUND_CHANNELS = 'kaching') {
  if (Platform.OS === 'web') return;
  configureNotifications();
  const s = SOUND_CHANNELS[sound];
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data, sound: s.file },
    trigger: Platform.OS === 'android' ? { channelId: s.channel, seconds: 2, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL } : { seconds: 2, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL },
  });
}

/** Nghe thử âm thanh: phát một thông báo cục bộ sau 2 giây (cần bản cài development build, không chạy trên web) */
export async function previewSound(sound: keyof typeof SOUND_CHANNELS) {
  await localNotify('Đơn mới #10428 · 149,00 USD', `Nghe thử: ${SOUND_CHANNELS[sound].label}`, { type: 'test' }, sound);
}

export function openSystemSettingsHint() {
  return Platform.OS === 'ios' ? 'Cài đặt → Thông báo → Woo Admin' : 'Cài đặt → Ứng dụng → Woo Admin → Thông báo';
}
