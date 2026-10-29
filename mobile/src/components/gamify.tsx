import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { ApiError, post } from '@/lib/api';
import { feedback } from '@/lib/feedback';
import { colors } from '@/lib/theme';
import type { Badge, ChestReward, LeagueTier, Level, Quest } from '@/lib/types';
import { Confetti, popIn, riseIn } from './motion';
import { Banner, Button, Icon, ProgressBar, type IconName } from './ui';

/** Shared pieces for gems, quests, levels, badges, leagues and the quest chest. */

export const TIER_STYLE: Record<LeagueTier, { label: string; color: string; tint: string }> = {
  bronze: { label: 'Bronze', color: '#B66A2C', tint: '#F8E6D6' },
  silver: { label: 'Silver', color: '#6B7587', tint: '#ECEFF4' },
  gold: { label: 'Gold', color: '#A87E00', tint: '#FFF4CC' },
  platinum: { label: 'Platinum', color: '#1F7F97', tint: '#DDF3F9' },
  diamond: { label: 'Diamond', color: '#2F6AD8', tint: '#E1ECFF' },
  lakehouse: { label: 'Lakehouse', color: colors.primary, tint: colors.primaryTint },
};

/** Server badge icons are Ionicons names; anything unknown falls back to a ribbon. */
export function iconFor(name: string | null | undefined, fallback: IconName = 'ribbon'): IconName {
  return name && name in Ionicons.glyphMap ? (name as IconName) : fallback;
}

export function TierBadge({ tier, size = 40, dim }: { tier: LeagueTier; size?: number; dim?: boolean }) {
  const t = TIER_STYLE[tier];
  return (
    <View
      accessibilityLabel={`${t.label} league`}
      className="items-center justify-center rounded-full"
      style={{ width: size, height: size, backgroundColor: dim ? colors.border : t.tint }}
    >
      <Icon name="shield" size={size * 0.55} color={dim ? colors.locked : t.color} />
    </View>
  );
}

export function GemPill({ gems }: { gems: number }) {
  return (
    <View accessibilityLabel={`${gems} gems`} className="flex-row items-center gap-1 rounded-full px-2.5 py-1 bg-gem-tint">
      <Icon name="diamond" size={13} color={colors.gemDark} />
      <Text className="text-gem-dark text-xs font-bold">{gems}</Text>
    </View>
  );
}

/** A progress bar that fills from `from` after `delay` ms, for result screens. */
export function FillBar({ value, from = 0, delay = 0, tone, label }: { value: number; from?: number; delay?: number; tone?: 'primary' | 'success' | 'streak' | 'gem'; label?: string }) {
  const [shown, setShown] = useState(delay ? from : value);
  useEffect(() => {
    const timer = setTimeout(() => setShown(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return <ProgressBar value={shown} tone={tone} label={label} />;
}

export function QuestRow({ quest, from, delay }: { quest: Quest; from?: number; delay?: number }) {
  return (
    <View className="gap-1.5" accessible accessibilityLabel={`${quest.label}: ${quest.progress} of ${quest.target}${quest.done ? ', complete' : ''}`}>
      <View className="flex-row items-center gap-2">
        <Icon name={quest.done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={quest.done ? colors.success : colors.muted} />
        <Text className="flex-1 text-ink text-[15px] font-semibold">{quest.label}</Text>
        <Text className="text-muted text-[13px] font-bold">
          {quest.progress}/{quest.target}
        </Text>
      </View>
      <FillBar value={quest.target ? quest.progress / quest.target : 0} from={from} delay={delay} tone={quest.done ? 'success' : 'streak'} />
    </View>
  );
}

export function LevelBar({ level, from, delay }: { level: Level; from?: number; delay?: number }) {
  const span = Math.max(1, level.next - level.floor);
  return (
    <View className="gap-1.5">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-ink text-[16px] font-extrabold">
          Level {level.level} · {level.title}
        </Text>
        <Text className="text-muted text-[12px] font-bold">{level.next - level.xp} XP to next</Text>
      </View>
      <FillBar value={(level.xp - level.floor) / span} from={from} delay={delay} label={`Level ${level.level} progress`} />
    </View>
  );
}

export function StatTile({ icon, label, value, color, tint, delay = 0 }: { icon: IconName; label: string; value: string; color: string; tint: string; delay?: number }) {
  return (
    <Animated.View entering={popIn(delay)} className="flex-1">
      <View accessible accessibilityLabel={`${label}: ${value}`} className="rounded-[18px] border-2 items-center py-2.5 gap-1" style={{ borderColor: color, backgroundColor: tint }}>
        <Text className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color }}>
          {label}
        </Text>
        <View className="flex-row items-center gap-1">
          <Icon name={icon} size={16} color={color} />
          <Text className="text-ink text-[18px] font-extrabold">{value}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

export function BadgeMedal({ badge, size = 56 }: { badge: Pick<Badge, 'title' | 'description' | 'icon' | 'earned_at'>; size?: number }) {
  const earned = !!badge.earned_at;
  return (
    <View accessible accessibilityLabel={`${badge.title}. ${badge.description}. ${earned ? 'Earned' : 'Not earned yet'}`} className="items-center gap-1.5 w-full">
      <View
        className={`items-center justify-center rounded-full border-4 ${earned ? 'bg-streak-tint border-streak' : 'bg-border border-locked'}`}
        style={{ width: size, height: size }}
      >
        <Icon name={earned ? iconFor(badge.icon) : 'lock-closed'} size={size * 0.42} color={earned ? colors.streakDark : colors.muted} />
      </View>
      <Text numberOfLines={2} className={`text-center text-[12px] font-bold ${earned ? 'text-ink' : 'text-muted'}`}>
        {badge.title}
      </Text>
    </View>
  );
}

export function chestRewardText(reward: ChestReward) {
  if (reward.kind === 'gems') return { icon: 'diamond' as const, title: `${reward.amount} gems`, body: 'Spend them on streak freezes and more in the shop.' };
  if (reward.kind === 'xp_boost') return { icon: 'flash' as const, title: `Double XP for ${reward.minutes} minutes`, body: 'Every answer earns twice the XP while it lasts.' };
  return { icon: 'snow' as const, title: 'A streak freeze', body: 'It covers one missed day so your streak survives.' };
}

function Wiggle({ active, children }: { active: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const r = useSharedValue(0);
  useEffect(() => {
    if (!active || reduced) {
      r.set(withTiming(0, { duration: 100 }));
      return;
    }
    const t = (to: number) => withTiming(to, { duration: 70 });
    r.set(withRepeat(withSequence(t(-8), t(8), t(-6), t(6), t(0), withTiming(0, { duration: 500 })), -1));
  }, [active, reduced, r]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.get()}deg` }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * The daily quest chest: it rattles until tapped, then opens on the server and
 * reveals the reward. Opening twice returns the same reward.
 */
export function ChestModal({ visible, onClose, onOpened }: { visible: boolean; onClose: () => void; onOpened?: () => void }) {
  const queryClient = useQueryClient();
  const [reward, setReward] = useState<ChestReward | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    feedback.tick();
    try {
      const res = await post<{ reward: ChestReward }>('/me/quests/chest', {});
      setReward(res.reward);
      onOpened?.();
      feedback.unlock();
      queryClient.invalidateQueries({ queryKey: ['quests'] });
      queryClient.invalidateQueries({ queryKey: ['engagement'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open the chest');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setReward(null);
    setError(null);
    onClose();
  }

  const text = reward ? chestRewardText(reward) : null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-[420px] rounded-[28px] bg-surface p-6 gap-4 items-center">
          {text ? (
            <>
              <Animated.View entering={popIn(0)} className="h-28 w-28 rounded-full bg-streak-tint items-center justify-center">
                <Icon name={text.icon} size={56} color={text.icon === 'diamond' ? colors.gem : text.icon === 'snow' ? colors.gemDark : colors.streakDark} />
              </Animated.View>
              <Animated.View entering={riseIn(150)} className="items-center gap-1">
                <Text className="text-muted text-xs font-bold uppercase tracking-wider">You got</Text>
                <Text accessibilityRole="header" className="text-ink text-[24px] font-extrabold text-center">
                  {text.title}
                </Text>
                <Text className="text-muted text-[15px] text-center">{text.body}</Text>
              </Animated.View>
              <View className="w-full">
                <Button label="Collect" onPress={close} />
              </View>
            </>
          ) : (
            <>
              <Wiggle active={!busy}>
                <View className="h-28 w-28 rounded-[28px] bg-streak items-center justify-center border-b-8 border-streak-dark">
                  <Icon name="gift" size={58} color="#FFFFFF" />
                </View>
              </Wiggle>
              <Text accessibilityRole="header" className="text-ink text-[22px] font-extrabold text-center">
                All three quests done!
              </Text>
              <Text className="text-muted text-[15px] text-center">Your chest holds gems, a double-XP boost or a streak freeze.</Text>
              {error ? <Banner tone="error">{error}</Banner> : null}
              <View className="w-full gap-2">
                <Button label="Open chest" loading={busy} onPress={open} />
                <Button label="Later" variant="ghost" onPress={close} />
              </View>
            </>
          )}
        </View>
      </View>
      {reward ? <Confetti count={70} /> : null}
    </Modal>
  );
}

/** A row-sized button that opens the chest; it pulses gently while waiting. */
export function ChestButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open your quest chest"
      onPress={onPress}
      className="min-h-[56px] flex-row items-center gap-3 rounded-[18px] bg-streak px-4 py-3 border-b-4 border-streak-dark active:opacity-90"
    >
      <Wiggle active>
        <Icon name="gift" size={26} color="#FFFFFF" />
      </Wiggle>
      <Text className="flex-1 text-white text-[16px] font-extrabold">Open your chest</Text>
      <Icon name="chevron-forward" size={18} color="#FFFFFF" />
    </Pressable>
  );
}

/** Hours and minutes until a timestamp, for league and quest deadlines. */
export function timeLeft(until: Date | string, now = new Date()) {
  const ms = Math.max(0, new Date(until).getTime() - now.getTime());
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

/** The learner's next local midnight, when daily quests reset. */
export function nextMidnight(now = new Date()) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d;
}

/** Learn-tab card: today's quest count, with the chest calling once all three are done. */
export function QuestsSummary({ quests, chestReady, onPress }: { quests: Quest[]; chestReady: boolean; onPress: () => void }) {
  const done = quests.filter((q) => q.done).length;
  const next = quests.find((q) => !q.done);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Daily quests: ${done} of ${quests.length} done${chestReady ? '. Your chest is ready' : ''}`}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-[20px] bg-surface border border-border px-4 py-3 active:bg-primary-tint"
    >
      <Wiggle active={chestReady}>
        <View className={`h-11 w-11 rounded-[12px] items-center justify-center ${chestReady ? 'bg-streak' : done ? 'bg-streak-tint' : 'bg-border'}`}>
          <Icon name="gift" size={24} color={chestReady ? '#FFFFFF' : done ? colors.streakDark : colors.muted} />
        </View>
      </Wiggle>
      <View className="flex-1 gap-1.5">
        <View className="flex-row items-center justify-between">
          <Text className="text-ink text-[15px] font-bold">{chestReady ? 'Your chest is ready!' : 'Daily quests'}</Text>
          <Text className="text-muted text-[13px] font-bold">
            {done}/{quests.length}
          </Text>
        </View>
        <View className="flex-row gap-1.5">
          {quests.map((q) => (
            <View key={q.key} className={`flex-1 h-2 rounded-full ${q.done ? 'bg-success' : q.progress ? 'bg-streak' : 'bg-border'}`} />
          ))}
        </View>
        {next && !chestReady ? (
          <Text numberOfLines={1} className="text-muted text-[12px]">
            Next: {next.label} ({next.progress}/{next.target})
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}
