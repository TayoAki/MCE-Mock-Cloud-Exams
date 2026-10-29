import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Cube } from '@/components/Cube';
import { Banner, Body, Button, Eyebrow, Icon, Screen, Small, Title } from '@/components/ui';
import { trackEvent } from '@/lib/analytics';
import { ApiError, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { newId } from '@/lib/ids';
import { colors } from '@/lib/theme';

const GOALS = [5, 10, 15] as const;

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const DATE_CHOICES = [
  { label: 'In 2 weeks', value: () => addDays(14) },
  { label: 'In a month', value: () => addDays(30) },
  { label: 'In 3 months', value: () => addDays(90) },
];

/** S02: a realistic daily pace; the exam date is optional. */
export default function DailyGoal() {
  const { version } = useLocalSearchParams<{ version: string; exam: string }>();
  const { status, startGuest } = useAuth();
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState<(typeof GOALS)[number]>(5);
  const [examDate, setExamDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One request ID for this screen so a retried tap never enrolls twice.
  const [requestId] = useState(newId);

  useEffect(() => trackEvent('onboarding_viewed', { step: 'goal' }), []);
  const dateValid = examDate === '' || /^\d{4}-\d{2}-\d{2}$/.test(examDate);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      if (status !== 'signedIn') await startGuest();
      await post('/enrollments', { exam_version_id: version, client_request_id: requestId, ...(examDate ? { exam_date: examDate } : {}) });
      await patch('/me/preferences', { daily_goal_minutes: goal });
      trackEvent('daily_goal_selected', { minutes: goal });
      await queryClient.invalidateQueries();
      router.replace('/learn');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button label="Build my path" loading={busy} disabled={!dateValid || !version} onPress={build} />}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} className="h-11 w-11 justify-center">
        <Icon name="chevron-back" size={24} color={colors.ink} />
      </Pressable>
      <Eyebrow>Step 2 of 2</Eyebrow>
      <Title>A little practice. Every day.</Title>
      <Body muted>Choose a pace that fits your life.</Body>
      <View className="items-center py-1">
        <Cube size={96} mood="proud" />
      </View>
      <View accessibilityRole="radiogroup" className="flex-row gap-3">
        {GOALS.map((g) => {
          const active = g === goal;
          return (
            <Pressable
              key={g}
              accessibilityRole="radio"
              aria-checked={active}
              accessibilityLabel={`${g} minutes a day`}
              onPress={() => setGoal(g)}
              className={`flex-1 min-h-[88px] items-center justify-center rounded-[20px] border-2 ${active ? 'border-primary bg-primary-tint' : 'border-border bg-surface'}`}
            >
              <Text className={`text-[28px] font-extrabold ${active ? 'text-primary' : 'text-ink'}`}>{g}</Text>
              <Text className="text-muted text-[13px]">min / day</Text>
            </Pressable>
          );
        })}
      </View>
      <View className="gap-2">
        <Text className="text-ink text-[15px] font-bold">Exam date · optional</Text>
        <View className="flex-row flex-wrap gap-2">
          {DATE_CHOICES.map((c) => (
            <Pressable
              key={c.label}
              accessibilityRole="button"
              onPress={() => setExamDate(c.value())}
              className="min-h-[44px] justify-center rounded-full border border-border bg-surface px-4 active:bg-primary-tint"
            >
              <Text className="text-ink text-[14px]">{c.label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={examDate}
          onChangeText={setExamDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Exam date, optional, as year-month-day"
          autoCapitalize="none"
          inputMode="numeric"
          className={`min-h-[52px] rounded-[15px] border bg-surface px-4 text-[16px] text-ink ${dateValid ? 'border-border' : 'border-coral'}`}
        />
        {!dateValid ? <Text className="text-coral-dark text-[13px]">Use the format YYYY-MM-DD, or leave it empty.</Text> : null}
        <Small>You can change your goal or pause whenever you need.</Small>
      </View>
      {error ? <Banner tone="error">{error}</Banner> : null}
    </Screen>
  );
}
