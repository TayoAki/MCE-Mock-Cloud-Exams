import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ApiError, post } from '@/lib/api';
import { feedback } from '@/lib/feedback';
import { useCircleActivity, useFriendStreaks } from '@/lib/queries';
import { colors } from '@/lib/theme';
import type { FriendStreakRow } from '@/lib/types';
import { FillBar, timeLeft } from './gamify';
import { popIn } from './motion';
import { Banner, Button, Card, Icon, Small, type IconName } from './ui';

/** Friend streaks, the weekly circle quest, high-fives and nudges, and recent wins. */

function ago(iso: string, now = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function SmallAction({ icon, label, onPress, done, disabled }: { icon: IconName; label: string; onPress: () => void; done?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={!!(done || disabled)}
      disabled={done || disabled}
      onPress={onPress}
      className={`h-11 w-11 items-center justify-center rounded-full border-2 ${done ? 'border-success bg-mint' : 'border-border bg-surface active:bg-primary-tint'} ${disabled ? 'opacity-50' : ''}`}
    >
      <Icon name={done ? 'checkmark' : icon} size={18} color={done ? colors.success : colors.primary} />
    </Pressable>
  );
}

function useAct() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function act(key: string, path: string, body: object, success?: string) {
    setBusy(key);
    setMessage(null);
    try {
      await post(path, body);
      feedback.tick();
      if (success) setMessage({ tone: 'success', text: success });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['friend-streaks'] }), queryClient.invalidateQueries({ queryKey: ['circle-activity'] })]);
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof ApiError ? e.message : 'That didn’t go through' });
    } finally {
      setBusy(null);
    }
  }
  return { act, busy, message };
}

function FriendStreakLine({ row, act, busy }: { row: FriendStreakRow; act: ReturnType<typeof useAct>['act']; busy: string | null }) {
  const name = row.friend.name;
  if (row.status === 'pending') {
    return (
      <View className="gap-2">
        <View className="flex-row items-center gap-3">
          <Icon name="flame-outline" size={22} color={colors.streakDark} />
          <Text className="flex-1 text-ink text-[15px]">{row.invited_by_me ? `Waiting for ${name} to accept` : `${name} wants to start a friend streak`}</Text>
        </View>
        {row.invited_by_me ? null : (
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button label="Accept" loading={busy === `accept:${row.id}`} onPress={() => act(`accept:${row.id}`, `/friend-streaks/${row.id}/accept`, {}, `Friend streak with ${name} started. Study on the same day to grow it.`)} />
            </View>
            <View className="flex-1">
              <Button label="Not now" variant="secondary" onPress={() => act(`decline:${row.id}`, `/friend-streaks/${row.id}/decline`, {})} />
            </View>
          </View>
        )}
      </View>
    );
  }
  const both = row.me_today && row.friend_today;
  return (
    <View
      className="flex-row items-center gap-3"
      accessible
      accessibilityLabel={`${row.current}-day friend streak with ${name}. ${row.me_today ? 'You studied today' : 'You haven’t studied today'}, ${row.friend_today ? `${name} studied today` : `${name} hasn’t yet`}`}
    >
      <View className={`h-10 w-10 rounded-full items-center justify-center ${row.current ? 'bg-streak' : 'bg-border'}`}>
        <Icon name="flame" size={20} color={row.current ? '#FFFFFF' : colors.muted} />
      </View>
      <View className="flex-1">
        <Text className="text-ink text-[15px] font-bold">
          {row.current} {row.current === 1 ? 'day' : 'days'} with {name}
        </Text>
        <Small>{both ? 'You both studied today' : row.me_today ? `Waiting on ${name} today` : row.friend_today ? `${name} studied. Your turn!` : 'Neither of you has studied today'}</Small>
      </View>
      <View className="flex-row gap-1" aria-hidden>
        <View className={`h-3 w-3 rounded-full ${row.me_today ? 'bg-streak' : 'bg-border'}`} />
        <View className={`h-3 w-3 rounded-full ${row.friend_today ? 'bg-streak' : 'bg-border'}`} />
      </View>
    </View>
  );
}

export function CirclePanels({ circleId }: { circleId: string }) {
  const activity = useCircleActivity(circleId);
  const friendStreaks = useFriendStreaks();
  const { act, busy, message } = useAct();
  const a = activity.data;
  const rows = friendStreaks.data ?? [];
  const streakWith = new Map(rows.map((r) => [r.friend.id, r]));
  const others = a?.members.filter((m) => !m.is_you) ?? [];

  return (
    <>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
      {a ? (
        <Card tone={a.quest.done ? 'mint' : 'surface'} className="gap-2.5">
          <View className="flex-row items-center gap-2">
            <Icon name={a.quest.done ? 'trophy' : 'flag'} size={20} color={a.quest.done ? colors.success : colors.primary} />
            <Text className="flex-1 text-ink text-[16px] font-extrabold">Circle quest</Text>
            <Text className="text-muted text-[12px] font-bold">ends in {timeLeft(a.quest.ends_at)}</Text>
          </View>
          <Text className="text-ink text-[14px]">
            {a.quest.done ? `Done! Everyone earned ${a.quest.reward_gems} gems.` : `Earn ${a.quest.target} XP together this week for ${a.quest.reward_gems} gems each.`}
          </Text>
          <FillBar value={a.quest.progress / a.quest.target} tone={a.quest.done ? 'success' : 'primary'} label={`${a.quest.progress} of ${a.quest.target} XP`} />
          <Small>
            {a.quest.progress} / {a.quest.target} XP
          </Small>
        </Card>
      ) : null}

      {rows.length ? (
        <Card className="gap-3">
          <Text className="text-ink text-[16px] font-extrabold">Friend streaks</Text>
          {rows.map((r) => (
            <FriendStreakLine key={r.id} row={r} act={act} busy={busy} />
          ))}
        </Card>
      ) : null}

      {others.length ? (
        <Card className="gap-3">
          <Text className="text-ink text-[16px] font-extrabold">Cheer your circle</Text>
          {others.map((m, i) => {
            const fs = streakWith.get(m.user_id);
            return (
              <Animated.View key={m.user_id} entering={popIn(i * 60)} className="flex-row items-center gap-2">
                <View className="h-9 w-9 rounded-full bg-mint items-center justify-center">
                  <Text className="text-success font-bold">{m.name.slice(0, 1)}</Text>
                </View>
                <View className="flex-1">
                  <Text numberOfLines={1} className="text-ink text-[15px] font-semibold">
                    {m.name}
                  </Text>
                  <Small>{`${m.weekly_xp} XP this week${m.studied_today ? ' · studied today' : ''}`}</Small>
                </View>
                <SmallAction
                  icon="hand-left"
                  label={m.high_fived_today ? `You high-fived ${m.name} today` : `High-five ${m.name}`}
                  done={m.high_fived_today}
                  disabled={busy === `hf:${m.user_id}`}
                  onPress={() => act(`hf:${m.user_id}`, `/friends/${m.user_id}/high-five`, {}, `High-five sent to ${m.name}.`)}
                />
                {m.studied_today ? null : (
                  <SmallAction
                    icon="notifications"
                    label={`Nudge ${m.name} to study today`}
                    disabled={busy === `nudge:${m.user_id}`}
                    onPress={() => act(`nudge:${m.user_id}`, `/friends/${m.user_id}/nudge`, {}, `Nudge sent. ${m.name} will see it next time they open CertPath.`)}
                  />
                )}
                {fs ? null : (
                  <SmallAction
                    icon="flame"
                    label={`Start a friend streak with ${m.name}`}
                    disabled={busy === `fs:${m.user_id}`}
                    onPress={() => act(`fs:${m.user_id}`, '/friend-streaks', { friend_id: m.user_id }, `Friend streak invite sent to ${m.name}.`)}
                  />
                )}
              </Animated.View>
            );
          })}
          <Small>High-five, nudge, or start a friend streak: study on the same day to keep it going.</Small>
        </Card>
      ) : null}

      {a?.feed.length ? (
        <Card className="gap-2.5">
          <Text className="text-ink text-[16px] font-extrabold">Recent wins</Text>
          {a.feed.slice(0, 8).map((f) => (
            <View key={`${f.user_id}-${f.at}`} className="flex-row items-center gap-2">
              <Icon name="checkmark-circle" size={18} color={colors.success} />
              <Text className="flex-1 text-ink text-[14px]">{f.is_you ? 'You' : f.name} finished a lesson</Text>
              <Small>{ago(f.at)}</Small>
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}
