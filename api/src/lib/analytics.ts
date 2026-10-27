import { config } from '../config.js';
import { AnalyticsEvent } from '../models/index.js';

/**
 * Event contract from delivery/ANALYTICS_AND_EVAL_PLAN.md. Each event lists the
 * only property keys it may carry; anything else is dropped. Never add email,
 * free-form reasoning, option text, evidence or raw AI prompts here.
 */
export const EVENT_PROPERTIES = {
  // Server-authoritative
  enrollment_created: ['exam_date_set'],
  session_started: ['mode', 'question_count', 'sample'],
  answer_graded: ['mode', 'correct', 'first_seen'],
  session_completed: ['mode', 'status', 'correct', 'total', 'qualifying'],
  study_day_credited: ['current_streak'],
  reward_granted: ['amount'],
  review_scheduled: ['stage'],
  mock_finalized: ['status', 'correct', 'total', 'sample', 'fresh_count'],
  entitlement_changed: ['source', 'change'],
  exam_outcome_recorded: ['result'],
  account_upgraded: [],
  explanation_generated: ['origin', 'style'],
  tutor_message: ['phase', 'origin', 'guard_tripped'],
  question_flagged: ['flagged'],
  question_rated: ['stars'],
  issue_reported: ['reason'],
  // Client
  onboarding_viewed: ['step'],
  daily_goal_selected: ['minutes'],
  explanation_opened: ['origin'],
  source_opened: [],
  reminder_prompt_viewed: [],
  paywall_viewed: ['surface'],
  circle_invite_requested: [],
  // Worker
  reminder_suppressed: ['reason', 'kind'],
  reminder_sent: ['kind', 'template'],
  reminder_failed: ['reason', 'kind', 'template'],
} as const satisfies Record<string, readonly string[]>;

export type EventName = keyof typeof EVENT_PROPERTIES;
export const CLIENT_EVENTS: EventName[] = [
  'onboarding_viewed',
  'daily_goal_selected',
  'explanation_opened',
  'source_opened',
  'reminder_prompt_viewed',
  'paywall_viewed',
  'circle_invite_requested',
];

type Scalar = string | number | boolean | null;

export interface TrackInput {
  userId?: string | null;
  anonymousId?: string | null;
  examVersionId?: string | null;
  sessionId?: string | null;
  properties?: Record<string, unknown>;
  occurredAt?: Date;
  sourceVersion?: string;
}

export function filterProperties(name: EventName, properties: Record<string, unknown> = {}) {
  const allowed = EVENT_PROPERTIES[name] as readonly string[];
  const out: Record<string, Scalar> = {};
  for (const key of allowed) {
    const value = properties[key];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = typeof value === 'string' ? value.slice(0, 64) : (value as Scalar);
    }
  }
  return out;
}

/** Fire-and-forget; analytics must never fail a learner request. */
export function track(name: EventName, input: TrackInput) {
  if (!input.userId && !input.anonymousId) return;
  AnalyticsEvent.create({
    userId: input.userId ?? null,
    anonymousId: input.anonymousId ?? null,
    eventName: name,
    occurredAt: input.occurredAt ?? new Date(),
    sourceVersion: input.sourceVersion ?? config.SOURCE_VERSION,
    examVersionId: input.examVersionId ?? null,
    sessionId: input.sessionId ?? null,
    properties: filterProperties(name, input.properties),
  }).catch((err) => console.error(JSON.stringify({ t: new Date().toISOString(), analytics_error: String(err) })));
}
