import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Minimal shared UI for the functional Phase 1 screens. */

export const C = {
  bg: '#0f1219',
  panel: '#171c26',
  border: '#28303d',
  text: '#f2f5fa',
  muted: '#93a0b4',
  dim: '#6b7687',
  blue: '#2354e6',
  link: '#8ab4ff',
  green: '#3fbf7f',
  amber: '#e0a33a',
  red: '#e05252',
};

export function Screen({
  title,
  back = true,
  children,
  scroll = true,
  footer,
}: {
  title: string;
  back?: boolean;
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[s.content, { flex: 1 }]}>{children}</View>
  );
  return (
    <View style={s.screen}>
      <View style={s.header}>
        {back ? (
          <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
            <Text style={s.backText}>‹</Text>
          </Pressable>
        ) : null}
        <Text style={s.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {body}
      {footer ? <View style={[s.footer, { paddingBottom: 12 + insets.bottom }]}>{footer}</View> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [s.btn, s[kind], off && s.off, pressed && !off && s.pressed, style]}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={[s.btnText, kind === 'ghost' && { color: C.link }]}>{label}</Text>}
    </Pressable>
  );
}

export function Panel({ title, children, tone }: { title?: string; children: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const border = tone === 'good' ? C.green : tone === 'warn' ? C.amber : tone === 'bad' ? C.red : C.border;
  return (
    <View style={[s.panel, { borderColor: border }]}>
      {title ? <Text style={s.panelTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={[s.fieldValue, mono && s.mono]} selectable>
        {value}
      </Text>
    </View>
  );
}

export function Note({ children, tone }: { children: ReactNode; tone?: 'bad' | 'warn' }) {
  return <Text style={[s.note, tone === 'bad' && { color: C.red }, tone === 'warn' && { color: C.amber }]}>{children}</Text>;
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 6,
  },
  back: { paddingHorizontal: 8 },
  backText: { color: C.text, fontSize: 30, lineHeight: 30 },
  title: { color: C.text, fontSize: 18, fontWeight: '700', flex: 1 },
  content: { padding: 16, gap: 12 },
  footer: { paddingHorizontal: 16, paddingTop: 10, gap: 8, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg },
  btn: { borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  primary: { backgroundColor: C.blue },
  secondary: { backgroundColor: '#2a3242' },
  danger: { backgroundColor: '#8a2a2a' },
  ghost: { backgroundColor: 'transparent' },
  off: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  panel: { backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  panelTitle: { color: C.muted, fontSize: 12.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  field: { gap: 2 },
  fieldLabel: { color: C.dim, fontSize: 12.5 },
  fieldValue: { color: C.text, fontSize: 15 },
  mono: { fontFamily: 'monospace', fontSize: 12.5 },
  note: { color: C.muted, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 10 },
});
