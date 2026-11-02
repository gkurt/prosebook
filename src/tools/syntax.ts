/**
 * The two syntaxes a catalog can be written in, behind one pair of calls: read a message into the
 * element tree, and write a tree back out. Everything past reading works on the tree alone.
 */
import { parseMessage, type MessageFormatElement } from './icu.ts';
import { toMf1 } from './mf1.ts';
import { parseMf2, toMf2, type Isolate } from './mf2.ts';

export type MessageFormatVersion = 1 | 2;

export const SYNTAX_NAME: Record<MessageFormatVersion, string> = { 1: 'ICU MessageFormat', 2: 'MessageFormat 2' };

/**
 * A message as the element tree. MF2 is read per locale: which variants a value can reach depends
 * on the locale's plural rules (see `matchTree` in mf2.ts).
 */
export function readMessage(version: MessageFormatVersion, text: string, locale: string, isolate?: Isolate): MessageFormatElement[] {
  return version === 2 ? parseMf2(text, locale, isolate) : parseMessage(text);
}

/** A tree as text in the given syntax. Throws, saying what the syntax can't express, where it can't. */
export function writeMessage(version: MessageFormatVersion, ast: MessageFormatElement[], locale: string): string {
  return version === 2 ? toMf2(ast, locale) : toMf1(ast);
}
