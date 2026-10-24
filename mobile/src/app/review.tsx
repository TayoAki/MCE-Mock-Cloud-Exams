import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Cube } from '@/components/Cube';
import { Banner, Body, Button, Card, ErrorState, Icon, LoadingState, Pill, Screen, Small, Title } from '@/components/ui';
import { useCurrentEnrollment, useReviews } from '@/lib/queries';
import { useStartSession } from '@/lib/sessions';
import { colors } from '@/lib/theme';

function dueLabel(iso: string) {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `In ${days} days`;
}

/** S08: due concepts first, with a meaningful empty state. Review is always free. */
export default function Review() {
  const { enrollment } = useCurrentEnrollment();
  const reviews = useReviews(enrollment?.id);
  const { start, pending, error } = useStartSession();
  const r = reviews.data;

  return (
    <Screen
      footer={
        r && r.due_count > 0 ? (
          <>
            {error ? <Banner tone="error">{error.message}</Banner> : null}
            <Button label="Start a 5-question review" loading={pending === 'review'} onPress={() => start({ enrollment_id: enrollment?.id, mode: 'review' })} />
          </>
        ) : (
          <Button label="Practice a new lesson" variant="secondary" onPress={() => router.dismissTo('/learn')} />
        )
      }
    >
      <View className="flex-row items-center justify-between">
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} className="h-11 w-11 justify-center">
          <Icon name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Pill tone="primary" label="Spaced practice" />
      </View>
      <Title>A little review. A stronger memory.</Title>
      <Body muted>Revisit the ideas that need another look.</Body>
      {reviews.isLoading ? <LoadingState /> : null}
      {reviews.error ? <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} /> : null}
      {r ? (
        <>
          <Card tone="tint" className="flex-row items-center justify-between">
            <View className="gap-1">
              <Text className="text-primary text-[40px] font-extrabold">{r.due_count}</Text>
              <Text className="text-ink text-[15px] font-semibold">{r.due_count === 1 ? 'review due today' : 'reviews due today'}</Text>
            </View>
            <Cube size={84} mood={r.due_count ? 'thinking' : 'happy'} />
          </Card>
          {r.due_count === 0 ? (
            <Banner tone="success" title="You're caught up.">
              {r.upcoming.length ? 'Your next review is scheduled. Keep learning in the meantime.' : 'Missed questions come back here the next day.'}
            </Banner>
          ) : null}
          {r.due.map((e) => (
            <Card key={e.objective_id} className="gap-1">
              <Text className="text-ink text-[16px] font-bold">{e.title}</Text>
              <Text className="text-muted text-[13px]">{e.domain_title}</Text>
            </Card>
          ))}
          {r.upcoming.length ? (
            <View className="gap-2">
              <Text className="text-muted text-xs font-bold uppercase tracking-wider">Coming up</Text>
              {r.upcoming.map((e) => (
                <View key={e.objective_id} className="flex-row justify-between rounded-[16px] bg-surface border border-border px-4 py-3">
                  <Text className="text-ink text-[14px] flex-1" numberOfLines={1}>{e.title}</Text>
                  <Text className="text-muted text-[13px]">{dueLabel(e.due_at)}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Small>Get a concept right and it returns after 1, 3, 7, then 14 days. A miss brings it back tomorrow, ideally as a fresh scenario.</Small>
        </>
      ) : null}
    </Screen>
  );
}
