import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { AiUsage } from '../models/index.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

let client: Anthropic | null = null;

/** The shared Claude client, or null when no Anthropic key is configured. */
export function anthropic() {
  if (!config.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: config.AI_TIMEOUT_MS, maxRetries: 1 });
  return client;
}

/** Which service generates AI replies: Anthropic directly when its key is set, otherwise OpenRouter. */
export function aiProvider(): 'anthropic' | 'openrouter' | null {
  if (config.ANTHROPIC_API_KEY) return 'anthropic';
  if (config.OPENROUTER_API_KEY) return 'openrouter';
  return null;
}

export const aiEnabled = () => aiProvider() !== null;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A failed OpenRouter call, carrying its HTTP status for logging. */
export class OpenRouterError extends Error {
  constructor(readonly status: number) {
    super(`OpenRouter request failed with status ${status}`);
  }
}

/**
 * One reply from whichever provider is configured, or null when it was refused,
 * cut off, empty or failed. Callers fall back to reviewed content on null.
 */
export async function complete(feature: string, input: { system: string; messages: ChatMessage[] }): Promise<string | null> {
  try {
    const provider = aiProvider();
    if (provider === 'anthropic') return await fromAnthropic(input);
    if (provider === 'openrouter') return await fromOpenRouter(input);
    return null;
  } catch (error) {
    logAiError(error, feature);
    return null;
  }
}

async function fromAnthropic(input: { system: string; messages: ChatMessage[] }) {
  const response = await anthropic()!.beta.messages.create({
    model: config.AI_MODEL,
    max_tokens: 2048,
    // Re-run on Anthropic's recommended model if the requested one declines.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: input.system,
    messages: input.messages,
  });
  return replyText(response);
}

interface OpenRouterResponse {
  choices?: { finish_reason?: string | null; native_finish_reason?: string | null; message?: { content?: string | null }; error?: unknown }[];
}

/** OpenRouter's OpenAI-compatible chat API, retried once on rate limits, server errors and dropped connections. */
async function fromOpenRouter(input: { system: string; messages: ChatMessage[] }) {
  const send = () =>
    fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'CertPath' },
      body: JSON.stringify({ model: config.OPENROUTER_MODEL, max_tokens: 2048, messages: [{ role: 'system', content: input.system }, ...input.messages] }),
      signal: AbortSignal.timeout(config.AI_TIMEOUT_MS),
    });
  let res = await send().catch((error: unknown) => (isTimeout(error) ? Promise.reject(error) : null));
  if (!res || res.status === 429 || res.status >= 500) res = await send();
  if (!res.ok) throw new OpenRouterError(res.status);
  const choice = ((await res.json()) as OpenRouterResponse).choices?.[0];
  // Anything but a normal stop (length, content_filter, error, a provider refusal) is unusable.
  if (!choice || choice.error || choice.finish_reason !== 'stop' || choice.native_finish_reason === 'refusal') return null;
  return choice.message?.content?.trim() || null;
}

const isTimeout = (error: unknown) => error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

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
  else if (error instanceof OpenRouterError) kind = error.status === 429 ? 'rate_limited' : `status_${error.status}`;
  else if (isTimeout(error)) kind = 'timeout';
  else if (error instanceof TypeError) kind = 'connection';
  console.error(JSON.stringify({ t: new Date().toISOString(), ai_error: kind, feature, provider: aiProvider() }));
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
