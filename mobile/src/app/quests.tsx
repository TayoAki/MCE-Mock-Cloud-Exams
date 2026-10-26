import { useState } from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ChestButton, ChestModal, QuestRow, chestRewardText, nextMidnight, timeLeft } from '@/components/gamify';
import { riseIn } from '@/components/motion';
import { BackButton, Body, Card, ErrorState, Eyebrow, Icon, LoadingState, ProgressBar, Screen, Small, Title } from '@/components/ui';
import { useQuests } from '@/lib/queries';
import { colors } from '@/lib/theme';

/** Today's three quests, the chest they unlock and the monthly challenge. */
export default function Quests() {
  const quests = useQuests();
  const [chestOpen, setChestOpen] = useState(false);
  const q = quests.data;
  const done = q?.quests.filter((x) => x.done).length ?? 0;
  const monthName = q ? new Date(`${q.monthly.month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long' }) : '';
  const reward = q?.chest.reward ? chestRewardText(q.chest.reward) : null;

  return (
    <Screen>
      <BackButton />
      <View className="gap-1">
        <Eyebrow>Daily quests · resets in {timeLeft(nextMidnight())}</Eyebrow>
        <Title>{done === 3 ? 'All done today!' : `${done} of 3 quests done`}</Title>
        <Body muted>Finish all three to open today’s chest.</Body>
      </View>
      {quests.isLoading ? <LoadingState /> : null}
      {quests.error ? <ErrorState error={quests.error} onRetry={() => quests.refetch()} /> : null}
      {q ? (
        <>
          <Card className="gap-4">
            {q.quests.map((quest, i) => (
              <Animated.View key={quest.key} entering={riseIn(i * 80)}>
                <QuestRow quest={quest} />
              </Animated.View>
            ))}
          </Card>

          {q.chest.available ? (
            <ChestButton onPress={() => setChestOpen(true)} />
          ) : q.chest.opened && reward ? (
            <Card tone="mint" className="flex-row items-center gap-3">
              <Icon name={reward.icon} size={26} color={colors.success} />
              <View className="flex-1">
                <Text className="text-success text-[15px] font-bold">Chest opened: {reward.title}</Text>
                <Small>A new chest waits behind tomorrow’s quests.</Small>
              </View>
            </Card>
          ) : (
            <Card className="flex-row items-center gap-3">
              <View className="h-11 w-11 rounded-[12px] bg-border items-center justify-center">
                <Icon name="gift" size={24} color={colors.muted} />
              </View>
              <View className="flex-1">
                <Text className="text-ink text-[15px] font-bold">Today’s chest is locked</Text>
                <Small>Gems, a double-XP boost or a streak freeze.</Small>
              </View>
            </Card>
          )}

          <Card className="gap-2.5">
            <View className="flex-row items-center gap-2">
              <Icon name="calendar" size={20} color={colors.primary} />
              <Text className="flex-1 text-ink text-[16px] font-extrabold">{monthName} challenge</Text>
              <Text className="text-muted text-[13px] font-bold">
                {q.monthly.progress}/{q.monthly.target}
              </Text>
            </View>
            <ProgressBar value={q.monthly.progress / q.monthly.target} label={`${monthName} challenge progress`} />
            <Small>
              {q.monthly.progress >= q.monthly.target
                ? `Badge earned. See you in next month’s challenge.`
                : `Complete ${q.monthly.target} quests this month for the ${monthName} badge and 100 gems.`}
            </Small>
          </Card>
          <Small className="text-center">Quests size themselves to your daily goal, so there’s always a doable one.</Small>
        </>
      ) : null}
      <ChestModal visible={chestOpen} onClose={() => setChestOpen(false)} />
    </Screen>
  );
}
