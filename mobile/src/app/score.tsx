import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { DeltaPill, ScoreRing, Sparkline } from '@/components/insights';
import { riseIn } from '@/components/motion';
import { BackButton, Banner, Button, Card, ErrorState, Eyebrow, LoadingState, ProgressBar, Screen, Small } from '@/components/ui';
import { useCurrentEnrollment, useScore } from '@/lib/queries';
import { useStartSession } from '@/lib/sessions';

/** The CertPath Score in detail: trend, domain breakdown, method and what it is not. */
export default function ScoreScreen() {
  const { enrollment, data: me } = useCurrentEnrollment();
  const score = useScore(enrollment?.id);
  const { start, pending, error } = useStartSession();
  const s = score.data;
  return (
    <Screen>
      <BackButton />
      {score.isLoading ? <LoadingState /> : null}
      {score.error ? <ErrorState error={score.error} onRetry={() => score.refetch()} /> : null}
      {s ? (
        <>
          <View className="items-center gap-2">
            <Eyebrow>CertPath Score</Eyebrow>
            <ScoreRing score={s.score} max={s.max} size={150} stroke={14} />
            <Text accessibilityRole="header" className="text-ink text-[24px] font-extrabold">
              {s.band}
            </Text>
            <DeltaPill delta={s.delta_7d} />
          </View>

          <Card className="gap-2">
            <Text className="text-ink text-[16px] font-extrabold">Last 30 days</Text>
            <Sparkline points={s.history.map((h) => h.score)} width={300} />
          </Card>

          <Card className="gap-3">
            <Text className="text-ink text-[16px] font-extrabold">By exam domain</Text>
            {s.domains.map((d, i) => (
              <Animated.View key={d.domain_id} entering={riseIn(i * 50)} className="gap-1.5">
                <View className="flex-row items-baseline justify-between gap-2">
                  <Text className="flex-1 text-ink text-[14px] font-semibold">{d.title}</Text>
                  <Text className="text-muted text-[12px] font-bold">
                    {d.score} · {d.weight_percent}% of exam
                  </Text>
                </View>
                <ProgressBar value={d.score / 100} label={`${d.title}: ${d.score} of 100`} />
              </Animated.View>
            ))}
          </Card>

          {s.focus ? (
            <Card tone="tint" className="gap-2">
              <Text className="text-primary-dark text-[15px] font-bold">Biggest boost available: {s.focus.title}</Text>
              <Small>It carries real weight on the exam and has the most room to grow.</Small>
              {error ? <Banner tone="error">{error.message}</Banner> : null}
              <Button
                label={me?.plus_enabled ? 'Practise your weakest topics' : 'Practise this domain'}
                variant="secondary"
                loading={pending === 'custom' || pending === 'weakest'}
                onPress={() =>
                  // Custom quizzes are free while Plus is off, so the button can aim at the domain itself.
                  me?.plus_enabled
                    ? start({ enrollment_id: enrollment?.id, mode: 'weakest' })
                    : start({ enrollment_id: enrollment?.id, mode: 'custom', domain_ids: [s.focus!.domain_id], question_count: 5 })
                }
              />
            </Card>
          ) : null}

          <Card className="gap-1.5">
            <Text className="text-ink text-[15px] font-bold">How it works</Text>
            <Small>{s.method}</Small>
          </Card>
          <Small className="text-center">{s.note}</Small>
        </>
      ) : null}
    </Screen>
  );
}
