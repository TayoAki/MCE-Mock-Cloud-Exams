import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { BadgeMedal } from '@/components/gamify';
import { popIn } from '@/components/motion';
import { BackButton, Body, Card, ErrorState, Eyebrow, LoadingState, ProgressBar, Screen, Small, Title } from '@/components/ui';
import { useAchievements } from '@/lib/queries';
import type { Badge } from '@/lib/types';

const GROUPS: { key: Badge['group']; title: string }[] = [
  { key: 'habit', title: 'Habit' },
  { key: 'learning', title: 'Learning' },
  { key: 'practice', title: 'Practice' },
  { key: 'social', title: 'Together' },
  { key: 'league', title: 'Leagues' },
];

function Grid({ badges }: { badges: Badge[] }) {
  return (
    <View className="flex-row flex-wrap -mx-1">
      {badges.map((b, i) => (
        <Animated.View key={b.key} entering={popIn(Math.min(i, 8) * 40)} className="w-1/3 px-1 pb-3">
          <BadgeMedal badge={b} />
        </Animated.View>
      ))}
    </View>
  );
}

/** Every badge, earned or still to earn, plus monthly challenge badges. */
export default function Achievements() {
  const achievements = useAchievements();
  const data = achievements.data;
  const earned = data?.badges.filter((b) => b.earned_at).length ?? 0;
  const total = data?.badges.length ?? 0;

  return (
    <Screen>
      <BackButton />
      <View className="gap-1">
        <Eyebrow>Badges</Eyebrow>
        <Title>{data ? `${earned} of ${total} earned` : 'Badges'}</Title>
        <Body muted>Each new badge comes with 20 gems.</Body>
      </View>
      {achievements.isLoading ? <LoadingState /> : null}
      {achievements.error ? <ErrorState error={achievements.error} onRetry={() => achievements.refetch()} /> : null}
      {data ? (
        <>
          <ProgressBar value={total ? earned / total : 0} tone="streak" label={`${earned} of ${total} badges earned`} />
          {GROUPS.map((g) => {
            const badges = data.badges.filter((b) => b.group === g.key);
            if (!badges.length) return null;
            return (
              <Card key={g.key} className="gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-ink text-[16px] font-extrabold">{g.title}</Text>
                  <Small>
                    {badges.filter((b) => b.earned_at).length}/{badges.length}
                  </Small>
                </View>
                <Grid badges={badges} />
              </Card>
            );
          })}
          <Card className="gap-3">
            <Text className="text-ink text-[16px] font-extrabold">Monthly challenges</Text>
            {data.monthly.length ? <Grid badges={data.monthly} /> : <Small>Complete 30 daily quests in a month to earn that month’s badge.</Small>}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
