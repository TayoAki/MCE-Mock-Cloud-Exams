import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner, Button, ErrorState, Icon, LoadingState, ProgressBar, Screen, Small } from '@/components/ui';
import { trackEvent } from '@/lib/analytics';
import { ApiError, post } from '@/lib/api';
import { newId } from '@/lib/ids';
import { clearPending, loadPending, savePending, type PendingAnswer } from '@/lib/pending';
import { useRefreshLearning, useSession } from '@/lib/queries';
import { colors } from '@/lib/theme';
import type { AnswerReceipt, Explanation, Feedback, Session, SessionItem } from '@/lib/types';

type OptionState = 'idle' | 'selected' | 'correct' | 'wrong' | 'dim';

function OptionRow({ letter, text, state, multiple, onPress, disabled }: { letter: string; text: string; state: OptionState; multiple: boolean; onPress: () => void; disabled: boolean }) {
  const box = {
    idle: 'border-border bg-surface',
    selected: 'border-primary bg-primary-tint',
    correct: 'border-success bg-mint',
    wrong: 'border-coral bg-coral-tint',
    dim: 'border-border bg-surface opacity-70',
  }[state];
  const badge = {
    idle: 'bg-background',
    selected: 'bg-primary',
    correct: 'bg-success',
    wrong: 'bg-coral',
    dim: 'bg-background',
  }[state];
  const status = state === 'correct' ? ', correct answer' : state === 'wrong' ? ', your answer, incorrect' : state === 'selected' ? ', selected' : '';
  return (
    <Pressable
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      aria-checked={state === 'selected' || state === 'wrong' || state === 'correct'} aria-disabled={disabled}
      accessibilityLabel={`Option ${letter}: ${text}${status}`}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-[56px] flex-row items-center gap-3 rounded-[16px] border-2 px-3.5 py-3 ${box}`}
    >
      <View className={`h-8 w-8 ${multiple ? 'rounded-lg' : 'rounded-full'} items-center justify-center ${badge}`}>
        {state === 'correct' ? (
          <Icon name="checkmark" size={18} color="#FFFFFF" />
        ) : state === 'wrong' ? (
          <Icon name="close" size={18} color="#FFFFFF" />
        ) : (
          <Text className={`text-[14px] font-bold ${state === 'selected' ? 'text-white' : 'text-muted'}`}>{letter}</Text>
        )}
      </View>
      <Text className="flex-1 text-ink text-[15px] leading-[21px]">{text}</Text>
    </Pressable>
  );
}

function optionState(key: string, item: SessionItem, selected: string[], feedback: Feedback | null): OptionState {
  const mine = item.submission?.selected_options ?? selected;
  if (!feedback) return mine.includes(key) ? 'selected' : 'idle';
  if (feedback.correct_options.includes(key)) return 'correct';
  if (mine.includes(key)) return 'wrong';
  return 'dim';
}

function useCountdown(session: Session | undefined) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const active = !!session?.deadline_at && session.status === 'active';
  useEffect(() => {
    if (!session?.deadline_at || session.status !== 'active') return;
    // Count down against server time; the server deadline is authoritative.
    const offset = new Date(session.server_time).getTime() - Date.now();
    const deadline = new Date(session.deadline_at).getTime();
    const tick = () => setRemaining(Math.max(0, deadline - (Date.now() + offset)));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [session?.deadline_at, session?.server_time, session?.status]);
  return active ? remaining : null;
}

const formatTime = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const REPORT_REASONS = [
  { key: 'incorrect_key', label: 'The marked answer looks wrong' },
  { key: 'unclear', label: 'The question is unclear' },
  { key: 'outdated', label: 'The content is outdated' },
  { key: 'typo', label: 'Typo or formatting' },
  { key: 'other', label: 'Something else' },
] as const;

function ReportSheet({ item, attemptId, onClose }: { item: SessionItem; attemptId?: string; onClose: () => void }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(reason: string) {
    try {
      await post('/issue-reports', { question_version_id: item.question_version_id, reason, ...(attemptId && { attempt_id: attemptId }) });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the report');
    }
  }
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/30">
        <View className="rounded-t-[24px] bg-surface p-5 gap-3 pb-8">
          <Text accessibilityRole="header" className="text-ink text-[20px] font-extrabold">
            Report an issue
          </Text>
          {sent ? (
            <Banner tone="success" title="Thanks for flagging this">Our content team will review it. Your answer stays recorded.</Banner>
          ) : (
            REPORT_REASONS.map((r) => (
              <Pressable key={r.key} accessibilityRole="button" onPress={() => send(r.key)} className="min-h-[48px] justify-center rounded-[14px] border border-border px-4 active:bg-primary-tint">
                <Text className="text-ink text-[15px]">{r.label}</Text>
              </Pressable>
            ))
          )}
          {error ? <Banner tone="error">{error}</Banner> : null}
          <Button label={sent ? 'Done' : 'Cancel'} variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** S04 question, S05 feedback, and the timed/mock runner. */
export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const refreshLearning = useRefreshLearning();
  const session = useSession(id);
  const s = session.data;
  const sealed = s?.feedback_timing === 'after_submit';

  const [selected, setSelected] = useState<string[]>([]);
  const [showingId, setShowingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [reporting, setReporting] = useState(false);
  const remaining = useCountdown(s);

  const answered = s?.items.filter((i) => i.submission).length ?? 0;
  const current = useMemo(() => {
    if (!s) return undefined;
    if (showingId) return s.items.find((i) => i.session_item_id === showingId);
    return s.items.find((i) => !i.submission);
  }, [s, showingId]);
  const feedback = current?.submission?.feedback ?? null;

  // A finished session belongs on its summary screen.
  useEffect(() => {
    if (!s || s.status === 'active') return;
    if (s.status === 'abandoned') router.dismissTo('/learn');
    else if (s.mode === 'mock') router.replace(`/results/${s.id}`);
    else router.replace(`/complete/${s.id}`);
  }, [s]);

  // Restore a submission that never got a confirmed response.
  useEffect(() => {
    if (!s) return;
    loadPending(s.id).then((p) => {
      if (!p) return;
      const item = s.items.find((i) => i.session_item_id === p.body.session_item_id);
      if (!item || item.submission) clearPending(s.id);
      else {
        setSelected(p.body.selected_options);
        // Resend the identical payload; the server decides whether it already committed.
        submit(p);
      }
    });
  }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Moving to another question resets the selection and any extra explanation.
  const [shownItemId, setShownItemId] = useState(current?.session_item_id);
  if (current?.session_item_id !== shownItemId) {
    setShownItemId(current?.session_item_id);
    setExplanation(null);
    if (!pending) setSelected([]);
  }

  // When the server deadline passes, the server finalizes the form; fetch and move on.
  useEffect(() => {
    if (remaining === 0) session.refetch();
  }, [remaining]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyReceipt(item: SessionItem, body: PendingAnswer['body'], receipt: AnswerReceipt) {
    queryClient.setQueryData<Session>(['session', id], (old) =>
      old
        ? {
            ...old,
            answered_count: old.answered_count + 1,
            items: old.items.map((i) =>
              i.session_item_id === item.session_item_id
                ? { ...i, submission: { attempt_id: receipt.attempt_id, selected_options: body.selected_options, submitted_at: new Date().toISOString(), feedback: receipt.feedback } }
                : i,
            ),
          }
        : old,
    );
  }

  async function submit(answer: PendingAnswer) {
    const item = s?.items.find((i) => i.session_item_id === answer.body.session_item_id);
    if (!item) return;
    setSubmitting(true);
    setError(null);
    await savePending(answer);
    setPending(answer);
    try {
      const receipt = await post<AnswerReceipt>(`/sessions/${id}/answers`, answer.body);
      await clearPending(id);
      setPending(null);
      applyReceipt(item, answer.body, receipt);
      if (!sealed) {
        setShowingId(item.session_item_id);
        if (Platform.OS !== 'web' && receipt.feedback) {
          Haptics.notificationAsync(receipt.feedback.correct ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
        }
      } else {
        setSelected([]);
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'error', 'Something went wrong');
      if (err.isNetwork || err.status >= 500) {
        // Keep the pending answer; retrying sends the identical payload.
        setError(err);
      } else {
        await clearPending(id);
        setPending(null);
        if (err.code === 'session_expired' || err.code === 'session_closed') await session.refetch();
        else if (err.code === 'already_answered') await session.refetch();
        else setError(err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function check() {
    if (!current) return;
    if (pending?.body.session_item_id === current.session_item_id) return submit(pending);
    submit({ sessionId: id, body: { session_item_id: current.session_item_id, client_submission_id: newId(), selected_options: [...selected].sort() } });
  }

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      await post(`/sessions/${id}/complete`, {});
      await refreshLearning();
      router.replace(sealed ? `/results/${id}` : `/complete/${id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'error', 'Could not finish'));
    } finally {
      setFinishing(false);
    }
  }

  function next() {
    setShowingId(null);
    setExplanation(null);
    if (s && s.items.every((i) => i.submission)) finish();
  }

  async function explain() {
    if (!current?.submission) return;
    setExplaining(true);
    trackEvent('explanation_opened', { origin: 'request' });
    try {
      setExplanation(await post<Explanation>('/explanations', { attempt_id: current.submission.attempt_id, style: 'analogy' }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'plus_required') router.push({ pathname: '/premium', params: { feature: 'ai_explain' } });
      else setError(e instanceof ApiError ? e : null);
    } finally {
      setExplaining(false);
    }
  }

  function exit() {
    if (s?.deadline_at || answered > 0) setConfirmExit(true);
    else router.back();
  }

  if (session.isLoading) return <Screen><LoadingState label="Loading your questions" /></Screen>;
  if (session.error || !s) return <Screen><ErrorState error={session.error} onRetry={() => session.refetch()} /><Button label="Back" variant="ghost" onPress={() => router.back()} /></Screen>;
  if (s.status !== 'active') return <Screen><LoadingState label="Finalizing" /></Screen>;

  const topic = s.lesson ? `${s.lesson.unit_title} · ${s.lesson.title}` : current?.domain_title ?? '';
  const multiple = current?.answer_type === 'multiple';
  const allAnswered = answered === s.items.length;
  const lowTime = remaining !== null && remaining < 60_000;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-3 px-5 pt-2 pb-3">
        <Pressable accessibilityRole="button" accessibilityLabel="Leave session" onPress={exit} className="h-11 w-11 items-center justify-center">
          <Icon name="close" size={28} color={colors.ink} />
        </Pressable>
        <View className="flex-1">
          <ProgressBar value={answered / s.items.length} label={`${answered} of ${s.items.length} answered`} />
        </View>
        {remaining !== null ? (
          <View accessibilityLabel={`Time left ${formatTime(remaining)}`} className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${lowTime ? 'bg-coral-tint' : 'bg-primary-tint'}`}>
            <Icon name="time-outline" size={14} color={lowTime ? colors.coralDark : colors.primaryDark} />
            <Text className={`text-[13px] font-bold ${lowTime ? 'text-coral-dark' : 'text-primary-dark'}`}>{formatTime(remaining)}</Text>
          </View>
        ) : (
          <Text className="text-muted text-[13px] font-semibold">
            {Math.min(answered + (feedback ? 0 : 1), s.items.length)}/{s.items.length}
          </Text>
        )}
      </View>

      <ScrollView contentContainerClassName="px-5 pb-6 gap-4" keyboardShouldPersistTaps="handled">
        {current ? (
          <>
            <View className="gap-2">
              <Text className="text-primary text-xs font-bold uppercase tracking-wider">{topic}</Text>
              <Text accessibilityRole="header" className="text-ink text-[22px] leading-[29px] font-extrabold">
                {current.prompt}
              </Text>
              {multiple && !feedback ? <Small>Select all that apply.</Small> : null}
              {current.repeat && !sealed ? <Small>You’ve seen this idea before. Repeats count separately from new questions.</Small> : null}
            </View>
            <View className="gap-2.5">
              {current.options.map((o) => (
                <OptionRow
                  key={o.key}
                  letter={o.key}
                  text={o.text}
                  multiple={multiple}
                  disabled={!!current.submission || submitting || !!pending}
                  state={optionState(o.key, current, selected, feedback)}
                  onPress={() => setSelected((prev) => (multiple ? (prev.includes(o.key) ? prev.filter((k) => k !== o.key) : [...prev, o.key]) : [o.key]))}
                />
              ))}
            </View>

            {feedback ? (
              <View accessibilityLiveRegion="polite" className={`rounded-[20px] p-4 gap-2 ${feedback.correct ? 'bg-mint' : 'bg-coral-tint'}`}>
                <View className="flex-row items-center gap-2">
                  <Icon name={feedback.correct ? 'checkmark-circle' : 'bulb'} size={22} color={feedback.correct ? colors.success : colors.coralDark} />
                  <Text accessibilityRole="header" className={`text-[17px] font-extrabold ${feedback.correct ? 'text-success' : 'text-coral-dark'}`}>
                    {feedback.correct ? 'You got it!' : 'A useful one to review'}
                  </Text>
                </View>
                {!feedback.correct ? (
                  <Text className="text-ink text-[14px] font-semibold">Correct answer: {feedback.correct_options.join(', ')}</Text>
                ) : null}
                <Text className="text-ink text-[15px] leading-[22px]">{feedback.rationale}</Text>
                {feedback.sources.map((src) => (
                  <Pressable
                    key={src}
                    accessibilityRole="link"
                    onPress={() => {
                      trackEvent('source_opened');
                      WebBrowser.openBrowserAsync(src).catch(() => undefined);
                    }}
                    className="min-h-[44px] justify-center"
                  >
                    <Text className="text-primary text-[14px] font-bold">Read the documentation ›</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {explanation ? (
              <View className="rounded-[20px] bg-surface border border-border p-4 gap-2">
                <Text className="text-primary text-xs font-bold uppercase tracking-wider">
                  {explanation.origin === 'generated' ? 'Another way to see it' : 'Reviewed explanation'}
                </Text>
                <Text className="text-ink text-[15px] leading-[22px]">{explanation.text}</Text>
                {explanation.notice ? <Small>{explanation.notice}</Small> : null}
              </View>
            ) : null}

            {!sealed && !feedback ? <Small>Original practice item. Select {multiple ? 'every answer that applies' : 'one answer'}.</Small> : null}
            {sealed ? <Small>Answers are saved as you go. Feedback appears after you submit the mock.</Small> : null}
          </>
        ) : allAnswered && sealed ? (
          <View className="gap-3 pt-6 items-center">
            <Icon name="checkmark-done-circle" size={56} color={colors.primary} />
            <Text className="text-ink text-[22px] font-extrabold text-center">Every question answered.</Text>
            <Small className="text-center">Submit to see your practice score and explanations.</Small>
          </View>
        ) : null}

        {pending && !submitting && error?.isNetwork ? (
          <Banner tone="warn" title="Your answer is saved on this device">
            We couldn’t reach the server. Retry sends the same answer, so nothing is counted twice.
          </Banner>
        ) : null}
        {error && !error.isNetwork ? <Banner tone="error">{error.message}</Banner> : null}
      </ScrollView>

      <View className="px-5 pt-3 gap-2 border-t border-border bg-background" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        {pending && !submitting ? (
          <Button label="Retry" icon="refresh" onPress={() => submit(pending)} />
        ) : feedback ? (
          <>
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button label="Explain another way" variant="secondary" loading={explaining} onPress={explain} />
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Report an issue with this question" onPress={() => setReporting(true)} className="h-[52px] w-[52px] items-center justify-center rounded-[15px] border-2 border-border">
                <Icon name="flag-outline" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <Button label={answered === s.items.length ? 'Finish' : 'Got it — continue'} loading={finishing} onPress={next} />
          </>
        ) : current ? (
          <>
            <Button label={sealed ? 'Save answer' : 'Check answer'} disabled={selected.length === 0} loading={submitting} onPress={check} />
            {sealed && answered > 0 ? <Button label="Submit mock now" variant="ghost" onPress={() => setConfirmSubmit(true)} /> : null}
          </>
        ) : allAnswered ? (
          <Button label={sealed ? 'Submit mock' : 'Finish'} loading={finishing} onPress={sealed ? () => setConfirmSubmit(true) : finish} />
        ) : null}
      </View>

      {reporting && current ? <ReportSheet item={current} attemptId={current.submission?.attempt_id} onClose={() => setReporting(false)} /> : null}

      <Modal visible={confirmExit} transparent animationType="fade" onRequestClose={() => setConfirmExit(false)}>
        <View className="flex-1 items-center justify-center bg-black/30 px-6">
          <View className="w-full rounded-[24px] bg-surface p-5 gap-3">
            <Text className="text-ink text-[20px] font-extrabold">Take a break?</Text>
            <Text className="text-ink text-[15px] leading-[22px]">
              {s.deadline_at ? 'Your answers are saved. The timer keeps running while you are away.' : 'Your answers are saved. Pick up where you left off any time.'}
            </Text>
            <Button label="Keep going" onPress={() => setConfirmExit(false)} />
            <Button
              label="Leave for now"
              variant="ghost"
              onPress={() => {
                setConfirmExit(false);
                router.back();
              }}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={confirmSubmit} transparent animationType="fade" onRequestClose={() => setConfirmSubmit(false)}>
        <View className="flex-1 items-center justify-center bg-black/30 px-6">
          <View className="w-full rounded-[24px] bg-surface p-5 gap-3">
            <Text className="text-ink text-[20px] font-extrabold">Submit your mock?</Text>
            <Text className="text-ink text-[15px] leading-[22px]">
              {allAnswered ? 'You answered every question.' : `${s.items.length - answered} unanswered ${s.items.length - answered === 1 ? 'question counts' : 'questions count'} as incorrect.`}
            </Text>
            <Button
              label="Submit"
              loading={finishing}
              onPress={() => {
                setConfirmSubmit(false);
                finish();
              }}
            />
            <Button label="Not yet" variant="ghost" onPress={() => setConfirmSubmit(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
