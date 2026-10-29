import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Banner, Body, Button, Card, ErrorState, Icon, LoadingState, Pill, Screen, Small, Title } from '@/components/ui';
import { useCurrentEnrollment, useExams, usePractice } from '@/lib/queries';
import { useStartSession } from '@/lib/sessions';
import { colors } from '@/lib/theme';

/** S09: format, timing and guide version up front; no feedback until the end. */
export default function MockSetup() {
  const { enrollment } = useCurrentEnrollment();
  const practice = usePractice(enrollment?.id);
  const exams = useExams();
  const { start, pending, error } = useStartSession();
  const p = practice.data;
  const exam = exams.data?.find((e) => e.id === enrollment?.exam_id);
  const fullReady = !!p?.mock.full_form_available;
  const hasMocks = !!p?.features.includes('mocks');

  return (
    <Screen
      footer={
        p ? (
          <>
            {error ? <Banner tone={error.code === 'insufficient_inventory' ? 'warn' : 'error'}>{error.message}</Banner> : null}
            {fullReady ? (
              <Button
                label={hasMocks ? `Start full ${p.mock.full_form_size}-question mock` : 'Full mocks are part of Plus'}
                variant={hasMocks ? 'primary' : 'secondary'}
                loading={pending === 'mock'}
                onPress={() => (hasMocks ? start({ enrollment_id: enrollment?.id, mode: 'mock' }) : router.push({ pathname: '/premium', params: { feature: 'mocks' } }))}
              />
            ) : null}
            <Button
              label={`Start ${p.mock.sample_size}-question sample`}
              variant={fullReady ? 'secondary' : 'primary'}
              loading={pending === 'mock'}
              onPress={() => start({ enrollment_id: enrollment?.id, mode: 'mock', question_count: p.mock.sample_size })}
            />
          </>
        ) : null
      }
    >
      <View className="flex-row items-center justify-between">
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} className="h-11 w-11 justify-center">
          <Icon name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Pill tone="primary" label="Practice mode" />
      </View>
      <Title>A dress rehearsal for exam day.</Title>
      <Body muted>A focused run, with feedback at the end.</Body>
      {practice.isLoading ? <LoadingState /> : null}
      {practice.error ? <ErrorState error={practice.error} onRetry={() => practice.refetch()} /> : null}
      {p ? (
        <>
          <Card className="gap-3">
            <View className="flex-row gap-8">
              <View>
                <Text className="text-ink text-[30px] font-extrabold">{p.mock.full_form_size}</Text>
                <Text className="text-muted text-[13px]">questions</Text>
              </View>
              <View>
                <Text className="text-ink text-[30px] font-extrabold">{p.mock.duration_minutes}</Text>
                <Text className="text-muted text-[13px]">minutes</Text>
              </View>
            </View>
            <Small>
              {exam ? `${exam.title} ${exam.subtitle}` : 'Exam'}
              {exam?.current_version ? ` · guide ${exam.current_version.version_label}` : ''}
            </Small>
          </Card>
          <View className="gap-2.5">
            {['Review explanations after submission', 'See performance by exam domain', 'Get a focused next step'].map((t) => (
              <View key={t} className="flex-row items-center gap-2.5">
                <Icon name="add-circle" size={18} color={colors.success} />
                <Text className="text-ink text-[15px]">{t}</Text>
              </View>
            ))}
          </View>
          {!fullReady ? (
            <Card tone="tint" className="gap-1.5">
              <Text className="text-ink text-[16px] font-bold">This is a short sample</Text>
              <Text className="text-ink text-[14px] leading-5">
                A full mock needs more reviewed questions than the bank has today, so we won’t call a smaller set a full exam. The sample has {p.mock.sample_size} original questions and {p.mock.sample_minutes} minutes, balanced across the exam’s domains.
              </Text>
            </Card>
          ) : null}
          <Banner tone="info" title="The timer keeps running">
            If you leave the app, your answers are saved and the deadline continues on the server.
          </Banner>
          <Small>Practice percentages do not predict a pass.</Small>
        </>
      ) : null}
    </Screen>
  );
}
