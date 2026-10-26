import { useSyncExternalStore } from 'react';

/**
 * Lets a screen with its own celebration sequence (the lesson-complete screen)
 * hold the global celebration player until that sequence has played.
 */

let held = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function holdCelebrations(ms: number) {
  clearTimeout(timer);
  held = true;
  emit();
  timer = setTimeout(() => {
    held = false;
    emit();
  }, ms);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while a hold is active. */
export function useCelebrationHold() {
  return useSyncExternalStore(subscribe, () => held, () => held);
}
