import { expireOverdueSessions } from '../services/completion.js';
import { processDeletions } from '../services/deletion.js';
import { closeLeagueWeeks } from '../services/leagues.js';
import { dispatchReminders, planReminders } from '../services/notifications.js';

type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

const JOBS: Job[] = [
  // Server deadlines keep running while the app is backgrounded; expire overdue forms once.
  { name: 'expire_sessions', everyMs: 30_000, run: () => expireOverdueSessions() },
  { name: 'plan_reminders', everyMs: 5 * 60_000, run: () => planReminders() },
  { name: 'dispatch_reminders', everyMs: 60_000, run: () => dispatchReminders() },
  { name: 'process_deletions', everyMs: 10 * 60_000, run: () => processDeletions() },
  // League weeks end Monday 00:00 UTC; rank and move each finished cohort once.
  { name: 'close_league_weeks', everyMs: 5 * 60_000, run: () => closeLeagueWeeks() },
];

/** In-process scheduler. Run a single API instance with workers enabled, or move these to a job runner. */
export function startWorkers() {
  const timers = JOBS.map((job) => {
    let running = false;
    return setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await job.run();
      } catch (err) {
        console.error(JSON.stringify({ t: new Date().toISOString(), worker: job.name, error: String(err) }));
      } finally {
        running = false;
      }
    }, job.everyMs);
  });
  return () => timers.forEach(clearInterval);
}
