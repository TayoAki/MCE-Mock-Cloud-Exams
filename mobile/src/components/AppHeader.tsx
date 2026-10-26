import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useMe } from '@/lib/queries';
import { colors } from '@/lib/theme';
import { Bump } from './motion';
import { Icon, Pill } from './ui';

/** The flame grows with the streak: 3, 7 and 30 days are milestones. */
function StreakPill({ days }: { days: number }) {
  const active = days > 0;
  const size = days >= 30 ? 19 : days >= 7 ? 17 : days >= 3 ? 15 : 13;
  return (
    <View accessibilityLabel={`${days}-day streak`} className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${active ? 'bg-streak-tint' : 'bg-border'}`}>
      <Icon name="flame" size={size} color={active ? colors.streakDark : colors.muted} />
      <Text className={`text-xs font-bold ${active ? 'text-streak-dark' : 'text-muted'}`}>
        {days} {days === 1 ? 'day' : 'days'}
      </Text>
    </View>
  );
}

/** Brand row with activity pills (streak and XP measure activity, not readiness). They bump when they grow. */
export function AppHeader() {
  const me = useMe();
  const streak = me.data?.streak.current ?? 0;
  const xp = me.data?.xp_total ?? 0;
  return (
    <View className="flex-row items-center justify-between pt-1">
      <Text className="text-ink text-[22px] font-extrabold">CertPath</Text>
      <View className="flex-row items-center gap-2">
        <Bump value={streak}>
          <StreakPill days={streak} />
        </Bump>
        <Bump value={xp} to={1.15}>
          <Pill tone="primary" label={`${xp} XP`} />
        </Bump>
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
