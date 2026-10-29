import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { Banner, Body, Button, Eyebrow, ErrorState, Icon, LoadingState, NavRow, Pill, Screen, Title, type IconName } from '@/components/ui';
import { useCurrentEnrollment, useFlags, usePractice, useStories } from '@/lib/queries';
import { useStartSession } from '@/lib/sessions';
import { colors } from '@/lib/theme';
import type { SessionMode } from '@/lib/types';

const RESUME_LABEL: Partial<Record<SessionMode, string>> = {
  lesson: 'lesson',
  story: 'story',
  qotd: 'Question of the Day',
  flagged: 'flagged quiz',
  levelup: 'Level Up round',
  review: 'review',
  missed: 'missed questions',
  weakest: 'weakest topics',
  quick: 'Quick 5',
  timed: 'timed quiz',
  custom: 'custom quiz',
};

function Tile({ icon, title, subtitle, onPress, plus, busy }: { icon: IconName; title: string; subtitle: string; onPress: () => void; plus?: boolean; busy?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}${plus ? '. Plus feature' : ''}`}
      aria-busy={!!busy}
      onPress={onPress}
      className="flex-1 min-h-[112px] rounded-[20px] bg-surface border border-border p-4 gap-2 active:bg-primary-tint"
    >
      <View className="flex-row justify-between items-start">
        <View className="h-9 w-9 rounded-full bg-primary-tint items-center justify-center">
          <Icon name={icon} size={18} color={colors.primary} />
        </View>
        {plus ? <Pill tone="primary" label="Plus" /> : null}
      </View>
      <Text className="text-ink text-[15px] font-bold">{title}</Text>
      <Text className="text-muted text-[12px]">{subtitle}</Text>
    </Pressable>
  );
}

/** S07: clear alternate modes, mock size and due review. */
export default function Practice() {
  const { enrollment, isLoading, error } = useCurrentEnrollment();
  const practice = usePractice(enrollment?.id);
  const stories = useStories(enrollment?.id);
  const flags = useFlags(enrollment?.id);
  const { start, pending, error: startError, clearError } = useStartSession();

  useFocusEffect(
    useCallback(() => {
      if (enrollment?.id) {
        practice.refetch();
        stories.refetch();
        flags.refetch();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enrollment?.id]),
  );

  const p = practice.data;
  const plus = (feature: string) => !!p && !p.features.includes(feature as never);
  const go = (mode: SessionMode) => {
    clearError();
    start({ enrollment_id: enrollment?.id, mode });
  };

  return (
    <Screen>
      <AppHeader />
      <View className="gap-1">
        <Eyebrow>Your exam toolbox</Eyebrow>
        <Title>Make practice count.</Title>
        <Body muted>Choose what you need today.</Body>
      </View>
      {isLoading || practice.isLoading ? <LoadingState /> : null}
      {error || practice.error ? <ErrorState error={error ?? practice.error} onRetry={() => practice.refetch()} /> : null}
      {p ? (
        <>
          {p.active_sessions.map((s) => (
            <NavRow
              key={s.id}
              icon="play"
              title={`Resume ${s.mode === 'mock' ? (s.sample ? 'sample mock' : 'mock exam') : (RESUME_LABEL[s.mode] ?? 'practice')}`}
              subtitle={`${s.answered_count} of ${s.question_count} answered${s.deadline_at ? ' · timer running' : ''}`}
              onPress={() => router.push(s.mode === 'story' ? `/story/${s.id}` : `/session/${s.id}`)}
            />
          ))}
          {startError ? (
            <Banner tone={startError.code === 'nothing_missed' || startError.code === 'nothing_due' || startError.code === 'qotd_done' ? 'success' : 'error'}>{startError.message}</Banner>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quick 5. Five fresh questions"
            onPress={() => go('quick')}
            className="min-h-[88px] flex-row items-center gap-4 rounded-[20px] bg-primary border-b-4 border-primary-dark px-5 active:bg-primary-dark"
          >
            <View className="h-11 w-11 rounded-full bg-white items-center justify-center">
              <Icon name={pending === 'quick' ? 'hourglass' : 'chevron-forward'} size={22} color={colors.primary} />
            </View>
            <View className="gap-0.5">
              <Text className="text-white text-[20px] font-extrabold">Quick 5</Text>
              <Text className="text-white/80 text-[13px]">Five fresh questions</Text>
            </View>
          </Pressable>
          <View className="flex-row gap-3">
            <Tile icon="arrow-undo" title="Missed questions" subtitle={`${p.missed_count} to revisit`} onPress={() => go('missed')} busy={pending === 'missed'} />
            <Tile icon="trending-up" title="Weakest topics" subtitle="Focus on your gaps" onPress={() => go('weakest')} busy={pending === 'weakest'} />
          </View>
          <View className="flex-row gap-3">
            <Tile icon="podium-outline" title="Level Up" subtitle="Harder, one subject at a time" onPress={() => router.push('/level-up')} />
            <Tile
              icon="bookmark-outline"
              title="Flagged"
              subtitle={flags.data?.items.length ? `${flags.data.items.length} saved · quiz them` : 'Save questions to revisit'}
              onPress={() => router.push('/flagged')}
            />
          </View>
          <View className="flex-row gap-3">
            <Tile icon="timer-outline" title="Timed quiz" subtitle="Build your pace" plus={plus('custom_quiz')} onPress={() => router.push('/custom?mode=timed')} />
            <Tile icon="options-outline" title="Custom quiz" subtitle="Choose your topics" plus={plus('custom_quiz')} onPress={() => router.push('/custom?mode=custom')} />
          </View>
          {stories.data?.length ? (
            <View className="gap-2.5">
              <Text className="text-muted text-xs font-bold uppercase tracking-wider pt-1">Stories</Text>
              {stories.data.map((story) => (
                <Pressable
                  key={story.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Story: ${story.title}. ${story.summary} ${story.question_count} questions${story.completed ? '. Finished' : ''}`}
                  onPress={() => {
                    if (story.active_session_id) router.push(`/story/${story.active_session_id}`);
                    else start({ enrollment_id: enrollment?.id, mode: 'story', story_id: story.id });
                  }}
                  className="flex-row gap-3 rounded-[20px] bg-surface border border-border p-4 active:bg-primary-tint"
                >
                  <View className="h-12 w-12 rounded-[14px] bg-streak-tint items-center justify-center">
                    <Icon name={story.completed ? 'checkmark-done' : 'book'} size={24} color={colors.streakDark} />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text className="text-ink text-[16px] font-extrabold">{story.title}</Text>
                    <Text className="text-muted text-[13px] leading-[18px]">{story.summary}</Text>
                    <Text className="text-primary text-[12px] font-bold pt-0.5">
                      {story.completed ? 'Finished · read again' : story.active_session_id ? 'Continue' : `${story.question_count} decisions · about 4 min`}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
          <NavRow
            icon="document-text-outline"
            title="Mock exam"
            subtitle={`${p.mock.full_form_size} questions · ${p.mock.duration_minutes} minutes`}
            onPress={() => router.push('/mock-setup')}
          />
          <Button label={`Review due · ${p.due_review_count}`} variant="secondary" icon="refresh" onPress={() => router.push('/review')} />
        </>
      ) : null}
    </Screen>
  );
}
