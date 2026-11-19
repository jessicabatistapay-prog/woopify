import React, { useEffect, useState } from 'react';
import { Keyboard, Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../lib/theme';
import { Txt } from './kit';

/**
 * Chiều cao bàn phím đang che màn hình.
 * - iOS/Android: sự kiện Keyboard của React Native
 * - Web trên điện thoại (Safari/Chrome): visualViewport co lại khi bàn phím mở
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      if (!vv) return;
      const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
      return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      };
    }
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setInset(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return inset;
}

/** Bảng trượt từ dưới lên; tự nâng lên trên bàn phím để ô nhập và nút lưu luôn nhìn thấy */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const kb = useKeyboardInset();
  const { height } = useWindowDimensions();
  // Android (adjustResize) đã tự thu nhỏ cửa sổ; iOS và web cần tự chừa chỗ
  const lift = Platform.OS === 'android' ? 0 : kb;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.4)' }} onPress={onClose} accessibilityLabel="Đóng" />
      <View
        style={{
          backgroundColor: colors.card,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          padding: space.lg,
          paddingBottom: lift ? space.md : 36,
          marginBottom: lift,
          maxHeight: Math.max(240, (height - lift) * 0.88),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.md }}>
          <Txt bold size="lg" style={{ flex: 1 }}>
            {title}
          </Txt>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng" hitSlop={12}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </Modal>
  );
}
