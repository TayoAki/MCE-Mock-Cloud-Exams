import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { riseIn } from '@/components/motion';
import { PeerLine, RatingStars } from '@/components/study';
import { ChoiceAnswer, ListenPrompt, MatchAnswer, OrderAnswer, TypeAnswer, answerBody, answerReady, formatHint, type AnswerState } from '@/components/questions';
import { Banner, Button, ErrorState, Icon, LoadingState, ProgressBar, Screen, Small } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { feedback as play } from '@/lib/feedback';
import { newId } from '@/lib/ids';
import { useRefreshLearning, useSession } from '@/lib/queries';
import { speak, stopSpeaking } from '@/lib/speech';
import { colors } from '@/lib/theme';
import type { AnswerReceipt, Session, SessionItem, StoryPart } from '@/lib/types';

const AVATAR = [
  { bg: colors.primaryTint, fg: colors.primaryDark },
  { bg: colors.streakTint, fg: colors.streakDark },
  { bg: colors.gemTint, fg: colors.gemDark },
  { bg: colors.mint, fg: colors.success },
];

function Line({ part, characters, onPlay }: { part: Extract<StoryPart, { kind: 'line' }>; characters: string[]; onPlay: () => void }) {
  const who = part.speaker ? characters.indexOf(part.speaker) : -1;
  if (who < 0) {
    return (
      <Animated.View entering={riseIn(0)} className="px-4">
        <Text className="text-muted text-[15px] leading-[22px] italic text-center">{part.text}</Text>
      </Animated.View>
    );
  }
  const right = who % 2 === 1;
  const tone = AVATAR[who % AVATAR.length]!;
  return (
    <Animated.View entering={riseIn(0)} className={`flex-row items-end gap-2 ${right ? 'flex-row-reverse' : ''}`}>
      <View className="h-10 w-10 rounded-full items-center justify-center" style={{ backgroundColor: tone.bg }}>
        <Text className="text-[16px] font-extrabold" style={{ color: tone.fg }}>
          {part.speaker!.slice(0, 1)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${part.speaker} says: ${part.text}. Tap to hear it`}
        onPress={onPlay}
        className={`max-w-[78%] rounded-[18px] border border-border bg-surface px-3.5 py-2.5 gap-0.5 ${right ? 'rounded-br-[6px]' : 'rounded-bl-[6px]'}`}
      >
        <Text className="text-[12px] font-extrabold" style={{ color: tone.fg }}>
          {part.speaker}
        </Text>
        <Text className="text-ink text-[16px] leading-[23px]">{part.text}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** One story question, answered in place. */
function QuestionCard({ item, sessionId, onAnswered }: { item: SessionItem; sessionId: string; onAnswered: (correct: boolean) => void }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AnswerState>({ selected: [], typed: '', inputMode: 'tap' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept across retries so a resend after a network error is the same submission.
  const submissionId = useRef(newId());
  const feedback = item.submission?.feedback ?? null;
  const disabled = !!item.submission || busy;

  async function check() {
    if (!answerReady(item, state) || busy) return;
    setBusy(true);
    setError(null);
    const body = { session_item_id: item.session_item_id, client_submission_id: submissionId.current, ...answerBody(item, state) };
    try {
      const receipt = await post<AnswerReceipt>(`/sessions/${sessionId}/answers`, body);
      queryClient.setQueryData<Session>(['session', sessionId], (old) =>
        old
          ? {
              ...old,
              answered_count: old.answered_count + 1,
              items: old.items.map((i) =>
                i.session_item_id === item.session_item_id
                  ? {
                      ...i,
                      submission: {
                        attempt_id: receipt.attempt_id,
                        selected_options: body.selected_options,
                        typed_answer: 'typed_answer' in body ? body.typed_answer : null,
                        submitted_at: new Date().toISOString(),
                        feedback: receipt.feedback,
                        peer: receipt.peer ?? null,
                        rating: receipt.rating ?? null,
                      },
                    }
                  : i,
              ),
            }
          : old,
      );
      if (receipt.feedback?.correct) play.correct(1);
      else play.wrong();
      onAnswered(!!receipt.feedback?.correct);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send your answer');
      if (e instanceof ApiError && e.code === 'already_answered') queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    } finally {
      setBusy(false);
    }
  }

  const answer =
    item.answer_type === 'order' ? (
      <OrderAnswer item={item} value={state.selected} onChange={(selected) => setState((s) => ({ ...s, selected }))} disabled={disabled} feedback={feedback} />
    ) : item.answer_type === 'match' ? (
      <MatchAnswer item={item} value={state.selected} onChange={(selected) => setState((s) => ({ ...s, selected }))} disabled={disabled} feedback={feedback} />
    ) : item.answer_type === 'type' ? (
      <TypeAnswer
        item={item}
        value={state.typed}
        onChange={(typed, inputMode) => setState((s) => ({ ...s, typed, inputMode }))}
        disabled={disabled}
        feedback={feedback}
        onSubmit={check}
      />
    ) : (
      <ChoiceAnswer item={item} value={state.selected} onChange={(selected) => setState((s) => ({ ...s, selected }))} disabled={disabled} feedback={feedback} />
    );

  return (
    <Animated.View entering={riseIn(0)} className="rounded-[22px] border-2 border-primary bg-surface p-4 gap-3">
      <View className="flex-row items-center gap-1.5">
        <Icon name="help-circle" size={16} color={colors.primary} />
        <Text className="text-primary text-xs font-bold uppercase tracking-wider">Your call</Text>
      </View>
      {item.presentation === 'listen' ? (
        <ListenPrompt text={item.prompt} revealed={!!feedback} />
      ) : (
        <Text accessibilityRole="header" className="text-ink text-[19px] leading-[26px] font-extrabold">
          {item.prompt}
        </Text>
      )}
      {answer}
      {feedback ? (
        <View accessibilityLiveRegion="polite" className={`rounded-[16px] p-3.5 gap-1 ${feedback.correct ? 'bg-mint' : 'bg-coral-tint'}`}>
          <Text className={`text-[16px] font-extrabold ${feedback.correct ? 'text-success' : 'text-coral-dark'}`}>{feedback.correct ? 'Good call!' : 'Not quite'}</Text>
          <Text className="text-ink text-[14px] leading-[20px]">{feedback.rationale}</Text>
          <PeerLine peer={item.submission?.peer} />
          <RatingStars sessionId={sessionId} familyId={item.family_id} questionVersionId={item.question_version_id} rating={item.submission?.rating} />
          <Pressable accessibilityRole="button" onPress={() => router.push(`/tutor/${item.session_item_id}`)} className="min-h-[40px] flex-row items-center gap-1.5 self-start">
            <Icon name="chatbubbles" size={15} color={colors.primary} />
            <Text className="text-primary text-[14px] font-bold">Talk it through with the tutor</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Small>{formatHint(item)}</Small>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <Button label="Check" disabled={!answerReady(item, state)} loading={busy} onPress={check} />
        </>
      )}
    </Animated.View>
  );
}

/** A story told line by line, with questions where a decision is needed. */
export default function StoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const session = useSession(id);
  const refreshLearning = useRefreshLearning();
  const s = session.data;
  const story = s?.story;
  const [shown, setShown] = useState<number | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);

  // Opening a story starts at the first line; resuming jumps to the first unanswered question.
  if (story && shown === null && s) {
    const answered = new Set(s.items.filter((i) => i.submission).map((i) => i.session_item_id));
    const next = story.parts.findIndex((p) => p.kind === 'question' && !answered.has(p.session_item_id));
    setShown(answered.size === 0 ? 1 : next === -1 ? story.parts.length : next + 1);
  }

  useEffect(() => {
    if (s && s.status !== 'active' && s.status !== 'abandoned') router.replace(`/complete/${s.id}`);
  }, [s?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopSpeaking(), []);

  const characters = story?.characters.map((c) => c.name) ?? [];
  const voiceOf = (speaker: string | null) => Math.max(0, characters.indexOf(speaker ?? '') + 1);

  function reveal() {
    if (!story || shown === null) return;
    const next = story.parts[shown];
    setShown(shown + 1);
    play.tick();
    if (next?.kind === 'line' && readAloud) speak(next.text, { voice: voiceOf(next.speaker) });
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120);
  }

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      await post(`/sessions/${id}/complete`, {});
      await refreshLearning();
      router.replace(`/complete/${id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not finish the story');
    } finally {
      setFinishing(false);
    }
  }

  if (session.isLoading) return <Screen><LoadingState label="Loading the story" /></Screen>;
  if (session.error || !s || !story || shown === null) return <Screen><ErrorState error={session.error} onRetry={() => session.refetch()} /><Button label="Back" variant="ghost" onPress={() => router.back()} /></Screen>;

  const items = new Map(s.items.map((i) => [i.session_item_id, i]));
  const visible = story.parts.slice(0, shown);
  const last = visible[visible.length - 1];
  const waiting = last?.kind === 'question' && !items.get(last.session_item_id)?.submission;
  const done = shown >= story.parts.length && !waiting;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-3 px-5 pt-2 pb-3">
        <Pressable accessibilityRole="button" accessibilityLabel="Leave the story" onPress={() => router.back()} className="h-11 w-11 items-center justify-center">
          <Icon name="close" size={28} color={colors.ink} />
        </Pressable>
        <View className="flex-1">
          <ProgressBar value={shown / story.parts.length} label={`Part ${shown} of ${story.parts.length}`} />
        </View>
        <Pressable
          accessibilityRole="switch"
          aria-checked={readAloud}
          accessibilityLabel="Read the story aloud"
          onPress={() => {
            if (readAloud) stopSpeaking();
            setReadAloud(!readAloud);
          }}
          className={`h-11 w-11 items-center justify-center rounded-full ${readAloud ? 'bg-primary' : 'bg-primary-tint'}`}
        >
          <Icon name={readAloud ? 'volume-high' : 'volume-mute'} size={20} color={readAloud ? '#FFFFFF' : colors.primary} />
        </Pressable>
      </View>

      <ScrollView ref={scroll} contentContainerClassName="px-5 pb-8 gap-4" keyboardShouldPersistTaps="handled">
        <View className="gap-1 items-center pb-2">
          <Text className="text-primary text-xs font-bold uppercase tracking-wider">Story</Text>
          <Text accessibilityRole="header" className="text-ink text-[24px] font-extrabold text-center">
            {story.title}
          </Text>
          <Small className="text-center">{story.characters.map((c) => `${c.name}, ${c.role.toLowerCase()}`).join(' · ')}</Small>
        </View>
        {visible.map((part, i) =>
          part.kind === 'line' ? (
            <Line key={`line-${i}`} part={part} characters={characters} onPlay={() => speak(part.text, { voice: voiceOf(part.speaker) })} />
          ) : items.get(part.session_item_id) ? (
            <QuestionCard
              key={part.session_item_id}
              item={items.get(part.session_item_id)!}
              sessionId={s.id}
              onAnswered={() => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 150)}
            />
          ) : null,
        )}
        {error ? <Banner tone="error">{error}</Banner> : null}
      </ScrollView>

      <View className="px-5 pt-3 gap-2 border-t border-border bg-background" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        {done ? (
          <Button label="Finish the story" icon="checkmark-done" loading={finishing} onPress={finish} />
        ) : waiting ? (
          <Small className="text-center">Answer to keep the story going.</Small>
        ) : (
          <Button label="Continue" onPress={reveal} />
        )}
      </View>
    </View>
  );
}
