import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Cube } from '@/components/Cube';
import { Body, Button, Eyebrow, ErrorState, Icon, LoadingState, Pill, Screen, Small, Title } from '@/components/ui';
import { trackEvent } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { useExams } from '@/lib/queries';
import { colors } from '@/lib/theme';
import type { Exam } from '@/lib/types';

const LETTER: Record<Exam['provider'], string> = { databricks: 'D', aws: 'A', microsoft: 'F' };

/** S01: choose a supported exam. Planned banks are visible but cannot start. */
export default function ChooseExam() {
  const exams = useExams();
  const { status } = useAuth();
  const [picked, setSelected] = useState<string | null>(null);
  // Default to the first enrollable exam until the learner picks one.
  const selected = picked ?? exams.data?.find((e) => e.enrollable)?.id ?? null;

  useEffect(() => trackEvent('onboarding_viewed', { step: 'exam' }), []);

  const choice = exams.data?.find((e) => e.id === selected);
  return (
    <Screen
      footer={
        <>
          <Button
            label="Continue"
            disabled={!choice?.enrollable}
            onPress={() => {
              const version = choice?.current_version_id;
              if (version) router.push({ pathname: '/onboarding/goal', params: { version } });
            }}
          />
          {status === 'signedOut' ? <Button label="I already have an account" variant="ghost" onPress={() => router.push('/account?mode=signin')} /> : null}
        </>
      }
    >
      <Eyebrow>Step 1 of 2</Eyebrow>
      <Title>What are you working toward?</Title>
      <Body muted>Small lessons. A real certification goal.</Body>
      <View className="items-center py-2">
        <Cube size={104} />
      </View>
      {exams.isLoading ? <LoadingState /> : null}
      {exams.error ? <ErrorState error={exams.error} onRetry={() => exams.refetch()} /> : null}
      <View accessibilityRole="radiogroup" className="gap-3">
        {exams.data?.map((exam) => {
          const active = exam.id === selected;
          return (
            <Pressable
              key={exam.id}
              accessibilityRole="radio"
              aria-checked={active} aria-disabled={!exam.enrollable}
              accessibilityLabel={`${exam.title}, ${exam.subtitle}${exam.enrollable ? '' : ', planned, not available yet'}`}
              disabled={!exam.enrollable}
              onPress={() => setSelected(exam.id)}
              className={`min-h-[72px] flex-row items-center gap-3 rounded-[20px] border-2 px-4 py-3 ${
                active ? 'border-primary bg-primary-tint' : 'border-border bg-surface'
              } ${exam.enrollable ? '' : 'opacity-60'}`}
            >
              <View className={`h-10 w-10 rounded-xl items-center justify-center ${active ? 'bg-primary' : 'bg-primary-tint'}`}>
                <Text className={`text-[17px] font-extrabold ${active ? 'text-white' : 'text-primary'}`}>{LETTER[exam.provider]}</Text>
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="text-ink text-[16px] font-bold">{exam.title}</Text>
                <Text className="text-muted text-[13px]">
                  {exam.subtitle} · {exam.enrollable ? 'Pilot' : 'Planned'}
                </Text>
              </View>
              {exam.enrollable ? (
                active ? <Icon name="checkmark-circle" size={24} color={colors.primary} /> : null
              ) : (
                <Pill tone="muted" label="Planned" />
              )}
            </Pressable>
          );
        })}
      </View>
      <Small>Start with one carefully reviewed exam bank. More paths come after the pilot.</Small>
    </Screen>
  );
}
