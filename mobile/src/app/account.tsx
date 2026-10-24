import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Banner, Body, Button, Icon, Screen, Small, Title } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMe } from '@/lib/queries';
import { colors } from '@/lib/theme';
import { deviceTimezone } from '@/lib/timezone';
import type { Profile } from '@/lib/types';

function Field(props: { label: string; value: string; onChangeText: (v: string) => void; secure?: boolean; email?: boolean }) {
  return (
    <View className="gap-1.5">
      <Text className="text-ink text-[14px] font-semibold">{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secure}
        autoCapitalize="none"
        autoComplete={props.secure ? 'password' : props.email ? 'email' : 'name'}
        inputMode={props.email ? 'email' : 'text'}
        accessibilityLabel={props.label}
        placeholderTextColor={colors.muted}
        className="min-h-[52px] rounded-[15px] border border-border bg-surface px-4 text-[16px] text-ink"
      />
    </View>
  );
}

/**
 * Save progress: a guest who registers keeps the same identity, so every
 * attempt, credit and reward stays. Signing in to another account does not
 * merge this device's guest progress.
 */
export default function Account() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'save' | 'signin'>(params.mode === 'signin' ? 'signin' : 'save');
  const { status, signIn } = useAuth();
  const me = useMe();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isGuest = me.data?.user.is_guest ?? status !== 'signedIn';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'save') {
        const res = await post<{ token: string; user: Profile }>('/auth/register', {
          email: email.trim(),
          password,
          ...(name.trim() && { display_name: name.trim() }),
          ...(status !== 'signedIn' && { timezone: deviceTimezone() }),
        });
        await signIn(res.token);
      } else {
        const res = await post<{ token: string }>('/auth/login', { email: email.trim(), password });
        await signIn(res.token);
      }
      await queryClient.invalidateQueries();
      router.replace('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button label={mode === 'save' ? 'Save my progress' : 'Sign in'} loading={busy} disabled={!email || password.length < (mode === 'save' ? 8 : 1)} onPress={submit} />}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} className="h-11 w-11 justify-center">
        <Icon name="close" size={28} color={colors.ink} />
      </Pressable>
      <Title>{mode === 'save' ? 'Keep your progress.' : 'Welcome back.'}</Title>
      <Body muted>{mode === 'save' ? 'Create an account to keep your streak, reviews and results on any device.' : 'Sign in to pick up where you left off.'}</Body>
      <View accessibilityRole="tablist" className="flex-row rounded-[15px] bg-border p-1">
        {(['save', 'signin'] as const).map((m) => (
          <Pressable key={m} accessibilityRole="tab" aria-selected={mode === m} onPress={() => setMode(m)} className={`flex-1 min-h-[44px] items-center justify-center rounded-[12px] ${mode === m ? 'bg-surface' : ''}`}>
            <Text className={`text-[14px] font-bold ${mode === m ? 'text-ink' : 'text-muted'}`}>{m === 'save' ? 'Create account' : 'Sign in'}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'save' ? <Field label="Name (optional)" value={name} onChangeText={setName} /> : null}
      <Field label="Email" value={email} onChangeText={setEmail} email />
      <Field label={mode === 'save' ? 'Password (at least 8 characters)' : 'Password'} value={password} onChangeText={setPassword} secure />
      {mode === 'signin' && status === 'signedIn' && isGuest ? (
        <Banner tone="warn" title="This device's guest progress stays separate">
          Signing in to an existing account doesn’t move guest progress into it. To keep it, create an account instead.
        </Banner>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Small>We use your email only to sign you in. It never appears in analytics.</Small>
    </Screen>
  );
}
