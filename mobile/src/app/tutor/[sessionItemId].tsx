import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cube } from '@/components/Cube';
import { Banner, ErrorState, Icon, LoadingState, Pill } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { newId } from '@/lib/ids';
import { useSession, useTutor } from '@/lib/queries';
import { colors } from '@/lib/theme';
import type { TutorThread } from '@/lib/types';

function Bubble({ role, text, hint }: { role: 'learner' | 'tutor'; text: string; hint?: boolean }) {
  const mine = role === 'learner';
  return (
    <Animated.View entering={FadeInUp.duration(220)} className={`max-w-[85%] ${mine ? 'self-end' : 'self-start'}`}>
      <View className={`rounded-[18px] px-3.5 py-2.5 ${mine ? 'bg-primary rounded-br-[6px]' : 'bg-surface border border-border rounded-bl-[6px]'}`}>
        {hint ? <Text className="text-muted text-[11px] font-bold uppercase tracking-wider pb-0.5">Reviewed hint</Text> : null}
        <Text selectable className={`text-[15px] leading-[22px] ${mine ? 'text-white' : 'text-ink'}`}>
          {text}
        </Text>
      </View>
    </Animated.View>
  );
}

/** A chat about one question: guidance without the answer first, open discussion after. */
export default function Tutor() {
  const { sessionItemId } = useLocalSearchParams<{ sessionItemId: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const thread = useTutor(sessionItemId);
  const t = thread.data;
  const session = useSession(t?.session_id);
  const item = session.data?.items.find((i) => i.session_item_id === sessionItemId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState<{ text: string; id: string } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);

  async function send(message: string, retryId?: string) {
    const body = message.trim();
    if (!body || sending) return;
    const clientMessageId = retryId ?? newId();
    setSending({ text: body, id: clientMessageId });
    setError(null);
    setText('');
    try {
      const updated = await post<TutorThread>(`/tutor/${sessionItemId}`, { message: body, client_message_id: clientMessageId });
      queryClient.setQueryData(['tutor', sessionItemId], updated);
      setSending(null);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'error', 'Something went wrong');
      if (err.code === 'plus_required') {
        setSending(null);
        router.push({ pathname: '/premium', params: { feature: 'ai_explain' } });
        return;
      }
      setError(err);
      // A network failure keeps the message so Retry sends the identical request.
      if (err.isNetwork) return;
      setText(body);
      setSending(null);
    }
  }

  const before = t?.phase === 'before';
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-background" style={{ paddingTop: Platform.OS === 'ios' ? 0 : insets.top }}>
      <View className="flex-row items-center gap-3 px-4 pt-3 pb-3 border-b border-border">
        <Cube size={40} mood="happy" />
        <View className="flex-1">
          <Text accessibilityRole="header" className="text-ink text-[18px] font-extrabold">
            Tutor
          </Text>
          <Text className="text-muted text-[12px]">{before ? 'Guides you without giving the answer away' : 'Ask anything about this question'}</Text>
        </View>
        {t?.mode === 'hints' ? <Pill tone="muted" label="Hints" /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Close tutor" onPress={() => router.back()} className="h-11 w-11 items-center justify-center">
          <Icon name="close" size={26} color={colors.ink} />
        </Pressable>
      </View>

      {thread.isLoading ? (
        <View className="px-5">
          <LoadingState label="Opening the tutor" />
        </View>
      ) : thread.error || !t ? (
        <View className="px-5">
          <ErrorState error={thread.error} onRetry={() => thread.refetch()} />
        </View>
      ) : (
        <>
          <ScrollView
            ref={scroll}
            className="flex-1"
            contentContainerClassName="px-4 py-4 gap-3"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
          >
            {item ? (
              <View className="rounded-[16px] bg-primary-tint p-3 gap-1">
                <Text className="text-primary-dark text-[11px] font-bold uppercase tracking-wider">{item.objective_title}</Text>
                <Text numberOfLines={4} className="text-ink text-[14px] leading-[20px] font-semibold">
                  {item.prompt}
                </Text>
              </View>
            ) : null}
            <Bubble role="tutor" text={t.intro} />
            {t.messages.map((m, i) => (
              <Bubble key={`${m.at}-${i}`} role={m.role} text={m.text} hint={m.role === 'tutor' && m.origin === 'hint' && t.mode === 'ai'} />
            ))}
            {sending ? (
              <>
                <Bubble role="learner" text={sending.text} />
                {!error ? (
                  <Animated.View entering={FadeIn.delay(200)} accessibilityLabel="The tutor is thinking" className="self-start rounded-[18px] bg-surface border border-border px-4 py-3 flex-row gap-1">
                    {[0, 1, 2].map((d) => (
                      <View key={d} className="h-2 w-2 rounded-full bg-locked" />
                    ))}
                  </Animated.View>
                ) : null}
              </>
            ) : null}
            {!t.available ? (
              <Banner tone="info" title="The tutor is waiting">
                Under exam conditions it opens once your answer is in. Finish the mock to talk it through.
              </Banner>
            ) : null}
            {error ? (
              <View className="gap-2">
                <Banner tone={error.isNetwork ? 'warn' : 'error'}>{error.message}</Banner>
                {error.isNetwork && sending ? (
                  <Pressable accessibilityRole="button" onPress={() => send(sending.text, sending.id)} className="self-start min-h-[44px] justify-center px-2">
                    <Text className="text-primary text-[14px] font-bold">Retry</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </ScrollView>

          {t.available ? (
            <View className="px-4 pt-2 gap-2 border-t border-border bg-background" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
              {t.remaining > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" keyboardShouldPersistTaps="handled">
                  {t.suggestions.map((q) => (
                    <Pressable
                      key={q}
                      accessibilityRole="button"
                      disabled={!!sending}
                      onPress={() => send(q)}
                      className="min-h-[36px] justify-center rounded-full border border-primary px-3 active:bg-primary-tint"
                    >
                      <Text className="text-primary text-[13px] font-bold">{q}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
              {t.remaining > 0 ? (
                <View className="flex-row items-end gap-2">
                  <TextInput
                    accessibilityLabel="Message the tutor"
                    value={text}
                    onChangeText={setText}
                    placeholder={before ? 'What’s confusing you?' : 'Ask a follow-up'}
                    placeholderTextColor={colors.muted}
                    multiline
                    maxLength={1000}
                    className="flex-1 min-h-[48px] max-h-[120px] rounded-[16px] border-2 border-border bg-surface px-3.5 py-3 text-ink text-[15px]"
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send"
                    aria-disabled={!text.trim() || !!sending}
                    disabled={!text.trim() || !!sending}
                    onPress={() => send(text)}
                    className={`h-12 w-12 rounded-full items-center justify-center ${text.trim() && !sending ? 'bg-primary' : 'bg-locked'}`}
                  >
                    <Icon name="arrow-up" size={22} color="#FFFFFF" />
                  </Pressable>
                </View>
              ) : (
                <Banner tone="info">That’s the limit for this question. The next one starts a fresh conversation.</Banner>
              )}
              <Text className="text-muted text-[11px] text-center">
                {t.mode === 'ai' ? 'AI tutor, grounded in the reviewed explanation. It can make mistakes.' : 'Reviewed hints and explanations.'}
                {t.remaining > 0 && t.remaining <= 5 ? ` ${t.remaining} messages left.` : ''}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </KeyboardAvoidingView>
  );
}
