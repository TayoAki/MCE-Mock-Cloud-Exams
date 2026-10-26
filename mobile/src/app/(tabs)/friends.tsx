import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Share, Text, TextInput, View } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { CirclePanels } from '@/components/CirclePanels';
import { Cube } from '@/components/Cube';
import { Banner, Body, Button, Card, ErrorState, Eyebrow, LoadingState, Pill, Screen, Small, Title } from '@/components/ui';
import { trackEvent } from '@/lib/analytics';
import { ApiError, post } from '@/lib/api';
import { useCircle, useCircles, useMe } from '@/lib/queries';
import { colors } from '@/lib/theme';
import { deviceTimezone } from '@/lib/timezone';

function Dots({ filled, target }: { filled: number; target: number }) {
  return (
    <View className="flex-row gap-1.5">
      {Array.from({ length: target }, (_, i) => (
        <View key={i} className={`h-5 w-5 rounded-full ${i < filled ? 'bg-primary' : 'bg-border'}`} />
      ))}
    </View>
  );
}

/** S12 (phase 2): an optional private study-day circle. Declining never blocks learning. */
export default function Friends() {
  const me = useMe();
  const circles = useCircles();
  const circleId = circles.data?.[0]?.id;
  const circle = useCircle(circleId);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [target, setTarget] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await post('/circles', { name: name.trim() || 'Study circle', timezone: deviceTimezone(), weekly_target_days: target });
      await queryClient.invalidateQueries({ queryKey: ['circles'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the circle');
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    setError(null);
    try {
      const res = await post<{ invite_url: string; expires_at: string }>(`/circles/${circleId}/invites`, {});
      trackEvent('circle_invite_requested');
      // On web the invite opens this app's /join route; native shares the certpath:// deep link.
      const token = new URL(res.invite_url.replace(/^certpath:\/\//, 'https://x/')).searchParams.get('token') ?? '';
      const link = Platform.OS === 'web' ? `${window.location.origin}/join?token=${encodeURIComponent(token)}` : res.invite_url;
      setInviteLink(link);
      // Not every browser has a share sheet; the link stays on screen either way.
      await Share.share({ message: `Join my CertPath study circle: ${link}` }).catch(() => undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create an invite');
    }
  }

  async function leave() {
    try {
      await post(`/circles/${circleId}/leave`, {});
      await queryClient.invalidateQueries({ queryKey: ['circles'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not leave the circle');
    }
  }

  const c = circle.data;
  return (
    <Screen>
      <AppHeader />
      <View className="gap-1">
        <Eyebrow>Optional · Study circle</Eyebrow>
        <Title>A little accountability.</Title>
        <Body muted>Study together, go further.</Body>
      </View>
      {circles.isLoading || (circleId && circle.isLoading) ? <LoadingState /> : null}
      {circles.error ? <ErrorState error={circles.error} onRetry={() => circles.refetch()} /> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      {me.data?.user.is_guest ? (
        <Card className="gap-2 items-center">
          <Cube size={88} />
          <Text className="text-ink text-[16px] font-bold text-center">Save your progress to join a circle</Text>
          <Small className="text-center">Circles are private and invite-only. We never upload your contacts.</Small>
          <Button label="Save my progress" onPress={() => router.push('/account')} />
        </Card>
      ) : c ? (
        <>
          <Card className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-ink text-[18px] font-extrabold">{c.name}</Text>
              <Pill tone="primary" label="Private circle" />
            </View>
            <Small>Weekly goal: study on {c.weekly_target_days} days</Small>
            {c.members.map((m) => (
              <View key={`${m.display_name}-${m.is_you}`} className="flex-row items-center gap-3" accessibilityLabel={`${m.is_you ? 'You' : m.display_name}: ${m.study_days} of ${c.weekly_target_days} study days`}>
                <View className="h-8 w-8 rounded-full bg-mint items-center justify-center">
                  <Text className="text-success font-bold">{(m.is_you ? 'You' : m.display_name).slice(0, 1)}</Text>
                </View>
                <Text className="flex-1 text-ink text-[15px]">{m.is_you ? 'You' : m.display_name}</Text>
                <Dots filled={Math.min(m.study_days, c.weekly_target_days)} target={c.weekly_target_days} />
                <Text className="w-8 text-right text-ink text-[13px] font-bold">
                  {m.study_days}/{c.weekly_target_days}
                </Text>
              </View>
            ))}
          </Card>
          <Small>{c.note} Weeks run Monday to Sunday in {c.timezone}.</Small>
          {circleId ? <CirclePanels circleId={circleId} /> : null}
          <Button label="Invite a friend" icon="share-outline" onPress={invite} />
          {inviteLink ? (
            <Banner tone="success" title="Invite link (expires in 7 days)">
              <Text selectable className="text-ink text-[14px]">
                {inviteLink}
              </Text>
            </Banner>
          ) : null}
          <Button label="Leave circle" variant="ghost" onPress={leave} />
        </>
      ) : circles.data ? (
        <>
          <View className="items-center">
            <Cube size={104} />
          </View>
          <Card className="gap-3">
            <Text className="text-ink text-[16px] font-bold">Start a private circle</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Circle name"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Circle name"
              maxLength={60}
              className="min-h-[52px] rounded-[15px] border border-border bg-surface px-4 text-[16px] text-ink"
            />
            <Text className="text-ink text-[14px] font-semibold">Weekly goal: {target} study days</Text>
            <View className="flex-row gap-2">
              {[3, 4, 5, 6, 7].map((n) => (
                <Button key={n} label={String(n)} variant={n === target ? 'primary' : 'secondary'} onPress={() => setTarget(n)} />
              ))}
            </View>
            <Button label="Create circle" loading={busy} onPress={create} />
          </Card>
          <Small>Track study days together, share a weekly quest, keep friend streaks and trade high-fives. Got an invite link? Open it on this device to join.</Small>
        </>
      ) : null}
    </Screen>
  );
}
