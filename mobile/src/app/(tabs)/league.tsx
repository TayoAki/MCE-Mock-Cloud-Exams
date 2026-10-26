import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AppHeader } from '@/components/AppHeader';
import { Cube } from '@/components/Cube';
import { TIER_STYLE, TierBadge, timeLeft } from '@/components/gamify';
import { riseIn } from '@/components/motion';
import { Banner, Body, Button, Card, ErrorState, Eyebrow, Icon, LoadingState, Screen, Small, Title } from '@/components/ui';
import { ApiError, put } from '@/lib/api';
import { useLeague } from '@/lib/queries';
import { colors } from '@/lib/theme';
import type { LeagueView } from '@/lib/types';

function ZoneLine({ tone, label }: { tone: 'promote' | 'demote'; label: string }) {
  const color = tone === 'promote' ? colors.success : colors.coralDark;
  return (
    <View className="flex-row items-center gap-2 py-1">
      <View className="flex-1 h-px" style={{ backgroundColor: color }} />
      <Icon name={tone === 'promote' ? 'arrow-up' : 'arrow-down'} size={14} color={color} />
      <Text className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color }}>
        {label}
      </Text>
      <View className="flex-1 h-px" style={{ backgroundColor: color }} />
    </View>
  );
}

/** Weekly leagues: about thirty learners, ranked by XP earned this week. Top ranks move up, bottom ranks move down. */
export default function League() {
  const league = useLeague();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      league.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  async function show() {
    setError(null);
    try {
      queryClient.setQueryData(['league'], await put<LeagueView>('/me/league-visibility', { hidden: false }));
      queryClient.invalidateQueries({ queryKey: ['engagement'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update');
    }
  }

  const l = league.data;
  const tierIndex = l ? l.tiers.indexOf(l.tier) : 0;
  const nextTier = l?.tiers[tierIndex + 1];
  const last = l?.last_result;
  return (
    <Screen>
      <AppHeader />
      {league.isLoading ? <LoadingState /> : null}
      {league.error ? <ErrorState error={league.error} onRetry={() => league.refetch()} /> : null}
      {l ? (
        <>
          <View className="gap-1">
            <Eyebrow>Weekly league · ends in {timeLeft(l.ends_at)}</Eyebrow>
            <Title>{TIER_STYLE[l.tier].label} League</Title>
            <Body muted>{!l.joined ? 'Earn XP this week to join a league.' : nextTier ? `Finish ${l.promote === 1 ? 'first' : `in the top ${l.promote}`} to move up to ${TIER_STYLE[nextTier].label}.` : 'The top league. Finish in the top three for gems.'}</Body>
          </View>

          <View accessibilityLabel={`League ${tierIndex + 1} of ${l.tiers.length}: ${TIER_STYLE[l.tier].label}`} className="flex-row justify-between items-center px-1">
            {l.tiers.map((t, i) => (
              <View key={t} className="items-center gap-1" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <TierBadge tier={t} size={t === l.tier ? 50 : 38} dim={i > tierIndex} />
                <Text className={`text-[10px] font-bold ${t === l.tier ? 'text-ink' : 'text-muted'}`}>{TIER_STYLE[t].label}</Text>
              </View>
            ))}
          </View>

          {last?.outcome ? (
            <Banner tone={last.outcome === 'demoted' ? 'warn' : 'success'} icon={last.outcome === 'promoted' ? 'arrow-up-circle' : last.outcome === 'demoted' ? 'arrow-down-circle' : 'checkmark-circle'}>
              {`Last week you finished #${last.rank} in ${TIER_STYLE[last.tier].label}${last.outcome === 'promoted' ? ' and moved up.' : last.outcome === 'demoted' ? ' and moved down.' : '.'}`}
            </Banner>
          ) : null}
          {error ? <Banner tone="error">{error}</Banner> : null}

          {l.hidden ? (
            <Card className="gap-3 items-center">
              <Cube size={88} mood="sleepy" />
              <Text className="text-ink text-[16px] font-bold text-center">You’re hidden from leagues</Text>
              <Small className="text-center">Your XP still counts for quests and levels. Other learners just don’t see you.</Small>
              <Button label="Join leagues again" variant="secondary" onPress={show} />
            </Card>
          ) : !l.joined ? (
            <Card className="gap-3 items-center">
              <Cube size={88} mood="happy" />
              <Text className="text-ink text-[16px] font-bold text-center">Finish a lesson to join this week’s league</Text>
              <Small className="text-center">You’ll be matched with up to 30 learners. Top finishers win gems and move up a league.</Small>
              <Button label="Start a lesson" onPress={() => router.push('/learn')} />
            </Card>
          ) : (
            <Card className="gap-0.5 px-3">
              {l.rows.map((r, i) => {
                const firstDemote = l.demote > 0 && i === l.rows.length - l.demote;
                return (
                  <View key={`${r.rank}-${r.name}`}>
                    {firstDemote ? <ZoneLine tone="demote" label="Demotion zone" /> : null}
                    <Animated.View
                      entering={riseIn(Math.min(i, 10) * 35)}
                      accessible
                      accessibilityLabel={`Rank ${r.rank}: ${r.is_me ? 'You' : r.name}, ${r.xp} XP${r.zone === 'promote' ? ', promotion zone' : r.zone === 'demote' ? ', demotion zone' : ''}`}
                      className={`min-h-[48px] flex-row items-center gap-3 rounded-[14px] px-2 ${r.is_me ? 'bg-primary-tint' : ''}`}
                    >
                      <Text className={`w-7 text-center text-[15px] font-extrabold ${r.zone === 'promote' ? 'text-success' : r.zone === 'demote' ? 'text-coral-dark' : 'text-muted'}`}>{r.rank}</Text>
                      <View className="h-8 w-8 rounded-full items-center justify-center" style={{ backgroundColor: r.is_me ? colors.primary : TIER_STYLE[l.tier].tint }}>
                        <Text className="font-bold" style={{ color: r.is_me ? '#FFFFFF' : TIER_STYLE[l.tier].color }}>
                          {(r.is_me ? 'You' : r.name).slice(0, 1)}
                        </Text>
                      </View>
                      <Text numberOfLines={1} className={`flex-1 text-[15px] ${r.is_me ? 'text-primary-dark font-extrabold' : 'text-ink'}`}>
                        {r.is_me ? 'You' : r.name}
                      </Text>
                      <Text className="text-ink text-[14px] font-bold">{r.xp} XP</Text>
                    </Animated.View>
                    {l.promote > 0 && i === l.promote - 1 && i < l.rows.length - 1 ? <ZoneLine tone="promote" label="Promotion zone" /> : null}
                  </View>
                );
              })}
            </Card>
          )}
          {l.joined && !l.hidden && l.rows.length < 5 ? (
            <Small className="text-center">More learners join as they earn XP this week. If you’re still alone on Sunday, 100 XP moves you up.</Small>
          ) : null}
          <Small className="text-center">
            Leagues rank XP earned this week, which measures practice, not readiness. Top three win gems. You can hide yourself in Settings.
          </Small>
        </>
      ) : null}
    </Screen>
  );
}
