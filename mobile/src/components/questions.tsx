import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { feedback as play, useFeedbackPrefs } from '@/lib/feedback';
import { speak, stopSpeaking, useDictation } from '@/lib/speech';
import { colors } from '@/lib/theme';
import type { Feedback, SessionItem } from '@/lib/types';
import { Pulse, popIn } from './motion';
import { Icon, Small } from './ui';

/** Answer areas for the formats beyond multiple choice: order, match, typed or spoken, and listening prompts. */

export interface AnswerState {
  selected: string[];
  typed: string;
  inputMode: 'tap' | 'keyboard' | 'voice';
}

/** Whether the learner has given a complete answer for this item's format. */
export function answerReady(item: SessionItem, a: AnswerState) {
  switch (item.answer_type) {
    case 'order':
    case 'match':
      return a.selected.length === item.options.length;
    case 'type':
      return a.typed.trim().length > 0;
    default:
      return a.selected.length > 0;
  }
}

/** The submission body for this item's format. */
export function answerBody(item: SessionItem, a: AnswerState) {
  if (item.answer_type === 'type') return { selected_options: [], typed_answer: a.typed.trim(), input_mode: a.inputMode };
  if (item.answer_type === 'order' || item.answer_type === 'match') return { selected_options: [...a.selected], input_mode: 'tap' as const };
  return { selected_options: [...a.selected].sort() };
}

export function formatHint(item: SessionItem) {
  switch (item.answer_type) {
    case 'order':
      return 'Tap the steps in the right order. Tap a placed step to take it back.';
    case 'match':
      return 'Tap an item, then its match. Tap a pair to undo it.';
    case 'type':
      return 'Type your answer. Small typos are fine.';
    case 'multiple':
      return 'Select every answer that applies.';
    default:
      return 'Select one answer.';
  }
}

const tileTone = (state: 'idle' | 'placed' | 'correct' | 'wrong') =>
  ({
    idle: 'border-border bg-surface',
    placed: 'border-primary bg-primary-tint',
    correct: 'border-success bg-mint',
    wrong: 'border-coral bg-coral-tint',
  })[state];

export function OrderAnswer({ item, value, onChange, disabled, feedback }: { item: SessionItem; value: string[]; onChange: (v: string[]) => void; disabled: boolean; feedback: Feedback | null }) {
  const text = new Map(item.options.map((o) => [o.key, o.text]));
  const placed = item.submission?.selected_options ?? value;
  const bank = item.options.filter((o) => !placed.includes(o.key));
  const reduced = useReducedMotion();
  const layout = reduced ? undefined : LinearTransition.springify().mass(1).damping(18).stiffness(220);
  return (
    <View className="gap-3">
      <View className="gap-2" accessibilityLabel="Your order">
        {item.options.map((_, i) => {
          const key = placed[i];
          if (!key) {
            return (
              <View key={`slot-${i}`} className="min-h-[52px] flex-row items-center gap-3 rounded-[14px] border-2 border-dashed border-border px-3.5">
                <Text className="text-muted text-[14px] font-bold">{i + 1}</Text>
              </View>
            );
          }
          const state = feedback ? (feedback.correct_options[i] === key ? 'correct' : 'wrong') : 'placed';
          return (
            <Animated.View key={key} layout={layout} entering={reduced ? undefined : FadeIn.duration(160)}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Step ${i + 1}: ${text.get(key)}${feedback ? (state === 'correct' ? ', correct position' : ', wrong position') : '. Tap to remove'}`}
                disabled={disabled}
                onPress={() => {
                  play.select();
                  onChange(placed.filter((k) => k !== key));
                }}
                className={`min-h-[52px] flex-row items-center gap-3 rounded-[14px] border-2 px-3.5 py-2.5 ${tileTone(state)}`}
              >
                <View className={`h-7 w-7 rounded-full items-center justify-center ${state === 'correct' ? 'bg-success' : state === 'wrong' ? 'bg-coral' : 'bg-primary'}`}>
                  <Text className="text-white text-[13px] font-extrabold">{i + 1}</Text>
                </View>
                <Text className="flex-1 text-ink text-[15px] leading-[21px]">{text.get(key)}</Text>
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
      {bank.length ? (
        <View className="gap-2">
          <Small>Steps</Small>
          {bank.map((o) => (
            <Animated.View key={o.key} layout={layout}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${o.text}. Place as step ${placed.length + 1}`}
                disabled={disabled}
                onPress={() => {
                  play.select();
                  onChange([...placed, o.key]);
                }}
                className="min-h-[52px] justify-center rounded-[14px] border-2 border-border border-b-4 bg-surface px-3.5 py-2.5 active:bg-primary-tint"
              >
                <Text className="text-ink text-[15px] leading-[21px]">{o.text}</Text>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      ) : null}
      {feedback && !feedback.correct ? (
        <View className="gap-1.5 rounded-[16px] bg-surface border border-border p-3.5">
          <Text className="text-success text-[14px] font-bold">Correct order</Text>
          {feedback.correct_options.map((k, i) => (
            <Text key={k} className="text-ink text-[14px] leading-5">
              {i + 1}. {text.get(k)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const PAIR_COLORS = [
  { border: '#6750EE', bg: '#EEEAFE' },
  { border: '#F5A623', bg: '#FFF4E0' },
  { border: '#1FA2D6', bg: '#E0F4FB' },
  { border: '#E15D64', bg: '#FFF0EF' },
  { border: '#137B60', bg: '#DDF6EB' },
  { border: '#8B5CF6', bg: '#F3EEFF' },
];

export function MatchAnswer({ item, value, onChange, disabled, feedback }: { item: SessionItem; value: string[]; onChange: (v: string[]) => void; disabled: boolean; feedback: Feedback | null }) {
  const pairs = item.submission?.selected_options ?? value;
  const [pick, setPick] = useState<{ side: 'left' | 'right'; key: string } | null>(null);
  const targets = item.match_targets ?? [];
  const leftOf = new Map(pairs.map((p) => [p.split('=')[0]!, p.split('=')[1]!]));
  const rightOf = new Map(pairs.map((p) => [p.split('=')[1]!, p.split('=')[0]!]));
  const colorOf = (left: string) => PAIR_COLORS[item.options.findIndex((o) => o.key === left) % PAIR_COLORS.length]!;
  const correct = new Set(feedback?.correct_options ?? []);

  function pair(left: string, right: string) {
    play.tick();
    onChange([...pairs.filter((p) => !p.startsWith(`${left}=`) && !p.endsWith(`=${right}`)), `${left}=${right}`]);
    setPick(null);
  }

  function tap(side: 'left' | 'right', key: string) {
    const paired = side === 'left' ? leftOf.get(key) : rightOf.get(key);
    if (paired) {
      // Tapping a paired item undoes the pair and picks the item again.
      play.select();
      onChange(pairs.filter((p) => (side === 'left' ? !p.startsWith(`${key}=`) : !p.endsWith(`=${key}`))));
      setPick({ side, key });
      return;
    }
    if (pick && pick.side !== side) return side === 'left' ? pair(key, pick.key) : pair(pick.key, key);
    play.select();
    setPick(pick?.side === side && pick.key === key ? null : { side, key });
  }

  const cell = (side: 'left' | 'right', key: string, label: string) => {
    const left = side === 'left' ? key : rightOf.get(key);
    const paired = !!left && (side === 'left' ? leftOf.has(key) : true);
    const picked = pick?.side === side && pick.key === key;
    const result = feedback && left ? (correct.has(`${left}=${leftOf.get(left)}`) ? 'correct' : 'wrong') : null;
    const tone = result ? (result === 'correct' ? { border: colors.success, bg: colors.mint } : { border: colors.coral, bg: colors.coralTint }) : paired ? colorOf(left!) : null;
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={`${label}${paired ? `, paired with ${side === 'left' ? targets.find((t) => t.key === leftOf.get(key))?.text : item.options.find((o) => o.key === left)?.text}` : ''}${picked ? ', selected' : ''}`}
        aria-selected={picked}
        disabled={disabled}
        onPress={() => tap(side, key)}
        className={`min-h-[64px] justify-center rounded-[14px] border-2 px-3 py-2.5 ${picked ? 'border-primary bg-primary-tint' : tone ? '' : 'border-border bg-surface'}`}
        style={tone && !picked ? { borderColor: tone.border, backgroundColor: tone.bg } : undefined}
      >
        <Text className={`text-ink leading-[19px] ${side === 'left' ? 'text-[14px] font-bold' : 'text-[13px]'}`}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View className="gap-3">
      <View className="flex-row gap-2.5">
        <View className="flex-1 gap-2">{item.options.map((o) => cell('left', o.key, o.text))}</View>
        <View className="flex-1 gap-2">{targets.map((t) => cell('right', t.key, t.text))}</View>
      </View>
      {feedback && !feedback.correct ? (
        <View className="gap-1.5 rounded-[16px] bg-surface border border-border p-3.5">
          <Text className="text-success text-[14px] font-bold">Correct matches</Text>
          {feedback.correct_options.map((p) => {
            const [l, r] = p.split('=');
            return (
              <Text key={p} className="text-ink text-[14px] leading-5">
                <Text className="font-bold">{item.options.find((o) => o.key === l)?.text}</Text> → {targets.find((t) => t.key === r)?.text}
              </Text>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function TypeAnswer({
  item,
  value,
  onChange,
  disabled,
  feedback,
  onSubmit,
}: {
  item: SessionItem;
  value: string;
  onChange: (text: string, mode: 'keyboard' | 'voice') => void;
  disabled: boolean;
  feedback: Feedback | null;
  onSubmit: () => void;
}) {
  const shown = item.submission?.typed_answer ?? value;
  const dictation = useDictation((text) => onChange(text, 'voice'));
  const border = feedback ? (feedback.correct ? 'border-success bg-mint' : 'border-coral bg-coral-tint') : 'border-border bg-surface';
  return (
    <View className="gap-2">
      <View className={`flex-row items-center gap-2 rounded-[16px] border-2 pl-4 pr-1.5 ${border}`}>
        <TextInput
          value={shown}
          onChangeText={(t) => onChange(t, 'keyboard')}
          editable={!disabled}
          placeholder={item.input_hint ?? 'Type your answer'}
          placeholderTextColor={colors.muted}
          accessibilityLabel="Your answer"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="done"
          onSubmitEditing={() => shown.trim() && onSubmit()}
          maxLength={200}
          className="flex-1 min-h-[56px] text-ink text-[17px] font-semibold"
        />
        {dictation.available && !disabled ? (
          <Pulse active={dictation.listening} to={1.12}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={dictation.listening ? 'Stop listening' : 'Say your answer'}
              onPress={() => (dictation.listening ? dictation.stop() : dictation.start())}
              className={`h-11 w-11 items-center justify-center rounded-full ${dictation.listening ? 'bg-coral' : 'bg-primary-tint'}`}
            >
              <Icon name={dictation.listening ? 'stop' : 'mic'} size={20} color={dictation.listening ? '#FFFFFF' : colors.primary} />
            </Pressable>
          </Pulse>
        ) : null}
      </View>
      {dictation.listening ? <Small>Listening… say your answer, then tap stop.</Small> : null}
      {dictation.error ? <Small className="text-coral-dark">{dictation.error}</Small> : null}
      {feedback && !feedback.correct && feedback.expected_answer ? (
        <Animated.View entering={popIn(100)} className="rounded-[14px] bg-surface border border-border px-3.5 py-2.5">
          <Text className="text-ink text-[15px]">
            Answer: <Text className="font-extrabold">{feedback.expected_answer}</Text>
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * A listening prompt: the question is read aloud (automatically when sound is
 * on) and its text stays hidden until the learner asks or has answered.
 */
export function ListenPrompt({ text, revealed }: { text: string; revealed: boolean }) {
  const prefs = useFeedbackPrefs();
  const [playing, setPlaying] = useState(false);
  const [show, setShow] = useState(false);
  const autoplayed = useRef<string | null>(null);

  function play() {
    setPlaying(true);
    speak(text, { onDone: () => setPlaying(false) });
  }

  useEffect(() => {
    if (prefs.sound && autoplayed.current !== text && !revealed) {
      autoplayed.current = text;
      const timer = setTimeout(play, 350);
      return () => clearTimeout(timer);
    }
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopSpeaking(), []);

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <Pulse active={playing} to={1.08}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Playing the question' : 'Play the question'}
            onPress={play}
            className="h-16 w-16 items-center justify-center rounded-[20px] bg-primary border-b-4 border-primary-dark"
          >
            <Icon name="volume-high" size={30} color="#FFFFFF" />
          </Pressable>
        </Pulse>
        <View className="flex-1 gap-0.5">
          <Text className="text-ink text-[17px] font-extrabold">Listen to the question</Text>
          {!(revealed || show) ? (
            <Pressable accessibilityRole="button" onPress={() => setShow(true)} className="min-h-[32px] justify-center">
              <Text className="text-primary text-[14px] font-bold">Show the text</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {revealed || show ? (
        <Text accessibilityRole="header" className="text-ink text-[20px] leading-[27px] font-extrabold">
          {text}
        </Text>
      ) : null}
    </View>
  );
}

/** A compact single or multiple choice list, used inside stories. */
export function ChoiceAnswer({ item, value, onChange, disabled, feedback }: { item: SessionItem; value: string[]; onChange: (v: string[]) => void; disabled: boolean; feedback: Feedback | null }) {
  const multiple = item.answer_type === 'multiple';
  const mine = item.submission?.selected_options ?? value;
  return (
    <View className="gap-2">
      {item.options.map((o) => {
        const state = feedback ? (feedback.correct_options.includes(o.key) ? 'correct' : mine.includes(o.key) ? 'wrong' : 'idle') : mine.includes(o.key) ? 'placed' : 'idle';
        return (
          <Pressable
            key={o.key}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            aria-checked={mine.includes(o.key)}
            accessibilityLabel={`${o.text}${state === 'correct' ? ', correct answer' : state === 'wrong' ? ', your answer, incorrect' : ''}`}
            disabled={disabled}
            onPress={() => {
              play.select();
              onChange(multiple ? (mine.includes(o.key) ? mine.filter((k) => k !== o.key) : [...mine, o.key]) : [o.key]);
            }}
            className={`min-h-[52px] flex-row items-center gap-3 rounded-[14px] border-2 px-3.5 py-2.5 ${tileTone(state)}`}
          >
            {state === 'correct' || state === 'wrong' ? <Icon name={state === 'correct' ? 'checkmark-circle' : 'close-circle'} size={20} color={state === 'correct' ? colors.success : colors.coralDark} /> : null}
            <Text className="flex-1 text-ink text-[15px] leading-[21px]">{o.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
