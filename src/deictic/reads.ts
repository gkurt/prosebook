/**
 * The reads the copy inspector matches text on screen to: kept in the browser as the runtime reports
 * them, and on a dev server for what its renders read (`serverReads` in `index.ts`). Each integration's
 * dev module imports it from beside itself and calls `listen`, before any copy reads, so the record
 * starts with the page. Shared by the page and the server, so it imports types only.
 */
import type { DevHooks } from '#src/runtime/types.ts';

export interface Read {
  key: string;
  /** The locale the message was found in. */
  locale: string;
}

/** Recent reads by the text they came to, least recent text first; each text's keys most recent first. */
export type Reads = Map<string, Read[]>;

// Enough for every string on a busy screen and the ones it showed a moment ago.
const LIMIT = 2000;

export function record(reads: Reads, key: string, text: string, locale: string): void {
  if (text.trim() === '') return;
  const seen = reads.get(text) ?? [];
  reads.delete(text);
  reads.set(text, seen[0]?.key === key && seen[0].locale === locale ? seen : [{ key, locale }, ...seen.filter((r) => r.key !== key)]);
  if (reads.size > LIMIT) reads.delete(reads.keys().next().value!);
}

/**
 * The page's record of what every copy read, started once: the dev module starts it before the app runs,
 * and the plugin's page half asks for it, starting it where no dev module did.
 */
export function listen(): Reads {
  const hooks = globalThis as DevHooks;
  if (hooks.__PROSEBOOK_READS__ !== undefined) return hooks.__PROSEBOOK_READS__;
  const reads: Reads = new Map();
  hooks.__PROSEBOOK_READS__ = reads;
  hooks.__PROSEBOOK_READ__ = (key, text, locale) => record(reads, key, text, locale);
  return reads;
}
