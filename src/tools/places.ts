/*
 * Where a lint finding stands in a message's text. Rules read the message as prose (`readings`), which
 * loses positions, so a finding's match is found again in the literals as written.
 */

import { walk, TYPE, type MessageFormatElement } from './icu.ts';
import type { RuleContext } from './lint.ts';

/** Stands in for a placeholder in a reading, which no prose rule reads. */
export const HOLE = '\u2063';

export interface Literal {
  start: number;
  value: string;
}

/**
 * Where the message's literals are written in its text, each looked for after the one before. A
 * literal escaped in the text (`''`, `\{`) isn't written as read, so it has no place, and nor does a
 * finding in it.
 */
export function literalsIn(ast: MessageFormatElement[], text: string): Literal[] {
  const found: Literal[] = [];
  let from = 0;
  walk(ast, (el) => {
    if (el.type !== TYPE.literal || el.value === '') return;
    // MF2's `.match` is read into arms in another order than they are written, so look from the top too.
    const next = text.indexOf(el.value, from);
    const start = next === -1 ? text.indexOf(el.value) : next;
    if (start === -1) return;
    found.push({ start, value: el.value });
    from = start + el.value.length;
  });
  return found;
}

/**
 * What a reading's `HOLE` is written as: a verbatim tag in MF1 or MF2, a placeholder, or a plural's
 * `#`. Tags first, since MF2's opening one is a placeholder's braces too. A plural read as a hole has
 * braces inside, and isn't found.
 */
const WRITTEN_HOLE = String.raw`(?:<[\w-]+>[\s\S]*?</[\w-]+>|\{#[^{}]*\}[\s\S]*?\{/[^{}]*\}|\{[^{}]*\}|#)`;

export const takesInHole = (match: string | RegExp): match is string => typeof match === 'string' && match.includes(HOLE);

/**
 * Every place `match` stands in the literals: a string in any case, whole where it starts or ends
 * with a letter; a regular expression as it matches. A string taking in a placeholder spans
 * literals, so it is looked for in the whole text.
 */
export function placesOf(match: string | RegExp, literals: Literal[], written: string): Place[] {
  const pattern =
    typeof match === 'string' ? wordsPattern(match) : new RegExp(match.source, match.flags.includes('g') ? match.flags : `${match.flags}g`);
  const places = new Map<number, Place>();
  for (const { start, value } of takesInHole(match) ? [{ start: 0, value: written }] : literals) {
    for (const m of value.matchAll(pattern))
      if (m[0] !== '') places.set(start + m.index, { start: start + m.index, end: start + m.index + m[0].length, groups: [...m] });
  }
  return [...places.values()].sort((a, b) => a.start - b.start);
}

/**
 * A match a reading made, as the message's text writes it: its placeholders, case and apostrophes
 * as written, so a rule's message can name it. Where the text doesn't write it as read (an escaped
 * literal), the match itself, each placeholder in it as `{…}`.
 */
export function asWritten(match: string, { ast, written }: Pick<RuleContext, 'ast' | 'written'>): string {
  const places = placesOf(match, literalsIn(ast, written), written);
  // In any case, and an earlier place may differ from the one matched only in it.
  const place = places.find((p) => p.groups[0]!.replace(/’/g, "'") === match) ?? places[0];
  return place === undefined ? match.replaceAll(HOLE, '{…}') : written.slice(place.start, place.end);
}

/** Where a match stands in the text, and what it matched, groups first to last after the whole. */
export interface Place {
  start: number;
  end: number;
  groups: (string | undefined)[];
}

function wordsPattern(match: string): RegExp {
  const body = match
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/ /g, '\\s+')
    .replace(/'/g, "['’]")
    .replaceAll(HOLE, WRITTEN_HOLE);
  const before = /^[\p{L}\p{N}]/u.test(match) ? '(?<![\\p{L}\\p{N}])' : '';
  const after = /[\p{L}\p{N}]$/u.test(match) ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(`${before}${body}${after}`, 'giu');
}

/** What a fix writes over the text it replaces: in that text's case, or as a regular expression's replacement. */
export function fixed({ groups }: Place, match: string | RegExp, fix: string): string {
  if (typeof match === 'string') return inCaseOf(groups[0]!, fix);
  // Expanded from the match as it was made: run again on the text it matched, a lookaround would fail.
  return fix.replace(/\$(&|\d)/g, (_, group: string) => (group === '&' ? groups[0]! : (groups[Number(group)] ?? '')));
}

/** A fix in the case of what it replaces: "Colour" becomes "Color". */
const inCaseOf = (found: string, fix: string) =>
  /^\p{Lu}/u.test(found) && /^\p{Ll}/u.test(fix) ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix;
