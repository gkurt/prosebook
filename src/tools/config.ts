/**
 * `prosebook/config`: where the catalog lives, what an entry may say about itself, and how strictly
 * its words are checked. Written as `prosebook.config.ts` (or `.js`, `.mjs`, `.json`) at the project root.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Formats, FormatTable } from '#src/runtime/formats.ts';

import { DURATION_STYLES, DURATION_UNITS } from './icu.ts';
import { compileRule, CORE_RULES, REASON_NAME, reasonProblem, type CheckRule, type CoreRule, type Plugin } from './lint.ts';
import type { Isolate } from './mf2.ts';
import { DEFAULT_KINDS, DEFAULT_QUOTES, DEFAULT_SURFACES, STRICT_LISTS, type KindRule, type Severity } from './presets.ts';

export type { KindRule, Severity };
export {
  definePlugin,
  phrase,
  sentences,
  words,
  type CapitalizationRule,
  type CheckRule,
  type ConditionalRule,
  type ExistenceRule,
  type GuidelineRule,
  type OccurrenceRule,
  type Plugin,
  type Readings,
  type Report,
  type Rule,
  type RuleContext,
  type SubstitutionRule,
} from './lint.ts';
export { asWritten, HOLE } from './places.ts';

export interface WordLists {
  /** Words a string never uses, in groups that say why. */
  banned?: { words: string[]; why: string }[];
  /** A spelling, and the one the product uses instead. */
  spelling?: Record<string, string>;
  /** A near-synonym, and the one word the product uses for that concept. */
  concepts?: Record<string, string>;
  /** Words that keep their capital inside a sentence-case string: product names, platforms. */
  properNouns?: string[];
  /** What a path through menus or settings is written with, spaced: `›` by default, as in Settings › General. */
  pathSeparator?: string;
  /**
   * Quotation marks by language or locale, over the defaults (`de: ['„', '“']`, CLDR's): what the
   * `quotes` rule holds a translation to. A locale takes its own, else its language's.
   */
  quotes?: Record<string, readonly [open: string, close: string]>;
}

type RuleSeverities = Partial<Record<CoreRule, Severity>> & Record<string, Severity>;

export interface LintConfig extends WordLists {
  /** `recommended` (the default) checks shape; `strict` adds the word lists and rules of a house style guide. */
  extends?: 'recommended' | 'strict' | 'none';
  /** Rules of your own, as `<plugin>/<rule>`. Each takes the severity it gives itself under `extends`. */
  plugins?: Plugin[];
  rules?: RuleSeverities;
  /** Severities for one area's entries (a key's first segment) over `rules`: `{ native: { 'sentence-case': 'off' } }`. */
  areas?: Record<string, RuleSeverities>;
  /**
   * Reasons many exemptions share, by name: `allow: { period: card-detail }` takes the reason
   * `card-detail` names here, so it is written, reviewed and changed once.
   */
  reasons?: Record<string, string>;
}

/**
 * Native code generated from the catalog, for the parts of an app outside the browser: a tray, a
 * menu bar, a CLI. One file, holding every locale, with a typed function per message; for Android and
 * Apple, string resources, a file per locale.
 */
export interface NativeTarget {
  language: 'rust' | 'swift' | 'kotlin' | 'android' | 'apple';
  /**
   * The file written; for Android, the `res` folder its `values*` folders go in, and for Apple, the
   * folder its `.lproj` folders go in.
   */
  out: string;
  /**
   * Key prefixes the file holds: `['native']` takes every `native.*` key, which it names without the
   * prefix (`native.tray.quit` is `tray_quit`). Every key, named in full, by default.
   */
  keys?: string[];
  /**
   * The type holding the locales and messages: `Locale` in Rust, `Copy` in Swift and Kotlin. For
   * Android, the resource file's name: `strings`, for `values/strings.xml`. For Apple, the table's:
   * `Localizable`, or `InfoPlist` with `plist`.
   */
  name?: string;
  /** Kotlin's package. */
  package?: string;
  /**
   * For Apple, the Info.plist the table translates: each key names one of its strings, spelled in
   * words (`ns-camera-usage-description` is `NSCameraUsageDescription`), and the source must say
   * what the plist says.
   */
  plist?: string;
}

export interface ProsebookConfig {
  /** The source-language catalog: one `<area>.yaml` per area. */
  catalog?: string;
  /** Translations: `<locale>/<area>.yaml` or `<locale>.yaml`, holding `key: message`. */
  locales?: string;
  /** Where the generated modules go. */
  out?: string;
  /** Records which source text each translation was made from, so a changed source marks it stale. */
  lock?: string;
  /** The locale the catalog is written in. Its code is also the field holding the message. */
  source?: string;
  /**
   * The syntax messages are written in: ICU MessageFormat (1) or Unicode MessageFormat 2. Source and
   * translations alike; `prosebook migrate` rewrites a catalog from one to the other.
   */
  messageFormat?: 1 | 2;
  /**
   * In MF2, when a placeholder is wrapped in Unicode isolation marks, so a value written the other
   * way (a Latin name in Hebrew) can't reorder the text around it. `'rtl'`, the default: in locales
   * written right to left, and wherever `u:dir` asks. `'always'`: also every string in any locale,
   * as the spec's default has it. `false`: never.
   */
  isolate?: Isolate;
  /**
   * Number and date formats by name, as `Intl` options: `number: { price: { style: 'currency', currency: 'EUR' } }`.
   * A message names one in place of a style (`{total, number, price}`, `{$total :number format=price}`)
   * and code passes the name to `copy.number` and `copy.date`, so the app shows each the same way
   * everywhere, and one edit here changes it. `locales` shows one differently in a locale or language.
   */
  formats?: Formats;
  /** Locales that ship in the main bundle beside the source, rather than loading when first used. */
  bundled?: string[];
  /** A pseudo-locale generated from the source (accented and lengthened) to find layout bugs and hardcoded text. */
  pseudo?: string | false;
  /** What a translation whose source changed since does: still show (`use`) or show the source (`fallback`). */
  stale?: 'use' | 'fallback';
  /** Generated modules as TypeScript or as JavaScript with a `.d.ts` beside the index. */
  language?: 'ts' | 'js';
  /** The extension generated imports name: `.js` suits most TypeScript setups, `.ts` suits Node's type stripping. */
  importExtension?: '.js' | '.ts' | '';
  /** The fields every entry must have. A shorthand `key: message` entry satisfies none of them. */
  require?: ('context' | 'kind' | 'surface')[];
  /** The kinds of string an entry may say it is, with the shape each one is held to. */
  kinds?: Record<string, KindRule>;
  /** Where a string may sit, with what each surface means. */
  surfaces?: Record<string, string>;
  lint?: LintConfig;
  /**
   * The writing guide `generate` writes for whoever writes the copy, a person or an agent: the kinds,
   * the surfaces and the rules the lint holds them to, as instructions. `WRITING.md` in the catalog
   * folder by default; `false` writes none. Point AGENTS.md at it.
   */
  guide?: string | false;
  /** Rust, Swift or Kotlin files `generate` writes beside the TypeScript. */
  native?: NativeTarget[];
  /** How `prosebook extract` writes new entries. */
  extract?: {
    /**
     * An area for the words several features say, `Cancel` and `Loading…`: an entry there is reused
     * from any file, and text another area holds already goes there rather than into a second area.
     */
    shared?: string;
  };
  /** Where `prosebook scan` looks for hardcoded text and catalog keys. */
  scan?: {
    dirs?: string[];
    extensions?: string[];
    /** JSX attributes whose literal value a person reads. */
    attributes?: string[];
    /**
     * Functions whose text arguments a person reads, by name: `toast` covers `toast('…')` and
     * `toast.error('…')`, and the text of an options object passed to them.
     */
    calls?: string[];
    /** Object properties whose literal value a person reads, as in a label map: `{ value: 'done', label: 'Done' }`. */
    properties?: string[];
  };
}

/** What `scan` reads, and where. */
export interface ScanOptions {
  dirs: string[];
  extensions: string[];
  attributes: string[];
  calls: string[];
  properties: string[];
}

export interface ResolvedConfig {
  root: string;
  catalog: string;
  locales: string;
  out: string;
  lock: string;
  source: string;
  messageFormat: 1 | 2;
  isolate: Isolate;
  formats: Formats;
  bundled: string[];
  pseudo: string | false;
  stale: 'use' | 'fallback';
  language: 'ts' | 'js';
  importExtension: '.js' | '.ts' | '';
  require: ('context' | 'kind' | 'surface')[];
  kinds: Record<string, KindRule>;
  surfaces: Record<string, string>;
  lint: {
    rules: Record<string, { rule: CheckRule; severity: Severity }>;
    areas: Record<string, Record<string, Severity>>;
    reasons: Record<string, string>;
  } & Required<WordLists>;
  guide: string | false;
  native: (NativeTarget & { name: string })[];
  extract: { shared?: string };
  scan: ScanOptions;
}

const NATIVE_NAMES = { rust: 'Locale', swift: 'Copy', kotlin: 'Copy', android: 'strings', apple: 'Localizable' };

/** Typed config, for `prosebook.config.ts`. */
export function defineConfig(config: ProsebookConfig): ProsebookConfig {
  return config;
}

export const CONFIG_FILES = [
  'prosebook.config.ts',
  'prosebook.config.mts',
  'prosebook.config.js',
  'prosebook.config.mjs',
  'prosebook.config.json',
];

/** Finds and reads the config at `root`, or the defaults when there is none. */
export async function loadConfig(root: string, inline?: ProsebookConfig): Promise<ResolvedConfig> {
  if (inline) return resolveConfig(root, inline);
  for (const name of CONFIG_FILES) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    if (name.endsWith('.json')) return resolveConfig(root, JSON.parse(readFileSync(path, 'utf8')) as ProsebookConfig);
    const mod = (await import(pathToFileURL(path).href)) as { default?: ProsebookConfig };
    return resolveConfig(root, mod.default ?? {});
  }
  return resolveConfig(root, {});
}

export function resolveConfig(root: string, config: ProsebookConfig): ResolvedConfig {
  const at = (path: string) => (isAbsolute(path) ? path : resolve(root, path));
  const lint = config.lint ?? {};
  const base = lint.extends ?? 'recommended';
  const strict = base === 'strict';
  const rules = lintRules(lint);
  const catalog = at(config.catalog ?? 'copy/catalog');
  for (const [area, severities] of Object.entries(lint.areas ?? {})) {
    for (const name of Object.keys(severities))
      if (!(name in rules)) throw new Error(`lint.areas.${area}.${name} is not a rule: name one of ${Object.keys(rules).join(', ')}`);
  }
  return {
    root,
    catalog,
    locales: at(config.locales ?? 'copy/locales'),
    out: at(config.out ?? 'src/copy'),
    lock: at(config.lock ?? 'copy/lock.json'),
    source: config.source ?? 'en',
    messageFormat: config.messageFormat ?? 1,
    isolate: config.isolate ?? 'rtl',
    formats: checkedFormats(config.formats ?? {}),
    bundled: config.bundled ?? [],
    pseudo: config.pseudo ?? false,
    stale: config.stale ?? 'use',
    language: config.language ?? 'ts',
    importExtension: config.importExtension ?? '.js',
    require: config.require ?? ['context'],
    kinds: config.kinds ?? DEFAULT_KINDS,
    surfaces: config.surfaces ?? DEFAULT_SURFACES,
    lint: {
      rules,
      areas: lint.areas ?? {},
      reasons: checkedReasons(lint.reasons ?? {}),
      banned: [...(strict ? STRICT_LISTS.banned : []), ...(lint.banned ?? [])],
      spelling: { ...(strict ? STRICT_LISTS.spelling : {}), ...lint.spelling },
      concepts: { ...lint.concepts },
      properNouns: lint.properNouns ?? [],
      pathSeparator: lint.pathSeparator ?? '›',
      quotes: checkedQuotes(lint.quotes ?? {}),
    },
    guide: config.guide === false ? false : config.guide === undefined ? join(catalog, 'WRITING.md') : at(config.guide),
    native: (config.native ?? []).map((target, i) => {
      if (!(target.language in NATIVE_NAMES))
        throw new Error(`native[${i}].language is "${target.language}": name one of ${Object.keys(NATIVE_NAMES).join(', ')}`);
      if (target.plist !== undefined && target.language !== 'apple')
        throw new Error(`native[${i}].plist names an Info.plist, which only the apple target reads: remove it, or set language to 'apple'`);
      const plist = target.plist === undefined ? {} : { plist: at(target.plist) };
      const name = target.name ?? (target.plist === undefined ? NATIVE_NAMES[target.language] : 'InfoPlist');
      return { ...target, out: at(target.out), name, ...plist };
    }),
    extract: { ...config.extract },
    scan: {
      dirs: (config.scan?.dirs ?? ['src']).map(at),
      extensions: config.scan?.extensions ?? ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.vue', '.svelte', '.astro'],
      attributes: config.scan?.attributes ?? ['alt', 'title', 'placeholder', 'label', 'aria-label', 'aria-description', 'aria-placeholder'],
      calls: config.scan?.calls ?? ['toast', 'alert', 'confirm'],
      properties: config.scan?.properties ?? ['label', 'title', 'description', 'placeholder', 'header'],
    },
  };
}

/** What `Intl` reads of each kind of format's options; it ignores any other key, so a misspelled one would do nothing. */
const FORMAT_OPTIONS = {
  number: {
    intl: 'Intl.NumberFormat',
    options: [
      'numberingSystem',
      'style',
      'currency',
      'currencyDisplay',
      'currencySign',
      'unit',
      'unitDisplay',
      'notation',
      'compactDisplay',
      'signDisplay',
      'useGrouping',
      'minimumIntegerDigits',
      'minimumFractionDigits',
      'maximumFractionDigits',
      'minimumSignificantDigits',
      'maximumSignificantDigits',
      'roundingIncrement',
      'roundingMode',
      'roundingPriority',
      'trailingZeroDisplay',
    ],
    // The styles a message names without the config, which a format may not take the name of.
    builtIn: ['integer', 'percent', 'currency'],
  },
  date: {
    intl: 'Intl.DateTimeFormat',
    options: [
      'calendar',
      'numberingSystem',
      'hour12',
      'hourCycle',
      'timeZone',
      'weekday',
      'era',
      'year',
      'month',
      'day',
      'dayPeriod',
      'hour',
      'minute',
      'second',
      'fractionalSecondDigits',
      'timeZoneName',
      'dateStyle',
      'timeStyle',
    ],
    builtIn: ['short', 'medium', 'long', 'full'],
  },
  list: {
    intl: 'Intl.ListFormat',
    options: ['type', 'style', 'max', 'more'],
    builtIn: ['conjunction', 'disjunction', 'unit', 'long', 'short', 'narrow'],
  },
  duration: { intl: 'Intl.DurationFormat', options: ['style', 'largest', 'smallest', 'units'], builtIn: DURATION_STYLES },
} as const;

const KINDS = Object.keys(FORMAT_OPTIONS) as (keyof typeof FORMAT_OPTIONS)[];

/** A format's options `Intl` refuses, or prosebook's own (`max`, `largest`, ...) that make no sense: what is wrong, or nothing. */
function refusedOptions(kind: keyof typeof FORMAT_OPTIONS, value: Record<string, unknown>): string | undefined {
  const whole = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0;
  if (kind === 'list') {
    const { max, more } = value;
    if (max !== undefined && !whole(max)) return 'max is a whole number of items, 1 or more';
    if (more !== undefined && typeof more !== 'string') return 'more is the key of the entry saying the rest: more: common.more';
    if ((max === undefined) !== (more === undefined))
      return 'max and more go together: the first max items, and the entry more names for the rest, given {count}';
  }
  if (kind === 'duration') {
    const { largest, smallest, units } = value;
    const at = (unit: unknown) => DURATION_UNITS.findIndex((u) => u === unit);
    for (const [key, unit] of Object.entries({ largest, smallest }))
      if (unit !== undefined && at(unit) === -1) return `${key} is a unit: ${DURATION_UNITS.join(', ')}`;
    if (largest !== undefined && smallest !== undefined && at(largest) > at(smallest))
      return `largest is ${DURATION_UNITS[at(largest)]!}, which is smaller than smallest`;
    if (units !== undefined && !whole(units)) return 'units is how many units are shown, 1 or more';
  }
  try {
    if (kind === 'number') new Intl.NumberFormat('en', value).resolvedOptions();
    else if (kind === 'date') new Intl.DateTimeFormat('en', value).resolvedOptions();
    else if (kind === 'list') new Intl.ListFormat('en', value).resolvedOptions();
    // A Node or Bun without `Intl.DurationFormat` checks only prosebook's options.
    else if (typeof Intl.DurationFormat === 'function') new Intl.DurationFormat('en', value).resolvedOptions();
  } catch (e) {
    return `is refused by ${FORMAT_OPTIONS[kind].intl}: ${(e as Error).message}`;
  }
  return undefined;
}

const FORMAT_NAME = /^[A-Za-z][\w-]*$/;

/** Each format a name a message can say, and options `Intl` takes: a JSON config is not type-checked. */
function checkedFormats(formats: Formats): Formats {
  const check = (table: FormatTable, at: string, defined?: FormatTable) => {
    for (const kind of Object.keys(table)) {
      if (!(KINDS as string[]).includes(kind) && !(defined === undefined && kind === 'locales'))
        throw new Error(`${at}${kind} is not a kind of format: ${KINDS.join(', ')}`);
    }
    for (const kind of KINDS) {
      const { intl, options, builtIn } = FORMAT_OPTIONS[kind];
      for (const [name, value] of Object.entries(table[kind] ?? {})) {
        const path = `${at}${kind}.${name}`;
        if (defined !== undefined && defined[kind]?.[name] === undefined)
          throw new Error(`${path} shows a format no one named: name it under formats.${kind} first`);
        if (!FORMAT_NAME.test(name)) throw new Error(`${path}: a format's name is a letter, then letters, digits, _ and -`);
        if ((builtIn as readonly string[]).includes(name)) {
          const fix = `name the format for what it shows: ${name}-${kind}`;
          throw new Error(`${path}: "${name}" is a style every message knows already, so ${fix}`);
        }
        if (typeof value !== 'object' || value === null || Array.isArray(value))
          throw new Error(`${path} is the options ${intl} takes, as an object`);
        for (const key of Object.keys(value)) {
          if (!(options as readonly string[]).includes(key))
            throw new Error(`${path}.${key} is not an option of ${intl}, which would ignore it: ${options.join(', ')}`);
        }
        const refused = refusedOptions(kind, value as Record<string, unknown>);
        if (refused !== undefined) throw new Error(`${path}${refused.startsWith('is ') ? ' ' : '.'}${refused}`);
      }
    }
  };
  check(formats, 'formats.');
  for (const [locale, table] of Object.entries(formats.locales ?? {})) check(table, `formats.locales.${locale}.`, formats);
  return formats;
}

/** Each named reason is a name `allow` can give, and a reason a reviewer can check. */
function checkedReasons(reasons: Record<string, string>): Record<string, string> {
  for (const [name, why] of Object.entries(reasons)) {
    if (!REASON_NAME.test(name)) throw new Error(`lint.reasons.${name}: a reason's name is lowercase words joined by -`);
    const problem = reasonProblem(why);
    if (problem !== undefined) throw new Error(`lint.reasons.${name} ${problem}`);
  }
  return reasons;
}

/** The defaults with the config's own over them, each a pair of marks: a JSON config is not type-checked. */
function checkedQuotes(quotes: Record<string, readonly [string, string]>): Record<string, readonly [string, string]> {
  for (const [locale, pair] of Object.entries(quotes)) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((mark) => typeof mark === 'string' && mark !== ''))
      throw new Error(`lint.quotes.${locale} is a pair of marks, the opening and the closing: ['„', '“']`);
  }
  return { ...DEFAULT_QUOTES, ...quotes };
}

function lintRules(lint: LintConfig): ResolvedConfig['lint']['rules'] {
  const base = lint.extends ?? 'recommended';
  const all: [string, CheckRule][] = Object.entries(CORE_RULES);
  const seen = new Set<string>();
  for (const plugin of lint.plugins ?? []) {
    if (!/^[a-z][a-z0-9-]*$/i.test(plugin.name))
      throw new Error(`lint.plugins: "${plugin.name}" is not a plugin name: use letters, digits and dashes`);
    if (seen.has(plugin.name)) throw new Error(`lint.plugins: "${plugin.name}" is added twice: remove one`);
    seen.add(plugin.name);
    for (const [name, rule] of Object.entries(plugin.rules)) {
      const full = `${plugin.name}/${name}`;
      all.push([full, compileRule(full, rule)]);
    }
  }
  const preset = (rule: CheckRule): Severity =>
    base === 'none' ? 'off' : base === 'strict' ? (rule.strict ?? 'error') : (rule.recommended ?? 'off');
  const rules = Object.fromEntries(all.map(([name, rule]) => [name, { rule, severity: lint.rules?.[name] ?? preset(rule) }]));
  for (const name of Object.keys(lint.rules ?? {}))
    if (!(name in rules)) throw new Error(`lint.rules.${name} is not a rule: name one of ${Object.keys(rules).join(', ')}`);
  return rules;
}
