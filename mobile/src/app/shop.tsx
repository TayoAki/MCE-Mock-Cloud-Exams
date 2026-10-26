import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { timeLeft } from '@/components/gamify';
import { Bump, riseIn } from '@/components/motion';
import { BackButton, Banner, Body, Button, Card, ErrorState, Eyebrow, Icon, LoadingState, Screen, Small, Title, type IconName } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { feedback } from '@/lib/feedback';
import { newId } from '@/lib/ids';
import { useEngagement } from '@/lib/queries';
import { colors } from '@/lib/theme';
import type { Engagement, ShopItem } from '@/lib/types';

const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });

function Item({
  icon,
  color,
  tint,
  title,
  body,
  status,
  price,
  gems,
  action,
  unavailable,
  busy,
  onBuy,
}: {
  icon: IconName;
  color: string;
  tint: string;
  title: string;
  body: string;
  status?: string;
  price: number;
  gems: number;
  action: string;
  unavailable?: string;
  busy: boolean;
  onBuy: () => void;
}) {
  const short = gems < price;
  return (
    <Card className="gap-3">
      <View className="flex-row gap-3">
        <View className="h-14 w-14 rounded-[16px] items-center justify-center" style={{ backgroundColor: tint }}>
          <Icon name={icon} size={30} color={color} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-ink text-[16px] font-extrabold">{title}</Text>
          <Text className="text-muted text-[14px] leading-5">{body}</Text>
          {status ? <Text className="text-success text-[13px] font-bold pt-0.5">{status}</Text> : null}
        </View>
      </View>
      {unavailable ? (
        <Small>{unavailable}</Small>
      ) : (
        <Button
          label={short ? `Need ${price - gems} more gems` : `${action} · ${price} gems`}
          variant={short ? 'secondary' : 'primary'}
          icon="diamond"
          disabled={short}
          loading={busy}
          onPress={onBuy}
        />
      )}
    </Card>
  );
}

/** Spend gems on streak protection. Nothing here is for sale for money. */
export default function Shop() {
  const engagement = useEngagement();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<ShopItem | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function buy(item: ShopItem, success: string) {
    setBusy(item);
    setMessage(null);
    try {
      const next = await post<Engagement>('/shop/purchase', { item, client_request_id: newId() });
      queryClient.setQueryData(['engagement'], next);
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['celebrations'] });
      feedback.unlock();
      setMessage({ tone: 'success', text: success });
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof ApiError ? e.message : 'That purchase didn’t go through' });
    } finally {
      setBusy(null);
    }
  }

  const e = engagement.data;
  return (
    <Screen>
      <BackButton />
      <View className="gap-1">
        <Eyebrow>Shop</Eyebrow>
        <Title>Protect your streak.</Title>
        <Body muted>Gems come from lessons, perfect scores, badges, chests and league podiums.</Body>
      </View>
      {engagement.isLoading ? <LoadingState /> : null}
      {engagement.error ? <ErrorState error={engagement.error} onRetry={() => engagement.refetch()} /> : null}
      {e ? (
        <>
          <Card tone="tint" className="flex-row items-center gap-3">
            <Bump value={e.gems}>
              <View className="h-14 w-14 rounded-full bg-gem-tint items-center justify-center">
                <Icon name="diamond" size={30} color={colors.gem} />
              </View>
            </Bump>
            <View className="flex-1">
              <Text accessibilityLabel={`${e.gems} gems`} className="text-ink text-[28px] font-extrabold">
                {e.gems}
              </Text>
              <Small>gems to spend</Small>
            </View>
            {e.boost_until ? (
              <View className="items-end">
                <View className="flex-row items-center gap-1 rounded-full bg-streak-tint px-2.5 py-1">
                  <Icon name="flash" size={13} color={colors.streakDark} />
                  <Text className="text-streak-dark text-xs font-bold">2× XP · {timeLeft(e.boost_until)}</Text>
                </View>
              </View>
            ) : null}
          </Card>
          {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

          {e.repair ? (
            <Animated.View entering={riseIn(0)}>
              <Item
                icon="bandage"
                color={colors.coralDark}
                tint={colors.coralTint}
                title={`Repair your ${e.repair.days}-day streak`}
                body={`Bring back the streak you lost. Available until ${day(e.repair.until)}.`}
                price={e.repair.price}
                gems={e.gems}
                action="Repair"
                busy={busy === 'streak_repair'}
                onBuy={() => buy('streak_repair', 'Streak repaired. Study today to keep it going.')}
              />
            </Animated.View>
          ) : null}

          <Animated.View entering={riseIn(60)}>
            <Item
              icon="snow"
              color={colors.gemDark}
              tint={colors.gemTint}
              title="Streak freeze"
              body="Covers one missed day automatically. Hold up to two."
              status={e.freezes ? `${e.freezes} of ${e.max_freezes} equipped` : undefined}
              price={e.prices.streak_freeze}
              gems={e.gems}
              action="Buy"
              unavailable={e.freezes >= e.max_freezes ? `You have ${e.max_freezes} of ${e.max_freezes} freezes equipped. That's the most you can hold.` : undefined}
              busy={busy === 'streak_freeze'}
              onBuy={() => buy('streak_freeze', 'Streak freeze equipped.')}
            />
          </Animated.View>

          <Animated.View entering={riseIn(120)}>
            <Item
              icon="shield-checkmark"
              color={colors.primary}
              tint={colors.primaryTint}
              title="Weekend amulet"
              body="Take Saturday and Sunday off without losing your streak."
              status={e.amulet ? `Protecting ${day(e.amulet.saturday)} and ${day(e.amulet.sunday)}` : undefined}
              price={e.prices.weekend_amulet}
              gems={e.gems}
              action="Buy"
              unavailable={e.amulet ? 'Your next weekend is already protected.' : undefined}
              busy={busy === 'weekend_amulet'}
              onBuy={() => buy('weekend_amulet', 'Your next weekend is protected.')}
            />
          </Animated.View>

          <Animated.View entering={riseIn(180)}>
            <Item
              icon="trophy"
              color={colors.streakDark}
              tint={colors.streakTint}
              title="Streak wager"
              body={`Bet ${e.prices.streak_wager} gems you'll study 7 days in a row. Win ${e.wager?.payout ?? e.prices.streak_wager * 2}.`}
              status={e.wager?.status === 'active' ? `Running until ${day(e.wager.ends_on)}` : undefined}
              price={e.prices.streak_wager}
              gems={e.gems}
              action="Place wager"
              unavailable={e.wager?.status === 'active' ? 'Study every day until it ends to double your gems.' : undefined}
              busy={busy === 'streak_wager'}
              onBuy={() => buy('streak_wager', 'Wager placed. Seven days, starting today.')}
            />
          </Animated.View>
          <Small className="text-center">Gems can’t be bought. A protected day keeps your streak alive but doesn’t count as a study day.</Small>
        </>
      ) : null}
    </Screen>
  );
}
