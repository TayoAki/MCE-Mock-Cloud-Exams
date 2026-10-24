import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useMe } from '@/lib/queries';
import { colors } from '@/lib/theme';
import { Icon, Pill } from './ui';

/** Brand row with activity pills (streak and XP measure activity, not readiness). */
export function AppHeader() {
  const me = useMe();
  const streak = me.data?.streak.current ?? 0;
  return (
    <View className="flex-row items-center justify-between pt-1">
      <Text className="text-ink text-[22px] font-extrabold">CertPath</Text>
      <View className="flex-row items-center gap-2">
        <Pill tone="streak" icon="flame" label={`${streak} ${streak === 1 ? 'day' : 'days'}`} />
        <Pill tone="primary" label={`${me.data?.xp_total ?? 0} XP`} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account and settings"
          onPress={() => router.push('/settings')}
          className="h-11 w-11 items-center justify-center rounded-full active:bg-primary-tint"
        >
          <Icon name="person-circle-outline" size={26} color={colors.ink} />
        </Pressable>
      </View>
    </View>
  );
}
