import { useQueryClient } from '@tanstack/react-query';
import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCelebrationHold } from '@/lib/celebrations';
import { feedback } from '@/lib/feedback';
import { useCelebrations, useMe } from '@/lib/queries';
import { colors } from '@/lib/theme';
import type { Celebration, LeagueTier } from '@/lib/types';
import { Cube, type CubeMood } from './Cube';
import { TIER_STYLE, TierBadge, iconFor } from './gamify';
import { Confetti, popIn, riseIn } from './motion';
import { Button, Icon, type IconName } from './ui';

/**
 * Plays the moments the server queued (level-ups, badges, streak news, league
 * results, friends' cheers) once each, anywhere in the app except mid-lesson.
 * Small news is a toast; big news is a full card. Each is marked seen on close.
 */

const TOAST_KINDS = new Set<Celebration['kind']>(['quest_complete', 'freeze_used', 'amulet_used', 'friend_streak', 'high_five', 'nudge', 'circle_quest']);
/** Social and quest toasts go stale; big moments still play when the learner comes back. */
const TOAST_STALE_MS = 48 * 3_600_000;

interface Moment {
  lead: Celebration;
  ids: string[];
  count: number;
}

/** The next thing to play: quest toasts merge into one, and the all-quests card absorbs them. */
function nextMoment(queue: Celebration[]): Moment | null {
  const first = queue[0];
  if (!first) return null;
  if (first.kind === 'quest_complete' || first.kind === 'quests_done') {
    const quests = queue.filter((c) => c.kind === 'quest_complete');
    const allDone = queue.find((c) => c.kind === 'quests_done');
    if (allDone) return { lead: allDone, ids: [allDone.id, ...quests.map((q) => q.id)], count: quests.length };
    return { lead: first, ids: quests.map((q) => q.id), count: quests.length };
  }
  return { lead: first, ids: [first.id], count: 1 };
}

/**
 * Moments not worth playing any more: stale toasts, a break that was already
 * repaired, and quest news while the lesson-complete screen already shows it.
 */
function skippable(queue: Celebration[], now: number, onComplete: boolean) {
  const repaired = queue.some((c) => c.kind === 'streak_repaired');
  return queue.filter(
    (c) =>
      (TOAST_KINDS.has(c.kind) && now - new Date(c.created_at).getTime() > TOAST_STALE_MS) ||
      (repaired && c.kind === 'streak_broken') ||
      (onComplete && (c.kind === 'quest_complete' || c.kind === 'quests_done')),
  );
}

const str = (v: unknown, fallback = '') => (v === null || v === undefined ? fallback : String(v));
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

function toastText(m: Moment): { icon: IconName; color: string; text: string } {
  const p = m.lead.payload;
  switch (m.lead.kind) {
    case 'quest_complete':
      return { icon: 'checkmark-circle', color: colors.success, text: m.count > 1 ? `${m.count} quests complete` : `Quest complete: ${str(p.label)}` };
    case 'freeze_used':
      return { icon: 'snow', color: colors.gemDark, text: `A streak freeze saved your ${num(p.streak)}-day streak` };
    case 'amulet_used':
      return { icon: 'shield-checkmark', color: colors.primary, text: 'Your weekend amulet protected your streak' };
    case 'friend_streak':
      return { icon: 'people', color: colors.streakDark, text: `${num(p.days)}-day friend streak with ${str(p.friend, 'your friend')}` };
    case 'high_five':
      return { icon: 'hand-left', color: colors.primary, text: `${str(p.from, 'A friend')} sent you a high-five` };
    case 'nudge':
      return { icon: 'notifications', color: colors.streakDark, text: `${str(p.from, 'A friend')} is cheering you on to study today` };
    case 'circle_quest':
      return { icon: 'trophy', color: colors.streakDark, text: `${str(p.circle, 'Your circle')} finished the weekly quest: +${num(p.gems)} gems` };
    default:
      return { icon: 'sparkles', color: colors.primary, text: 'Nice work' };
  }
}

interface Card {
  eyebrow: string;
  title: string;
  body?: string;
  icon?: IconName;
  iconColor?: string;
  tint?: string;
  tier?: LeagueTier;
  mood?: CubeMood;
  confetti: boolean;
  gems?: number;
  primary: { label: string; href?: Href };
  secondary?: { label: string; href?: Href };
}

function cardFor(c: Celebration): Card {
  const p = c.payload;
  switch (c.kind) {
    case 'level_up':
      return { eyebrow: 'Level up', title: `Level ${num(p.level)}`, body: `Title: ${str(p.title)}. Levels grow with practice, so every session moves you along.`, mood: 'cheer', confetti: true, primary: { label: 'Keep going' } };
    case 'achievement':
    case 'monthly_challenge':
      return {
        eyebrow: c.kind === 'monthly_challenge' ? 'Monthly challenge complete' : 'Badge unlocked',
        title: str(p.title, 'New badge'),
        body: str(p.description),
        icon: iconFor(str(p.icon)),
        iconColor: colors.streakDark,
        tint: colors.streakTint,
        confetti: true,
        gems: num(p.gems),
        primary: { label: 'Nice!' },
        secondary: { label: 'See all badges', href: '/achievements' },
      };
    case 'streak_milestone':
      return {
        eyebrow: 'Streak milestone',
        title: `${num(p.days)}-day streak!`,
        body: num(p.days) >= 30 ? 'That is a real habit. Your future self says thanks.' : 'Small daily wins add up. Keep the flame going tomorrow.',
        icon: 'flame',
        iconColor: colors.streak,
        tint: colors.streakTint,
        confetti: true,
        primary: { label: 'Keep it going' },
        secondary: { label: 'Protect my streak', href: '/shop' },
      };
    case 'quests_done':
      return {
        eyebrow: 'Daily quests',
        title: 'All three quests done!',
        body: 'Your chest is ready to open.',
        icon: 'gift',
        iconColor: colors.streakDark,
        tint: colors.streakTint,
        confetti: true,
        primary: { label: 'Open my chest', href: '/quests' },
        secondary: { label: 'Later' },
      };
    case 'league_result': {
      const outcome = str(p.outcome);
      const newTier = (str(p.new_tier) || str(p.tier) || 'bronze') as LeagueTier;
      const rank = num(p.rank);
      return {
        eyebrow: 'League results',
        title:
          outcome === 'promoted'
            ? `Promoted to ${TIER_STYLE[newTier].label}!`
            : outcome === 'demoted'
              ? `Back to ${TIER_STYLE[newTier].label} League`
              : `You finished #${rank}`,
        body:
          outcome === 'demoted'
            ? `You finished #${rank} of ${num(p.size)}. A fresh week starts now.`
            : `#${rank} of ${num(p.size)} in ${TIER_STYLE[(str(p.tier) || 'bronze') as LeagueTier].label} League last week.`,
        tier: newTier,
        mood: outcome === 'demoted' ? 'thinking' : undefined,
        confetti: outcome === 'promoted' || rank <= 3,
        gems: num(p.gems),
        primary: { label: 'See this week', href: '/league' },
        secondary: { label: 'Close' },
      };
    }
    case 'wager_won':
      return { eyebrow: 'Streak wager', title: 'You won your wager!', body: 'Seven days in a row. Double your gems back.', icon: 'trophy', iconColor: colors.streakDark, tint: colors.streakTint, confetti: true, gems: num(p.gems), primary: { label: 'Collect' } };
    case 'wager_lost':
      return { eyebrow: 'Streak wager', title: 'This wager is over', body: `The streak broke before day seven, so the ${num(p.stake)} gems are gone. Try again any time.`, mood: 'sleepy', confetti: false, primary: { label: 'OK' } };
    case 'streak_broken': {
      const until = str(p.repairable_until);
      return {
        eyebrow: 'Streak',
        title: `Your ${num(p.days)}-day streak ended`,
        body: until ? `You can repair it in the shop until ${new Date(`${until}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })}. Or start fresh today: day one is the hardest.` : 'Start fresh today: day one is the hardest.',
        mood: 'sleepy',
        confetti: false,
        primary: until ? { label: 'Repair my streak', href: '/shop' } : { label: 'Start fresh' },
        secondary: until ? { label: 'Start fresh' } : undefined,
      };
    }
    case 'streak_repaired':
      return { eyebrow: 'Streak', title: 'Streak repaired!', body: `You're back to ${num(p.days)} days. Study today to keep it.`, icon: 'flame', iconColor: colors.streak, tint: colors.streakTint, confetti: true, primary: { label: 'Back to it' } };
    default:
      return { eyebrow: 'Nice', title: 'Well done', confetti: false, primary: { label: 'OK' } };
  }
}

function Toast({ moment, onDone }: { moment: Moment; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const t = toastText(moment);
  useEffect(() => {
    feedback.tick();
    AccessibilityInfo.announceForAccessibility(t.text);
    const timer = setTimeout(onDone, 3400);
    return () => clearTimeout(timer);
  }, [moment.lead.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View
      entering={FadeInUp.springify().mass(1).damping(16).stiffness(200)}
      exiting={FadeOutUp.duration(200)}
      style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, alignItems: 'center' }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t.text}. Dismiss`}
        onPress={onDone}
        className="w-full max-w-[460px] flex-row items-center gap-3 rounded-[18px] bg-surface border border-border px-4 py-3"
        style={{ boxShadow: '0 8px 24px rgba(36, 36, 58, 0.16)' }}
      >
        <Animated.View entering={popIn(120)}>
          <Icon name={t.icon} size={24} color={t.color} />
        </Animated.View>
        <Text className="flex-1 text-ink text-[15px] font-bold">{t.text}</Text>
      </Pressable>
    </Animated.View>
  );
}

function BigMoment({ moment, onDone }: { moment: Moment; onDone: () => void }) {
  const c = cardFor(moment.lead);
  useEffect(() => {
    if (c.confetti) feedback.complete();
    else feedback.tick();
  }, [moment.lead.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function go(target?: { href?: Href }) {
    onDone();
    if (target?.href) router.push(target.href);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => go()}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View accessibilityViewIsModal className="w-full max-w-[420px] rounded-[28px] bg-surface p-6 gap-4 items-center">
          {c.tier ? (
            <Animated.View entering={popIn(80)}>
              <TierBadge tier={c.tier} size={104} />
            </Animated.View>
          ) : c.icon ? (
            <Animated.View entering={popIn(80)} className="h-28 w-28 rounded-full items-center justify-center" style={{ backgroundColor: c.tint }}>
              <Icon name={c.icon} size={58} color={c.iconColor} />
            </Animated.View>
          ) : (
            <Cube size={112} mood={c.mood ?? 'cheer'} motion={c.confetti ? 'jump' : 'idle'} />
          )}
          <Animated.View entering={riseIn(180)} className="items-center gap-1.5">
            <Text className="text-primary text-xs font-bold uppercase tracking-wider">{c.eyebrow}</Text>
            <Text accessibilityRole="header" className="text-ink text-[26px] leading-[32px] font-extrabold text-center">
              {c.title}
            </Text>
            {c.body ? <Text className="text-muted text-[15px] leading-[22px] text-center">{c.body}</Text> : null}
          </Animated.View>
          {c.gems ? (
            <Animated.View entering={popIn(420)} className="flex-row items-center gap-1.5 rounded-full bg-gem-tint px-3 py-1.5">
              <Icon name="diamond" size={16} color={colors.gemDark} />
              <Text className="text-gem-dark text-[15px] font-extrabold">+{c.gems} gems</Text>
            </Animated.View>
          ) : null}
          <View className="w-full gap-2">
            <Button label={c.primary.label} onPress={() => go(c.primary)} />
            {c.secondary ? <Button label={c.secondary.label} variant="ghost" onPress={() => go(c.secondary)} /> : null}
          </View>
        </View>
      </View>
      {c.confetti ? <Confetti count={80} /> : null}
    </Modal>
  );
}

export function CelebrationPlayer() {
  const { status } = useAuth();
  const pathname = usePathname();
  const held = useCelebrationHold();
  const celebrations = useCelebrations();
  const me = useMe();
  const queryClient = useQueryClient();
  const [played, setPlayed] = useState<ReadonlySet<string>>(new Set());

  // Opening the app is when the server notices a protected or broken streak, so look again once the profile loads.
  useEffect(() => {
    if (me.dataUpdatedAt) celebrations.refetch();
  }, [me.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const unplayed = (celebrations.data ?? []).filter((c) => !played.has(c.id));
  // Staleness is judged at fetch time, so rendering stays pure.
  const skipped = skippable(unplayed, celebrations.dataUpdatedAt, pathname.startsWith('/complete'));
  const skippedIds = skipped.map((c) => c.id).join(',');
  useEffect(() => {
    if (skippedIds) post('/me/celebrations/seen', { ids: skippedIds.split(',') }).catch(() => undefined);
  }, [skippedIds]);
  const queue = unplayed.filter((c) => !skipped.includes(c));

  const blocked = status !== 'signedIn' || held || pathname === '/' || pathname.startsWith('/session') || pathname.startsWith('/onboarding');
  const moment = blocked ? null : nextMoment(queue);
  if (!moment) return null;

  const done = () => {
    setPlayed((prev) => new Set([...prev, ...moment.ids]));
    post('/me/celebrations/seen', { ids: moment.ids }).catch(() => undefined);
    // Badges, levels and wallets may have changed with these moments.
    queryClient.invalidateQueries({ queryKey: ['engagement'] });
    queryClient.invalidateQueries({ queryKey: ['achievements'] });
  };
  return TOAST_KINDS.has(moment.lead.kind) ? <Toast key={moment.lead.id} moment={moment} onDone={done} /> : <BigMoment key={moment.lead.id} moment={moment} onDone={done} />;
}
