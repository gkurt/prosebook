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

export interface Lock {
  version: 2;
  /** Source text by hash: every text some translation is anchored to. */
  sources: Record<string, string>;
  /** Per locale, per key: `<source hash>:<translation hash>`. */
  translations: Record<string, Record<string, string>>;
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

export function serializeLock(lock: Lock): string {
  const translations = Object.fromEntries(
    Object.keys(lock.translations)
      .sort()
      .map((locale) => [locale, sortedEntries(lock.translations[locale]!)]),
  );
  return `${JSON.stringify({ version: 2, sources: sortedEntries(lock.sources), translations }, null, 2)}\n`;
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
  const lock = emptyLock();
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
