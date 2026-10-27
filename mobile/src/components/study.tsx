import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { popIn, riseIn } from '@/components/motion';
import { Button, Card, Icon, type IconName } from '@/components/ui';
import { ApiError, del, put } from '@/lib/api';
import { feedback as play } from '@/lib/feedback';
import { useNextSteps } from '@/lib/queries';
import { useStartSession } from '@/lib/sessions';
import { colors } from '@/lib/theme';
import type { PeerStat, QotdView, RatingView, Session, SessionFeedback, SessionItem, Suggestion } from '@/lib/types';

/** "62% of learners got this right": shown with feedback once enough learners have answered. */
export function PeerLine({ peer, qotd }: { peer?: PeerStat | null; qotd?: boolean }) {
  if (!peer) return null;
  if (peer.correct_percent === null) {
    if (!qotd) return null;
    return (
      <View className="flex-row items-center gap-1.5">
        <Icon name="people" size={15} color={colors.muted} />
        <Text className="text-muted text-[13px] font-semibold">You’re one of the first to answer today’s question.</Text>
      </View>
    );
  }
  return (
    <View accessible accessibilityLabel={`${peer.correct_percent} percent of learners got this right on their first try`} className="flex-row items-center gap-1.5">
      <Icon name="people" size={15} color={colors.primaryDark} />
      <Text className="text-ink text-[13px]">
        <Text className="font-extrabold">{peer.correct_percent}%</Text> of learners got this right on their first try
      </Text>
    </View>
  );
}

/**
 * Bookmarks a question to quiz on later. Optimistic: the icon flips at once
 * and flips back if the server refuses.
 */
export function FlagButton({ sessionId, item, size = 44 }: { sessionId: string; item: Pick<SessionItem, 'family_id' | 'question_version_id' | 'flagged'>; size?: number }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const setFlag = (flagged: boolean) =>
    queryClient.setQueryData<Session>(['session', sessionId], (old) =>
      old ? { ...old, items: old.items.map((i) => (i.family_id === item.family_id ? { ...i, flagged } : i)) } : old,
    );
  async function toggle() {
    if (busy) return;
    const next = !item.flagged;
    setBusy(true);
    setFlag(next);
    play.select();
    try {
      if (next) await put(`/flags/${item.family_id}`, { question_version_id: item.question_version_id });
      else await del(`/flags/${item.family_id}`);
      queryClient.invalidateQueries({ queryKey: ['flags'] });
    } catch {
      setFlag(!next);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.flagged ? 'Remove from flagged questions' : 'Flag this question to quiz on later'}
      aria-pressed={item.flagged}
      onPress={toggle}
      hitSlop={6}
      style={{ width: size, height: size }}
      className="items-center justify-center"
    >
      <Icon name={item.flagged ? 'bookmark' : 'bookmark-outline'} size={24} color={item.flagged ? colors.streak : colors.muted} />
    </Pressable>
  );
}

const STAR_LABELS = ['Poor', 'Weak', 'OK', 'Good', 'Great'];

/**
 * "Rate this question": 1–5 stars once the answer is shown. Optimistic, like
 * flags. A low rating offers the issue report, which says what's wrong.
 */
export function RatingStars({
  sessionId,
  familyId,
  questionVersionId,
  rating,
  onReport,
}: {
  sessionId: string;
  familyId: string;
  questionVersionId: string;
  rating?: RatingView | null;
  onReport?: () => void;
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<RatingView>(rating ?? { mine: null, average: null, count: 0 });
  const [error, setError] = useState<string | null>(null);
  // Keep both caches this question appears in up to date, so it shows the same stars on return.
  const store = (next: RatingView) => {
    setView(next);
    queryClient.setQueryData<Session>(['session', sessionId], (old) =>
      old ? { ...old, items: old.items.map((i) => (i.family_id === familyId && i.submission ? { ...i, submission: { ...i.submission, rating: next } } : i)) } : old,
    );
    queryClient.setQueryData<SessionFeedback>(['feedback', sessionId], (old) =>
      old ? { ...old, items: old.items.map((i) => (i.family_id === familyId ? { ...i, rating: next } : i)) } : old,
    );
  };
  async function rate(stars: number) {
    const before = view;
    setError(null);
    play.select();
    setView({ ...view, mine: stars, count: view.mine === null ? view.count + 1 : view.count });
    try {
      store(await put<RatingView>(`/ratings/${familyId}`, { question_version_id: questionVersionId, stars }));
    } catch (e) {
      setView(before);
      setError(e instanceof ApiError ? e.message : 'Could not save your rating');
    }
  }
  const mine = view.mine;
  return (
    <View className="gap-1.5 pt-1">
      <View className="flex-row flex-wrap items-center gap-x-2">
        <Text className="text-muted text-[13px] font-semibold">{mine ? `You rated it ${STAR_LABELS[mine - 1]!.toLowerCase()}` : 'Rate this question'}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Rate this question from 1 to 5 stars" className="flex-row">
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityLabel={`${n} star${n === 1 ? '' : 's'}, ${STAR_LABELS[n - 1]}`}
              accessibilityState={{ checked: mine === n }}
              onPress={() => rate(n)}
              hitSlop={4}
              className="h-[40px] w-[36px] items-center justify-center"
            >
              <Icon name={mine !== null && n <= mine ? 'star' : 'star-outline'} size={22} color={mine !== null && n <= mine ? colors.streak : colors.muted} />
            </Pressable>
          ))}
        </View>
        {view.average !== null ? (
          <Text accessibilityLabel={`Learners rate it ${view.average} out of 5 from ${view.count} ratings`} className="text-muted text-[13px]">
            {view.average.toFixed(1)} avg · {view.count} ratings
          </Text>
        ) : null}
      </View>
      {mine !== null && mine <= 2 && onReport ? (
        <Pressable accessibilityRole="button" onPress={onReport} className="min-h-[40px] justify-center self-start">
          <Text className="text-primary text-[14px] font-bold">Tell us what’s wrong ›</Text>
        </Pressable>
      ) : null}
      {error ? <Text className="text-coral-dark text-[13px]">{error}</Text> : null}
    </View>
  );
}

const SUGGESTION_ICON: Record<Suggestion['kind'], IconName> = {
  take_break: 'cafe',
  level_up: 'trending-up',
  retry_missed: 'refresh',
  review_due: 'repeat',
  qotd: 'sunny',
  next_lesson: 'play',
  flagged: 'bookmark',
  weakest: 'locate',
};

/** The suggested next step after a session, with one alternative. */
export function NextStepCard({ sessionId, enrollmentId, delay = 0 }: { sessionId: string; enrollmentId: string; delay?: number }) {
  const next = useNextSteps(sessionId);
  const { start, pending, error } = useStartSession();
  if (!next.data) return null;
  const { primary, secondary } = next.data;
  const go = (s: Suggestion) => {
    if (!s.start) {
      router.dismissTo('/learn');
      return;
    }
    start({ enrollment_id: enrollmentId, ...s.start, replace: true });
  };
  return (
    <Animated.View entering={riseIn(delay)}>
      <Card tone="tint" className="gap-3">
        <Text className="text-primary-dark text-xs font-bold uppercase tracking-wider">Suggested next step</Text>
        <View className="flex-row items-start gap-3">
          <View className="h-11 w-11 rounded-[14px] bg-primary items-center justify-center">
            <Icon name={SUGGESTION_ICON[primary.kind]} size={22} color="#FFFFFF" />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-ink text-[17px] font-extrabold">{primary.title}</Text>
            <Text className="text-ink text-[14px] leading-[20px]">{primary.body}</Text>
          </View>
        </View>
        <Button label={primary.cta} icon={primary.start ? 'arrow-forward' : undefined} loading={!!pending && pending === primary.start?.mode} onPress={() => go(primary)} />
        {secondary ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Or: ${secondary.title}`}
            onPress={() => go(secondary)}
            className="min-h-[44px] flex-row items-center gap-2 rounded-[14px] px-1 active:bg-primary-tint"
          >
            <Icon name={SUGGESTION_ICON[secondary.kind]} size={16} color={colors.primary} />
            <Text className="flex-1 text-primary text-[14px] font-bold">Or: {secondary.title}</Text>
            <Icon name="chevron-forward" size={16} color={colors.primary} />
          </Pressable>
        ) : null}
        {error ? <Text className="text-coral-dark text-[13px]">{error.message}</Text> : null}
      </Card>
    </Animated.View>
  );
}

/** Today's shared question on the Learn tab, with its own streak. */
export function QotdCard({ qotd, enrollmentId }: { qotd: QotdView; enrollmentId: string }) {
  const { start, pending, error } = useStartSession();
  if (!qotd.available || !qotd.question) return null;
  const done = qotd.status === 'done';
  const streak = qotd.streak.current;
  return (
    <Pressable
      accessibilityRole={done ? undefined : 'button'}
      accessibilityLabel={
        done
          ? `Question of the Day answered${qotd.result?.correct ? ' correctly' : ''}. ${streak}-day question streak. A new question arrives tomorrow.`
          : `Question of the Day. ${qotd.question.prompt}. ${streak > 0 ? `${streak}-day question streak.` : ''}`
      }
      aria-busy={pending === 'qotd'}
      disabled={done}
      onPress={() => start({ enrollment_id: enrollmentId, mode: 'qotd' })}
      className="rounded-[20px] bg-gem-tint p-4 gap-2.5 active:opacity-80"
    >
      <View className="flex-row items-center gap-2">
        <Icon name="sunny" size={18} color={colors.gemDark} />
        <Text className="flex-1 text-gem-dark text-xs font-bold uppercase tracking-wider">Question of the Day</Text>
        <View className="flex-row items-center gap-1 rounded-full bg-surface px-2 py-0.5">
          <Icon name="flame" size={13} color={streak > 0 ? colors.streak : colors.locked} />
          <Text className="text-ink text-[12px] font-extrabold">{streak}</Text>
        </View>
      </View>
      {done ? (
        <View className="flex-row items-center gap-2.5">
          <Animated.View entering={popIn()}>
            <View className={`h-9 w-9 rounded-full items-center justify-center ${qotd.result?.correct ? 'bg-success' : 'bg-coral'}`}>
              <Icon name={qotd.result?.correct ? 'checkmark' : 'close'} size={20} color="#FFFFFF" />
            </View>
          </Animated.View>
          <View className="flex-1 gap-0.5">
            <Text className="text-ink text-[16px] font-extrabold">{qotd.result?.correct ? 'You got today’s question' : 'Answered for today'}</Text>
            {qotd.result?.peer?.correct_percent != null ? (
              <Text className="text-muted text-[13px]">{qotd.result.peer.correct_percent}% of learners got it right · new question tomorrow</Text>
            ) : (
              <Text className="text-muted text-[13px]">A new question arrives tomorrow.</Text>
            )}
          </View>
        </View>
      ) : (
        <>
          <Text numberOfLines={3} className="text-ink text-[16px] leading-[22px] font-bold">
            {qotd.question.prompt}
          </Text>
          <View className="flex-row items-center justify-between">
            <Text className="text-muted text-[12px] flex-1">
              {qotd.question.domain_title} · +{qotd.gems} gems
            </Text>
            <Text className="text-gem-dark text-[14px] font-extrabold">{qotd.status === 'in_progress' ? 'Continue ›' : 'Answer ›'}</Text>
          </View>
        </>
      )}
      {error ? <Text className="text-coral-dark text-[13px]">{error.message}</Text> : null}
    </Pressable>
  );
}

/** Four pips for a domain's Level Up progress. */
export function LevelPips({ passed, current }: { passed: number; current: number }) {
  return (
    <View aria-hidden className="flex-row gap-1">
      {[1, 2, 3, 4].map((n) => (
        <View key={n} className={`h-2 w-6 rounded-full ${n <= passed ? 'bg-success' : n === current ? 'bg-primary' : 'bg-border'}`} />
      ))}
    </View>
  );
}
