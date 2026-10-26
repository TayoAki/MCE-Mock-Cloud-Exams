import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { DomainBar } from '@/components/DomainBar';
import { LevelBar } from '@/components/gamify';
import { Banner, Body, Button, Card, ErrorState, Eyebrow, LoadingState, NavRow, Pill, Screen, Small, Title } from '@/components/ui';
import { useAchievements, useCurrentEnrollment, useEngagement, useExams, useProgress } from '@/lib/queries';
import { useStartSession } from '@/lib/sessions';

/** S11: coverage and first-seen evidence with denominators. No pass probability. */
export default function ProgressTab() {
  const { enrollment, data: me } = useCurrentEnrollment();
  const progress = useProgress(enrollment?.id);
  const exams = useExams();
  const engagement = useEngagement();
  const achievements = useAchievements();
  const { start, pending, error } = useStartSession();

  useFocusEffect(
    useCallback(() => {
      if (enrollment?.id) progress.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enrollment?.id]),
  );

  const p = progress.data;
  const exam = exams.data?.find((e) => e.id === enrollment?.exam_id);
  const enoughOverall = p ? p.first_seen_total >= p.min_ranking_sample : false;
  const pct = p && p.first_seen_total ? Math.round((p.first_seen_correct / p.first_seen_total) * 100) : 0;
  const mock = p?.latest_mock;

  return (
    <Screen>
      <AppHeader />
      <View className="gap-1">
        <Eyebrow>{exam ? `${exam.title} · Your progress` : 'Your progress'}</Eyebrow>
        <Title>See what’s improving.</Title>
        <Body muted>Evidence from practice, one topic at a time.</Body>
      </View>
      {progress.isLoading ? <LoadingState /> : null}
      {progress.error ? <ErrorState error={progress.error} onRetry={() => progress.refetch()} /> : null}
      {p ? (
        <>
          <View className="flex-row gap-3">
            <Card className="flex-1 gap-1">
              <Text className="text-ink text-[28px] font-extrabold">{enoughOverall ? `${pct}%` : '—'}</Text>
              <Small>
                {enoughOverall ? `accuracy on ${p.first_seen_total} new questions` : `Not enough practice yet (${p.first_seen_total} of ${p.min_ranking_sample} new questions)`}
              </Small>
            </Card>
            <Card className="flex-1 gap-1">
              <Text className="text-ink text-[28px] font-extrabold">
                {p.practiced_objectives}/{p.total_objectives}
              </Text>
              <Small>objectives practiced</Small>
            </Card>
          </View>

          <Card className="flex-row items-center justify-between">
            <View className="gap-0.5 flex-1">
              <Text className="text-ink text-[16px] font-bold">{mock ? (mock.sample ? 'Latest sample mock' : 'Latest full mock') : 'No mock yet'}</Text>
              <Small>{mock ? `${Math.round((mock.correct / mock.total) * 100)}% correct · practice score` : 'Try a sample when you have covered a few units.'}</Small>
            </View>
            {mock ? <Pill tone="primary" label={`${mock.correct} / ${mock.total}`} /> : null}
          </Card>

          <Card className="gap-3">
            <Text className="text-ink text-[17px] font-extrabold">Where to focus next</Text>
            {p.domains.map((d) => (
              <DomainBar key={d.domain_id} title={d.title} correct={d.first_seen_correct} total={d.first_seen_total} hidePercent={!d.enough_practice} />
            ))}
            {p.focus ? (
              <Small>
                {p.focus.reason === 'low_accuracy'
                  ? `Focus: ${p.focus.title} (${p.focus.first_seen_correct}/${p.focus.first_seen_total} on new questions).`
                  : `Focus: ${p.focus.title}. You haven't practised it much yet (${p.focus.first_seen_total} new questions), and its domain carries real weight.`}
              </Small>
            ) : null}
            {error ? <Banner tone="error">{error.message}</Banner> : null}
            <Button label="Focus weak topic" variant="secondary" loading={pending === 'weakest'} onPress={() => start({ enrollment_id: enrollment?.id, mode: 'weakest' })} />
          </Card>

          <Card className="gap-1">
            <Text className="text-ink text-[16px] font-bold">Repeated questions</Text>
            <Small>
              {p.repeat_total ? `${p.repeat_correct}/${p.repeat_total} correct on questions you had seen before. Counted separately so repeats don't inflate new-question accuracy.` : 'No repeats yet.'}
            </Small>
          </Card>

          <Card className="gap-3">
            {engagement.data ? <LevelBar level={engagement.data.level} /> : <Text className="text-ink text-[16px] font-bold">Activity</Text>}
            <Small>
              {me?.xp_total ?? 0} XP · {me?.streak.current ?? 0}-day streak · longest {me?.streak.longest ?? 0}. XP, levels and streaks measure showing up, not readiness.
            </Small>
          </Card>
          <NavRow
            icon="ribbon-outline"
            title="Badges"
            subtitle={achievements.data ? `${achievements.data.badges.filter((b) => b.earned_at).length} of ${achievements.data.badges.length} earned` : undefined}
            onPress={() => router.push('/achievements')}
          />
          <NavRow icon="flame-outline" title="Streak" subtitle={`${me?.streak.current ?? 0} days · freezes, amulet and wagers`} onPress={() => router.push('/streak')} />
          <NavRow icon="diamond-outline" title="Shop" subtitle={engagement.data ? `${engagement.data.gems} gems to spend` : undefined} onPress={() => router.push('/shop')} />

          <Card tone="mint" className="gap-2">
            <Text className="text-success text-[16px] font-bold">Passing is the goal.</Text>
            <Text className="text-ink text-[14px]">Record the outcome and pause reminders after your exam.</Text>
            <NavRow title="Record my exam result" icon="ribbon-outline" onPress={() => router.push('/outcome')} />
          </Card>
          <Small className="text-center">{p.note}</Small>
        </>
      ) : null}
    </Screen>
  );
}
