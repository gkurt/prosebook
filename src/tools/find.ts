/**
 * `prosebook find`: the entries saying what someone is about to write, looked up before an entry is
 * added, so a string the catalog has is read again rather than written twice. Words are compared
 * without case or punctuation, against every arm of an entry's message and the words of its key past
 * its area; one saying them all comes first, then those saying most of them.
 */
import type { Message } from './catalog.ts';
import { readings } from './lint.ts';

export interface Found {
  message: Message;
  /** The share of the words looked for that the entry says: 1 for all of them. */
  score: number;
  /** Its message says exactly the words looked for. */
  exact: boolean;
}

export interface FindOptions {
  kind?: string;
  surface?: string;
  /** The most entries to give back. */
  limit?: number;
}

const wordsOf = (text: string): string[] => Array.from(text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu), (m) => m[0]);

/** A word said, or said with an ending: "item" is in "items", "check" in "checked". */
const says = (said: readonly string[], word: string) =>
  said.some((w) => w === word || (word.length > 2 && w.startsWith(word) && w.length - word.length <= 3));

/** The entries saying the words of `query`, the closest first. */
export function findEntries(messages: readonly Message[], query: string, options: FindOptions = {}): Found[] {
  const { kind, surface, limit = 10 } = options;
  const wanted = [...new Set(wordsOf(query))];
  if (wanted.length === 0) return [];
  const phrase = wanted.join(' ');
  const found: Found[] = [];
  for (const message of messages) {
    if (message.remove || (kind !== undefined && message.kind !== kind) || (surface !== undefined && message.surface !== surface)) continue;
    const { primary, variants } = readings(message.ast);
    const said = variants.flatMap(wordsOf);
    // A key says its words too, `player.fullscreen` "full screen", though its area says what all its keys do.
    const key = message.key.slice(message.area.length + 1).toLowerCase();
    const score = wanted.filter((word) => says(said, word) || (word.length > 2 && key.includes(word))).length / wanted.length;
    if (score === 0) continue;
    found.push({ message, score, exact: wordsOf(primary).join(' ') === phrase });
  }
  const order = (a: Found, b: Found) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return a.message.key.localeCompare(b.message.key);
  };
  return found.sort(order).slice(0, limit);
}
