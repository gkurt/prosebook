/**
 * Stale translations: a translation made from source text that has since changed.
 *
 * The lock records, per translation, a hash of the source it was made from and a hash of the
 * translation itself. Editing the translation re-anchors it to the current source; editing only
 * the source leaves the old anchor in place, which is what marks it stale. Nobody has to remember
 * to flag anything: `prosebook status` lists what is stale, and `prosebook accept` re-anchors a
 * translation that was still right.
 *
 * The lock also keeps the text behind each anchor, once per distinct text, so a stale translation
 * can show its translator what changed rather than only what the source says now.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import type { Catalog } from './catalog.ts';
import { formatDiff, wordDiff } from './diff.ts';
import type { Verdicts } from './judge.ts';

export interface Lock {
  version: 2;
  /** Source text by hash: every text some translation is anchored to. */
  sources: Record<string, string>;
  /** Per locale, per key: `<source hash>:<translation hash>`. */
  translations: Record<string, Record<string, string>>;
  /** A model's verdicts on the guidelines, which `prosebook judge` writes (`judge.ts`). */
  judged?: Verdicts;
  /**
   * The same for the docs' prose, which `--docs` reads apart from the copy: each run keeps only the
   * verdicts of what it read, so the two would drop each other's in one record.
   */
  docs?: Verdicts;
}

export function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 10);
}

export function emptyLock(): Lock {
  return { version: 2, sources: {}, translations: {} };
}

/** The lock at `path`. A version 1 lock, which held only the translations, reads with no source texts. */
export function readLock(path: string): Lock {
  if (!existsSync(path)) return emptyLock();
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Lock> | Record<string, Record<string, string>>;
  if ((raw as Partial<Lock>).version === 2) return { ...emptyLock(), ...(raw as Partial<Lock>) };
  return { version: 2, sources: {}, translations: raw as Record<string, Record<string, string>> };
}

const sortedEntries = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * The lock as written: pretty-printed, except that each entry's verdicts in a locale stand on one
 * line. A catalog judged on every guideline holds thousands of them, one per rule and model, which
 * pretty-printed run to tens of thousands of lines; an entry that changes is judged anew, so it
 * changes one line of the diff, not a screen of them.
 */
export function serializeLock(lock: Lock): string {
  const translations = Object.fromEntries(
    Object.keys(lock.translations)
      .sort()
      .map((locale) => [locale, sortedEntries(lock.translations[locale]!)]),
  );
  const head = JSON.stringify({ version: 2, sources: sortedEntries(lock.sources), translations }, null, 2);
  const sections = (['judged', 'docs'] as const).flatMap((name) => {
    const written = verdictsText(lock[name] ?? {});
    return written === undefined ? [] : [`  ${JSON.stringify(name)}: {\n${written}\n  }`];
  });
  if (sections.length === 0) return `${head}\n`;
  // The pretty-printed head ends `\n}`: the verdicts go in before that brace.
  return `${head.slice(0, -2)},\n${sections.join(',\n')}\n}\n`;
}

/** Verdicts by locale, each entry's on one line; nothing where no locale holds one. */
function verdictsText(verdicts: Verdicts): string | undefined {
  const locales = Object.keys(verdicts)
    .sort()
    .filter((locale) => Object.keys(verdicts[locale]!).length > 0);
  if (locales.length === 0) return undefined;
  return locales
    .map((locale) => {
      const keys = Object.entries(sortedEntries(verdicts[locale]!)).map(([key, rules]) => {
        const said = Object.fromEntries(Object.entries(sortedEntries(rules)).map(([rule, judges]) => [rule, sortedEntries(judges)]));
        return `      ${JSON.stringify(key)}: ${JSON.stringify(said)}`;
      });
      return `    ${JSON.stringify(locale)}: {\n${keys.join(',\n')}\n    }`;
    })
    .join(',\n');
}

export interface StaleTranslation {
  /** The source the translation was made from, where the lock recorded it. */
  was: string | undefined;
  /** The source now. */
  now: string;
  /** The translation, made from `was`. */
  translation: string;
}

/** What changed in the source of a stale translation, as a word diff, or why that isn't known. */
export function changeOf(stale: StaleTranslation): string {
  if (stale.was === undefined) return "the earlier text isn't recorded (the lock predates prosebook 0.2)";
  return formatDiff(wordDiff(stale.was, stale.now)).replaceAll('\n', ' ');
}

export interface Reconciled {
  lock: Lock;
  /** Per locale, per key: the translations made from a source that has changed since. */
  stale: Map<string, Map<string, StaleTranslation>>;
}

/**
 * The lock brought up to date with the catalog, and what is stale. `accept` re-anchors the given
 * translations (per locale, keys, or `true` for all of them) to the current source.
 */
export function reconcile(catalog: Catalog, previous: Lock, accept: Map<string, Set<string> | true> = new Map()): Reconciled {
  // The verdicts are `prosebook judge`'s to bring up to date, so they're kept as they were.
  const lock: Lock = {
    ...emptyLock(),
    ...(previous.judged !== undefined && { judged: previous.judged }),
    ...(previous.docs !== undefined && { docs: previous.docs }),
  };
  const stale = new Map<string, Map<string, StaleTranslation>>();
  for (const message of catalog.messages) {
    const source = hash(message.text);
    for (const [locale, translation] of message.translations) {
      const text = hash(translation.text);
      const [anchor, recorded] = (previous.translations[locale]?.[message.key] ?? '').split(':');
      const accepted = accept.get(locale);
      const reanchor =
        anchor === undefined || anchor === '' || recorded !== text || accepted === true || accepted?.has(message.key) === true;
      const kept = reanchor ? source : anchor;
      (lock.translations[locale] ??= {})[message.key] = `${kept}:${text}`;
      const keptText = kept === source ? message.text : previous.sources[kept];
      if (keptText !== undefined) lock.sources[kept] = keptText;
      if (!reanchor && anchor !== source) {
        let keys = stale.get(locale);
        if (keys === undefined) stale.set(locale, (keys = new Map()));
        keys.set(message.key, { was: keptText, now: message.text, translation: translation.text });
      }
    }
  }
  return { lock, stale };
}

/**
 * Copies into `lock` what `previous` held of translations it has none of, with the source each was
 * made from: for a catalog loaded with broken entries left out, whose lock would otherwise forget them.
 */
export function keepUnread(lock: Lock, previous: Lock): void {
  for (const [locale, keys] of Object.entries(previous.translations)) {
    for (const [key, anchor] of Object.entries(keys)) {
      const here = (lock.translations[locale] ??= {});
      if (key in here) continue;
      here[key] = anchor;
      const source = anchor.split(':')[0]!;
      if (previous.sources[source] !== undefined) lock.sources[source] = previous.sources[source];
    }
  }
}
