import { badRequest } from './errors.js';
import type { AnswerType } from '../models/bank.js';

/**
 * Grading rules for every answer format. Pure functions, so the rules are
 * easy to test and identical for submission, replay and review.
 */

/** Lowercase, accents and quotes removed, whitespace collapsed, trailing punctuation dropped. */
export function normalizeTyped(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[`'"‘’“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:!?,]+$/, '')
    .trim();
}

/** Letters and digits only, so "Z-order", "z order" and "ZORDER" agree. */
const compact = (text: string) => normalizeTyped(text).replace(/[^a-z0-9]/g, '');

/** Optimal string alignment distance (Levenshtein plus adjacent swaps). */
export function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * A typed answer counts when it equals an accepted answer after normalizing,
 * or after reducing both to letters and digits, allowing one typo from five
 * characters and two from twelve. Short answers must be exact.
 */
export function typedMatches(typed: string, accepted: string[]) {
  const t = normalizeTyped(typed);
  const tc = compact(typed);
  if (!tc) return false;
  return accepted.some((answer) => {
    if (normalizeTyped(answer) === t) return true;
    const ac = compact(answer);
    if (ac === tc) return true;
    const allowed = ac.length >= 12 ? 2 : ac.length >= 5 ? 1 : 0;
    return allowed > 0 && Math.abs(ac.length - tc.length) <= allowed && editDistance(ac, tc) <= allowed;
  });
}

export interface AnswerInput {
  selected_options: string[];
  typed_answer?: string | null;
}

interface QuestionShape {
  answerType: AnswerType;
  options: { key: string }[];
  matchTargets?: { key: string }[] | null;
}

/**
 * Checks a submission against the question's format and returns it in the
 * stored form: sorted choices, the tapped sequence, sorted pairs, or text.
 */
export function canonicalAnswer(q: QuestionShape, input: AnswerInput): { selected: string[]; typed: string | null } {
  const keys = new Set(q.options.map((o) => o.key));
  const raw = input.selected_options ?? [];
  switch (q.answerType) {
    case 'single':
    case 'multiple': {
      const selected = [...new Set(raw)];
      if (selected.some((k) => !keys.has(k))) throw badRequest('invalid_option', 'A selected option is not part of this question');
      if (q.answerType === 'single' && selected.length !== 1) throw badRequest('invalid_cardinality', 'Choose exactly one answer');
      if (!selected.length) throw badRequest('invalid_cardinality', 'Choose at least one answer');
      return { selected: selected.sort(), typed: null };
    }
    case 'order': {
      if (raw.length !== keys.size || new Set(raw).size !== raw.length || raw.some((k) => !keys.has(k))) {
        throw badRequest('invalid_order', 'Place every step exactly once');
      }
      return { selected: [...raw], typed: null };
    }
    case 'match': {
      const targets = new Set((q.matchTargets ?? []).map((t) => t.key));
      const lefts = new Set<string>();
      const rights = new Set<string>();
      for (const pair of raw) {
        const [left, right] = pair.split('=');
        if (!left || !right || !keys.has(left) || !targets.has(right) || lefts.has(left) || rights.has(right)) {
          throw badRequest('invalid_match', 'Pair each item with one different match');
        }
        lefts.add(left);
        rights.add(right);
      }
      if (lefts.size !== keys.size) throw badRequest('invalid_match', 'Pair every item before checking');
      return { selected: [...raw].sort(), typed: null };
    }
    case 'type': {
      const typed = (input.typed_answer ?? '').trim();
      if (raw.length) throw badRequest('invalid_option', 'This question takes a typed answer');
      if (!typed) throw badRequest('answer_required', 'Type an answer first');
      return { selected: [], typed: typed.slice(0, 200) };
    }
  }
}

export function gradeAnswer(type: AnswerType, answer: { selected: string[]; typed: string | null }, key: { correctOptions: string[]; acceptedAnswers?: string[] | null }) {
  switch (type) {
    case 'order':
      return answer.selected.length === key.correctOptions.length && answer.selected.every((k, i) => k === key.correctOptions[i]);
    case 'type':
      return typedMatches(answer.typed ?? '', key.acceptedAnswers ?? []);
    default: {
      const a = new Set(answer.selected);
      const b = new Set(key.correctOptions);
      return a.size === b.size && [...a].every((k) => b.has(k));
    }
  }
}

/** True when a retry carries the same answer as the stored attempt. */
export function sameAnswer(stored: { selectedOptions: string[]; typedAnswer?: string | null }, answer: { selected: string[]; typed: string | null }) {
  return (stored.typedAnswer ?? null) === answer.typed && stored.selectedOptions.length === answer.selected.length && stored.selectedOptions.every((k, i) => k === answer.selected[i]);
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A permutation of 0..n-1 that is not the identity (for n ≥ 2), so keys never spell out the answer. */
function scrambled(n: number, rng: () => number) {
  const idx = [...Array(n).keys()];
  for (let attempt = 0; attempt < 20; attempt++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j]!, idx[i]!];
    }
    if (n < 2 || idx.some((v, i) => v !== i)) break;
  }
  return idx;
}

/**
 * Takes steps in their correct order and gives them scrambled letters, so the
 * options listed A, B, C… are out of order. Returns the options sorted by key
 * and the correct sequence of keys.
 */
export function keyOrderSteps(steps: string[], rng: () => number = Math.random) {
  const perm = scrambled(steps.length, rng);
  const keyed = steps.map((text, i) => ({ key: LETTERS[perm[i]!]!, text }));
  return { options: [...keyed].sort((a, b) => a.key.localeCompare(b.key)), correct: keyed.map((o) => o.key) };
}

/** Takes aligned pairs and numbers the right-hand column in scrambled order. Returns options, targets and "A=n" pairs. */
export function keyMatchPairs(pairs: { left: string; right: string }[], rng: () => number = Math.random) {
  const perm = scrambled(pairs.length, rng);
  const options = pairs.map((p, i) => ({ key: LETTERS[i]!, text: p.left }));
  const targets = pairs.map((p, i) => ({ key: String(perm[i]! + 1), text: p.right }));
  return {
    options,
    targets: [...targets].sort((a, b) => a.key.localeCompare(b.key)),
    correct: pairs.map((_, i) => `${LETTERS[i]}=${targets[i]!.key}`).sort(),
  };
}

/** A small seeded PRNG (mulberry32), so seeded content gets the same keys on every run. */
export function seededRandom(seedText: string) {
  let a = [...seedText].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 1779033703);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
