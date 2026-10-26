import { router, useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { RefreshControl, ScrollView, Text, View, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/AppHeader';
import { Cube } from '@/components/Cube';
import { QuestsSummary } from '@/components/gamify';
import { Pulse, SPRING, pop as popTo } from '@/components/motion';
import { Banner, Body, Button, Eyebrow, ErrorState, Icon, LoadingState, NavRow, Small, Title } from '@/components/ui';
import { feedback as play } from '@/lib/feedback';
import { useCurrentEnrollment, useExams, usePath, usePractice, useQuests } from '@/lib/queries';
import { useStartSession } from '@/lib/sessions';
import { colors } from '@/lib/theme';
import type { LessonNode } from '@/lib/types';

const OFFSETS = [0, 44, 64, 44, 0, -44, -64, -44];

const UNLOCK_DELAY = 450;

function Node({ lesson, index, current, upNext, onLayoutY }: { lesson: LessonNode; index: number; current: boolean; upNext: boolean; onLayoutY?: (y: number) => void }) {
  const done = lesson.state === 'completed' || lesson.state === 'placed_out';
  const locked = lesson.state === 'locked';
  const reduced = useReducedMotion();
  const pop = useSharedValue(1);
  const focused = useIsFocused();
  const wasDone = useRef(done);
  const wasCurrent = useRef(current);
  // Coming back from a lesson: the finished node pops, then the next one springs open as the new current lesson.
  // The path refreshes while the lesson screens cover it, so compare with what the learner last saw here.
  useEffect(() => {
    if (!focused) return;
    const finished = done && !wasDone.current;
    const unlocked = current && !wasCurrent.current;
    wasDone.current = done;
    wasCurrent.current = current;
    if (reduced) return;
    if (finished) pop.set(popTo(1.25));
    if (!unlocked) return;
    pop.set(withSequence(withTiming(0.55, { duration: 0 }), withDelay(UNLOCK_DELAY, withSpring(1, SPRING.bouncy))));
    const timer = setTimeout(play.unlock, UNLOCK_DELAY);
    return () => clearTimeout(timer);
  }, [done, current, reduced, pop, focused]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));
  const size = current ? 72 : 60;
  const bg = done ? 'bg-success' : current ? 'bg-primary' : 'bg-locked';
  const icon = done ? 'checkmark' : lesson.kind === 'checkpoint' ? 'trophy' : current ? 'star' : 'lock-closed';
  const status = done ? 'Lesson complete' : current ? `${lesson.question_count} questions · about 5 min` : lesson.kind === 'checkpoint' ? 'Fresh scenarios' : upNext ? 'Up next' : '';
  return (
    <View
      className="flex-row items-center gap-4"
      style={{ marginLeft: 72 + (OFFSETS[index % OFFSETS.length] ?? 0) }}
      onLayout={onLayoutY ? (e) => onLayoutY(e.nativeEvent.layout.y) : undefined}
    >
      <Animated.View style={popStyle}>
        <Pulse active={current}>
          <View
            accessibilityLabel={`${lesson.title}. ${done ? 'Completed' : current ? 'Current lesson' : 'Locked'}`}
            className={`items-center justify-center rounded-full ${bg} ${current ? 'border-4 border-primary-tint' : ''}`}
            style={{ width: size, height: size }}
          >
            <Icon name={icon} size={current ? 30 : 24} color={locked && !current ? colors.muted : '#FFFFFF'} />
          </View>
        </Pulse>
      </Animated.View>
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
  const quests = useQuests();
  const { start, pending, error: startError } = useStartSession();
  const reduced = useReducedMotion();
  const { height } = useWindowDimensions();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const unitY = useRef<Record<string, number>>({});
  const currentY = useRef<{ lessonId: string; y: number } | null>(null);
  const scrolledFor = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (enrollment?.id) {
        path.refetch();
        practice.refetch();
        quests.refetch();
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
  const mood = me?.streak.studied_today ? 'cheer' : me && me.streak.current === 0 && me.streak.longest > 0 ? 'sleepy' : 'happy';

  // Bring the current lesson into view once both its unit's and its own position are known.
  function scrollToCurrent() {
    const node = currentY.current;
    const unitId = lessons.find((l) => l.id === node?.lessonId)?.unit_id;
    const top = unitId ? unitY.current[unitId] : undefined;
    if (!node || top === undefined || scrolledFor.current === node.lessonId) return;
    scrolledFor.current = node.lessonId;
    const target = top + node.y - height * 0.35;
    if (target > 40) scrollRef.current?.scrollTo({ y: target, animated: !reduced });
  }

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ScrollView
        ref={scrollRef}
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
            {quests.data ? <QuestsSummary quests={quests.data.quests} chestReady={quests.data.chest.available} onPress={() => router.push('/quests')} /> : null}
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
                <View
                  key={unit.id}
                  className="gap-4"
                  onLayout={(e) => {
                    unitY.current[unit.id] = e.nativeEvent.layout.y;
                    scrollToCurrent();
                  }}
                >
                  {u !== unitIndex ? (
                    <Text className="text-muted text-xs font-bold uppercase tracking-wider pt-2">
                      Unit {u + 1} · {unit.title}
                    </Text>
                  ) : null}
                  {unitLessons.map((lesson, i) => (
                    <Node
                      key={lesson.id}
                      lesson={lesson}
                      index={i}
                      current={lesson.id === currentLessonId}
                      upNext={lessons.indexOf(lesson) === lessons.findIndex((l) => l.id === currentLessonId) + 1}
                      onLayoutY={
                        lesson.id === currentLessonId
                          ? (y) => {
                              currentY.current = { lessonId: lesson.id, y };
                              scrollToCurrent();
                            }
                          : undefined
                      }
                    />
                  ))}
                </View>
              );
            })}
            <View className="items-end -mt-16 pr-2" pointerEvents="none">
              <Cube size={72} mood={mood} />
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

