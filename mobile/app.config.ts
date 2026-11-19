import type { ExpoConfig } from 'expo/config';

// Cấu hình qua biến môi trường (xem mobile/.env.example)
const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
const bundleId = process.env.APP_BUNDLE_ID ?? 'com.example.wooadmin';

const config: ExpoConfig = {
  name: 'Woo Admin',
  slug: process.env.EAS_SLUG ?? 'woo-admin',
  owner: process.env.EAS_OWNER,
  scheme: 'wooadmin',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: bundleId,
    supportsTablet: false,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: bundleId,
    adaptiveIcon: {
      backgroundColor: '#1E4D3A',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // google-services.json cần cho FCM (push Android) — xem README
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? undefined,
    permissions: ['POST_NOTIFICATIONS'],
  },
  web: { favicon: './assets/favicon.png', bundler: 'metro', output: 'single' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    // Âm “ka-ching” tự tạo (không dùng âm của Shopify) — cần build lại app khi đổi file âm thanh
    ['expo-notifications', { color: '#1E4D3A', defaultChannel: 'orders_kaching', sounds: ['./assets/sounds/ka_ching.wav'] }],
    ['expo-image-picker', { photosPermission: 'Cho phép chọn ảnh để thêm vào sản phẩm.' }],
  ],
  experiments: { typedRoutes: false },
  extra: { eas: projectId ? { projectId } : undefined },
};

export default config;
