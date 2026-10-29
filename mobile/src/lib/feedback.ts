import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Sound effects and haptics for answer feedback and celebrations. Both are
 * device preferences (on by default) and both fail silently: feedback is a
 * nicety, never a reason for an error.
 */

export interface FeedbackPrefs {
  sound: boolean;
  haptics: boolean;
}

const KEY = 'certpath.feedback.v1';
let prefs: FeedbackPrefs = { sound: true, haptics: true };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (!raw) return;
    prefs = { ...prefs, ...(JSON.parse(raw) as Partial<FeedbackPrefs>) };
    emit();
  })
  .catch(() => undefined);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFeedbackPrefs(): FeedbackPrefs {
  return useSyncExternalStore(subscribe, () => prefs, () => prefs);
}

export function setFeedbackPref(key: keyof FeedbackPrefs, value: boolean) {
  prefs = { ...prefs, [key]: value };
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => undefined);
}

const SOUNDS = {
  correct: require('../../assets/sounds/correct.wav'),
  wrong: require('../../assets/sounds/wrong.wav'),
  combo: require('../../assets/sounds/combo.wav'),
  complete: require('../../assets/sounds/complete.wav'),
  unlock: require('../../assets/sounds/unlock.wav'),
} as const;
export type SoundName = keyof typeof SOUNDS;

const players: Partial<Record<SoundName, AudioPlayer>> = {};
let audioReady = false;

export function playSound(name: SoundName) {
  if (!prefs.sound) return;
  try {
    if (!audioReady) {
      audioReady = true;
      // Respect the silent switch and never pause the learner's own music.
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
    }
    // A handful of short clips, kept for the app's lifetime.
    const player = (players[name] ??= createAudioPlayer(SOUNDS[name]));
    player.seekTo(0).catch(() => undefined);
    player.play();
  } catch {
    // Sound is optional.
  }
}

function haptic(run: () => Promise<void>) {
  if (Platform.OS === 'web' || !prefs.haptics) return;
  run().catch(() => undefined);
}

/** Named moments, so screens describe what happened rather than how it sounds. */
export const feedback = {
  select: () => haptic(() => Haptics.selectionAsync()),
  correct: (combo: number) => {
    playSound(combo >= 3 ? 'combo' : 'correct');
    haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },
  wrong: () => {
    playSound('wrong');
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft));
  },
  complete: () => {
    playSound('complete');
    haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },
  streak: () => haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  unlock: () => {
    playSound('unlock');
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  },
  tick: () => haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};
