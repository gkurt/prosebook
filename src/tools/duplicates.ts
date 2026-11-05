/**
 * Entries that are one entry written twice: the same words in the same role (kind and surface),
 * which the `duplicate` lint finds and `prosebook lint --fix --unsafe` merges (`planMerge`).
 */
import type { Message } from './catalog.ts';

/** Entries by source text and role, each catalog once. */
const sameWords = new WeakMap<readonly Message[], Map<string, Message[]>>();

const roleOf = (m: Message) => `${m.kind ?? ''}\u0000${m.surface ?? ''}\u0000${m.text}`;

export function entriesSaying(catalog: readonly Message[], message: Message): Message[] {
  let index = sameWords.get(catalog);
  if (index === undefined) {
    index = new Map();
    for (const m of catalog) if (!m.remove) index.set(roleOf(m), [...(index.get(roleOf(m)) ?? []), m]);
    sameWords.set(catalog, index);
  }
  return index.get(roleOf(message)) ?? [];
}

/** An entry exempt from `duplicate` stands apart from the rest saying its words. */
export const apart = (m: Message) => m.allow.has('duplicate');

/** The entries that are one entry written twice or more, the one to keep first: what `duplicate` finds. */
export function duplicateGroups(catalog: readonly Message[]): Message[][] {
  const seen = new Set<Message>();
  const groups: Message[][] = [];
  for (const m of catalog) {
    if (seen.has(m) || m.remove || apart(m)) continue;
    const group = entriesSaying(catalog, m).filter((other) => !apart(other));
    for (const other of group) seen.add(other);
    if (group.length > 1) groups.push(group);
  }
  return groups;
}
