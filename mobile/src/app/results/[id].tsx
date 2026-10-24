import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DomainBar } from '@/components/DomainBar';
import { Banner, Body, Button, Card, ErrorState, Icon, LoadingState, Pill, Screen, Small, Title } from '@/components/ui';
import { get } from '@/lib/api';
import { useRefreshLearning } from '@/lib/queries';
import { useStartSession } from '@/lib/sessions';
import { colors } from '@/lib/theme';
import type { Completion, SessionFeedback } from '@/lib/types';

/** S10: raw score with domain denominators. Never a pass prediction. */
export default function MockResults() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const refresh = useRefreshLearning();
  const result = useQuery({ queryKey: ['results', id], queryFn: () => get<Completion & { enrollment_id?: string }>(`/sessions/${id}/results`) });
  const session = useQuery({ queryKey: ['session', id], queryFn: () => get<{ enrollment_id: string }>(`/sessions/${id}`) });
  const [showAnswers, setShowAnswers] = useState(false);
  const feedback = useQuery({ queryKey: ['feedback', id], queryFn: () => get<SessionFeedback>(`/sessions/${id}/feedback`), enabled: showAnswers });
  const { start, pending, error } = useStartSession();

  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (result.isLoading) return <Screen><LoadingState label="Finalizing your results" /></Screen>;
  if (result.error || !result.data) return <Screen><ErrorState error={result.error} onRetry={() => result.refetch()} /></Screen>;
  const c = result.data;
  const pct = c.total ? Math.round((c.correct / c.total) * 100) : 0;
  const weakest = [...c.domains].filter((d) => d.total > 0).sort((a, b) => a.correct / a.total - b.correct / b.total)[0];

  return (
    <Screen
      footer={
        <>
          {error ? <Banner tone="error">{error.message}</Banner> : null}
          <Button
            label="Practice weak topics"
            loading={pending === 'weakest'}
            disabled={!session.data}
            onPress={() => start({ enrollment_id: session.data?.enrollment_id, mode: 'weakest' })}
          />
          <Button label="Back to practice" variant="ghost" onPress={() => router.dismissTo('/practice')} />
        </>
      }
    >
      <Small>{c.sample ? `${c.total}-question sample` : 'Full mock'}{c.fresh_count !== null ? ` · ${c.fresh_count} new to you` : ''}</Small>
      <Title>Your practice results.</Title>
      <Body muted>Find your next useful step.</Body>
      {c.status === 'expired' ? <Banner tone="warn" title="Time ran out">Unanswered questions count as incorrect. You answered {c.answered} of {c.total}.</Banner> : null}

      <Card className="items-center gap-2 py-6">
        <Text className="text-ink text-[44px] font-extrabold" accessibilityLabel={`${c.correct} of ${c.total} correct`}>
          {c.correct} / {c.total}
        </Text>
        <Pill tone="mint" label={`${pct}% correct`} />
        <Small>Practice score · not a pass prediction</Small>
      </Card>

      <Card className="gap-3">
        <Text className="text-ink text-[17px] font-extrabold">Performance by domain</Text>
        {c.domains.map((d) => (
          <DomainBar key={d.domain_id} title={d.title} correct={d.correct} total={d.total} />
        ))}
        {c.sample ? <Small>Samples have only a few questions per domain, so treat these as hints, not measurements.</Small> : null}
      </Card>

      {weakest && weakest.correct < weakest.total ? (
        <Card tone="mint" className="gap-1">
          <Text className="text-success text-[16px] font-bold">Next up: a focused practice set</Text>
          <Text className="text-ink text-[14px]">
            Start with {weakest.title.toLowerCase()} ({weakest.correct}/{weakest.total}), then revisit your missed questions.
          </Text>
        </Card>
      ) : null}

      <Pressable
        accessibilityRole="button"
        aria-expanded={showAnswers}
        onPress={() => setShowAnswers((v) => !v)}
        className="min-h-[52px] flex-row items-center justify-between rounded-[20px] bg-surface border border-border px-4"
      >
        <Text className="text-ink text-[15px] font-bold">Review answers and explanations</Text>
        <Icon name={showAnswers ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {showAnswers && feedback.isLoading ? <LoadingState /> : null}
      {showAnswers && feedback.data
        ? feedback.data.items.map((item) => (
            <Card key={item.session_item_id} className="gap-2">
              <View className="flex-row items-center gap-2">
                <Icon name={item.feedback.correct ? 'checkmark-circle' : item.answered ? 'close-circle' : 'remove-circle'} size={20} color={item.feedback.correct ? colors.success : colors.coralDark} />
                <Text className="text-muted text-[13px] font-semibold">
                  Question {item.position} · {item.feedback.correct ? 'Correct' : item.answered ? 'Incorrect' : 'Not answered'}
                </Text>
              </View>
              <Text className="text-ink text-[15px] font-bold">{item.prompt}</Text>
              {item.options.map((o) => {
                const right = item.feedback.correct_options.includes(o.key);
                const mine = item.selected_options.includes(o.key);
                return (
                  <Text key={o.key} className={`text-[14px] ${right ? 'text-success font-bold' : mine ? 'text-coral-dark' : 'text-muted'}`}>
                    {o.key}. {o.text}
                    {right ? '  ✓ correct' : mine ? '  ✗ your answer' : ''}
                  </Text>
                );
              })}
              <Text className="text-ink text-[14px] leading-5">{item.feedback.rationale}</Text>
            </Card>
          ))
        : null}
    </Screen>
  );
}
