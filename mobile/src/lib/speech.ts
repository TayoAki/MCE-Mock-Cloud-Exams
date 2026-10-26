import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useState } from 'react';

/**
 * Reading aloud (listening questions and stories) and dictation (spoken
 * answers). Both fail quietly: every question can still be read and typed.
 */

/** Slightly different voices per story character, by pitch. */
const PITCH = [1, 1.18, 0.88, 1.08];

export function speak(text: string, opts: { voice?: number; onDone?: () => void } = {}) {
  try {
    Speech.stop();
    const done = () => opts.onDone?.();
    Speech.speak(text, { language: 'en-US', rate: 0.98, pitch: PITCH[(opts.voice ?? 0) % PITCH.length], onDone: done, onStopped: done, onError: done });
  } catch {
    opts.onDone?.();
  }
}

export function stopSpeaking() {
  try {
    Speech.stop();
  } catch {
    // Nothing to stop.
  }
}

/** Platform vocabulary that helps the recognizer with commands it would otherwise mishear. */
const VOCABULARY = [
  'Databricks',
  'Delta Lake',
  'VACUUM',
  'OPTIMIZE',
  'RESTORE',
  'DESCRIBE HISTORY',
  'VERSION AS OF',
  'TIMESTAMP AS OF',
  'MERGE INTO',
  'COPY INTO',
  'Auto Loader',
  'Unity Catalog',
  'Z-ORDER',
  'liquid clustering',
  'databricks.yml',
  'delta log',
  'bronze',
  'silver',
  'gold',
];

function recognitionAvailable() {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/** Speech to text for typed answers. `onText` receives partial and final transcripts. */
export function useDictation(onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available] = useState(recognitionAvailable);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (e) => {
    const transcript = e.results[0]?.transcript ?? '';
    if (transcript) onText(transcript, e.isFinal);
  });
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false);
    if (e.error === 'aborted') return;
    setError(
      e.error === 'not-allowed'
        ? 'Microphone or speech access is off for CertPath. You can allow it in Settings, or type instead.'
        : e.error === 'no-speech' || e.error === 'speech-timeout'
          ? "Didn't catch that. Tap the mic and try again."
          : 'Speaking is unavailable right now. Type your answer instead.',
    );
  });

  async function start() {
    setError(null);
    stopSpeaking();
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone or speech access is off for CertPath. You can allow it in Settings, or type instead.');
        return;
      }
      ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true, contextualStrings: VOCABULARY, addsPunctuation: false });
    } catch {
      setError('Speaking is unavailable right now. Type your answer instead.');
    }
  }

  function stop() {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      setListening(false);
    }
  }

  return { available, listening, error, start, stop };
}
