import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useEngagement, useMe } from '@/lib/queries';
import { colors } from '@/lib/theme';
import { GemPill } from './gamify';
import { Bump } from './motion';
import { Icon } from './ui';

/** The flame grows with the streak: 3, 7 and 30 days are milestones. */
function StreakPill({ days, atRisk }: { days: number; atRisk: boolean }) {
  const active = days > 0;
  const size = days >= 30 ? 19 : days >= 7 ? 17 : days >= 3 ? 15 : 13;
  return (
    <View className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${active ? 'bg-streak-tint' : 'bg-border'} ${atRisk ? 'border border-streak' : ''}`}>
      <Icon name="flame" size={size} color={active ? colors.streakDark : colors.muted} />
      <Text className={`text-xs font-bold ${active ? 'text-streak-dark' : 'text-muted'}`}>
        {days} {days === 1 ? 'day' : 'days'}
      </Text>
    </View>
  );
}

/** Brand row with the streak (opens streak details) and gems (opens the shop). Both bump when they grow. */
export function AppHeader() {
  const me = useMe();
  const engagement = useEngagement();
  const streak = me.data?.streak.current ?? 0;
  const atRisk = streak > 0 && !me.data?.streak.studied_today;
  const gems = engagement.data?.gems ?? 0;
  return (
    <View className="flex-row items-center justify-between pt-1">
      <Text className="text-ink text-[22px] font-extrabold">CertPath</Text>
      <View className="flex-row items-center gap-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${streak}-day streak${atRisk ? ', study today to keep it' : ''}. Streak details`}
          onPress={() => router.push('/streak')}
          className="min-h-[44px] justify-center px-0.5"
        >
          <Bump value={streak}>
            <StreakPill days={streak} atRisk={atRisk} />
          </Bump>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${gems} gems. Shop`} onPress={() => router.push('/shop')} className="min-h-[44px] justify-center px-0.5">
          <Bump value={gems} to={1.15}>
            <GemPill gems={gems} />
          </Bump>
        </Pressable>
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
