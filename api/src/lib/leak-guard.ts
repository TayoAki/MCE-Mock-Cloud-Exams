import type { AnswerType } from '../models/bank.js';

/** Lower-case words separated by single spaces, padded so phrases match on word boundaries. */
const words = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const mentions = (haystack: string, phrase: string) => {
  const needle = words(phrase);
  return needle.trim().length > 0 && haystack.includes(needle);
};

export interface GuardedQuestion {
  prompt: string;
  answerType: AnswerType;
  options: { key: string; text: string }[];
  matchTargets?: { key: string; text: string }[] | null;
}

export interface GuardedKey {
  correctOptions: string[];
  acceptedAnswers?: string[] | null;
}

/** A quoted option this long is too specific to be a passing mention. */
const LONG_OPTION_CHARS = 24;

/**
 * Whether a tutor reply written before the learner answered gives the answer
 * away. Deliberately cautious: a false alarm only costs a rewrite or a
 * reviewed hint, while a leak spoils the question.
 */
export function revealsAnswer(reply: string, q: GuardedQuestion, key: GuardedKey): boolean {
  const text = words(reply);
  const inPrompt = (phrase: string) => mentions(words(q.prompt), phrase);
  const optionText = new Map(q.options.map((o) => [o.key, o.text]));

  if (q.answerType === 'type') {
    // Naming the expected command or term is the answer.
    return (key.acceptedAnswers ?? []).some((a) => a.trim().length >= 2 && !inPrompt(a) && mentions(text, a));
  }

  if (q.answerType === 'order') {
    // Listing every step in the right order is the answer.
    const positions = key.correctOptions.map((k) => text.indexOf(words(optionText.get(k) ?? '')));
    return positions.length >= 3 && positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]!));
  }

  if (q.answerType === 'match') {
    // Stating any correct pair verbatim in one sentence gives that pair away.
    const targets = new Map((q.matchTargets ?? []).map((t) => [t.key, t.text]));
    const sentences = reply.split(/(?<=[.!?\n])\s+/).map(words);
    return key.correctOptions.some((pair) => {
      const [left, right] = pair.split('=');
      const l = optionText.get(left!);
      const r = targets.get(right!);
      return !!l && !!r && sentences.some((s) => mentions(s, l) && mentions(s, r));
    });
  }

  // Single and multiple choice: pointing at a correct letter ("B", "(B)", "option B").
  for (const k of key.correctOptions) {
    // The letter is matched case-sensitively, so the article "a" never counts as option A.
    const letter = new RegExp(`(?:\\b(?:[Oo]ption|[Aa]nswer|[Cc]hoice|[Ll]etter)s?\\s*(?:is\\s*)?\\(?${k}\\b)|(?:\\(${k}\\))|(?:(?:^|[\\s"'“‘])${k}(?:[).:,"'”’]|\\s*$))`, 'm');
    if (letter.test(reply)) return true;
  }
  const correct = key.correctOptions.map((k) => optionText.get(k) ?? '').filter((t) => t && !inPrompt(t));
  const incorrect = q.options.filter((o) => !key.correctOptions.includes(o.key)).map((o) => o.text);
  // Quoting a long correct option, or naming a correct option without any of the others, singles it out.
  if (correct.some((t) => words(t).trim().length >= LONG_OPTION_CHARS && mentions(text, t))) return true;
  const namesCorrect = correct.some((t) => mentions(text, t));
  const namesIncorrect = incorrect.some((t) => mentions(text, t));
  return namesCorrect && !namesIncorrect;
}
