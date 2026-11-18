import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../state/session';
import { colors, space } from '../lib/theme';
import { Banner, Button, Card, Field, Txt } from '../ui/kit';
import { ApiError } from '../api/client';

export default function Login() {
  const { signIn, startDemo, notice, baseUrl: lastUrl } = useSession();
  const [baseUrl, setBaseUrl] = useState(lastUrl ?? process.env.EXPO_PUBLIC_API_URL ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!/^https?:\/\//.test(baseUrl.trim())) return setError('Nhập địa chỉ backend dạng https://api.shop-cua-ban.com');
    if (!email || !password) return setError('Nhập email và mật khẩu');
    setBusy(true);
    try {
      await signIn(baseUrl, email, password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không đăng nhập được');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: 8, marginBottom: space.md }}>
            <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="bag-handle" size={34} color="#fff" />
            </View>
            <Txt size="xl" bold>
              Woo Admin
            </Txt>
            <Txt muted style={{ textAlign: 'center' }}>
              Quản lý đơn hàng, sản phẩm và doanh số cửa hàng WooCommerce
            </Txt>
          </View>
          {notice ? <Banner tone="warn" icon="lock-closed-outline" title="Hết phiên đăng nhập" text={notice} /> : null}
          <Card style={{ gap: space.lg }}>
            <Field
              label="Địa chỉ backend"
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder="https://api.shop-cua-ban.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              hint="Địa chỉ HTTPS của backend bạn triển khai trên VPS (không phải địa chỉ website)."
            />
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
            <Field label="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} />
            {error ? <Banner tone="danger" icon="alert-circle" text={error} /> : null}
            <Button title="Đăng nhập" icon="log-in-outline" onPress={submit} loading={busy} />
          </Card>
          <Card style={{ gap: space.md }}>
            <Txt bold>Chưa có backend?</Txt>
            <Txt muted>Xem giao diện với đơn túi xách, giày và phụ kiện mẫu. Dữ liệu demo tách hoàn toàn khỏi shop thật.</Txt>
            <Button title="Xem bản demo" icon="flask-outline" variant="secondary" onPress={startDemo} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
