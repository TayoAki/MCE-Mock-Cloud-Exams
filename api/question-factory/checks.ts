/**
 * Step 4 of the factory: the automated half of the self-check in AUTHORING.md.
 * Errors block an item from the bank; warnings flag it for a reviewer.
 */
import blueprintJson from '../src/seed/questions/blueprint.json' with { type: 'json' };
import { ItemSchema, type Item } from '../src/seed/questions/schema.js';
import { DOMAINS, UNITS } from '../src/seed/bank.js';
import { HANDS_ON_UNIT, STORIES } from '../src/seed/formats.js';

export interface BlueprintObjective {
  code: string;
  domain: string;
  title: string;
  guide: string[];
  new: number;
  file: string;
  add?: boolean;
}
export interface Blueprint {
  exam: string;
  guide: { url: string; updated: string };
  mix: { difficulty: Record<'1' | '2' | '3', number>; multiple_max_share: number };
  guide_objectives: Record<string, string>;
  objectives: BlueprintObjective[];
}
export const blueprint = blueprintJson as Blueprint;

export interface Finding {
  family: string;
  level: 'error' | 'warn';
  message: string;
}

const SOURCE_HOSTS = ['docs.databricks.com', 'learn.microsoft.com', 'docs.gcp.databricks.com', 'spark.apache.org', 'docs.delta.io', 'www.databricks.com'];
/** Old product names are allowed only next to "formerly". */
const RETIRED_NAMES = [/\bDelta Live Tables\b/, /\bDLT\b/, /\bDatabricks Repos\b/, /\bDatabricks Asset Bundles\b/, /\bDatabricks Workflows\b/];
const FILLER_OPTIONS = /\b(all|none) of the above\b|\bboth [A-E] and [A-E]\b/i;
const NEGATIVE_STEM = /\b(NOT|EXCEPT)\b/;
const LETTER_REFERENCE = /\b(option|answer|choice)\s+[A-E]\b|\([A-E]\)/;

const len = (s: string) => s.trim().length;
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2));
/** Word-set overlap between two stems, 0 to 1. */
export function similarity(a: string, b: string) {
  const x = words(a);
  const y = words(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.max(1, Math.min(x.size, y.size));
}

/** Families and prompts already in the seed, which new items must not collide with or near-duplicate. */
export function existingSeed() {
  const families = new Set<string>();
  const prompts: { family: string; prompt: string }[] = [];
  for (const unit of UNITS) for (const lesson of unit.lessons) for (const q of lesson.questions) (families.add(q.family), prompts.push({ family: q.family, prompt: q.prompt }));
  for (const lesson of HANDS_ON_UNIT.lessons) for (const q of lesson.questions) (families.add(q.family), prompts.push({ family: q.family, prompt: q.prompt }));
  for (const story of STORIES) for (const part of story.parts) if ('question' in part) (families.add(part.question.family), prompts.push({ family: part.question.family, prompt: part.question.prompt }));
  const objectives = new Set(DOMAINS.flatMap((d) => d.objectives.map((o) => o.code)));
  return { families, prompts, objectives };
}

function bounded(findings: Finding[], family: string, label: string, value: string, min: number, max: number) {
  if (len(value) < min || len(value) > max) findings.push({ family, level: 'error', message: `${label} is ${len(value)} characters; keep it within ${min}–${max}` });
}

/** Checks one item on its own. */
export function checkItem(raw: unknown): { item: Item | null; findings: Finding[] } {
  const parsed = ItemSchema.safeParse(raw);
  const fallbackFamily = (raw as { family?: string })?.family ?? '(unknown)';
  if (!parsed.success) {
    return { item: null, findings: parsed.error.issues.map((i) => ({ family: fallbackFamily, level: 'error' as const, message: `schema: ${i.path.join('.')} ${i.message}` })) };
  }
  const item = parsed.data;
  const f: Finding[] = [];
  const err = (message: string) => f.push({ family: item.family, level: 'error', message });
  const warn = (message: string) => f.push({ family: item.family, level: 'warn', message });

  const objective = blueprint.objectives.find((o) => o.code === item.objective);
  if (!objective) err(`objective ${item.objective} is not in the blueprint`);
  else if (!objective.guide.includes(item.guide)) err(`guide ${item.guide} does not belong to objective ${item.objective} (${objective.guide.join(', ')})`);
  if (!blueprint.guide_objectives[item.guide]) err(`guide objective ${item.guide} does not exist`);

  const correct = item.options.filter((o) => o.correct);
  const average = item.options.filter((o) => o.average);
  if (item.type === 'single') {
    if (item.options.length !== 4) err(`a single-answer item has 4 options, not ${item.options.length}`);
    if (correct.length !== 1) err(`a single-answer item has exactly 1 correct option, not ${correct.length}`);
  } else {
    if (item.options.length !== 5) err(`a "Choose two" item has 5 options, not ${item.options.length}`);
    if (correct.length !== 2) err(`a "Choose two" item has exactly 2 correct options, not ${correct.length}`);
    if (!/\(Choose two\.\)$/.test(item.stem.trim())) err('a "Choose two" stem ends with "(Choose two.)"');
  }
  if (average.length !== 1) err(`mark exactly 1 tempting wrong answer with "average", not ${average.length}`);
  if (average.some((o) => o.correct)) err('the "average" answer must be a wrong answer');

  bounded(f, item.family, 'stem', item.stem, 60, 700);
  if (item.type === 'single' && !/\?$/.test(item.stem.trim())) err('the stem ends with a question mark');
  if (NEGATIVE_STEM.test(item.stem)) err('no negative stems (NOT, EXCEPT)');
  if (item.difficulty >= 2 && !/\b(a|an|the)\s+([\w-]+\s+){0,3}(engineer|team|analyst|company|organization|developer|admin|administrator|architect|scientist|owner|group|lead)\b/i.test(item.stem)) {
    warn('difficulty 2–3 stems should be a scenario with an actor (5W + 1H)');
  }

  const texts = item.options.map((o) => o.text.trim().toLowerCase());
  if (new Set(texts).size !== texts.length) err('options must be distinct');
  for (const o of item.options) {
    bounded(f, item.family, `option "${o.text.slice(0, 30)}…"`, o.text, 2, 220);
    bounded(f, item.family, `why for "${o.text.slice(0, 30)}…"`, o.why, 40, 400);
    if (FILLER_OPTIONS.test(o.text)) err(`no filler options: "${o.text}"`);
    if (LETTER_REFERENCE.test(o.why)) err('explanations must not refer to option letters (options are shuffled)');
  }
  // The key should not stand out as the longest option.
  const keyLen = Math.max(...correct.map((o) => len(o.text)));
  const otherLen = item.options.filter((o) => !o.correct).map((o) => len(o.text));
  const avgOther = otherLen.reduce((a, b) => a + b, 0) / Math.max(1, otherLen.length);
  if (correct.length && keyLen > avgOther * 1.6 && keyLen - avgOther > 25) warn(`the key (${keyLen} chars) is much longer than the other options (avg ${Math.round(avgOther)})`);

  bounded(f, item.family, 'in_practice', item.in_practice, 60, 350);
  bounded(f, item.family, 'evidence', item.evidence, 30, 400);
  if (LETTER_REFERENCE.test(item.in_practice)) err('in_practice must not refer to option letters');

  const host = new URL(item.source).hostname;
  if (!SOURCE_HOSTS.includes(host)) err(`source host ${host} is not an approved documentation site`);

  const allText = [item.stem, ...item.options.map((o) => o.text)].join('\n');
  for (const name of RETIRED_NAMES) {
    for (const m of allText.matchAll(new RegExp(name.source, 'g'))) {
      const around = allText.slice(Math.max(0, m.index - 20), m.index + m[0].length + 5);
      if (!/formerly/i.test(around)) err(`retired name "${m[0]}" without "(formerly …)"`);
    }
  }
  return { item, findings: f };
}

export interface BankReport {
  items: Item[];
  findings: Finding[];
  byObjective: Record<string, { have: number; target: number; difficulty: [number, number, number]; multiple: number }>;
}

/** Checks a whole set of items together: uniqueness, near-duplicates, coverage and mix. */
export function checkBank(files: Record<string, unknown[]>): BankReport {
  const seed = existingSeed();
  const findings: Finding[] = [];
  const items: Item[] = [];
  const fileOf = new Map<string, string>();
  for (const [file, rawItems] of Object.entries(files)) {
    for (const raw of rawItems) {
      const { item, findings: f } = checkItem(raw);
      findings.push(...f);
      if (!item) continue;
      const expected = blueprint.objectives.find((o) => o.code === item.objective)?.file;
      if (expected && expected !== file) findings.push({ family: item.family, level: 'error', message: `objective ${item.objective} belongs in ${expected}.json, not ${file}.json` });
      if (fileOf.has(item.family)) findings.push({ family: item.family, level: 'error', message: `family is duplicated (also in ${fileOf.get(item.family)}.json)` });
      if (seed.families.has(item.family)) findings.push({ family: item.family, level: 'error', message: 'family collides with an existing seed question' });
      fileOf.set(item.family, file);
      items.push(item);
    }
  }
  const prompts = [...seed.prompts, ...items.map((i) => ({ family: i.family, prompt: i.stem }))];
  for (const item of items) {
    for (const other of prompts) {
      if (other.family === item.family) continue;
      const score = similarity(item.stem, other.prompt);
      if (score >= 0.8) findings.push({ family: item.family, level: 'error', message: `stem nearly duplicates ${other.family} (${Math.round(score * 100)}% word overlap)` });
      else if (score >= 0.65 && other.family < item.family) findings.push({ family: item.family, level: 'warn', message: `stem is close to ${other.family} (${Math.round(score * 100)}% word overlap)` });
    }
  }
  const byObjective: BankReport['byObjective'] = {};
  for (const o of blueprint.objectives) {
    const mine = items.filter((i) => i.objective === o.code);
    byObjective[o.code] = {
      have: mine.length,
      target: o.new,
      difficulty: [1, 2, 3].map((d) => mine.filter((i) => i.difficulty === d).length) as [number, number, number],
      multiple: mine.filter((i) => i.type === 'multiple').length,
    };
  }
  const multiple = items.filter((i) => i.type === 'multiple').length;
  if (items.length && multiple / items.length > blueprint.mix.multiple_max_share + 0.02) {
    findings.push({ family: '(bank)', level: 'warn', message: `${multiple} of ${items.length} items are "Choose two"; keep it near ${blueprint.mix.multiple_max_share * 100}%` });
  }
  return { items, findings, byObjective };
}
