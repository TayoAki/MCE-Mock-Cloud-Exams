import { tx } from '../db.js';
import { User } from '../models/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { GEMS, MAX_FREEZES, SHOP_PRICES, STREAK_REPAIR_DAYS, WAGER_DAYS, levelFor, type ShopItem } from '../lib/rules.js';
import { addDays, daysBetween, effectiveTimezone, localDate } from '../lib/time.js';
import { xpTotal } from './progress.js';
import { amuletFor, repairStreak, syncStreak } from './streaks.js';
import { ensureProfile, spendGems } from './wallet.js';

async function zoneFor(userId: string, now: Date) {
  const user = await User.findById(userId).select({ timezone: 1, pendingTimezone: 1 }).lean();
  if (!user) throw notFound('User');
  return effectiveTimezone(user, now);
}

/** Wallet, streak protection, level and league tier: everything the header, streak and shop screens show. */
export async function engagementView(userId: string, now = new Date()) {
  const today = localDate(now, await zoneFor(userId, now));
  await tx(() => syncStreak(userId, today));
  const profile = await ensureProfile(userId);
  const xp = await xpTotal(userId);
  const level = levelFor(xp);
  const amuletSunday = profile.amuletSaturday ? addDays(profile.amuletSaturday, 1) : null;
  const wager = profile.wager;
  const broken = profile.brokenStreak;
  return {
    gems: profile.gems,
    freezes: profile.freezes,
    max_freezes: MAX_FREEZES,
    amulet: profile.amuletSaturday && amuletSunday && daysBetween(today, amuletSunday) >= 0 ? { saturday: profile.amuletSaturday, sunday: amuletSunday } : null,
    wager: wager
      ? { started_on: wager.startedOn, ends_on: addDays(wager.startedOn, WAGER_DAYS - 1), stake: wager.stake, payout: GEMS.wagerPayout, status: wager.status }
      : null,
    boost_until: profile.boostUntil && profile.boostUntil > now ? profile.boostUntil.toISOString() : null,
    repair: broken ? { days: broken.days, until: addDays(broken.firstMissedDate, STREAK_REPAIR_DAYS), price: SHOP_PRICES.streak_repair } : null,
    level: { level: level.level, title: level.title, xp, floor: level.floor, next: level.next },
    league: { tier: profile.leagueTier, hidden: profile.leagueHidden },
    prices: SHOP_PRICES,
  };
}

/**
 * Buys one shop item with gems inside a transaction. The route wraps this in
 * request idempotency, so a retried purchase never charges twice.
 */
export async function purchase(userId: string, item: ShopItem, requestKey: string, now = new Date()) {
  const today = localDate(now, await zoneFor(userId, now));
  await tx(async () => {
    const { profile } = await syncStreak(userId, today);
    const key = `shop:${item}:${requestKey}`;
    if (item === 'streak_freeze') {
      if (profile.freezes >= MAX_FREEZES) throw conflict('freezes_full', `You can hold ${MAX_FREEZES} streak freezes at a time`);
      if (await spendGems(userId, SHOP_PRICES.streak_freeze, item, key)) {
        profile.freezes += 1;
        await profile.save();
      }
    } else if (item === 'weekend_amulet') {
      const { saturday } = amuletFor(today);
      if (profile.amuletSaturday === saturday) throw conflict('amulet_active', 'Your weekend is already protected');
      if (await spendGems(userId, SHOP_PRICES.weekend_amulet, item, key)) {
        profile.amuletSaturday = saturday;
        await profile.save();
      }
    } else if (item === 'streak_repair') {
      if (!profile.brokenStreak) throw conflict('nothing_to_repair', 'There is no broken streak to repair');
      if (await spendGems(userId, SHOP_PRICES.streak_repair, item, key)) await repairStreak(userId, today);
    } else {
      if (profile.wager?.status === 'active') throw conflict('wager_active', 'You already have a streak wager running');
      if (await spendGems(userId, SHOP_PRICES.streak_wager, item, key)) {
        const fresh = await ensureProfile(userId);
        fresh.wager = { startedOn: today, stake: SHOP_PRICES.streak_wager, status: 'active', resolvedOn: null };
        await fresh.save();
      }
    }
  });
  return engagementView(userId, now);
}
