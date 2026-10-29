/**
 * Step 2 of the factory: research. Scrapes every documentation page listed in
 * sources.json into question-factory/.cache as markdown, so authors (people,
 * agents or generate.ts) work from the current docs rather than memory.
 *
 * Uses Firecrawl (https://docs.firecrawl.dev) when FIRECRAWL_API_KEY is set,
 * and a plain fetch with a small HTML-to-markdown pass otherwise.
 *
 *   npm run factory:scrape                          # every objective
 *   npm run factory:scrape -- --objective ingestion.copy-into
 *   npm run factory:scrape -- --refresh             # ignore the cache
 *   npm run factory:scrape -- --discover            # find more pages first (needs Firecrawl)
 *   npm run factory:scrape -- --list --objective jobs.triggers   # an objective's pages and cache files
 *
 * --discover runs Firecrawl's map search for each objective's queries in
 * sources.json and adds the documentation pages it finds to that objective,
 * so a new batch can research beyond the pages the last one used.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = path.join(here, '.cache');
const FIRECRAWL_URL = 'https://api.firecrawl.dev/v2/scrape';
const FIRECRAWL_MAP_URL = 'https://api.firecrawl.dev/v2/map';
const SOURCES_FILE = path.join(here, 'sources.json');

interface Sources {
  guide: string;
  /** Search phrases per objective for --discover. */
  queries: Record<string, string[]>;
  objectives: Record<string, string[]>;
}

export async function loadSources(): Promise<Sources> {
  return JSON.parse(await readFile(SOURCES_FILE, 'utf8')) as Sources;
}

/** Current AWS documentation pages only: no release notes, API reference or archived pages. */
const DOCS_PAGE = /^https:\/\/docs\.databricks\.com\/aws\/en\/(?!release-notes\/|archive\/|api\/|reference\/api)/;
/** Pages added per query, so one broad search can't flood an objective. */
const PER_QUERY = 6;

/** Adds the pages Firecrawl's map search finds for each objective's queries to sources.json. */
async function discover(only: string | null) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error('--discover needs FIRECRAWL_API_KEY');
  const sources = await loadSources();
  const known = new Set(Object.values(sources.objectives).flat().map((u) => u.replace(/\/$/, '')));
  const searches = Object.entries(sources.queries)
    .filter(([code]) => !only || code === only)
    .flatMap(([code, queries]) => queries.map((search) => ({ code, search })));
  // Map searches are slow (several seconds each), so run a few at once.
  const found = new Map<string, string[]>();
  const queue = [...searches];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const res = await fetch(FIRECRAWL_MAP_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://docs.databricks.com/aws/en/', search: job.search, limit: 20 }),
        });
        const body = (await res.json().catch(() => null)) as { links?: ({ url: string } | string)[]; error?: string } | null;
        if (!res.ok || !body?.links) {
          console.warn(`map failed for "${job.search}" (${res.status} ${body?.error ?? ''})`);
          continue;
        }
        found.set(`${job.code}\t${job.search}`, body.links.map((l) => (typeof l === 'string' ? l : l.url).split('#')[0]!.replace(/\/$/, '')));
      }
    }),
  );
  // Assign in the queries' order, so the result doesn't depend on which search finished first.
  let added = 0;
  for (const { code, search } of searches) {
    const fresh = (found.get(`${code}\t${search}`) ?? []).filter((u) => DOCS_PAGE.test(`${u}/`) && !known.has(u)).slice(0, PER_QUERY);
    for (const url of fresh) known.add(url);
    sources.objectives[code] = [...(sources.objectives[code] ?? []), ...fresh];
    added += fresh.length;
    console.log(`${code} "${search}": +${fresh.length}`);
  }
  await writeFile(SOURCES_FILE, `${JSON.stringify(sources, null, 2)}\n`);
  console.log(`${added} pages added to sources.json`);
}

/** A stable file name for a URL: docs.databricks.com/aws/en/jobs/triggers -> jobs__triggers.md */
export function cacheName(url: string) {
  const u = new URL(url);
  const trimmed = u.pathname.replace(/^\/(aws\/en|docs\/latest)\//, '').replace(/\/$/, '') || 'index';
  const host = u.hostname.includes('databricks.com') ? '' : `${u.hostname.split('.')[0]}__`;
  return `${host}${trimmed.replace(/\//g, '__').replace(/[^a-z0-9_-]+/gi, '-')}.md`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Enough markdown to read a docs page: headings, lists, code, tables and paragraphs, without navigation. */
export function htmlToMarkdown(html: string) {
  const main = /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html;
  let s = main
    .replace(/<(script|style|nav|svg|button|footer|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => `\n\`\`\`\n${code.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')}\n\`\`\`\n`)
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, t: string) => `\n${'#'.repeat(Number(n))} ${t.replace(/<[^>]+>/g, '').trim()}\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|ul|ol|table|blockquote)>/gi, '\n')
    .replace(/<(br|tr)[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<[^>]+>/g, '');
  s = decode(s)
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

async function scrapeOne(url: string): Promise<{ markdown: string; via: 'firecrawl' | 'fetch' }> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (key) {
    const res = await fetch(FIRECRAWL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean; data?: { markdown?: string }; error?: string } | null;
    if (res.ok && body?.success && body.data?.markdown) return { markdown: body.data.markdown, via: 'firecrawl' };
    console.warn(`firecrawl failed for ${url} (${res.status} ${body?.error ?? ''}); falling back to fetch`);
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'certpath-question-factory/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return { markdown: htmlToMarkdown(await res.text()), via: 'fetch' };
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--objective') ? args[args.indexOf('--objective') + 1] : null;
  const refresh = args.includes('--refresh');
  if (args.includes('--discover')) await discover(only ?? null);
  const sources = await loadSources();
  if (args.includes('--list')) {
    for (const [code, list] of Object.entries(sources.objectives)) {
      if (only && code !== only) continue;
      console.log(code);
      for (const url of list) {
        const file = path.join(CACHE_DIR, cacheName(url));
        const size = (await stat(file).catch(() => null))?.size;
        console.log(`  ${size ? `${Math.round(size / 1024)} KB`.padStart(7) : 'missing'}  ${path.relative(process.cwd(), file)}  ${url}`);
      }
    }
    return;
  }
  const urls = [...new Set(Object.entries(sources.objectives).filter(([code]) => !only || code === only).flatMap(([, list]) => list))];
  await mkdir(CACHE_DIR, { recursive: true });
  let done = 0;
  let failed = 0;
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const file = path.join(CACHE_DIR, cacheName(url));
      if (!refresh && (await stat(file).catch(() => null))) {
        done++;
        continue;
      }
      try {
        const { markdown, via } = await scrapeOne(url);
        await writeFile(file, `<!-- source: ${url} | scraped: ${new Date().toISOString()} | via: ${via} -->\n\n${markdown}\n`);
        done++;
      } catch (err) {
        failed++;
        console.error(`failed ${url}: ${String(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`${done} pages cached in ${path.relative(process.cwd(), CACHE_DIR)}${failed ? `, ${failed} failed` : ''} (${process.env.FIRECRAWL_API_KEY ? 'Firecrawl' : 'fetch'})`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
