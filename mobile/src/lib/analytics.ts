import AsyncStorage from '@react-native-async-storage/async-storage';
import { post } from './api';
import { APP_VERSION } from './config';
import { newId } from './ids';

type ClientEvent =
  | 'onboarding_viewed'
  | 'daily_goal_selected'
  | 'explanation_opened'
  | 'source_opened'
  | 'reminder_prompt_viewed'
  | 'paywall_viewed'
  | 'circle_invite_requested';

let anonymousId: string | null = null;
async function getAnonymousId() {
  if (anonymousId) return anonymousId;
  anonymousId = (await AsyncStorage.getItem('certpath.anon')) ?? newId();
  await AsyncStorage.setItem('certpath.anon', anonymousId);
  return anonymousId;
}

/** Allowlisted product events only; never send answers, reasoning or personal data. */
export function trackEvent(name: ClientEvent, properties?: Record<string, string | number | boolean | null>) {
  getAnonymousId()
    .then((id) => post('/events', { anonymous_id: id, source_version: APP_VERSION, events: [{ name, properties }] }))
    .catch(() => undefined);
}
