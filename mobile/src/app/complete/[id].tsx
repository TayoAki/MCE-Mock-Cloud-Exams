import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Cube } from '@/components/Cube';
import { Banner, Button, Card, ErrorState, Eyebrow, LoadingState, NavRow, Pill, Screen, Small } from '@/components/ui';
import { WeekDots } from '@/components/WeekDots';
import { trackEvent } from '@/lib/analytics';
import { get } from '@/lib/api';
import { enableReminders } from '@/lib/notifications';
import { useMe, useRefreshLearning } from '@/lib/queries';
import type { Completion } from '@/lib/types';

const MODE_LABEL: Record<string, string> = {
  lesson: 'Daily lesson complete',
  checkpoint: 'Checkpoint complete',
  review: 'Review complete',
  missed: 'Missed questions revisited',
  weakest: 'Focused practice complete',
  quick: 'Quick 5 complete',
  timed: 'Timed quiz complete',
  custom: 'Custom quiz complete',
};

/** S06: activity XP and streak; the reward is effort, not readiness. */
export default function Complete() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const refresh = useRefreshLearning();
  const result = useQuery({ queryKey: ['results', id], queryFn: () => get<Completion>(`/sessions/${id}/results`) });
  const me = useMe();
  const [reminder, setReminder] = useState<'idle' | 'busy' | 'enabled' | 'denied' | 'unavailable'>('idle');

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

  return (
    <Screen footer={<Button label="Back to my path" onPress={() => router.dismissTo('/learn')} />}>
      <View className="items-center gap-3 pt-2">
        <Eyebrow>{MODE_LABEL[c.mode] ?? 'Practice complete'}</Eyebrow>
        <Cube size={112} mood="proud" />
        <Text accessibilityRole="header" className="text-ink text-[26px] font-extrabold text-center">
          {c.study_day_credited ? 'You showed up. That counts.' : 'Extra practice, well spent.'}
        </Text>
        <Text className="text-primary text-[40px] font-extrabold" accessibilityLabel={`${c.xp_granted} XP earned`}>
          +{c.xp_granted} XP
        </Text>
        <Text className="text-muted text-[15px]">
          {c.correct} of {c.total} correct{c.mode === 'lesson' ? ' on the first try' : ''}
        </Text>
      </View>

      {me.data ? (
        <Card className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-ink text-[18px] font-extrabold">
              {me.data.streak.current}-day streak
            </Text>
            {c.study_day_credited ? <Pill tone="streak" label="Keep going" /> : <Pill tone="muted" label="Today already counted" />}
          </View>
          <WeekDots week={me.data.streak.week} />
        </Card>
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

      {firstLesson && me.data && !me.data.plus_active && !me.data.preview_used ? (
        <NavRow icon="sparkles-outline" title="Try 14 days of Plus" subtitle="No card. No automatic renewal." onPress={() => router.push('/premium')} />
      ) : null}

      <Small className="text-center">XP tracks activity. It is not an exam score.</Small>
    </Screen>
  );
}
