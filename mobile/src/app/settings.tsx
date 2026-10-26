import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Platform, Pressable, Switch, Text, View } from 'react-native';
import { Banner, Button, Card, Divider, ErrorState, Icon, LoadingState, NavRow, Screen, Small, Title } from '@/components/ui';
import { ApiError, patch, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setFeedbackPref, useFeedbackPrefs } from '@/lib/feedback';
import { enableReminders } from '@/lib/notifications';
import { useCurrentEnrollment, useEngagement } from '@/lib/queries';
import { colors } from '@/lib/theme';
import { deviceTimezone } from '@/lib/timezone';

const TIMES = ['07:30', '12:30', '18:00', '21:00'];

/** Account, goal, timezone, reminders, plan, outcome, privacy and deletion. */
export default function Settings() {
  const { enrollment, data: me, isLoading, error, refetch } = useCurrentEnrollment();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const feel = useFeedbackPrefs();
  const engagement = useEngagement();
  const device = deviceTimezone();

  async function update(path: string, body: object, success?: string) {
    setMessage(null);
    try {
      await patch(path, body);
      await queryClient.invalidateQueries();
      if (success) setMessage({ tone: 'success', text: success });
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof ApiError ? e.message : 'Could not save' });
    }
  }

  async function toggleReminders(on: boolean) {
    if (!on) return update('/me/preferences', { reminders_enabled: false }, 'Reminders are off.');
    const result = await enableReminders(me?.preferences.daily_local_time).catch(() => 'denied' as const);
    await queryClient.invalidateQueries();
    setMessage(result === 'denied' ? { tone: 'info', text: 'Notifications are off for CertPath. Allow them in system settings to get reminders.' } : { tone: 'success', text: 'Reminders are on.' });
  }

  async function setLeagueVisible(visible: boolean) {
    setMessage(null);
    try {
      await put('/me/league-visibility', { hidden: !visible });
      await Promise.all(['engagement', 'league'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof ApiError ? e.message : 'Could not save' });
    }
  }

  async function deleteAccount() {
    try {
      await post('/me/deletion-request', {});
      setConfirmDelete(false);
      await signOut();
      router.replace('/onboarding/exam');
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof ApiError ? e.message : 'Could not request deletion' });
    }
  }

  if (isLoading) return <Screen><LoadingState /></Screen>;
  if (error || !me) return <Screen><ErrorState error={error} onRetry={() => refetch()} /></Screen>;
  const u = me.user;
  const prefs = me.preferences;

  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} className="h-11 w-11 justify-center">
        <Icon name="chevron-back" size={24} color={colors.ink} />
      </Pressable>
      <Title>Settings</Title>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

      <Card className="gap-1">
        <Text className="text-ink text-[17px] font-bold">{u.display_name}</Text>
        <Small>{u.is_guest ? 'Guest · progress is saved on our server for this device only' : u.email ?? ''}</Small>
      </Card>
      {u.is_guest ? <NavRow icon="cloud-upload-outline" title="Save your progress" subtitle="Create an account" onPress={() => router.push('/account')} /> : null}

      <Text className="text-muted text-xs font-bold uppercase tracking-wider pt-2">Daily goal</Text>
      <View className="flex-row gap-2">
        {[5, 10, 15].map((g) => (
          <Pressable key={g} accessibilityRole="radio" aria-checked={u.daily_goal_minutes === g} onPress={() => update('/me/preferences', { daily_goal_minutes: g })} className={`flex-1 min-h-[48px] items-center justify-center rounded-[14px] border-2 ${u.daily_goal_minutes === g ? 'border-primary bg-primary-tint' : 'border-border bg-surface'}`}>
            <Text className={`text-[15px] font-bold ${u.daily_goal_minutes === g ? 'text-primary' : 'text-ink'}`}>{g} min</Text>
          </Pressable>
        ))}
      </View>

      <Text className="text-muted text-xs font-bold uppercase tracking-wider pt-2">Study days and reminders</Text>
      <Card className="gap-3">
        <View className="gap-0.5">
          <Text className="text-ink text-[15px] font-bold">Timezone: {u.timezone}</Text>
          {u.pending_timezone ? (
            <Small>{`Changes to ${u.pending_timezone.zone} at your next midnight. Past study days stay as recorded.`}</Small>
          ) : (
            <Small>Your study days follow this timezone.</Small>
          )}
        </View>
        {device !== u.timezone && device !== u.pending_timezone?.zone ? (
          <Button label={`Use this device's timezone (${device})`} variant="secondary" onPress={() => update('/me/preferences', { timezone: device }, 'Timezone updated.')} />
        ) : null}
        <Divider />
        <View className="flex-row items-center justify-between min-h-[44px]">
          <Text className="text-ink text-[15px] font-bold">Daily reminder</Text>
          <Switch
            accessibilityLabel="Daily reminder"
            value={prefs.reminders_enabled}
            onValueChange={toggleReminders}
            trackColor={{ true: colors.primary, false: colors.locked }}
          />
        </View>
        {prefs.reminders_enabled ? (
          <>
            <View className="flex-row flex-wrap gap-2">
              {TIMES.map((t) => (
                <Pressable key={t} accessibilityRole="radio" aria-checked={prefs.daily_local_time === t} onPress={() => update('/me/preferences', { daily_local_time: t })} className={`min-h-[44px] justify-center rounded-full border px-4 ${prefs.daily_local_time === t ? 'border-primary bg-primary-tint' : 'border-border bg-surface'}`}>
                  <Text className="text-ink text-[14px]">{t}</Text>
                </Pressable>
              ))}
            </View>
            <Small>{`Quiet hours ${prefs.quiet_start}–${prefs.quiet_end}. No reminder once you've studied that day.`}</Small>
          </>
        ) : null}
      </Card>

      <Text className="text-muted text-xs font-bold uppercase tracking-wider pt-2">Sound and feel</Text>
      <Card className="gap-3">
        <View className="flex-row items-center justify-between min-h-[44px]">
          <View className="flex-1 pr-3">
            <Text className="text-ink text-[15px] font-bold">Sound effects</Text>
            <Small>Quiet when your phone is on silent.</Small>
          </View>
          <Switch accessibilityLabel="Sound effects" value={feel.sound} onValueChange={(on) => setFeedbackPref('sound', on)} trackColor={{ true: colors.primary, false: colors.locked }} />
        </View>
        {Platform.OS !== 'web' ? (
          <>
            <Divider />
            <View className="flex-row items-center justify-between min-h-[44px]">
              <Text className="text-ink text-[15px] font-bold">Haptics</Text>
              <Switch accessibilityLabel="Haptics" value={feel.haptics} onValueChange={(on) => setFeedbackPref('haptics', on)} trackColor={{ true: colors.primary, false: colors.locked }} />
            </View>
          </>
        ) : null}
        <Small>Animations follow your device’s Reduce Motion setting.</Small>
      </Card>

      {engagement.data ? (
        <>
          <Text className="text-muted text-xs font-bold uppercase tracking-wider pt-2">Leagues</Text>
          <Card className="gap-2">
            <View className="flex-row items-center justify-between min-h-[44px]">
              <View className="flex-1 pr-3">
                <Text className="text-ink text-[15px] font-bold">Show me in leagues</Text>
                <Small>{u.is_guest ? 'Others see an anonymous name.' : `Others see “${u.display_name}” and your weekly XP.`}</Small>
              </View>
              <Switch
                accessibilityLabel="Show me in leagues"
                value={!engagement.data.league.hidden}
                onValueChange={setLeagueVisible}
                trackColor={{ true: colors.primary, false: colors.locked }}
              />
            </View>
          </Card>
        </>
      ) : null}

      {enrollment ? (
        <>
          <Text className="text-muted text-xs font-bold uppercase tracking-wider pt-2">Exam</Text>
          <Card className="gap-3">
            <Small>{enrollment.exam_date ? `Exam date: ${enrollment.exam_date}` : 'No exam date set'}</Small>
            {enrollment.status === 'active' ? (
              <Button label="Pause study reminders" variant="secondary" onPress={() => update(`/enrollments/${enrollment.id}`, { status: 'paused' }, 'Paused. Your path stays available.')} />
            ) : enrollment.status === 'paused' ? (
              <Button label="Resume" variant="secondary" onPress={() => update(`/enrollments/${enrollment.id}`, { status: 'active' }, 'Welcome back.')} />
            ) : null}
            <NavRow icon="ribbon-outline" title="Record my exam result" onPress={() => router.push('/outcome')} />
          </Card>
        </>
      ) : null}

      {me.plus_enabled ? (
        <>
          <Text className="text-muted text-xs font-bold uppercase tracking-wider pt-2">Plan</Text>
          <NavRow icon="sparkles-outline" title={me.plus_active ? 'Plus is active' : 'CertPath Plus'} subtitle={me.plus_active && me.plus_ends_at ? `Until ${new Date(me.plus_ends_at).toLocaleDateString()}` : 'Free plan'} onPress={() => router.push('/premium')} />
        </>
      ) : null}

      <Text className="text-muted text-xs font-bold uppercase tracking-wider pt-2">Privacy</Text>
      <Small>We keep analytics free of your email, answers and reasoning. Deleting your account stops reminders immediately and removes your learning data after a short grace period.</Small>
      <Button label="Sign out" variant="secondary" onPress={async () => { await signOut(); router.replace('/onboarding/exam'); }} />
      <Button label="Delete my account" variant="danger" onPress={() => setConfirmDelete(true)} />

      <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(false)}>
        <View className="flex-1 items-center justify-center bg-black/30 px-6">
          <View className="w-full rounded-[24px] bg-surface p-5 gap-3">
            <Text className="text-ink text-[20px] font-extrabold">Delete your account?</Text>
            <Text className="text-ink text-[15px] leading-[22px]">Reminders stop now and you’ll be signed out everywhere. Your progress, streak and circle membership are then deleted. Store purchases are managed by the store.</Text>
            <Button label="Delete account" variant="danger" onPress={deleteAccount} />
            <Button label="Cancel" variant="ghost" onPress={() => setConfirmDelete(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
