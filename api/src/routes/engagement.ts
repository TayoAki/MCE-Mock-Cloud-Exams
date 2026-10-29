import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { idParam, parseBody, parseQuery, uuidParam } from '../lib/http.js';
import { idempotent } from '../lib/idempotency.js';
import { inviteLimiter, writeLimiter } from '../lib/rate-limit.js';
import { SHOP_PRICES, type ShopItem } from '../lib/rules.js';
import { achievementsView } from '../services/achievements.js';
import { circleActivity, friendStreaksView, inviteFriendStreak, respondFriendStreak, sendHighFive } from '../services/friends.js';
import { leagueView, setLeagueHidden } from '../services/leagues.js';
import { openChest, questsView } from '../services/quests.js';
import { engagementView, purchase } from '../services/shop.js';
import { markCelebrationsSeen, unseenCelebrations } from '../services/wallet.js';
import { recap } from '../services/insights.js';

/** Gems, quests, badges, streak protection, leagues and friends. */
export const engagementRouter = Router();

engagementRouter.get('/me/engagement', requireAuth, async (req, res) => {
  res.json(await engagementView(currentUser(req)._id));
});

engagementRouter.get('/me/quests', requireAuth, async (req, res) => {
  res.json(await questsView(currentUser(req)._id));
});

engagementRouter.post('/me/quests/chest', requireAuth, writeLimiter, async (req, res) => {
  res.json({ reward: await openChest(currentUser(req)._id) });
});

engagementRouter.get('/me/achievements', requireAuth, async (req, res) => {
  res.json(await achievementsView(currentUser(req)._id));
});

engagementRouter.get('/me/celebrations', requireAuth, async (req, res) => {
  res.json({ celebrations: await unseenCelebrations(currentUser(req)._id) });
});

engagementRouter.post('/me/celebrations/seen', requireAuth, async (req, res) => {
  const body = parseBody(req, z.strictObject({ ids: z.array(uuidParam).min(1).max(50) }));
  await markCelebrationsSeen(currentUser(req)._id, body.ids);
  res.status(204).end();
});

/** A month (?period=month&value=2026-10) or year (?period=year&value=2026) in review. */
engagementRouter.get('/me/recap', requireAuth, async (req, res) => {
  const query = parseQuery(req, z.object({ period: z.enum(['month', 'year']).default('month'), value: z.string().max(7).optional() }));
  res.json(await recap(currentUser(req)._id, query.period, query.value));
});

engagementRouter.get('/shop', requireAuth, async (req, res) => {
  res.json(await engagementView(currentUser(req)._id));
});

engagementRouter.post('/shop/purchase', requireAuth, writeLimiter, async (req, res) => {
  const user = currentUser(req);
  const body = parseBody(
    req,
    z.strictObject({ item: z.enum(Object.keys(SHOP_PRICES) as [ShopItem, ...ShopItem[]]), client_request_id: uuidParam }),
  );
  const result = await idempotent(user._id, 'shop', body.client_request_id, body, async () => ({
    status: 200,
    body: await purchase(user._id, body.item, body.client_request_id),
  }));
  res.status(result.status).json(result.body);
});

engagementRouter.get('/leagues/current', requireAuth, async (req, res) => {
  res.json(await leagueView(currentUser(req)._id));
});

engagementRouter.put('/me/league-visibility', requireAuth, async (req, res) => {
  const body = parseBody(req, z.strictObject({ hidden: z.boolean() }));
  await setLeagueHidden(currentUser(req)._id, body.hidden);
  res.json(await leagueView(currentUser(req)._id));
});

engagementRouter.get('/friend-streaks', requireAuth, async (req, res) => {
  res.json({ friend_streaks: await friendStreaksView(currentUser(req)._id) });
});

engagementRouter.post('/friend-streaks', requireAuth, inviteLimiter, async (req, res) => {
  const body = parseBody(req, z.strictObject({ friend_id: uuidParam }));
  res.status(201).json({ friend_streaks: await inviteFriendStreak(currentUser(req), body.friend_id) });
});

engagementRouter.post('/friend-streaks/:id/:action', requireAuth, writeLimiter, async (req, res) => {
  const action = z.enum(['accept', 'decline', 'end']).parse(req.params.action);
  res.json({ friend_streaks: await respondFriendStreak(currentUser(req), idParam(req), action) });
});

engagementRouter.post('/friends/:id/high-five', requireAuth, writeLimiter, async (req, res) => {
  res.status(201).json(await sendHighFive(currentUser(req), idParam(req), 'high_five'));
});

engagementRouter.post('/friends/:id/nudge', requireAuth, writeLimiter, async (req, res) => {
  res.status(201).json(await sendHighFive(currentUser(req), idParam(req), 'nudge'));
});

engagementRouter.get('/circles/:id/activity', requireAuth, async (req, res) => {
  res.json(await circleActivity(currentUser(req)._id, idParam(req)));
});
