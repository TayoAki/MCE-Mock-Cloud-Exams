import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { riseIn } from '@/components/motion';
import { LevelPips } from '@/components/study';
import { BackButton, Banner, Body, ErrorState, Eyebrow, Icon, LoadingState, Pill, Screen, Small, Title } from '@/components/ui';
import { useCurrentEnrollment, useLevelUp } from '@/lib/queries';
import { useStartSession } from '@/lib/sessions';
import { colors } from '@/lib/theme';

/** Level Up: one exam domain at a time, from Foundations to Mastery. */
export default function LevelUp() {
  const { enrollment } = useCurrentEnrollment();
  const levels = useLevelUp(enrollment?.id);
  const { start, pending, error } = useStartSession();
  const v = levels.data;
  const mastered = v?.domains.filter((d) => d.mastered).length ?? 0;

  return (
    <Screen>
      <BackButton />
      <View className="gap-1">
        <Eyebrow>Level Up</Eyebrow>
        <Title>One subject at a time.</Title>
        <Body muted>Each domain climbs from Foundations to Mastery. Get 4 of 5 right to unlock the next level.</Body>
      </View>
      {v ? (
        <View className="flex-row flex-wrap gap-1.5">
          {v.levels.map((l) => (
            <Pill key={l.level} tone={l.level === 4 ? 'streak' : 'primary'} label={`${l.level} · ${l.label}`} />
          ))}
        </View>
      ) : null}
      {levels.isLoading ? <LoadingState /> : null}
      {levels.error ? <ErrorState error={levels.error} onRetry={() => levels.refetch()} /> : null}
      {error ? <Banner tone="error">{error.message}</Banner> : null}
      {mastered > 0 ? (
        <Banner tone="success" icon="podium" title={`${mastered} ${mastered === 1 ? 'domain' : 'domains'} mastered`}>
          Mastery rounds mix your misses with the hardest questions. Replay them any time.
        </Banner>
      ) : null}
      {v?.domains.map((d, i) => {
        const best = d.best[String(d.current_level)];
        return (
          <Animated.View key={d.domain_id} entering={riseIn(i * 60)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${d.title}. ${d.mastered ? 'Mastered' : `Level ${d.current_level}, ${d.label}`}. ${d.locked ? 'Opens once your path reaches it.' : ''}`}
              aria-disabled={!d.available}
              aria-busy={pending === 'levelup'}
              disabled={!d.available || !!pending}
              onPress={() => start({ enrollment_id: enrollment?.id, mode: 'levelup', domain_ids: [d.domain_id] })}
              className={`rounded-[20px] bg-surface border border-border p-4 gap-2.5 active:bg-primary-tint ${d.available ? '' : 'opacity-60'}`}
            >
              <View className="flex-row items-center gap-3">
                <View className={`h-11 w-11 rounded-[14px] items-center justify-center ${d.mastered ? 'bg-streak-tint' : 'bg-primary-tint'}`}>
                  {d.locked ? (
                    <Icon name="lock-closed" size={20} color={colors.muted} />
                  ) : d.mastered ? (
                    <Icon name="podium" size={22} color={colors.streakDark} />
                  ) : (
                    <Text className="text-primary text-[18px] font-extrabold">{d.current_level}</Text>
                  )}
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className="text-ink text-[16px] font-extrabold">{d.title}</Text>
                  <Text className="text-muted text-[13px]">
                    {d.locked ? 'Opens once your path reaches it' : d.mastered ? 'Mastered · replay Mastery' : `Level ${d.current_level}: ${d.label}`}
                    {!d.locked && best !== undefined ? ` · best ${best}/5` : ''}
                  </Text>
                </View>
                {d.available ? <Icon name="chevron-forward" size={18} color={colors.muted} /> : null}
              </View>
              <View className="flex-row items-center justify-between">
                <LevelPips passed={d.level_passed} current={d.current_level} />
                <Small>{d.weight_percent}% of the exam</Small>
              </View>
            </Pressable>
          </Animated.View>
        );
      })}
      <Small className="text-center">Levels follow question difficulty: recall, then applying it, then tricky scenarios.</Small>
    </Screen>
  );
}
