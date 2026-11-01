/**
 * Stale translations: a translation made from source text that has since changed.
 *
 * The lock records, per translation, a hash of the source it was made from and a hash of the
 * translation itself. Editing the translation re-anchors it to the current source; editing only
 * the source leaves the old anchor in place, which is what marks it stale. Nobody has to remember
 * to flag anything: `copydeck status` lists what is stale, and `copydeck accept` re-anchors a
 * translation that was still right.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import type { Catalog } from './catalog.ts';

/** Per locale, per key: `<source hash>:<translation hash>`. */
export type Lock = Record<string, Record<string, string>>;

export function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 10);
}

export function readLock(path: string): Lock {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Lock;
}

export function serializeLock(lock: Lock): string {
  const sorted = Object.fromEntries(
    Object.keys(lock)
      .sort()
      .map((locale) => [locale, Object.fromEntries(Object.entries(lock[locale]!).sort(([a], [b]) => (a < b ? -1 : 1)))]),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export interface Reconciled {
  lock: Lock;
  /** Per locale, the keys whose translation was made from a source that has changed since. */
  stale: Map<string, Set<string>>;
}

/**
 * The lock brought up to date with the catalog, and what is stale. `accept` re-anchors the given
 * translations (per locale, keys, or `true` for all of them) to the current source.
 */
export function reconcile(catalog: Catalog, previous: Lock, accept: Map<string, Set<string> | true> = new Map()): Reconciled {
  const lock: Lock = {};
  const stale = new Map<string, Set<string>>();
  for (const message of catalog.messages) {
    const source = hash(message.text);
    for (const [locale, translation] of message.translations) {
      const text = hash(translation.text);
      const [anchor, recorded] = (previous[locale]?.[message.key] ?? '').split(':');
      const accepted = accept.get(locale);
      const reanchor =
        anchor === undefined || anchor === '' || recorded !== text || accepted === true || accepted?.has(message.key) === true;
      (lock[locale] ??= {})[message.key] = `${reanchor ? source : anchor}:${text}`;
      if (!reanchor && anchor !== source) {
        let keys = stale.get(locale);
        if (keys === undefined) stale.set(locale, (keys = new Set()));
        keys.add(message.key);
      }
    }
  }
  return { lock, stale };
}
