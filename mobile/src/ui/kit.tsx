import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, space } from '../lib/theme';
import { STATUS_TONE, statusLabel } from '../lib/format';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function Card({ children, style, onPress, accessibilityLabel }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void; accessibilityLabel?: string }) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.card, style, pressed && { opacity: 0.85 }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}

export function Txt({ children, style, muted, bold, size, numberOfLines, selectable }: { children: React.ReactNode; style?: TextStyle | TextStyle[]; muted?: boolean; bold?: boolean; size?: keyof typeof font; numberOfLines?: number; selectable?: boolean }) {
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[{ color: muted ? colors.textMuted : colors.text, fontSize: font[size ?? 'sm'], fontWeight: bold ? '700' : '400', lineHeight: font[size ?? 'sm'] * 1.35 }, style as TextStyle]}
    >
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
  accessibilityHint,
  compact,
}: {
  compact?: boolean;
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
}) {
  const v = {
    primary: { bg: colors.primary, fg: colors.primaryText, border: colors.primary },
    secondary: { bg: colors.card, fg: colors.text, border: colors.border },
    danger: { bg: colors.danger, fg: '#fff', border: colors.danger },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        compact && { paddingHorizontal: space.md, gap: 6 },
        { backgroundColor: v.bg, borderColor: v.border, opacity: off ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : icon ? <Ionicons name={icon} size={20} color={v.fg} /> : null}
      <Text style={{ color: v.fg, fontSize: compact ? font.sm : font.md, fontWeight: '600', flexShrink: 1 }} numberOfLines={2}>
        {title}
      </Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, badge }: { icon: IconName; label: string; onPress: () => void; badge?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={10} style={{ padding: 8 }}>
      <Ionicons name={icon} size={25} color={colors.text} />
      {badge ? (
        <View style={styles.badge}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function StatusBadge({ status, label, large, center }: { status: string; label?: string; large?: boolean; center?: boolean }) {
  const tone = STATUS_TONE[status] ?? { bg: '#F2F4F7', fg: '#344054', icon: 'ellipse-outline' };
  return (
    <View style={[styles.badgePill, { backgroundColor: tone.bg }, large && { paddingVertical: 6, paddingHorizontal: 12 }, center && { alignSelf: 'center' }]} accessibilityLabel={`Trạng thái: ${label ?? statusLabel(status)}`}>
      <Ionicons name={tone.icon as IconName} size={large ? 16 : 14} color={tone.fg} />
      <Text style={{ color: tone.fg, fontSize: large ? font.sm : font.xs, fontWeight: '600' }}>{label ?? statusLabel(status)}</Text>
    </View>
  );
}

export function PaidBadge({ paid }: { paid: boolean }) {
  return (
    <View style={[styles.badgePill, { backgroundColor: paid ? '#DDF3E4' : '#FFF4D6' }]}>
      <Ionicons name={paid ? 'card' : 'card-outline'} size={14} color={paid ? '#0F5C2E' : '#7A5200'} />
      <Text style={{ color: paid ? '#0F5C2E' : '#7A5200', fontSize: font.xs, fontWeight: '600' }}>{paid ? 'Đã thanh toán' : 'Chưa thanh toán'}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress, count }: { label: string; selected?: boolean; onPress: () => void; count?: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[styles.chip, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
    >
      <Text style={{ color: selected ? '#fff' : colors.text, fontSize: font.sm, fontWeight: '600' }}>
        {label}
        {count !== undefined ? ` · ${count}` : ''}
      </Text>
    </Pressable>
  );
}

export function Field({ label, hint, error, ...props }: TextInputProps & { label: string; hint?: string; error?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: font.sm, fontWeight: '600', color: colors.text }}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textSubtle}
        accessibilityLabel={label}
        {...props}
        style={[styles.input, error ? { borderColor: colors.danger } : null, props.multiline && { minHeight: 96, textAlignVertical: 'top' }, props.style]}
      />
      {error ? <Text style={{ color: colors.danger, fontSize: font.xs }}>{error}</Text> : hint ? <Text style={{ color: colors.textSubtle, fontSize: font.xs }}>{hint}</Text> : null}
    </View>
  );
}

export function SearchBar({ value, onChangeText, placeholder }: { value: string; onChangeText: (s: string) => void; placeholder: string }) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={20} color={colors.textSubtle} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSubtle}
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={{ flex: 1, fontSize: font.md, color: colors.text, paddingVertical: 10 }}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} accessibilityLabel="Xóa tìm kiếm" hitSlop={10}>
          <Ionicons name="close-circle" size={20} color={colors.textSubtle} />
        </Pressable>
      ) : null}
    </View>
  );
}

type BannerTone = 'info' | 'warn' | 'danger' | 'demo';
export function Banner({ tone, icon, title, text, action }: { tone: BannerTone; icon?: IconName; title?: string; text: string; action?: { label: string; onPress: () => void } }) {
  const t = {
    info: [colors.infoSoft, colors.info],
    warn: [colors.warnSoft, colors.warn],
    danger: [colors.dangerSoft, colors.danger],
    demo: [colors.demoSoft, colors.demo],
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t[0] }]} accessibilityRole="alert">
      <Ionicons name={icon ?? 'information-circle'} size={20} color={t[1]} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={{ color: t[1], fontWeight: '700', fontSize: font.sm }}>{title}</Text> : null}
        <Text style={{ color: t[1], fontSize: font.sm, lineHeight: 20 }}>{text}</Text>
      </View>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={8}>
          <Text style={{ color: t[1], fontWeight: '700', fontSize: font.sm, textDecorationLine: 'underline' }}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Loading({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.primary} />
      <Txt muted>{label}</Txt>
    </View>
  );
}

export function EmptyState({ icon = 'file-tray-outline', title, text, action }: { icon?: IconName; title: string; text?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.center}>
      <Ionicons name={icon} size={44} color={colors.textSubtle} />
      <Txt bold size="md" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {text ? (
        <Txt muted style={{ textAlign: 'center' }}>
          {text}
        </Txt>
      ) : null}
      {action ? <Button title={action.label} onPress={action.onPress} variant="secondary" /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: { kind: string; message: string }; onRetry: () => void }) {
  const offline = error.kind === 'network' || error.kind === 'timeout';
  return (
    <EmptyState
      icon={offline ? 'cloud-offline-outline' : 'warning-outline'}
      title={offline ? 'Mất kết nối' : error.kind === 'woo' ? 'Không kết nối được website' : 'Có lỗi xảy ra'}
      text={error.message}
      action={{ label: 'Thử lại', onPress: onRetry }}
    />
  );
}

export function Row({ label, value, strong, onPress, icon }: { label: string; value?: React.ReactNode; strong?: boolean; onPress?: () => void; icon?: IconName }) {
  const content = (
    <View style={styles.row}>
      {icon ? <Ionicons name={icon} size={20} color={colors.textMuted} /> : null}
      <Text style={{ flex: 1, fontSize: font.sm, color: strong ? colors.text : colors.textMuted, fontWeight: strong ? '700' : '400' }}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={{ fontSize: font.sm, color: colors.text, fontWeight: strong ? '700' : '500', textAlign: 'right', flexShrink: 1 }}>{value}</Text>
      ) : (
        value
      )}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} /> : null}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {content}
    </Pressable>
  ) : (
    content
  );
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 }} />;
}

export function Thumb({ uri, label, size = 48 }: { uri: string | null | undefined; label: string; size?: number }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: colors.border }} accessibilityIgnoresInvertColors />;
  const initials = label
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: size / 3 }}>{initials}</Text>
    </View>
  );
}

export function PressRow(props: PressableProps & { children: React.ReactNode }) {
  return <Pressable {...props} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]} />;
}

export const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md, marginBottom: space.xs },
  sectionTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  button: { minHeight: 50, borderRadius: radius.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, borderWidth: 1 },
  badge: { position: 'absolute', top: 2, right: 0, backgroundColor: colors.danger, borderRadius: 10, minWidth: 19, height: 19, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 9, alignSelf: 'flex-start' },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: font.md, color: colors.text, backgroundColor: colors.card },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 },
  banner: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: radius.md, alignItems: 'flex-start' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md, minHeight: 260 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10, minHeight: 44 },
});
