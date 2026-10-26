import { router } from 'expo-router';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { nextMidnight, timeLeft } from '@/components/gamify';
import { Pulse, popIn, riseIn } from '@/components/motion';
import { BackButton, Banner, Button, Card, ErrorState, Icon, LoadingState, NavRow, ProgressBar, Screen, Small } from '@/components/ui';
import { WeekDots } from '@/components/WeekDots';
import { useEngagement, useFriendStreaks, useMe } from '@/lib/queries';
import { colors } from '@/lib/theme';

const MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];

const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });

/** The streak in detail: this week, what protects it, the next milestone and friend streaks. */
export default function Streak() {
  const me = useMe();
  const engagement = useEngagement();
  const friends = useFriendStreaks();
  if (me.isLoading) return <Screen><LoadingState /></Screen>;
  if (me.error || !me.data) return <Screen><ErrorState error={me.error} onRetry={() => me.refetch()} /></Screen>;

  const s = me.data.streak;
  const e = engagement.data;
  const atRisk = s.current > 0 && !s.studied_today;
  const next = MILESTONES.find((m) => m > s.current) ?? null;
  const previous = [...MILESTONES].reverse().find((m) => m <= s.current) ?? 0;
  const activeFriends = (friends.data ?? []).filter((f) => f.status === 'active');
  const wagerDay = e?.wager?.status === 'active' ? Math.min(7, Math.round((Date.parse(`${s.today}T12:00:00`) - Date.parse(`${e.wager.started_on}T12:00:00`)) / 86_400_000) + 1) : 0;

  return (
    <Screen>
      <BackButton />
      <View className="items-center gap-1 pb-1">
        <Pulse active={atRisk}>
          <Animated.View entering={popIn(80)} className={`h-28 w-28 rounded-full items-center justify-center ${s.current ? 'bg-streak-tint' : 'bg-border'}`}>
            <Icon name="flame" size={64} color={s.current ? colors.streak : colors.muted} />
          </Animated.View>
        </Pulse>
        <Text accessibilityRole="header" className="text-ink text-[34px] font-extrabold">
          {s.current}-day streak
        </Text>
        <Small>{`Longest: ${s.longest} ${s.longest === 1 ? 'day' : 'days'}`}</Small>
      </View>

      {atRisk ? (
        <Banner tone="warn" title={`Study in the next ${timeLeft(nextMidnight())} to keep it`}>
          {e?.freezes ? `If you can't, one of your ${e.freezes} streak freezes covers today.` : 'One lesson is enough. About five minutes.'}
        </Banner>
      ) : s.studied_today ? (
        <Banner tone="success" title="Today counts">{`Come back tomorrow to make it ${s.current + 1}.`}</Banner>
      ) : (
        <Banner tone="info" title="Start a new streak today">Day one is the hardest. One short lesson does it.</Banner>
      )}

      <Card className="gap-3">
        <Text className="text-ink text-[16px] font-extrabold">This week</Text>
        <WeekDots week={s.week} />
      </Card>

      {next ? (
        <Animated.View entering={riseIn(80)}>
          <Card className="gap-2">
            <View className="flex-row items-center gap-2">
              <Icon name="ribbon" size={20} color={colors.streakDark} />
              <Text className="flex-1 text-ink text-[16px] font-extrabold">Next milestone: {next} days</Text>
              <Text className="text-muted text-[13px] font-bold">{next - s.current} to go</Text>
            </View>
            <ProgressBar value={(s.current - previous) / (next - previous)} tone="streak" label={`${s.current} of ${next} days`} />
          </Card>
        </Animated.View>
      ) : null}

      <Text className="text-muted text-xs font-bold uppercase tracking-wider pt-1">Streak protection</Text>
      {e ? (
        <Card className="gap-3">
          {e.repair ? (
            <>
              <View className="flex-row items-center gap-3">
                <Icon name="bandage" size={22} color={colors.coralDark} />
                <Text className="flex-1 text-ink text-[15px]">
                  Your {e.repair.days}-day streak can be repaired until {day(e.repair.until)}.
                </Text>
              </View>
              <Button label={`Repair for ${e.repair.price} gems`} icon="diamond" onPress={() => router.push('/shop')} />
            </>
          ) : null}
          <View className="flex-row items-center gap-3">
            <Icon name="snow" size={22} color={colors.gemDark} />
            <Text className="flex-1 text-ink text-[15px]">Streak freezes</Text>
            <View className="flex-row gap-1">
              {Array.from({ length: e.max_freezes }, (_, i) => (
                <View key={i} className={`h-7 w-7 rounded-full items-center justify-center ${i < e.freezes ? 'bg-gem-tint border-2 border-gem' : 'bg-border'}`}>
                  <Icon name="snow" size={13} color={i < e.freezes ? colors.gemDark : colors.muted} />
                </View>
              ))}
            </View>
          </View>
          <View className="flex-row items-center gap-3">
            <Icon name="shield-checkmark" size={22} color={colors.primary} />
            <Text className="flex-1 text-ink text-[15px]">Weekend amulet</Text>
            <Text className={`text-[13px] font-bold ${e.amulet ? 'text-success' : 'text-muted'}`}>{e.amulet ? 'Active' : 'Not active'}</Text>
          </View>
          <View className="flex-row items-center gap-3">
            <Icon name="trophy" size={22} color={colors.streakDark} />
            <Text className="flex-1 text-ink text-[15px]">Streak wager</Text>
            <Text className={`text-[13px] font-bold ${wagerDay ? 'text-success' : 'text-muted'}`}>{wagerDay ? `Day ${wagerDay} of 7` : 'None running'}</Text>
          </View>
          <Button label="Visit the shop" variant="secondary" icon="diamond" onPress={() => router.push('/shop')} />
        </Card>
      ) : null}

      <NavRow
        icon="people-outline"
        title={activeFriends.length ? `${activeFriends.length} friend ${activeFriends.length === 1 ? 'streak' : 'streaks'}` : 'Friend streaks'}
        subtitle={
          activeFriends.length
            ? activeFriends.map((f) => `${f.friend.name}: ${f.current} ${f.current === 1 ? 'day' : 'days'}`).join(' · ')
            : 'Keep a streak going with someone from your study circle'
        }
        onPress={() => router.push('/friends')}
      />
      <Small className="text-center">Streaks measure showing up, not exam readiness.</Small>
    </Screen>
  );
}
