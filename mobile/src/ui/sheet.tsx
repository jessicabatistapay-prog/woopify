import React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../lib/theme';
import { Txt } from './kit';

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(16,24,40,0.4)' }} onPress={onClose} accessibilityLabel="Đóng" />
      <View style={{ backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, paddingBottom: 36, maxHeight: '85%' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.md }}>
          <Txt bold size="lg" style={{ flex: 1 }}>
            {title}
          </Txt>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng" hitSlop={12}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView>{children}</ScrollView>
      </View>
    </Modal>
  );
}

