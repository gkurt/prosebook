/**
 * `prosebook/test`: the catalog in a test, so a test finds the page's text by key and a copy edit
 * doesn't break it. It reads the YAML itself, as `prosebook generate` would, so it needs no generated
 * modules and says what the catalog says now. `copy` is the project's, found from the working
 * directory up; `loadCopy` takes a root and options.
 */
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { createCopy, type Copy } from './runtime/copy.ts';
import { chainOf, negotiate } from './runtime/locale.ts';
import type { MessageShapes, RegisteredLocale, RegisteredMessages } from './runtime/types.ts';
import { CONFIG_FILES, loadConfig, type ResolvedConfig } from './tools/config.ts';
import { evaluatedCatalog } from './tools/evaluated.ts';
import { render } from './tools/generate.ts';
import type { MessageFormatElement } from './tools/icu.ts';
import { messageRegExp } from './tools/matcher.ts';

export interface TestCopyOptions {
  /** The project's folder, where its prosebook config is. The nearest folder up from the working directory holding one, unset. */
  root?: string;
  /** The locale to read in. The source, unset. */
  locale?: string;
  /** The IANA time zone dates are shown in: give the app's, `'UTC'` say, or a date reads as another day. */
  timeZone?: string;
  /** The clock relative times are measured from: `() => Date.UTC(2026, 10, 9)` reads them the same on every run. */
  now?: () => number;
}

export interface MatchOptions {
  /**
   * Matches the text anywhere in what it is tested on (`true`), at its start (`'start'`: a text opening with the
   * message) or at its end (`'end'`), not only the whole of it.
   */
  partial?: boolean | 'start' | 'end';
  /**
   * How many characters of the message's own words may differ from the text, each inserted, deleted or replaced: for a
   * page built from a catalog a little older or newer than the test's. Placeholders and values given aren't counted.
   */
  distance?: number;
}

export interface TestCopy<M extends MessageShapes = RegisteredMessages, L extends string = RegisteredLocale> {
  readonly locale: L;
  /** A message as plain text, as `getByText` and an accessible name read it. Throws on a key the catalog lacks or a placeholder with no value. */
  t: Copy<M, L>['t'];
  /**
   * A message as a regular expression matching every text it can come to: each placeholder given here as the app
   * would write it, each other one any text, and a plural or select not given any of its arms.
   */
  match<K extends keyof M & string>(this: void, key: K, values?: Partial<M[K]['args']>, options?: MatchOptions): RegExp;
  /** A number as the app writes it in this locale, with options or a named format of the config's. */
  number: Copy<M, L>['number'];
  /** A date as the app writes it, in the copy's `timeZone`. */
  date: Copy<M, L>['date'];
  /** Items joined as a list in this locale. */
  list: Copy<M, L>['list'];
  /** A duration in milliseconds, written out. */
  duration: Copy<M, L>['duration'];
  /** A time said relative to the copy's `now`. */
  relative: Copy<M, L>['relative'];
  /** The same catalog in another locale. */
  in(this: void, locale: L | (string & {})): TestCopy<M, L>;
}

const language = (locale: string) => locale.split('-')[0]!.toLowerCase();

/** The nearest folder from `from` up that holds a prosebook config, or `from` where none does. */
function projectRoot(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (CONFIG_FILES.some((name) => existsSync(join(dir, name)))) return dir;
    if (dirname(dir) === dir) return from;
  }
}

async function copyOf(config: ResolvedConfig, options: TestCopyOptions): Promise<TestCopy> {
  // Native targets are files for other platforms, which a test never reads.
  const generated = render({ ...config, native: [] });
  const catalog = evaluatedCatalog(config, generated);
  const asts = new Map([...generated.entries].map(([locale, entries]) => [locale, new Map<string, MessageFormatElement[]>(entries)]));
  const helpers = {
    timeZone: options.timeZone,
    now: options.now,
    formatters: catalog.formatters,
    relative: catalog.relative,
    ladder: catalog.ladder,
  };
  const missing = (key: string) => new Error(`prosebook: the catalog has no entry ${key}: name one it has, or add it`);
  // A copy switches locale asynchronously, so each starts in its own, every one loaded before a test reads.
  const copies = new Map<string, Copy>();
  for (const locale of catalog.locales) {
    const copy = createCopy(catalog, {
      locale,
      ...(options.timeZone !== undefined && { timeZone: options.timeZone }),
      ...(options.now !== undefined && { now: options.now }),
      onMissing: (key) => {
        throw missing(key);
      },
      onError: (error, key) => {
        throw new Error(
          `prosebook: ${key} in ${locale}: ${error.message}: give the test its value, or read the text with copy.match('${key}'), which matches any`,
        );
      },
    });
    await copy.ready;
    copies.set(locale, copy);
  }
  const make = (asked: string): TestCopy => {
    const locale = negotiate(asked, catalog.locales, catalog.source);
    // `negotiate` falls back to the source, which would read a test's locale as another without a word.
    if (language(locale) !== language(asked))
      throw new Error(`prosebook: the catalog has no locale ${asked}: name one of ${catalog.locales.join(', ')}`);
    const copy = copies.get(locale)!;
    return {
      locale: copy.locale,
      t: copy.t,
      number: copy.number,
      date: copy.date,
      list: copy.list,
      duration: copy.duration,
      relative: copy.relative,
      match: (key, values = {}, { partial, distance } = {}) => {
        const found = chainOf(copy.locale, copy.locales, copy.source)
          .map((l) => [l, asts.get(l)?.get(key)] as const)
          .find(([, ast]) => ast !== undefined);
        if (found === undefined) throw missing(key);
        return messageRegExp(found[1]!, found[0], values, {
          ...(partial !== undefined && { partial }),
          ...(distance !== undefined && { distance }),
          helpers,
        });
      },
      in: make,
    };
  };
  return make(options.locale ?? config.source);
}

/** The project's catalog, read from its YAML, for a test. */
export async function loadCopy(options: TestCopyOptions = {}): Promise<TestCopy> {
  const root = options.root === undefined ? projectRoot(process.cwd()) : resolve(options.root);
  const config = await loadConfig(root);
  if (config.inCode) throw new Error(`prosebook: the config at ${root} says catalog: false: a test reads the copy from a catalog`);
  if (!existsSync(config.catalog)) {
    const at = relative(process.cwd(), config.catalog) || '.';
    throw new Error(`prosebook: no catalog at ${at}: run the tests from the app's folder, or load it with loadCopy({ root: 'apps/web' })`);
  }
  return copyOf(config, options);
}

/** A copy whose every read throws why it couldn't load, so importing `loadCopy` alone still works. */
function unloaded(error: unknown): TestCopy {
  const fail = (): never => {
    throw error;
  };
  return {
    get locale() {
      return fail();
    },
    t: fail,
    number: fail,
    date: fail,
    list: fail,
    duration: fail,
    relative: fail,
    match: fail,
    in: fail,
  };
}

/** The project's catalog, in its source locale, found from the working directory up. */
export const copy: TestCopy = await loadCopy().catch(unloaded);
