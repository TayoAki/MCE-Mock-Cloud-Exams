import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Cube } from '@/components/Cube';
import { Banner, Body, Button, Screen, Title } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMe } from '@/lib/queries';

/** certpath://join?token=… Joining is always an explicit choice. */
export default function Join() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { status } = useAuth();
  const me = useMe();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await post('/circle-joins', { token });
      await queryClient.invalidateQueries({ queryKey: ['circles'] });
      router.dismissTo('/friends');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not join');
    } finally {
      setBusy(false);
    }
  }

  const needsAccount = status !== 'signedIn' || me.data?.user.is_guest;
  return (
    <Screen
      footer={
        needsAccount ? (
          <Button label="Create an account to join" onPress={() => router.push('/account')} />
        ) : (
          <>
            <Button label="Join circle" loading={busy} disabled={!token} onPress={join} />
            <Button label="Not now" variant="ghost" onPress={() => router.replace('/')} />
          </>
        )
      }
    >
      <Cube size={96} />
      <Title>You’re invited to a study circle.</Title>
      <Body muted>Members see each other’s study days for the week. Not your answers, scores or XP.</Body>
      {!token ? <Banner tone="error">This invite link is incomplete.</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
    </Screen>
  );
}
