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
  /** Missed mode: only the questions missed in this earlier session. */
  source_session_id?: string;
  /** Replace the current screen instead of pushing on top of it. */
  replace?: boolean;
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
      const { replace: _replace, ...body } = options;
      const session = await post<Session>('/sessions', { ...body, client_session_id: newId() });
      const path = session.mode === 'story' ? `/story/${session.id}` : `/session/${session.id}`;
      // A next step started from the results screen replaces it, so Back returns home.
      if (options.replace) router.replace(path);
      else router.push(path);
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
