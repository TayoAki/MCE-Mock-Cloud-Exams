import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, Keyframe } from 'react-native-reanimated';
import { Cube } from '@/components/Cube';
import { ChestButton, ChestModal, LevelBar, QuestRow, StatTile, TIER_STYLE, TierBadge } from '@/components/gamify';
import { Confetti, CountUp, riseIn } from '@/components/motion';
import { LevelPips, NextStepCard, PeerLine } from '@/components/study';
import { Banner, Button, Card, ErrorState, Eyebrow, Icon, LoadingState, NavRow, Pill, Screen, Small } from '@/components/ui';
import { WeekDots } from '@/components/WeekDots';
import { trackEvent } from '@/lib/analytics';
import { get } from '@/lib/api';
import { holdCelebrations } from '@/lib/celebrations';
import { feedback as play } from '@/lib/feedback';
import { enableReminders } from '@/lib/notifications';
import { useCurrentEnrollment, useMe, useQotd, useRefreshLearning } from '@/lib/queries';
import { colors } from '@/lib/theme';
import type { Completion, LeagueStanding } from '@/lib/types';

const MODE_LABEL: Record<string, string> = {
  lesson: 'Daily lesson complete',
  checkpoint: 'Checkpoint complete',
  review: 'Review complete',
  missed: 'Missed questions revisited',
  weakest: 'Focused practice complete',
  quick: 'Quick 5 complete',
  timed: 'Timed quiz complete',
  custom: 'Custom quiz complete',
  story: 'Story complete',
  qotd: 'Question of the Day',
  flagged: 'Flagged quiz complete',
  levelup: 'Level Up round complete',
};

// The celebration's beats, in ms after the results arrive.
const BEAT = { title: 300, xp: 550, detail: 900, stats: 1000, streakCard: 1350, ignite: 1700, stamp: 1900, level: 2100, quests: 2350, league: 2600, done: 3100 } as const;

function duration(seconds: number | null) {
  if (seconds === null) return '—';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function leagueLine(l: LeagueStanding) {
  const tier = TIER_STYLE[l.tier].label;
  if (l.previous_rank === null) return `You joined the ${tier} League at #${l.rank}`;
  if (l.previous_rank > l.rank) return `Up ${l.previous_rank - l.rank} to #${l.rank} in ${tier}`;
  return `#${l.rank} of ${l.size} in ${tier}`;
}

const stampIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 2.4 }] },
  100: { opacity: 1, transform: [{ scale: 1 }] },
})
  .duration(320)
  .delay(BEAT.stamp);

/** S06: activity XP and streak; the reward is effort, not readiness. */
export default function Complete() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const refresh = useRefreshLearning();
  const result = useQuery({ queryKey: ['results', id], queryFn: () => get<Completion>(`/sessions/${id}/results`) });
  const me = useMe();
  const { enrollment } = useCurrentEnrollment();
  const qotdView = useQotd(result.data?.mode === 'qotd' ? enrollment?.id : undefined);
  const [reminder, setReminder] = useState<'idle' | 'busy' | 'enabled' | 'denied' | 'unavailable'>('idle');
  const [skip, setSkip] = useState(false);
  const [chestOpen, setChestOpen] = useState(false);
  const [chestTaken, setChestTaken] = useState(false);
  const queryClient = useQueryClient();

  // Sound and haptics play once, when the result first arrives.
  const celebrated = useRef(false);
  const credited = !!result.data?.study_day_credited;
  useEffect(() => {
    if (!result.data || celebrated.current) return;
    celebrated.current = true;
    // Level-ups and badges from this session play after this screen's own sequence.
    holdCelebrations(BEAT.done + 900);
    queryClient.invalidateQueries({ queryKey: ['celebrations'] });
    play.complete();
    if (!credited) return;
    const timer = setTimeout(play.streak, BEAT.ignite);
    return () => clearTimeout(timer);
  }, [result.data, credited, queryClient]);

  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showReminderPrompt = !!me.data && !me.data.preferences.reminders_enabled && result.data?.study_day_credited;
  useEffect(() => {
    if (showReminderPrompt) trackEvent('reminder_prompt_viewed');
  }, [showReminderPrompt]);

  if (result.isLoading) return <Screen><LoadingState label="Saving your result" /></Screen>;
  if (result.error || !result.data) return <Screen><ErrorState error={result.error} onRetry={() => result.refetch()} /></Screen>;
  const c = result.data;
  const firstLesson = c.mode === 'lesson' && c.xp_granted > 0;
  const perfect = c.total >= 5 && c.correct === c.total;
  const g = c.engagement;
  const lu = c.level_up;
  const headline = lu
    ? lu.passed
      ? lu.level === 4
        ? `${lu.domain_title} mastered!`
        : `Level ${lu.level} passed!`
      : 'So close. Try again?'
    : c.qotd
      ? c.qotd.correct
        ? 'You got today’s question!'
        : 'Answered. Your streak lives on.'
      : perfect
        ? 'Perfect lesson!'
        : c.study_day_credited
          ? 'You showed up. That counts.'
          : 'Extra practice, well spent.';

  return (
    <View className="flex-1">
    <Screen footer={<Button label="Back to my path" onPress={() => router.dismissTo('/learn')} />}>
      {/* Tapping the hero skips the count-up. */}
      <Pressable accessible={false} onPress={() => setSkip(true)} className="items-center gap-3 pt-2">
        <Eyebrow>{MODE_LABEL[c.mode] ?? 'Practice complete'}</Eyebrow>
        <Cube size={112} mood={perfect || c.study_day_credited || lu?.passed || c.qotd?.correct ? 'cheer' : 'proud'} motion="jump" />
        <Animated.View entering={FadeInDown.delay(BEAT.title).duration(380)}>
          <Text accessibilityRole="header" className="text-ink text-[26px] font-extrabold text-center">
            {headline}
          </Text>
        </Animated.View>
        <View accessible accessibilityLabel={`${c.xp_granted} XP earned`}>
          <CountUp to={c.xp_granted} prefix="+" suffix=" XP" delay={BEAT.xp} skip={skip} className="text-primary text-[40px] font-extrabold" />
        </View>
        <Animated.View entering={FadeIn.delay(BEAT.detail).duration(300)}>
          <Text className="text-muted text-[15px]">
            {c.correct} of {c.total} correct{c.mode === 'lesson' ? ' on the first try' : ''}
          </Text>
        </Animated.View>
      </Pressable>

      {g ? (
        <View className="flex-row gap-2.5">
          <StatTile icon="locate" label="Accuracy" value={`${g.accuracy}%`} color={colors.success} tint={colors.mint} delay={BEAT.stats} />
          <StatTile icon="time" label="Time" value={duration(g.duration_seconds)} color={colors.primary} tint={colors.primaryTint} delay={BEAT.stats + 120} />
          <StatTile icon="diamond" label="Gems" value={`+${g.gems_earned}`} color={colors.gemDark} tint={colors.gemTint} delay={BEAT.stats + 240} />
        </View>
      ) : null}

      {lu ? (
        <Animated.View entering={riseIn(BEAT.stats + 200)}>
          <Card tone={lu.passed ? 'mint' : 'surface'} className="gap-2.5">
            <View className="flex-row items-center gap-2">
              <Icon name={lu.passed ? 'trending-up' : 'refresh'} size={20} color={lu.passed ? colors.success : colors.primary} />
              <Text className="flex-1 text-ink text-[16px] font-extrabold" numberOfLines={2}>
                {lu.domain_title}
              </Text>
            </View>
            <LevelPips passed={lu.mastered ? 4 : lu.passed ? lu.level : lu.level - 1} current={lu.next_level?.level ?? lu.level} />
            <Text className="text-ink text-[14px] leading-[20px]">
              {lu.passed
                ? lu.next_level
                  ? `Level ${lu.level}: ${lu.label} done with ${lu.correct} of ${lu.total}. Level ${lu.next_level.level}: ${lu.next_level.label} is unlocked.`
                  : `You’ve reached Mastery in this domain with ${lu.correct} of ${lu.total}.`
                : `${lu.correct} of ${lu.total} on Level ${lu.level}: ${lu.label}. You need ${lu.needed} to pass.`}
            </Text>
          </Card>
        </Animated.View>
      ) : null}

      {c.qotd ? (
        <Animated.View entering={riseIn(BEAT.stats + 200)}>
          <View className="rounded-[20px] bg-gem-tint p-4 gap-2">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Icon name="sunny" size={20} color={colors.gemDark} />
                <Text className="text-ink text-[18px] font-extrabold">{c.qotd.streak}-day question streak</Text>
              </View>
              {c.qotd.streak >= c.qotd.longest && c.qotd.streak > 1 ? <Pill tone="streak" icon="flame" label="Best yet" /> : null}
            </View>
            <PeerLine peer={qotdView.data?.result?.peer} qotd />
            <Small>Same question for every learner today. A new one arrives tomorrow.</Small>
          </View>
        </Animated.View>
      ) : null}

      {enrollment ? <NextStepCard sessionId={c.session_id} enrollmentId={enrollment.id} delay={BEAT.stats + 400} /> : null}

      {me.data && !c.qotd ? (
        <Animated.View entering={riseIn(BEAT.streakCard)}>
          <Card className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-ink text-[18px] font-extrabold">
                {me.data.streak.current}-day streak
              </Text>
              {c.study_day_credited ? (
                <Animated.View entering={stampIn}>
                  <View className="rounded-lg border-2 border-streak px-2 py-0.5" style={{ transform: [{ rotate: '-6deg' }] }}>
                    <Text className="text-streak-dark text-[13px] font-extrabold uppercase tracking-wider">Today counts</Text>
                  </View>
                </Animated.View>
              ) : (
                <Pill tone="muted" label="Today already counted" />
              )}
            </View>
            <WeekDots week={me.data.streak.week} igniteTodayAt={c.study_day_credited ? BEAT.ignite : undefined} />
          </Card>
        </Animated.View>
      ) : null}

      {g ? (
        <Animated.View entering={riseIn(BEAT.level)}>
          <Card className="gap-2">
            {g.level.leveled_up ? (
              <View className="flex-row">
                <Pill tone="primary" icon="arrow-up" label="Level up!" />
              </View>
            ) : null}
            <LevelBar level={g.level} from={g.level.leveled_up ? 0 : (g.level.xp - c.xp_granted - g.level.floor) / Math.max(1, g.level.next - g.level.floor)} delay={BEAT.level + 300} />
          </Card>
        </Animated.View>
      ) : null}

      {g?.quests.length ? (
        <Animated.View entering={riseIn(BEAT.quests)}>
          <Card className="gap-3">
            <Text className="text-ink text-[16px] font-extrabold">Daily quests</Text>
            {g.quests.map((q, i) => (
              <QuestRow key={q.key} quest={q} delay={BEAT.quests + 300 + i * 120} />
            ))}
            {g.chest_available && !chestTaken ? <ChestButton onPress={() => setChestOpen(true)} /> : null}
          </Card>
        </Animated.View>
      ) : null}

      {g?.league ? (
        <Animated.View entering={riseIn(BEAT.league)}>
          <NavRow
            title={leagueLine(g.league)}
            subtitle={g.league.rank <= g.league.promote ? 'In the promotion zone' : `${g.league.xp} XP this week`}
            right={
              <View className="flex-row items-center gap-2">
                {g.league.previous_rank !== null && g.league.previous_rank > g.league.rank ? <Icon name="arrow-up" size={18} color={colors.success} /> : null}
                <TierBadge tier={g.league.tier} size={36} />
              </View>
            }
            onPress={() => router.push('/league')}
          />
        </Animated.View>
      ) : null}

      {c.correct < c.total ? (
        <Card tone="mint" className="gap-1">
          <Text className="text-success text-[16px] font-bold">Make it stick</Text>
          <Text className="text-ink text-[14px]">Missed concepts enter your review queue for tomorrow.</Text>
        </Card>
      ) : null}

      {me.data?.user.is_guest ? (
        <NavRow icon="cloud-upload-outline" title="Save your progress" subtitle="Create an account to keep your streak on any device" onPress={() => router.push('/account')} />
      ) : null}

      {showReminderPrompt && reminder !== 'enabled' ? (
        <Card className="gap-2">
          <Text className="text-ink text-[16px] font-bold">Want a gentle daily reminder?</Text>
          <Small>One reminder at 9 pm on days you haven’t studied. Change or turn it off any time.</Small>
          {reminder === 'denied' ? <Banner tone="info">Notifications are off for CertPath. You can allow them in system settings.</Banner> : null}
          <Button
            label="Remind me"
            variant="secondary"
            loading={reminder === 'busy'}
            onPress={async () => {
              setReminder('busy');
              setReminder(await enableReminders().catch(() => 'denied' as const));
              me.refetch();
            }}
          />
        </Card>
      ) : null}
      {reminder === 'enabled' || reminder === 'unavailable' ? <Banner tone="success">Reminder saved. We’ll skip it on days you’ve already studied.</Banner> : null}

      {firstLesson && me.data?.plus_enabled && !me.data.plus_active && !me.data.preview_used ? (
        <NavRow icon="sparkles-outline" title="Try 14 days of Plus" subtitle="No card. No automatic renewal." onPress={() => router.push('/premium')} />
      ) : null}

      <Small className="text-center">XP tracks activity. It is not an exam score.</Small>
    </Screen>
    {perfect || c.study_day_credited || lu?.newly_passed ? <Confetti count={perfect || lu?.newly_passed ? 90 : 60} /> : null}
    <ChestModal visible={chestOpen} onClose={() => setChestOpen(false)} onOpened={() => setChestTaken(true)} />
    </View>
  );
}
