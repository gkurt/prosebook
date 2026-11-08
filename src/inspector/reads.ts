/**
 * The reads the inspector matches text on screen to: kept in the browser as the runtime reports
 * them, and on a dev server for what its renders read (`tools/endpoints.ts`). Shared by both, so it
 * imports nothing.
 */
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
