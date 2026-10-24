import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, type PressableProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/lib/api';
import { colors } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 20, color = colors.ink }: { name: IconName; size?: number; color?: ComponentProps<typeof Ionicons>['color'] }) {
  // Icons are decorative; the surrounding control carries the accessible name.
  return <Ionicons name={name} size={size} color={color} aria-hidden />;
}

/** Page shell: safe-area padding, scrolling content and an optional pinned footer. */
export function Screen({
  children,
  footer,
  scroll = true,
  padded = true,
}: {
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const content = <View className={padded ? 'px-5 pb-6 gap-4' : ''}>{children}</View>;
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {scroll ? (
        <ScrollView className="flex-1" contentContainerClassName="pt-3" keyboardShouldPersistTaps="handled">
          {content}
        </ScrollView>
      ) : (
        <View className="flex-1 pt-3">{content}</View>
      )}
      {footer ? (
        <View className="px-5 pt-3 bg-background border-t border-border gap-2" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

export function Eyebrow({ children, tone = 'primary' }: { children: ReactNode; tone?: 'primary' | 'muted' | 'success' | 'coral' }) {
  const color = { primary: 'text-primary', muted: 'text-muted', success: 'text-success', coral: 'text-coral-dark' }[tone];
  return <Text className={`${color} text-xs font-bold uppercase tracking-wider`}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" className="text-ink text-[28px] leading-[34px] font-extrabold">
      {children}
    </Text>
  );
}

export function Body({ children, muted, className = '' }: { children: ReactNode; muted?: boolean; className?: string }) {
  return <Text className={`${muted ? 'text-muted' : 'text-ink'} text-[15px] leading-[22px] ${className}`}>{children}</Text>;
}

export function Small({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <Text className={`text-muted text-[13px] leading-[18px] ${className}`}>{children}</Text>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  accessibilityHint,
}: {
  label: string;
  onPress?: PressableProps['onPress'];
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  accessibilityHint?: string;
}) {
  const inactive = disabled || loading;
  const styles: Record<ButtonVariant, { box: string; text: string; icon: string }> = {
    primary: { box: 'bg-primary border-b-4 border-primary-dark active:bg-primary-dark', text: 'text-white', icon: '#FFFFFF' },
    secondary: { box: 'bg-surface border-2 border-primary active:bg-primary-tint', text: 'text-primary', icon: colors.primary },
    ghost: { box: 'bg-transparent active:bg-primary-tint', text: 'text-primary', icon: colors.primary },
    danger: { box: 'bg-surface border-2 border-coral active:bg-coral-tint', text: 'text-coral-dark', icon: colors.coralDark },
  };
  const s = styles[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      aria-disabled={!!inactive} aria-busy={!!loading}
      disabled={inactive}
      onPress={onPress}
      className={`min-h-[52px] rounded-[15px] px-5 flex-row items-center justify-center gap-2 ${s.box} ${inactive ? 'opacity-50' : ''}`}
    >
      {loading ? <ActivityIndicator color={s.icon} /> : icon ? <Icon name={icon} size={18} color={s.icon} /> : null}
      <Text className={`${s.text} text-[16px] font-bold`}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, className = '', tone = 'surface' }: { children: ReactNode; className?: string; tone?: 'surface' | 'tint' | 'mint' | 'coral' | 'primary' }) {
  const bg = {
    surface: 'bg-surface border border-border',
    tint: 'bg-primary-tint',
    mint: 'bg-mint',
    coral: 'bg-coral-tint',
    primary: 'bg-primary',
  }[tone];
  return <View className={`rounded-[20px] p-4 ${bg} ${className}`}>{children}</View>;
}

export function Pill({ label, tone = 'primary', icon }: { label: string; tone?: 'primary' | 'streak' | 'mint' | 'muted' | 'coral'; icon?: IconName }) {
  const t = {
    primary: { box: 'bg-primary-tint', text: 'text-primary-dark', icon: colors.primaryDark },
    streak: { box: 'bg-streak-tint', text: 'text-streak-dark', icon: colors.streakDark },
    mint: { box: 'bg-mint', text: 'text-success', icon: colors.success },
    muted: { box: 'bg-border', text: 'text-muted', icon: colors.muted },
    coral: { box: 'bg-coral-tint', text: 'text-coral-dark', icon: colors.coralDark },
  }[tone];
  return (
    <View className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${t.box}`}>
      {icon ? <Icon name={icon} size={13} color={t.icon} /> : null}
      <Text className={`${t.text} text-xs font-bold`}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ value, tone = 'primary', label }: { value: number; tone?: 'primary' | 'success'; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      className="h-2.5 rounded-full bg-primary-tint overflow-hidden"
    >
      <View className={`h-full rounded-full ${tone === 'success' ? 'bg-success' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
    </View>
  );
}

export function Banner({ tone, title, children, icon }: { tone: 'info' | 'success' | 'warn' | 'error'; title?: string; children?: ReactNode; icon?: IconName }) {
  const t = {
    info: { box: 'bg-primary-tint', title: 'text-primary-dark', icon: colors.primaryDark, def: 'information-circle' as const },
    success: { box: 'bg-mint', title: 'text-success', icon: colors.success, def: 'checkmark-circle' as const },
    warn: { box: 'bg-streak-tint', title: 'text-streak-dark', icon: colors.streakDark, def: 'time' as const },
    error: { box: 'bg-coral-tint', title: 'text-coral-dark', icon: colors.coralDark, def: 'alert-circle' as const },
  }[tone];
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : undefined} className={`rounded-2xl p-3.5 flex-row gap-2.5 ${t.box}`}>
      <Icon name={icon ?? t.def} size={20} color={t.icon} />
      <View className="flex-1 gap-0.5">
        {title ? <Text className={`${t.title} text-[15px] font-bold`}>{title}</Text> : null}
        {typeof children === 'string' ? <Text className="text-ink text-[14px] leading-5">{children}</Text> : children}
      </View>
    </View>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <View accessibilityLabel={label} className="gap-3 pt-2">
      <View className="h-6 w-1/3 rounded-lg bg-border" />
      <View className="h-9 w-3/4 rounded-lg bg-border" />
      <View className="h-28 rounded-[20px] bg-border" />
      <View className="h-16 rounded-[20px] bg-border" />
      <View className="h-16 rounded-[20px] bg-border" />
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message : 'Something went wrong.';
  return (
    <View className="gap-3 pt-4">
      <Banner tone="error" title={error instanceof ApiError && error.isNetwork ? 'No connection' : "Couldn't load this"}>
        {message}
      </Banner>
      {onRetry ? <Button label="Try again" variant="secondary" icon="refresh" onPress={onRetry} /> : null}
    </View>
  );
}

export function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <View className={`flex-row items-center gap-3 ${className}`}>{children}</View>;
}

/** A tappable list/card row with a chevron, at least 44pt tall. */
export function NavRow({ title, subtitle, onPress, icon, right, disabled }: { title: string; subtitle?: string; onPress?: () => void; icon?: IconName; right?: ReactNode; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-[56px] flex-row items-center gap-3 rounded-[20px] bg-surface border border-border px-4 py-3 active:bg-primary-tint ${disabled ? 'opacity-60' : ''}`}
    >
      {icon ? (
        <View className="h-9 w-9 rounded-full bg-primary-tint items-center justify-center">
          <Icon name={icon} size={18} color={colors.primary} />
        </View>
      ) : null}
      <View className="flex-1 gap-0.5">
        <Text className="text-ink text-[15px] font-bold">{title}</Text>
        {subtitle ? <Text className="text-muted text-[13px]">{subtitle}</Text> : null}
      </View>
      {right ?? <Icon name="chevron-forward" size={18} color={colors.muted} />}
    </Pressable>
  );
}

export function Divider() {
  return <View className="h-px bg-border" />;
}
