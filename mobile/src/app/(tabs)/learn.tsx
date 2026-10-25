import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/AppHeader';
import { Cube } from '@/components/Cube';
import { Banner, Body, Button, Eyebrow, ErrorState, Icon, LoadingState, NavRow, Small, Title } from '@/components/ui';
import { useCurrentEnrollment, useExams, usePath, usePractice } from '@/lib/queries';
import { useStartSession } from '@/lib/sessions';
import { colors } from '@/lib/theme';
import type { LessonNode } from '@/lib/types';

const OFFSETS = [0, 44, 64, 44, 0, -44, -64, -44];

function Node({ lesson, index, current, upNext }: { lesson: LessonNode; index: number; current: boolean; upNext: boolean }) {
  const done = lesson.state === 'completed' || lesson.state === 'placed_out';
  const locked = lesson.state === 'locked';
  const size = current ? 72 : 60;
  const bg = done ? 'bg-success' : current ? 'bg-primary' : 'bg-locked';
  const icon = done ? 'checkmark' : lesson.kind === 'checkpoint' ? 'trophy' : current ? 'star' : 'lock-closed';
  const status = done ? 'Lesson complete' : current ? `${lesson.question_count} questions · about 5 min` : lesson.kind === 'checkpoint' ? 'Fresh scenarios' : upNext ? 'Up next' : '';
  return (
    <View className="flex-row items-center gap-4" style={{ marginLeft: 72 + (OFFSETS[index % OFFSETS.length] ?? 0) }}>
      <View
        accessibilityLabel={`${lesson.title}. ${done ? 'Completed' : current ? 'Current lesson' : 'Locked'}`}
        className={`items-center justify-center rounded-full ${bg} ${current ? 'border-4 border-primary-tint' : ''}`}
        style={{ width: size, height: size }}
      >
        <Icon name={icon} size={current ? 30 : 24} color={locked && !current ? colors.muted : '#FFFFFF'} />
      </View>
      <View className="flex-1">
        <Text className={`text-[15px] font-bold ${locked && !current ? 'text-muted' : 'text-ink'}`}>{lesson.title}</Text>
        {status ? <Text className="text-muted text-[12px]">{status}</Text> : null}
      </View>
    </View>
  );
}

/** S03: one current five-question lesson; completion unlocks the next step, not mastery. */
export default function Learn() {
  const insets = useSafeAreaInsets();
  const { enrollment, data: me, isLoading, error, refetch } = useCurrentEnrollment();
  const exams = useExams();
  const path = usePath(enrollment?.id);
  const practice = usePractice(enrollment?.id);
  const { start, pending, error: startError } = useStartSession();

  useFocusEffect(
    useCallback(() => {
      if (enrollment?.id) {
        path.refetch();
        practice.refetch();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enrollment?.id]),
  );

  const exam = exams.data?.find((e) => e.id === enrollment?.exam_id);
  const lessons = path.data?.lessons ?? [];
  const units = path.data?.units ?? [];
  const currentLessonId = path.data?.current_lesson_id ?? null;
  const current = lessons.find((l) => l.id === currentLessonId);
  const unitIndex = units.findIndex((u) => u.id === current?.unit_id);
  const currentUnit = units[unitIndex];
  const goal = me?.user.daily_goal_minutes ?? 5;
  const due = practice.data?.due_review_count ?? 0;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ScrollView
        contentContainerClassName="px-5 pt-3 pb-8 gap-4"
        refreshControl={<RefreshControl refreshing={path.isRefetching} onRefresh={async () => { await Promise.all([refetch(), path.refetch(), practice.refetch()]); }} />}
      >
        <AppHeader />
        {isLoading || path.isLoading ? <LoadingState /> : null}
        {error || path.error ? <ErrorState error={error ?? path.error} onRetry={() => (error ? refetch() : path.refetch())} /> : null}
        {path.data && me ? (
          <>
            <View className="gap-1">
              <Eyebrow>{exam ? `${exam.title} · ${exam.subtitle}` : 'Your path'}</Eyebrow>
              <Title>{me.streak.studied_today ? 'Nice. Today counts.' : 'Your next small win.'}</Title>
              <Body muted>{me.streak.studied_today ? 'Keep going if you like, or come back tomorrow.' : `${goal} minutes today. One step closer.`}</Body>
            </View>

            {enrollment?.status === 'paused' ? <Banner tone="warn" title="Study reminders are paused">Your path is still here whenever you want it.</Banner> : null}
            {enrollment?.status === 'passed' ? <Banner tone="success" title="Congratulations on your exam">Keep practising, or start a new certification when one is available.</Banner> : null}
            {due > 0 ? <NavRow icon="refresh" title={`${due} ${due === 1 ? 'review' : 'reviews'} due today`} subtitle="A little review, a stronger memory" onPress={() => router.push('/review')} /> : null}

            {current ? (
              <View className="rounded-[20px] bg-primary p-4 gap-1">
                <Text className="text-white/80 text-xs font-bold uppercase tracking-wider">
                  Unit {unitIndex + 1} · {currentUnit?.title}
                </Text>
                <Text className="text-white text-[20px] font-extrabold">{currentUnit?.subtitle}</Text>
              </View>
            ) : (
              <Banner tone="success" title="Path complete">
                You’ve finished every published lesson. Practice and mocks are ready in the Practice tab.
              </Banner>
            )}

            {units.map((unit, u) => {
              const unitLessons = lessons.filter((l) => l.unit_id === unit.id);
              return (
                <View key={unit.id} className="gap-4">
                  {u !== unitIndex ? (
                    <Text className="text-muted text-xs font-bold uppercase tracking-wider pt-2">
                      Unit {u + 1} · {unit.title}
                    </Text>
                  ) : null}
                  {unitLessons.map((lesson, i) => (
                    <Node key={lesson.id} lesson={lesson} index={i} current={lesson.id === currentLessonId} upNext={lessons.indexOf(lesson) === lessons.findIndex((l) => l.id === currentLessonId) + 1} />
                  ))}
                </View>
              );
            })}
            <View className="items-end -mt-16 pr-2" pointerEvents="none">
              <Cube size={72} />
            </View>
          </>
        ) : null}
      </ScrollView>
      {current ? (
        <View className="px-5 pt-3 pb-4 gap-2 bg-background border-t border-border">
          {startError ? <Banner tone="error">{startError.message}</Banner> : null}
          <Button
            label={current.state === 'in_progress' ? 'Continue lesson' : 'Start lesson'}
            loading={pending === 'lesson'}
            accessibilityHint={`${current.title}, ${current.question_count} questions`}
            onPress={() => start({ enrollment_id: enrollment?.id, mode: 'lesson', lesson_id: current.id })}
          />
          <Small className="text-center">A wrong answer is a chance to learn. Keep going.</Small>
        </View>
      ) : null}
    </View>
  );
}

