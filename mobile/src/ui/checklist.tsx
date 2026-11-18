import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CheckResult, CheckStep } from '../api/types';
import { colors } from '../lib/theme';
import { Txt } from './kit';

const ICON: Record<CheckStep['level'], { name: any; color: string; text: string }> = {
  ok: { name: 'checkmark-circle', color: '#0F5C2E', text: 'Đạt' },
  warn: { name: 'alert-circle', color: colors.warn, text: 'Lưu ý' },
  error: { name: 'close-circle', color: colors.danger, text: 'Lỗi' },
  skipped: { name: 'remove-circle-outline', color: colors.textSubtle, text: 'Bỏ qua' },
};

export function CheckList({ result }: { result: CheckResult }) {
  return (
    <View style={{ gap: 12 }}>
      {result.steps.map((s) => (
        <View key={s.key} style={{ flexDirection: 'row', gap: 10 }} accessibilityLabel={`${s.label}: ${ICON[s.level].text}. ${s.message}`}>
          <Ionicons name={ICON[s.level].name} size={22} color={ICON[s.level].color} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt bold>
              {s.label} · <Txt style={{ color: ICON[s.level].color, fontWeight: '700' }}>{ICON[s.level].text}</Txt>
            </Txt>
            <Txt muted>{s.message}</Txt>
            {s.hint && s.level !== 'ok' ? (
              <Txt size="xs" style={{ color: colors.info }}>
                → {s.hint}
              </Txt>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

