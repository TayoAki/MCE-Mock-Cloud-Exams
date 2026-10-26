import { router } from 'expo-router';
import { useState } from 'react';
import { ApiError, post } from './api';
import { newId } from './ids';
import type { Session, SessionMode } from './types';

export interface StartOptions {
  /** Undefined while the enrollment is still loading; start() then does nothing. */
  enrollment_id: string | undefined;
  mode: SessionMode;
  lesson_id?: string;
  story_id?: string;
  domain_ids?: string[];
  question_count?: number;
}

/**
 * Starts (or resumes) a session and opens it. Plus-gated modes route to the
 * preview screen; other refusals (nothing due, thin inventory) surface as messages.
 */
export function useStartSession() {
  const [pending, setPending] = useState<SessionMode | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function start(options: StartOptions) {
    if (!options.enrollment_id) return;
    setPending(options.mode);
    setError(null);
    try {
      const session = await post<Session>('/sessions', { ...options, client_session_id: newId() });
      router.push(session.mode === 'story' ? `/story/${session.id}` : `/session/${session.id}`);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'error', 'Something went wrong');
      if (err.code === 'plus_required') router.push({ pathname: '/premium', params: { feature: String(err.details?.feature ?? '') } });
      else setError(err);
    } finally {
      setPending(null);
    }
  }

  return { start, pending, error, clearError: () => setError(null) };
}
