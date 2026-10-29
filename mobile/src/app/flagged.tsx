import { useQueryClient } from '@tanstack/react-query';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { riseIn } from '@/components/motion';
import { BackButton, Banner, Body, Button, Card, ErrorState, Eyebrow, Icon, LoadingState, Pill, Screen, Small, Title } from '@/components/ui';
import { del } from '@/lib/api';
import { useCurrentEnrollment, useFlags } from '@/lib/queries';
import { useStartSession } from '@/lib/sessions';
import { colors } from '@/lib/theme';
import type { FlagsView } from '@/lib/types';

const QUIZ_SIZE = 10;

/** The learner's bookmarked questions, and a quiz made of them. */
export default function Flagged() {
  const { enrollment } = useCurrentEnrollment();
  const flags = useFlags(enrollment?.id);
  const queryClient = useQueryClient();
  const { start, pending, error } = useStartSession();
  const f = flags.data;

  async function unflag(familyId: string) {
    queryClient.setQueryData<FlagsView>(['flags', enrollment?.id], (old) =>
      old ? { ...old, items: old.items.filter((i) => i.family_id !== familyId), quiz_available: old.items.filter((i) => i.family_id !== familyId && i.available).length } : old,
    );
    await del(`/flags/${familyId}`).catch(() => flags.refetch());
  }

  const count = f?.quiz_available ?? 0;
  return (
    <Screen
      footer={
        count > 0 ? (
          <Button
            label={`Quiz me on ${Math.min(count, QUIZ_SIZE)} flagged ${count === 1 ? 'question' : 'questions'}`}
            icon="play"
            loading={pending === 'flagged'}
            onPress={() => start({ enrollment_id: enrollment?.id, mode: 'flagged' })}
          />
        ) : undefined
      }
    >
      <BackButton />
      <View className="gap-1">
        <Eyebrow>Flagged questions</Eyebrow>
        <Title>{f?.items.length ? `${f.items.length} saved for later` : 'Nothing flagged yet'}</Title>
        <Body muted>Tap the bookmark on any question to save it here, then quiz yourself on just those.</Body>
      </View>
      {flags.isLoading ? <LoadingState /> : null}
      {flags.error ? <ErrorState error={flags.error} onRetry={() => flags.refetch()} /> : null}
      {error ? <Banner tone="error">{error.message}</Banner> : null}
      {f && f.items.length === 0 ? (
        <Card tone="tint" className="flex-row items-center gap-3">
          <Icon name="bookmark-outline" size={28} color={colors.primary} />
          <Text className="flex-1 text-ink text-[14px] leading-[20px]">Flag tricky questions as you practice. Unflag them once they feel easy.</Text>
        </Card>
      ) : null}
      {f?.items.map((item, i) => (
        <Animated.View key={item.family_id} entering={riseIn(Math.min(i, 6) * 60)} exiting={FadeOut.duration(180)} layout={LinearTransition}>
          <Card className="gap-2">
            <View className="flex-row items-center gap-2">
              <Text className="flex-1 text-muted text-[12px] font-bold uppercase tracking-wider" numberOfLines={1}>
                {item.domain_title}
              </Text>
              {item.last_correct === true ? <Pill tone="mint" icon="checkmark" label="Last: right" /> : item.last_correct === false ? <Pill tone="coral" icon="close" label="Last: missed" /> : null}
            </View>
            <Text className="text-ink text-[15px] leading-[21px] font-semibold" numberOfLines={4}>
              {item.prompt}
            </Text>
            <View className="flex-row items-center justify-between">
              <Small>{item.available ? item.objective_title : 'Being revised · not in quizzes for now'}</Small>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove from flagged: ${item.prompt}`}
                onPress={() => unflag(item.family_id)}
                className="min-h-[44px] flex-row items-center gap-1 px-2"
              >
                <Icon name="bookmark" size={16} color={colors.streak} />
                <Text className="text-muted text-[13px] font-bold">Unflag</Text>
              </Pressable>
            </View>
          </Card>
        </Animated.View>
      ))}
      {count > QUIZ_SIZE ? <Small className="text-center">Each quiz draws {QUIZ_SIZE} of your flagged questions at random.</Small> : null}
    </Screen>
  );
}
