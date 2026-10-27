import { z } from 'zod';

/**
 * One authored question, as the question factory writes it
 * (api/question-factory/AUTHORING.md). The item keeps the reasoning that
 * built it: the tempting "average" answer, why each option is right or
 * wrong, and the real-world note, so a reviewer can check every step.
 */
export const ItemOptionSchema = z.strictObject({
  text: z.string(),
  /** The key. One for single-answer items, two for "Choose two". */
  correct: z.boolean().optional(),
  /** The most tempting wrong answer: what a candidate with surface knowledge picks. */
  average: z.boolean().optional(),
  /** Why this option is right (for the key) or why it falls short. */
  why: z.string(),
});

export const ItemSchema = z.strictObject({
  family: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  objective: z.string(),
  /** The official exam guide objective, e.g. "2.3". */
  guide: z.string().regex(/^[1-7]\.[1-9]$/),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  type: z.enum(['single', 'multiple']),
  stem: z.string(),
  options: z.array(ItemOptionSchema),
  /** The production angle: a trade-off, a scale or cost effect, or the business impact. */
  in_practice: z.string(),
  /** The most specific documentation page that supports the key. */
  source: z.url(),
  /** A short quote or close paraphrase from `source` that makes the key correct. */
  evidence: z.string(),
  /** Options read in a natural order (numbers, steps) and are not shuffled. */
  keep_order: z.boolean().optional(),
});

export const ItemFileSchema = z.strictObject({ items: z.array(ItemSchema) });

export type Item = z.infer<typeof ItemSchema>;
export type ItemFile = z.infer<typeof ItemFileSchema>;

/**
 * The learner-facing explanation: why the key is right, why each other option
 * falls short (the tempting one first), then the production angle.
 */
export function composeRationale(item: Item): string {
  const right = item.options.filter((o) => o.correct).map((o) => o.why);
  const tempting = item.options.filter((o) => !o.correct && o.average).map((o) => o.why);
  const others = item.options.filter((o) => !o.correct && !o.average).map((o) => o.why);
  return [...right, ...tempting, ...others, `In practice: ${item.in_practice}`].join(' ');
}

/** A deterministic shuffle per family, so the key's letter carries no signal and reseeding never reorders. */
export function arrangeItem(item: Item) {
  const tagged = item.options.map((o) => ({ text: o.text, correct: !!o.correct }));
  if (!item.keep_order) {
    let seed = [...item.family].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
    const next = () => (seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0) / 4294967296;
    for (let i = tagged.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [tagged[i], tagged[j]] = [tagged[j]!, tagged[i]!];
    }
  }
  return {
    options: tagged.map((t, k) => ({ key: String.fromCharCode(65 + k), text: t.text })),
    correct: tagged.flatMap((t, k) => (t.correct ? [String.fromCharCode(65 + k)] : [])),
  };
}
