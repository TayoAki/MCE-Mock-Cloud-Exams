import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Cube } from '@/components/Cube';
import { Banner, Body, Button, Card, Icon, Pill, Screen, Small, Title } from '@/components/ui';
import { trackEvent } from '@/lib/analytics';
import { ApiError, post } from '@/lib/api';
import { newId } from '@/lib/ids';
import { useMe } from '@/lib/queries';
import { colors } from '@/lib/theme';

const FEATURE_COPY: Record<string, string> = {
  mocks: 'Full mock exams are part of Plus.',
  custom_quiz: 'Timed and custom quizzes are part of Plus.',
  ai_explain: 'Extra explanations are part of Plus.',
  full_bank: 'The full question bank is part of Plus.',
};

/** S13: an explicit, no-card, nonrenewing 14-day preview. The free plan stays. */
export default function Premium() {
  const { feature } = useLocalSearchParams<{ feature?: string }>();
  const me = useMe();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(newId);

  useEffect(() => trackEvent('paywall_viewed', { surface: feature || 'direct' }), [feature]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/learn'));
  const [endDate] = useState(() => new Date(Date.now() + 14 * 86_400_000).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }));
  const m = me.data;

  if (m && !m.plus_enabled) {
    return (
      <Screen footer={<Button label="Back to learning" onPress={close} />}>
        <View className="items-center pt-6">
          <Cube size={96} mood="proud" />
        </View>
        <Title>Everything is free right now.</Title>
        <Body muted>The full question bank, timed and custom quizzes, mock exams and extra explanations are all included. There is nothing to buy.</Body>
      </Screen>
    );
  }

  async function startPreview() {
    if (m?.user.is_guest) {
      router.push('/account');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post('/me/preview', { accept_terms: true, client_request_id: requestId });
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the preview');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button label="Keep using free" variant="ghost" onPress={close} />}>
      <View className="flex-row items-center justify-between">
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} className="h-11 w-11 justify-center">
          <Icon name="close" size={28} color={colors.ink} />
        </Pressable>
        <Pill tone="primary" label="CertPath Plus" />
      </View>
      <View className="items-center">
        <Cube size={96} mood="proud" />
      </View>
      <Title>More ways to prepare.</Title>
      <Body muted>{feature && FEATURE_COPY[feature] ? FEATURE_COPY[feature] : 'Keep your daily lesson free.'}</Body>
      <View className="gap-2.5">
        {['Full question bank', 'Custom and timed quizzes, full mocks', 'Contextual explanations after a miss'].map((t) => (
          <View key={t} className="flex-row items-center gap-2.5">
            <Icon name="add-circle" size={18} color={colors.success} />
            <Text className="text-ink text-[15px]">{t}</Text>
          </View>
        ))}
      </View>

      {m?.plus_active ? (
        <Banner tone="success" title="Plus is active">
          {`Your access runs until ${m.plus_ends_at ? new Date(m.plus_ends_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'its end date'}. Then you continue on the free plan with all your history.`}
        </Banner>
      ) : m?.preview_used ? (
        <Banner tone="info" title="Your free preview has ended">Your attempts, corrections and history are all still here on the free plan.</Banner>
      ) : (
        <Card tone="tint" className="gap-2">
          <Text className="text-ink text-[18px] font-extrabold">Try 14 days of Plus</Text>
          <Text className="text-ink text-[14px] leading-5">
            No card. No automatic renewal. It ends on {endDate}, then you continue on the free plan.
          </Text>
          {m?.user.is_guest ? <Small>Save your progress with an account first, so the preview stays with you.</Small> : null}
          {error ? <Banner tone="error">{error}</Banner> : null}
          <Button label={m?.user.is_guest ? 'Save progress to start' : 'Start free preview'} loading={busy} onPress={startPreview} />
        </Card>
      )}

      <View className="flex-row gap-3">
        <Card className="flex-1 gap-0.5">
          <Text className="text-muted text-[12px] font-bold">Monthly</Text>
          <Text className="text-ink text-[22px] font-extrabold">$12.99</Text>
          <Small>per month</Small>
        </Card>
        <Card className="flex-1 gap-0.5">
          <Text className="text-muted text-[12px] font-bold">Annual</Text>
          <Text className="text-ink text-[22px] font-extrabold">$79.99</Text>
          <Small>per year</Small>
        </Card>
      </View>
      <Small>
        Illustrative USD pricing. Paid plans would show the store’s local price and renew until cancelled. Store purchases and restores are not connected in this build.
      </Small>
    </Screen>
  );
}
