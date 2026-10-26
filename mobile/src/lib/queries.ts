import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from './api';
import { useAuth } from './auth';
import type {
  ActiveSession,
  Badge,
  Celebration,
  Circle,
  CircleActivity,
  Engagement,
  Exam,
  FriendStreakRow,
  LeagueView,
  Me,
  Path,
  PracticeSummary,
  Progress,
  QuestsView,
  Reviews,
  Session,
  StorySummary,
} from './types';

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

export function useStories(enrollmentId?: string) {
  return useQuery({
    queryKey: ['stories', enrollmentId],
    queryFn: () => get<{ stories: StorySummary[] }>(`/enrollments/${enrollmentId}/stories`).then((r) => r.stories),
    enabled: !!enrollmentId,
  });
}

function useSignedIn() {
  return useAuth().status === 'signedIn';
}

/** Gems, freezes, amulet, wager, boost, repair offer, level and league tier. */
export function useEngagement() {
  return useQuery({ queryKey: ['engagement'], queryFn: () => get<Engagement>('/me/engagement'), enabled: useSignedIn() });
}

export function useQuests() {
  return useQuery({ queryKey: ['quests'], queryFn: () => get<QuestsView>('/me/quests'), enabled: useSignedIn() });
}

export function useAchievements() {
  return useQuery({
    queryKey: ['achievements'],
    queryFn: () => get<{ badges: Badge[]; monthly: Badge[] }>('/me/achievements'),
    enabled: useSignedIn(),
  });
}

export function useLeague() {
  return useQuery({ queryKey: ['league'], queryFn: () => get<LeagueView>('/leagues/current'), enabled: useSignedIn() });
}

export function useFriendStreaks() {
  return useQuery({
    queryKey: ['friend-streaks'],
    queryFn: () => get<{ friend_streaks: FriendStreakRow[] }>('/friend-streaks').then((r) => r.friend_streaks),
    enabled: useSignedIn(),
  });
}

export function useCircleActivity(circleId?: string) {
  return useQuery({ queryKey: ['circle-activity', circleId], queryFn: () => get<CircleActivity>(`/circles/${circleId}/activity`), enabled: !!circleId });
}

/** Moments the server queued for the app to play once. */
export function useCelebrations() {
  return useQuery({
    queryKey: ['celebrations'],
    queryFn: () => get<{ celebrations: Celebration[] }>('/me/celebrations').then((r) => r.celebrations),
    enabled: useSignedIn(),
    refetchInterval: 60_000,
  });
}

/** After a session finishes, everything derived from attempts may have changed. */
export function useRefreshLearning() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['me', 'path', 'practice', 'reviews', 'progress', 'sessions', 'circle', 'stories', 'engagement', 'quests', 'achievements', 'league', 'friend-streaks', 'circle-activity'].map(
        (key) => queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
}
