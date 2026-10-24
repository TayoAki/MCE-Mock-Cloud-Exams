import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from './api';
import { useAuth } from './auth';
import type { ActiveSession, Circle, Exam, Me, Path, PracticeSummary, Progress, Reviews, Session } from './types';

export function useMe() {
  const { status } = useAuth();
  return useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/me'), enabled: status === 'signedIn' });
}

export function useExams() {
  return useQuery({ queryKey: ['exams'], queryFn: () => get<{ exams: Exam[] }>('/exams').then((r) => r.exams), staleTime: 5 * 60_000 });
}

/** The pilot supports one exam, so the learner's newest non-archived enrollment is current. */
export function useCurrentEnrollment() {
  const me = useMe();
  const enrollment = me.data?.enrollments.filter((e) => e.status !== 'archived').at(-1) ?? null;
  return { ...me, enrollment };
}

export function usePath(enrollmentId?: string) {
  return useQuery({ queryKey: ['path', enrollmentId], queryFn: () => get<Path>(`/enrollments/${enrollmentId}/path`), enabled: !!enrollmentId });
}

export function usePractice(enrollmentId?: string) {
  return useQuery({ queryKey: ['practice', enrollmentId], queryFn: () => get<PracticeSummary>(`/enrollments/${enrollmentId}/practice`), enabled: !!enrollmentId });
}

export function useReviews(enrollmentId?: string) {
  return useQuery({ queryKey: ['reviews', enrollmentId], queryFn: () => get<Reviews>(`/enrollments/${enrollmentId}/reviews`), enabled: !!enrollmentId });
}

export function useProgress(enrollmentId?: string) {
  return useQuery({ queryKey: ['progress', enrollmentId], queryFn: () => get<Progress>(`/enrollments/${enrollmentId}/progress`), enabled: !!enrollmentId });
}

export function useSession(sessionId?: string) {
  return useQuery({ queryKey: ['session', sessionId], queryFn: () => get<Session>(`/sessions/${sessionId}`), enabled: !!sessionId, staleTime: 0 });
}

export function useActiveSessions() {
  const { status } = useAuth();
  return useQuery({ queryKey: ['sessions', 'active'], queryFn: () => get<{ sessions: ActiveSession[] }>('/sessions').then((r) => r.sessions), enabled: status === 'signedIn' });
}

export function useCircles() {
  const { status } = useAuth();
  return useQuery({
    queryKey: ['circles'],
    queryFn: () => get<{ circles: { id: string; name: string; weekly_target_days: number }[] }>('/circles').then((r) => r.circles),
    enabled: status === 'signedIn',
  });
}

export function useCircle(circleId?: string) {
  return useQuery({ queryKey: ['circle', circleId], queryFn: () => get<Circle>(`/circles/${circleId}`), enabled: !!circleId });
}

/** After a session finishes, everything derived from attempts may have changed. */
export function useRefreshLearning() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['me', 'path', 'practice', 'reviews', 'progress', 'sessions', 'circle'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
}
