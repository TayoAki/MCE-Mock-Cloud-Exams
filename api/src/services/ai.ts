import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { AiUsage } from '../models/index.js';

let client: Anthropic | null = null;

/** The shared Claude client, or null when no API key is configured. */
export function anthropic() {
  if (!config.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: config.AI_TIMEOUT_MS, maxRetries: 1 });
  return client;
}

/** Atomically counts one call against the per-user and global daily budgets, shared by every AI feature. */
export async function reserveBudget(userId: string, date: string): Promise<boolean> {
  const mine = await AiUsage.findOneAndUpdate({ userId, date }, { $inc: { count: 1 } }, { upsert: true, returnDocument: 'after' }).lean();
  if (mine!.count > config.AI_DAILY_CALLS_PER_USER) return false;
  const global = await AiUsage.findOneAndUpdate({ userId: '*', date }, { $inc: { count: 1 } }, { upsert: true, returnDocument: 'after' }).lean();
  return global!.count <= config.AI_DAILY_CALLS_GLOBAL;
}

/** Logs only the category of a failed call; callers fall back to reviewed content. */
export function logAiError(error: unknown, feature: string) {
  let kind = 'unknown';
  if (error instanceof Anthropic.RateLimitError) kind = 'rate_limited';
  else if (error instanceof Anthropic.APIConnectionTimeoutError) kind = 'timeout';
  else if (error instanceof Anthropic.APIConnectionError) kind = 'connection';
  else if (error instanceof Anthropic.APIError) kind = `status_${error.status}`;
  console.error(JSON.stringify({ t: new Date().toISOString(), ai_error: kind, feature }));
}

/** The text of a finished reply, or null when it was refused, cut off or empty. */
export function replyText(response: Anthropic.Beta.BetaMessage): string | null {
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text || null;
}
