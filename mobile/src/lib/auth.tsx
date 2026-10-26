import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { post, setAuthToken, setUnauthorizedHandler } from './api';
import { secureStorage } from './secure-storage';
import { deviceTimezone } from './timezone';
import type { Profile } from './types';
import { syncStreakWidget } from './widget';

const TOKEN_KEY = 'certpath.token';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: Status;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Guests explore with a real server identity so grading and credits stay server-side. */
  startGuest: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const queryClient = useQueryClient();

  const signOut = useCallback(async () => {
    await secureStorage.remove(TOKEN_KEY);
    setAuthToken(null);
    queryClient.clear();
    // The widget must not keep showing a signed-out learner's streak.
    syncStreakWidget({ signedIn: false, streak: 0, studiedToday: false, freezes: 0, questsDone: 0, questsTotal: 3 });
    setStatus('signedOut');
  }, [queryClient]);

  const signIn = useCallback(
    async (token: string) => {
      await secureStorage.set(TOKEN_KEY, token);
      setAuthToken(token);
      queryClient.clear();
      setStatus('signedIn');
    },
    [queryClient],
  );

  const startGuest = useCallback(async () => {
    const res = await post<{ token: string; user: Profile }>('/auth/guest', { timezone: deviceTimezone() });
    await signIn(res.token);
  }, [signIn]);

  useEffect(() => {
    secureStorage.get(TOKEN_KEY).then((token) => {
      setAuthToken(token);
      setStatus(token ? 'signedIn' : 'signedOut');
    });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo(() => ({ status, signIn, signOut, startGuest }), [status, signIn, signOut, startGuest]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
