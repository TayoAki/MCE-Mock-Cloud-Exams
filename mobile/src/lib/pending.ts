import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A submitted answer is kept here until the server confirms it. After a network
 * failure or app restart the identical payload (same client_submission_id) is
 * retried, and the server's response decides whether it had already committed.
 */
export interface PendingAnswer {
  sessionId: string;
  body: { session_item_id: string; client_submission_id: string; selected_options: string[] };
}

const key = (sessionId: string) => `certpath.pending.${sessionId}`;

export async function savePending(answer: PendingAnswer) {
  await AsyncStorage.setItem(key(answer.sessionId), JSON.stringify(answer));
}

export async function loadPending(sessionId: string): Promise<PendingAnswer | null> {
  const raw = await AsyncStorage.getItem(key(sessionId));
  return raw ? (JSON.parse(raw) as PendingAnswer) : null;
}

export async function clearPending(sessionId: string) {
  await AsyncStorage.removeItem(key(sessionId));
}
