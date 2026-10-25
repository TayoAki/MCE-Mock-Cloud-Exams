import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Banner, Body, Button, Icon, LoadingState, Pill, Screen, Small, Title } from '@/components/ui';
import { useCurrentEnrollment, useMe, usePractice, useProgress } from '@/lib/queries';
import { useStartSession } from '@/lib/sessions';
import { colors } from '@/lib/theme';

const SIZES = [10, 20, 30];

/** Plus: choose domains and size; timed mode adds a server deadline at exam pace. */
export default function CustomQuiz() {
  const { mode } = useLocalSearchParams<{ mode: 'timed' | 'custom' }>();
  const timed = mode === 'timed';
  const { enrollment } = useCurrentEnrollment();
  const practice = usePractice(enrollment?.id);
  const progress = useProgress(enrollment?.id);
  const plusEnabled = useMe().data?.plus_enabled;
  const [domains, setDomains] = useState<string[]>([]);
  const [size, setSize] = useState(10);
  const { start, pending, error } = useStartSession();

  const locked = practice.data && !practice.data.features.includes('custom_quiz');
  const perItem = practice.data ? (practice.data.mock.duration_minutes / practice.data.mock.full_form_size) * size : 0;

  return (
    <Screen
      footer={
        <>
          {error ? <Banner tone="error">{error.message}</Banner> : null}
          <Button
            label={locked ? 'Unlock with Plus' : `Start ${size}-question ${timed ? 'timed quiz' : 'quiz'}`}
            loading={!!pending}
            onPress={() =>
              locked
                ? router.push({ pathname: '/premium', params: { feature: 'custom_quiz' } })
                : start({ enrollment_id: enrollment?.id, mode: timed ? 'timed' : 'custom', question_count: size, ...(domains.length ? { domain_ids: domains } : {}) })
            }
          />
        </>
      }
    >
      <View className="flex-row items-center justify-between">
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} className="h-11 w-11 justify-center">
          <Icon name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        {plusEnabled ? <Pill tone="primary" label="Plus" /> : null}
      </View>
      <Title>{timed ? 'Build your pace.' : 'Choose your topics.'}</Title>
      <Body muted>{timed ? `About ${Math.round(perItem)} minutes for ${size} questions, the same pace as the exam.` : 'Mix the domains you want. Fresh questions come first.'}</Body>
      {progress.isLoading ? <LoadingState /> : null}
      <Text className="text-ink text-[15px] font-bold">Size</Text>
      <View className="flex-row gap-2">
        {SIZES.map((n) => (
          <Pressable key={n} accessibilityRole="radio" aria-checked={size === n} onPress={() => setSize(n)} className={`flex-1 min-h-[48px] items-center justify-center rounded-[14px] border-2 ${size === n ? 'border-primary bg-primary-tint' : 'border-border bg-surface'}`}>
            <Text className={`text-[16px] font-bold ${size === n ? 'text-primary' : 'text-ink'}`}>{n}</Text>
          </Pressable>
        ))}
      </View>
      <Text className="text-ink text-[15px] font-bold">Domains</Text>
      <Small>Leave all unselected to mix every domain.</Small>
      {progress.data?.domains.map((d) => {
        const on = domains.includes(d.domain_id);
        return (
          <Pressable
            key={d.domain_id}
            accessibilityRole="checkbox"
            aria-checked={on}
            onPress={() => setDomains((prev) => (on ? prev.filter((x) => x !== d.domain_id) : [...prev, d.domain_id]))}
            className={`min-h-[52px] flex-row items-center gap-3 rounded-[16px] border-2 px-4 ${on ? 'border-primary bg-primary-tint' : 'border-border bg-surface'}`}
          >
            <Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.muted} />
            <Text className="flex-1 text-ink text-[15px]">{d.title}</Text>
            <Text className="text-muted text-[12px]">{d.weight_percent}%</Text>
          </Pressable>
        );
      })}
    </Screen>
  );
}
