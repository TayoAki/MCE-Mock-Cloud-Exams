/**
 * Validates the question bank files (api/src/seed/questions/*.json) or a drafts
 * file against AUTHORING.md, and prints coverage against the blueprint.
 *
 *   npm run factory:validate                       # the whole bank
 *   npm run factory:validate -- --file jobs-1       # one bank file
 *   npm run factory:validate -- --drafts drafts/ingestion.copy-into-123.json
 *   npm run factory:validate -- --evidence          # also check each evidence quote against its page
 *   npm run factory:validate -- --overlap           # list items that rest on nearly the same evidence
 *
 * Exits non-zero when any item has an error.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Item } from '../src/seed/questions/schema.js';
import { blueprint, checkBank, similarity } from './checks.js';
import { CACHE_DIR, cacheName, htmlToMarkdown } from './scrape.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BANK_DIR = path.join(here, '..', 'src', 'seed', 'questions');

/** Every bank file except the blueprint, keyed by file name without .json. */
export async function loadBankFiles(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const name of (await readdir(BANK_DIR)).filter((n) => n.endsWith('.json') && n !== 'blueprint.json').sort()) {
    out[name.replace(/\.json$/, '')] = (JSON.parse(await readFile(path.join(BANK_DIR, name), 'utf8')) as { items: unknown[] }).items;
  }
  return out;
}

const content = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 3);

/**
 * The share of an item's evidence words that appear on its source page, fetching
 * pages that aren't cached yet. Low support means the quote may not come from that page.
 */
async function evidenceSupport(items: Item[]) {
  await mkdir(CACHE_DIR, { recursive: true });
  const pages = new Map<string, Set<string>>();
  const results: { family: string; support: number; source: string }[] = [];
  for (const item of items) {
    let words = pages.get(item.source);
    if (!words) {
      const file = path.join(CACHE_DIR, cacheName(item.source));
      let text = await readFile(file, 'utf8').catch(() => null);
      if (!text) {
        const res = await fetch(item.source).catch(() => null);
        text = res?.ok ? htmlToMarkdown(await res.text()) : '';
        if (text) await writeFile(file, `<!-- source: ${item.source} | scraped: ${new Date().toISOString()} | via: fetch -->\n\n${text}\n`);
      }
      words = new Set(content(text));
      pages.set(item.source, words);
    }
    const quote = content(item.evidence);
    const support = quote.length ? quote.filter((w) => words.has(w)).length / quote.length : 0;
    results.push({ family: item.family, support, source: item.source });
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const bank = await loadBankFiles();
  const drafts = arg('--drafts');
  const only = arg('--file');
  if (drafts) {
    const items = (JSON.parse(await readFile(path.resolve(here, drafts), 'utf8')) as { items: unknown[] }).items;
    const objective = (items[0] as { objective?: string })?.objective;
    const file = blueprint.objectives.find((o) => o.code === objective)?.files.at(-1) ?? 'drafts';
    bank[file] = [...(bank[file] ?? []), ...items];
  }
  const report = checkBank(bank);
  const relevant = only ? new Set(((bank[only] ?? []) as { family?: string }[]).map((i) => i.family)) : null;
  const findings = report.findings.filter((f) => !relevant || relevant.has(f.family) || f.family === '(bank)');
  for (const f of findings) console.log(`${f.level === 'error' ? 'ERROR' : 'warn '} ${f.family}: ${f.message}`);

  console.log('\nCoverage (factory items vs blueprint target; difficulty 1/2/3; "Choose two")');
  let have = 0;
  let target = 0;
  for (const o of blueprint.objectives) {
    if (only && !o.files.includes(only)) continue;
    const c = report.byObjective[o.code]!;
    have += c.have;
    target += c.target;
    const mark = c.have >= c.target ? '✓' : ' ';
    console.log(`${mark} ${o.code.padEnd(32)} ${String(c.have).padStart(3)}/${String(c.target).padEnd(3)} d ${c.difficulty.join('/')}  multi ${c.multiple}`);
  }
  if (args.includes('--evidence')) {
    const scoped = report.items.filter((i) => !relevant || relevant.has(i.family));
    const support = await evidenceSupport(scoped);
    const weak = support.filter((s) => s.support < 0.75).sort((a, b) => a.support - b.support);
    console.log(`\nEvidence: ${support.length - weak.length}/${support.length} items' evidence is found on their source page`);
    for (const w of weak) console.log(`  check ${w.family}: ${Math.round(w.support * 100)}% of the evidence words appear on ${w.source}`);
  }
  if (args.includes('--overlap')) {
    // Two items quoting nearly the same sentence often test the same fact. It is
    // a prompt to compare them, not an error: one sentence can support two angles.
    const pairs: string[] = [];
    for (const [a, x] of report.items.entries()) {
      for (const y of report.items.slice(a + 1)) {
        if (relevant && !relevant.has(x.family) && !relevant.has(y.family)) continue;
        const score = similarity(x.evidence, y.evidence);
        if (score >= 0.8) pairs.push(`  ${Math.round(score * 100)}%  ${x.family}  ~  ${y.family}`);
      }
    }
    console.log(`\nEvidence overlap: ${pairs.length} pair${pairs.length === 1 ? '' : 's'} to compare (same fact?)`);
    for (const p of pairs) console.log(p);
  }
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.length - errors;
  console.log(`\n${have}/${target} items · ${errors} errors · ${warnings} warnings`);
  if (errors) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
