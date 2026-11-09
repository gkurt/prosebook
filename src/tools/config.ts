/**
 * `prosebook/config`: where the catalog lives, what an entry may say about itself, and how strictly
 * its words are checked. Written as `prosebook.config.ts` (or `.js`, `.mjs`, `.json`) at the project root.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { formatIn, type Formats, type Formatters, type FormatTable } from '#src/runtime/formats.ts';
import { RELATIVE_UNITS } from '#src/runtime/relative.ts';

import { DURATION_STYLES, DURATION_UNITS, RELATIVE_STYLES } from './icu.ts';
import { AUTHOR, type Judge, type JudgeConfig, type ResolvedJudge } from './judge.ts';
import {
  compileRule,
  CORE_RULES,
  namesRule,
  REASON_NAME,
  reasonProblem,
  severityIn,
  type CheckRule,
  type CoreRule,
  type Plugin,
} from './lint.ts';
import type { Isolate } from './mf2.ts';
import {
  DEFAULT_KINDS,
  DEFAULT_QUOTES,
  DEFAULT_SURFACES,
  PRESETS,
  STRICT_LISTS,
  VOICE,
  type Formality,
  type KindRule,
  type Severity,
  type Tone,
  type ToneExample,
} from './presets.ts';

export type { Formality, KindRule, Severity, Tone, ToneExample };
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
export type { Judge, JudgeConfig, JudgeQuestion, JudgeRequest, JudgeResponse, ResolvedJudge } from './judge.ts';

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
  /** Severities by rule, over `extends`; `<plugin>/*` sets every rule of a plugin: `'voice/*': 'off'`. */
  rules?: RuleSeverities;
  /** Severities for one area's entries (a key's first segment) over `rules`: `{ native: { 'sentence-case': 'off' } }`. */
  areas?: Record<string, RuleSeverities>;
  /**
   * Severities for text in code whose kind or surface prosebook guessed from where it stands
   * (`catalog: false`, `scan --lint`), over `rules`: `{ 'word-budget': 'off' }` keeps a rule to the
   * catalog's entries, whose roles their writers named.
   */
  guessed?: RuleSeverities;
  /**
   * Reasons many exemptions share, by name: `allow: { period: card-detail }` takes the reason
   * `card-detail` names here, so it is written, reviewed and changed once.
   */
  reasons?: Record<string, string>;
}

/** What a preset sets of the lint: severities, and rules and words it adds to the config's. */
export type PresetLint = Pick<LintConfig, 'rules' | 'plugins' | 'banned' | 'spelling' | 'concepts' | 'properNouns'>;

/**
 * A tone and the rules that go with it, which a config extends: one of prosebook's by name, or a
 * team's own, shared as a package.
 */
export interface Preset {
  /** Its name, which the writing guide says and no other preset the config extends may have. */
  name: string;
  /** Presets this one builds on, each under it. */
  extends?: (string | Preset)[];
  /** How the copy sounds; each field over the presets' it extends. */
  tone?: Partial<Tone>;
  /**
   * Severities over `lint.extends` (`off` turns a rule off; `warn` or `error` turns it on at least
   * that high), and rules and words added to the config's.
   */
  lint?: PresetLint;
}

export interface ToneConfig {
  /** What the presets' tone leaves to the app, said after it: who reads the copy, and what it is for. */
  notes?: string;
  /**
   * The form of `you` the copy takes, over the presets': one for every locale, or by locale and
   * language, `*` for the rest: `{ '*': 'informal', fr: 'formal' }`.
   */
  formality?: Formality | Record<string, Formality>;
  /**
   * A preset for one area's entries (a key's first segment): `{ legal: 'plain' }`. Its tone is said
   * for them, and its rules hold there alone, so it may not add words, which hold everywhere.
   */
  areas?: Record<string, string | Preset>;
}

/** A tone as the presets and the config give it. */
export interface ResolvedTone {
  /** The presets it comes from, in order. */
  presets: string[];
  doc?: string;
  /** By locale and language, `*` for the rest; `formalityIn` reads it. */
  formality: Record<string, Formality>;
  examples: ToneExample[];
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
  /**
   * The source-language catalog: one `<area>.yaml` per area. `false` for none: the copy is the text
   * written in code, which `prosebook lint` reads where `scan` finds it.
   */
  catalog?: string | false;
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
   * Number, date, list, duration and relative formats by name, as options: `number: { price: { style: 'currency', currency: 'EUR' } }`.
   * A message names one in place of a style (`{total, number, price}`, `{$total :number format=price}`)
   * and code passes the name to `copy.number` and `copy.date`, so the app shows each the same way
   * everywhere, and one edit here changes it. `locales` shows one differently in a locale or language.
   */
  formats?: Formats;
  /**
   * A module of formats of the app's own, as code (`defineFormatters`), for what options can't say:
   * `'src/copy/formatters.ts'`. Each is named as a format here is, and the generated index imports
   * the module, so it ships to the browser: keep it small, and its output a function of the value and
   * locale alone, so a server and a browser show the same.
   */
  formatters?: string;
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
  /**
   * Presets the config builds on, in order, each under it: a tone and the rules that go with it.
   * prosebook's are `plain`, `professional`, `friendly`, `technical`, `playful`, and `formal`, which
   * the first two extend; a team's own is a `Preset` (`definePreset`).
   */
  extends?: string | Preset | (string | Preset)[];
  /** The tone over the presets': notes of the app's own, the form of `you`, a tone per area. */
  tone?: ToneConfig;
  /** The kinds of string an entry may say it is, with the shape each one is held to. */
  kinds?: Record<string, KindRule>;
  /** Where a string may sit, with what each surface means. */
  surfaces?: Record<string, string>;
  lint?: LintConfig;
  /**
   * A decision model that holds each entry to the guidelines no lint rule can check, for `prosebook
   * judge`: `{ model: decisionJudge(typeSafeAi.decisionModel('jev-latest')) }`, with `decisionJudge`
   * from `prosebook/ai`. Its verdicts are kept in the lock, so `lint` reads them without the model.
   */
  judge?: JudgeConfig;
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
    /**
     * Folders and files a check leaves out, by its name, where what it finds is no person's to read:
     * `{ 'formatted-in-code': ['src/server'] }` for a server's numbers and dates, which a tool reads.
     * Paths from the config's folder, or globs: `**\/server` for every folder named so, `**\/*.server.ts`.
     * `*` leaves every check out. Keys the code names still count, so its keys aren't unused.
     */
    ignore?: { [check in ScanCheck | '*']?: string[] };
    /**
     * The roles text in code takes from where it stands, for the lint: `false` for none, or a kind or
     * surface named `false` to guess every other: `{ heading: false }`.
     */
    roles?: false | Record<string, false>;
  };
}

/** The checks `scan` runs file by file, which `scan.ignore` can keep out of folders. */
export const SCAN_CHECKS = ['hardcoded-text', 'formatted-in-code'] as const;
export type ScanCheck = (typeof SCAN_CHECKS)[number];

/** What `scan` reads, and where. */
export interface ScanOptions {
  dirs: string[];
  extensions: string[];
  attributes: string[];
  calls: string[];
  properties: string[];
  /** Paths and globs from the root, with `/`. */
  ignore: Record<ScanCheck, string[]>;
  /** The kinds and surfaces not guessed, or `false` for every one. */
  roles?: false | Record<string, false>;
}

export interface ResolvedConfig {
  root: string;
  /** `catalog: false`: no catalog, so the commands that lint read the text in code (`scanned.ts`). */
  inCode: boolean;
  catalog: string;
  locales: string;
  out: string;
  lock: string;
  source: string;
  messageFormat: 1 | 2;
  isolate: Isolate;
  formats: Formats;
  /** The formatters module, and once `loadConfig` imported it, its formats, each in `formats` as `{ formatter }`. */
  formatters?: { file: string; table?: Formatters };
  bundled: string[];
  pseudo: string | false;
  stale: 'use' | 'fallback';
  language: 'ts' | 'js';
  importExtension: '.js' | '.ts' | '';
  require: ('context' | 'kind' | 'surface')[];
  kinds: Record<string, KindRule>;
  surfaces: Record<string, string>;
  /** The presets' tone with the config's over it, and each area's own. */
  tone: ResolvedTone & { notes?: string; areas: Record<string, ResolvedTone> };
  lint: {
    rules: Record<string, { rule: CheckRule; severity: Severity }>;
    areas: Record<string, Record<string, Severity>>;
    guessed: Record<string, Severity>;
    reasons: Record<string, string>;
  } & Required<WordLists>;
  guide: string | false;
  native: (NativeTarget & { name: string })[];
  extract: { shared?: string };
  scan: ScanOptions;
  judge?: ResolvedJudge;
}

const NATIVE_NAMES = { rust: 'Locale', swift: 'Copy', kotlin: 'Copy', android: 'strings', apple: 'Localizable' };

/** Typed config, for `prosebook.config.ts`. */
export function defineConfig(config: ProsebookConfig): ProsebookConfig {
  return config;
}

/** Typed preset, for a config's `extends`. */
export function definePreset(preset: Preset): Preset {
  return preset;
}

/** The presets a list names, each after those it extends, once: a JSON config is not type-checked. */
function presetsOf(list: string | Preset | (string | Preset)[] | undefined, at: string): Preset[] {
  const out = new Map<string, Preset>();
  const open = new Set<string>();
  const visit = (item: string | Preset) => {
    if (typeof item === 'string' && PRESETS[item] === undefined)
      throw new Error(`${at} names "${item}", which is no preset: name one of ${Object.keys(PRESETS).join(', ')}`);
    const preset = typeof item === 'string' ? PRESETS[item]! : item;
    if (typeof preset !== 'object' || typeof preset.name !== 'string' || preset.name === '')
      throw new Error(`${at} holds a preset with no name: give it one, as definePreset({ name, ... }) does`);
    const { name } = preset;
    const seen = out.get(name);
    if (seen === preset) return;
    if (seen !== undefined) throw new Error(`${at}: two presets are named "${name}": rename one`);
    if (open.has(name)) throw new Error(`${at}: preset "${name}" extends itself`);
    open.add(name);
    for (const parent of preset.extends ?? []) visit(parent);
    open.delete(name);
    out.set(name, preset);
  };
  for (const item of list === undefined ? [] : Array.isArray(list) ? list : [list]) visit(item);
  return [...out.values()];
}

/** The presets' tone, each field over the ones before it. */
function toneOf(presets: Preset[]): Omit<ResolvedTone, 'formality'> & { formality?: Formality } {
  const tone: ReturnType<typeof toneOf> = { presets: presets.map((p) => p.name), examples: [] };
  for (const { tone: own } of presets) {
    if (own?.doc !== undefined) tone.doc = own.doc;
    if (own?.formality !== undefined) tone.formality = own.formality;
    if (own?.examples !== undefined) tone.examples = own.examples;
  }
  return tone;
}

/** The presets' lint, each over the ones before it: severities replaced, rules and words added. */
function lintOf(presets: Preset[]): Required<PresetLint> {
  const lint: Required<PresetLint> = { rules: {}, plugins: [], banned: [], spelling: {}, concepts: {}, properNouns: [] };
  for (const { lint: own = {} } of presets) {
    Object.assign(lint.rules, own.rules);
    lint.plugins.push(...(own.plugins ?? []).filter((p) => !lint.plugins.includes(p)));
    lint.banned.push(...(own.banned ?? []));
    Object.assign(lint.spelling, own.spelling);
    Object.assign(lint.concepts, own.concepts);
    lint.properNouns.push(...(own.properNouns ?? []));
  }
  return lint;
}

const RANK: Record<Severity, number> = { off: 0, warn: 1, error: 2 };

/** A preset's severity over the one under it: `off` turns a rule off, and any other turns it on at least that high. */
const atLeast = (under: Severity, preset: Severity | undefined): Severity =>
  preset === undefined ? under : preset === 'off' ? 'off' : RANK[preset] > RANK[under] ? preset : under;

/** The tone, and each area's preset as its tone and rules, the rules not yet checked against the config's. */
function tonesOf(config: ProsebookConfig) {
  const presets = presetsOf(config.extends, 'extends');
  const own = config.tone ?? {};
  const { formality: fromPresets, ...tone } = toneOf(presets);
  const { '*': every, ...byLocale } = formalities(own.formality);
  // The config's own over the presets', which an area's preset is too.
  const formality = (under: Formality | undefined): Record<string, Formality> => {
    const all = every ?? under;
    return { ...(all !== undefined && { '*': all }), ...byLocale };
  };
  const areas = Object.entries(own.areas ?? {}).map(([area, item]) => {
    const at = `tone.areas.${area}`;
    const named = presetsOf(item, at);
    const lint = lintOf(named);
    const words = lint.banned.length + Object.keys(lint.spelling).length + Object.keys(lint.concepts).length + lint.properNouns.length;
    if (words > 0) throw new Error(`${at} adds words, which hold for the whole catalog: extend the preset at the top instead`);
    // What the area's presets leave unsaid is the config's: a doc with its examples, and the form of `you`.
    const local = toneOf(named);
    const said = local.doc === undefined ? tone : local;
    const areaTone: ResolvedTone = {
      presets: local.presets,
      ...(said.doc !== undefined && { doc: said.doc }),
      formality: formality(local.formality ?? fromPresets),
      examples: said.examples,
    };
    return { area, tone: areaTone, lint, presets: named };
  });
  const main: ResolvedTone = { ...tone, formality: formality(fromPresets) };
  return { presets, tone: { ...main, ...(own.notes !== undefined && { notes: own.notes }) }, areas };
}

/** `tone.formality` as a table by locale, each value a form: a JSON config is not type-checked. */
function formalities(formality: ToneConfig['formality']): Record<string, Formality> {
  const table = typeof formality === 'string' ? { '*': formality } : (formality ?? {});
  for (const [locale, form] of Object.entries(table)) {
    if (form !== 'formal' && form !== 'informal')
      throw new Error(`tone.formality${typeof formality === 'string' ? '' : `.${locale}`} is "${String(form)}": write formal or informal`);
  }
  return table;
}

export const CONFIG_FILES = [
  'prosebook.config.ts',
  'prosebook.config.mts',
  'prosebook.config.js',
  'prosebook.config.mjs',
  'prosebook.config.json',
];

// A module is imported once per process, so a config file changed since is imported anew: Node keys
// its modules by URL, the query included; Bun by path, ignoring the query, and drops one deleted from
// `require.cache`. The modules the file imports stay as first loaded.
const modules = createRequire(import.meta.url).cache;
const imported = new Map<string, number>();

/**
 * Finds and reads the config at `root`, or the defaults when there is none. A config file is read as
 * it is now, so a dev server that loads it again after an edit gets the edit.
 */
export async function loadConfig(root: string, inline?: ProsebookConfig): Promise<ResolvedConfig> {
  if (inline) return withFormatters(resolveConfig(root, inline));
  for (const name of CONFIG_FILES) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    if (name.endsWith('.json')) return withFormatters(resolveConfig(root, JSON.parse(readFileSync(path, 'utf8')) as ProsebookConfig));
    const mod = (await importAnew(path)) as { default?: ProsebookConfig };
    return withFormatters(resolveConfig(root, mod.default ?? {}));
  }
  return resolveConfig(root, {});
}

async function importAnew(path: string): Promise<unknown> {
  const modified = statSync(path).mtimeMs;
  if (imported.get(path) !== modified) delete modules[path];
  imported.set(path, modified);
  return import(`${pathToFileURL(path).href}?t=${modified}`);
}

/**
 * The config with its formatters module imported, anew once it changed: each format there named in
 * `formats` as `{ formatter: name }`, which the tools read as any format and the runtime calls by.
 */
export async function withFormatters(config: ResolvedConfig): Promise<ResolvedConfig> {
  const file = config.formatters?.file;
  if (file === undefined) return config;
  const at = relative(config.root, file).replaceAll('\\', '/');
  if (!existsSync(file)) throw new Error(`formatters names ${at}, which isn't there: write it, or remove formatters`);
  const mod = (await importAnew(file)) as { default?: unknown };
  const table = checkedFormatters(mod.default, config.formats, at);
  const formats: Record<string, unknown> = { ...config.formats };
  for (const kind of FORMATTER_KINDS) {
    const names = Object.keys(table[kind] ?? {});
    if (names.length > 0)
      formats[kind] = { ...config.formats[kind], ...Object.fromEntries(names.map((name) => [name, { formatter: name }])) };
  }
  checkRelativeDates(formats);
  return { ...config, formats: formats, formatters: { file, table } };
}

const FORMATTER_KINDS = ['number', 'date', 'relative'] as const;

/** The formatters module's default export, each a function under a name no format of the config's has. */
function checkedFormatters(table: unknown, formats: Formats, at: string): Formatters {
  const shape = `export default defineFormatters({ number: { money: (value, { locale }) => '…' } })`;
  if (typeof table !== 'object' || table === null) throw new Error(`${at} exports no formatters: ${shape}`);
  for (const [kind, named] of Object.entries(table)) {
    if (!(FORMATTER_KINDS as readonly string[]).includes(kind))
      throw new Error(`${at}: ${kind} is not a kind of formatter: ${FORMATTER_KINDS.join(', ')}`);
    const k = kind as (typeof FORMATTER_KINDS)[number];
    if (typeof named !== 'object' || named === null) throw new Error(`${at}: ${kind} is its formatters by name: ${shape}`);
    for (const [name, format] of Object.entries(named)) {
      const path = `${at}: ${kind}.${name}`;
      if (typeof format !== 'function') throw new Error(`${path} is a function of the value and its context, giving the text`);
      if (!FORMAT_NAME.test(name)) throw new Error(`${path}: a format's name is a letter, then letters, digits, _ and -`);
      if ((FORMAT_OPTIONS[k].builtIn as readonly string[]).includes(name))
        throw new Error(`${path}: "${name}" is a style every message knows already, so name the format for what it shows`);
      if (formats[k]?.[name] !== undefined) throw new Error(`${path} is named in formats.${kind} too: rename one`);
    }
  }
  return table;
}

/** What only a catalog's messages read, which a config with `catalog: false` is refused for naming. */
const CATALOG_ONLY = ['locales', 'out', 'messageFormat', 'native', 'pseudo', 'bundled', 'stale', 'extract', 'require'] as const;

/** The attributes whose values a person reads, which `scan.attributes` defaults to. */
export const READABLE_ATTRIBUTES = ['alt', 'title', 'placeholder', 'label', 'aria-label', 'aria-description', 'aria-placeholder'];

export function resolveConfig(root: string, config: ProsebookConfig): ResolvedConfig {
  const at = (path: string) => (isAbsolute(path) ? path : resolve(root, path));
  const lint = config.lint ?? {};
  const base = lint.extends ?? 'recommended';
  const strict = base === 'strict';
  const tones = tonesOf(config);
  const fromPresets = lintOf(tones.presets);
  const areaPlugins = tones.areas.flatMap((a) => a.lint.plugins);
  const rules = lintRules(lint, config.source ?? 'en', fromPresets, areaPlugins);
  for (const preset of [...tones.presets, ...tones.areas.flatMap((a) => a.presets)]) {
    for (const name of Object.keys(preset.lint?.rules ?? {}))
      if (!namesRule(name, rules)) throw new Error(`preset "${preset.name}" sets lint.rules.${name}, which ${notARule(rules)}`);
  }
  const areaSeverities = presetAreas(rules, tones.areas, [...fromPresets.plugins, ...(lint.plugins ?? [])], lint.rules ?? {});
  const inCode = config.catalog === false;
  if (inCode) {
    for (const name of CATALOG_ONLY)
      if (config[name] !== undefined) throw new Error(`${name} is for a catalog's messages, and catalog is false: remove it`);
  }
  const catalog = at(config.catalog === false || config.catalog === undefined ? 'copy/catalog' : config.catalog);
  for (const [area, severities] of Object.entries(lint.areas ?? {})) {
    for (const name of Object.keys(severities))
      if (!namesRule(name, rules)) throw new Error(`lint.areas.${area}.${name} ${notARule(rules)}`);
  }
  for (const name of Object.keys(lint.guessed ?? {}))
    if (!namesRule(name, rules)) throw new Error(`lint.guessed.${name} ${notARule(rules)}`);
  const kinds = config.kinds ?? DEFAULT_KINDS;
  const surfaces = config.surfaces ?? DEFAULT_SURFACES;
  const roles = config.scan?.roles;
  for (const [name, off] of Object.entries(roles === false || roles === undefined ? {} : roles)) {
    if (off) throw new Error(`scan.roles.${name} is ${String(off)}: set it to false to stop guessing it`);
    if (kinds[name] !== undefined || surfaces[name] !== undefined) continue;
    const named = [...Object.keys(kinds), ...Object.keys(surfaces)].join(', ');
    throw new Error(`scan.roles.${name} is neither a kind nor a surface: name one of ${named}`);
  }
  return {
    root,
    inCode,
    catalog,
    locales: at(config.locales ?? 'copy/locales'),
    out: at(config.out ?? 'src/copy'),
    lock: at(config.lock ?? 'copy/lock.json'),
    source: config.source ?? 'en',
    messageFormat: config.messageFormat ?? 1,
    isolate: config.isolate ?? 'rtl',
    // A relative format's date may name a formatter, which only the formatters module, read later, holds.
    formats: checkedFormats(config.formats ?? {}, config.formatters === undefined),
    ...(config.formatters !== undefined && { formatters: { file: at(config.formatters) } }),
    bundled: config.bundled ?? [],
    pseudo: config.pseudo ?? false,
    stale: config.stale ?? 'use',
    language: config.language ?? 'ts',
    importExtension: config.importExtension ?? '.js',
    require: config.require ?? ['context'],
    kinds,
    surfaces,
    tone: { ...tones.tone, areas: Object.fromEntries(tones.areas.map(({ area, tone }) => [area, tone])) },
    lint: {
      rules,
      areas: Object.fromEntries(
        [...new Set([...Object.keys(areaSeverities), ...Object.keys(lint.areas ?? {})])].map((area) => [
          area,
          { ...areaSeverities[area], ...lint.areas?.[area] },
        ]),
      ),
      guessed: lint.guessed ?? {},
      reasons: checkedReasons(lint.reasons ?? {}),
      banned: [...(strict ? STRICT_LISTS.banned : []), ...fromPresets.banned, ...(lint.banned ?? [])],
      spelling: { ...(strict ? STRICT_LISTS.spelling : {}), ...fromPresets.spelling, ...lint.spelling },
      concepts: { ...fromPresets.concepts, ...lint.concepts },
      properNouns: [...fromPresets.properNouns, ...(lint.properNouns ?? [])],
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
      attributes: config.scan?.attributes ?? READABLE_ATTRIBUTES,
      calls: config.scan?.calls ?? ['toast', 'alert', 'confirm'],
      properties: config.scan?.properties ?? ['label', 'title', 'description', 'placeholder', 'header'],
      ignore: scanIgnore(config.scan?.ignore ?? {}, (path) => relative(root, at(path)).replaceAll('\\', '/')),
      ...(roles !== undefined && { roles }),
    },
    ...(config.judge !== undefined && { judge: checkedJudge(config.judge) }),
  };
}

/**
 * `scan.ignore`'s paths and globs, each from the root with `/` as `scan` names files, under a check
 * `scan` runs or `*` for all of them: a JSON config is not type-checked.
 */
function scanIgnore(ignore: Record<string, string[] | undefined>, at: (path: string) => string): Record<ScanCheck, string[]> {
  for (const check of Object.keys(ignore)) {
    if (check !== '*' && !(SCAN_CHECKS as readonly string[]).includes(check))
      throw new Error(`scan.ignore.${check} is not a check scan runs file by file: ${SCAN_CHECKS.join(', ')}, or * for all`);
  }
  const paths = (check: ScanCheck) => [...(ignore['*'] ?? []), ...(ignore[check] ?? [])].map(at);
  return { 'hardcoded-text': paths('hardcoded-text'), 'formatted-in-code': paths('formatted-in-code') };
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
      'steps',
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
  duration: {
    intl: 'Intl.DurationFormat',
    options: ['style', 'largest', 'smallest', 'units', 'fractionalDigits'],
    builtIn: DURATION_STYLES,
  },
  relative: {
    intl: 'Intl.RelativeTimeFormat',
    options: ['style', 'numeric', 'largest', 'smallest', 'skip', 'rounding', 'now', 'date'],
    builtIn: RELATIVE_STYLES,
  },
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
    const { fractionalDigits: digits } = value;
    if (digits !== undefined) {
      // A duration is milliseconds, so a fourth digit would always be 0; no digit at all is `smallest: 'seconds'`.
      if (typeof digits !== 'number' || !Number.isInteger(digits) || digits < 1 || digits > 3)
        return `fractionalDigits is the most digits of a second shown, 1 to 3; for none, set smallest: 'seconds'`;
      if (smallest !== undefined && smallest !== 'seconds')
        return `fractionalDigits shows the milliseconds as the seconds' fraction, so the seconds are the smallest unit: remove smallest`;
      if (largest === 'milliseconds') return `fractionalDigits shows the seconds' fraction, so largest is seconds or larger`;
    }
  }
  if (kind === 'relative') {
    const refused = refusedRelative(value);
    if (refused !== undefined) return refused;
  }
  if (kind === 'number' && value.steps !== undefined) {
    const refused = refusedSteps(value.steps, FORMAT_OPTIONS.number.options);
    if (refused !== undefined) return refused;
  }
  try {
    if (kind === 'number') {
      // Each step is the format's options with its own over them, so each is checked as one.
      const steps = (value.steps ?? []) as Record<string, unknown>[];
      for (const step of [{}, ...steps]) new Intl.NumberFormat('en', { ...value, ...step }).resolvedOptions();
    } else if (kind === 'date') {
      new Intl.DateTimeFormat('en', value).resolvedOptions();
    } else if (kind === 'list') {
      new Intl.ListFormat('en', value).resolvedOptions();
    } else if (kind === 'relative') {
      new Intl.RelativeTimeFormat('en', value).resolvedOptions();
    }
    // A Node or Bun without `Intl.DurationFormat` checks only prosebook's options.
    else if (typeof Intl.DurationFormat === 'function') {
      new Intl.DurationFormat('en', value).resolvedOptions();
    }
  } catch (e) {
    return `is refused by ${FORMAT_OPTIONS[kind].intl}: ${(e as Error).message}`;
  }
  return undefined;
}

/** What is wrong with a relative format's own options (its units, `now` and `date`), or nothing. */
function refusedRelative(value: Record<string, unknown>): string | undefined {
  const { largest, smallest, skip, rounding, now, date } = value;
  const at = (unit: unknown) => RELATIVE_UNITS.findIndex(([u]) => u === unit);
  const names = RELATIVE_UNITS.map(([u]) => u).join(', ');
  for (const [key, unit] of Object.entries({ largest, smallest }))
    if (unit !== undefined && at(unit) === -1) return `${key} is a unit: ${names}`;
  const from = largest === undefined ? 0 : at(largest);
  const to = smallest === undefined ? 6 : at(smallest);
  if (from > to) return `largest is ${RELATIVE_UNITS[from]![0]}, which is smaller than smallest`;
  if (skip !== undefined) {
    if (!Array.isArray(skip) || skip.some((u) => at(u) === -1)) return `skip is a list of units to leave out: ${names}`;
    if (RELATIVE_UNITS.slice(from, to + 1).every(([u]) => skip.includes(u)))
      return 'skip leaves out every unit between largest and smallest: keep one';
  }
  if (rounding !== undefined && rounding !== 'nearest' && rounding !== 'down') return 'rounding is nearest or down';
  if (now !== undefined && (typeof now !== 'string' || now === ''))
    return 'now is the key of the entry a time under the smallest unit reads as: now: time.now';
  if (date !== undefined) {
    const example = "date: { after: 7 * 86_400_000, format: 'short' }";
    if (typeof date !== 'object' || date === null) return `date is when to show a date instead, and in what format: ${example}`;
    const { after, format, ...rest } = date as Record<string, unknown>;
    if (typeof after !== 'number' || !(after > 0)) return `date.after is the milliseconds from now past which a date shows: ${example}`;
    if (typeof format !== 'string') return `date.format names a date format of the config's: ${example}`;
    const other = Object.keys(rest)[0];
    if (other !== undefined) return `date.${other} is not an option of date, which takes after and format: ${example}`;
  }
  return undefined;
}

/** Each relative format's date names a date format of the config's, or of the formatters module. */
function checkRelativeDates(formats: Formats): void {
  for (const [at, table] of [
    ['formats.', formats] as const,
    ...Object.entries(formats.locales ?? {}).map(([l, t]) => [`formats.locales.${l}.`, t] as const),
  ]) {
    for (const [name, options] of Object.entries(table.relative ?? {})) {
      const date = options.date?.format;
      if (typeof date !== 'string' || formatIn(formats, 'date', date, 'und') !== undefined) continue;
      if (Object.values(formats.locales ?? {}).some((t) => t.date?.[date] !== undefined)) continue;
      const names = Object.keys(formats.date ?? {});
      const known = names.length > 0 ? `: ${names.join(', ')}` : `, and it names none: add ${date} under formats.date`;
      throw new Error(`${at}relative.${name}.date.format names ${date}, which is no date format of the config's${known}`);
    }
  }
}

/** What is wrong with a number format's `steps`, each the format's options over its own from a size up, or nothing. */
function refusedSteps(steps: unknown, options: readonly string[]): string | undefined {
  const example = 'steps: [{ from: 10, maximumFractionDigits: 0 }]';
  if (!Array.isArray(steps) || steps.length === 0) return `steps is a list of options, each from a size up: ${example}`;
  let last = -Infinity;
  for (const [i, step] of (steps as unknown[]).entries()) {
    const at = `steps[${i}]`;
    if (typeof step !== 'object' || step === null || Array.isArray(step)) return `${at} is options from a size up: ${example}`;
    const { from, ...own } = step as Record<string, unknown>;
    if (typeof from !== 'number' || !Number.isFinite(from) || from <= 0)
      return `${at}.from is the size, above 0, from which the step shows a number: ${example}`;
    if (from <= last) return `${at}.from is ${from}, not above the step before it: list the steps from the smallest size up`;
    last = from;
    for (const key of Object.keys(own)) {
      if (key === 'steps' || !options.includes(key))
        return `${at}.${key} is not an option of Intl.NumberFormat, which would ignore it: ${options.filter((o) => o !== 'steps').join(', ')}`;
    }
    if (Object.keys(own).length === 0) return `${at} changes nothing from ${from} up: give it the options it shows a number with`;
  }
  return undefined;
}

const FORMAT_NAME = /^[A-Za-z][\w-]*$/;

/** Each format a name a message can say, and options `Intl` takes: a JSON config is not type-checked. */
function checkedFormats(formats: Formats, whole: boolean): Formats {
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
  if (whole) checkRelativeDates(formats);
  return formats;
}

/** Each named reason is a name `allow` can give, and a reason a reviewer can check. */
/** `judge`, with its defaults: a JSON config can't hold a model, and is not type-checked. */
function checkedJudge(judge: JudgeConfig): ResolvedJudge {
  const { models, prompt, threshold = 0.7, concurrency = 8 } = judge;
  if (!Array.isArray(models) || models.length === 0)
    throw new Error('judge.models is not a list of models: decisionJudge(model) from prosebook/ai makes one, in a prosebook.config.ts');
  const ids = new Set<string>();
  models.forEach((model: Partial<Judge> | undefined, i) => {
    if (typeof model?.id !== 'string' || typeof model.judge !== 'function')
      throw new Error(`judge.models[${i}] is not a model: decisionJudge(model) from prosebook/ai makes one, in a prosebook.config.ts`);
    if (model.id === AUTHOR)
      throw new Error(`judge.models[${i}] is named ${AUTHOR}, which names the approvals of prosebook approve: give it another id`);
    if (ids.has(model.id)) throw new Error(`judge.models[${i}] is named ${model.id} as another is: give each model its own id`);
    ids.add(model.id);
  });
  if (prompt !== undefined && (typeof prompt !== 'string' || prompt.trim() === ''))
    throw new Error('judge.prompt is empty: say what the app is and who reads it, or leave it out');
  if (!(threshold > 0 && threshold < 1)) throw new Error(`judge.threshold is ${threshold}: give a probability between 0 and 1`);
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`judge.concurrency is ${concurrency}: give a whole number from 1`);
  return { models, threshold, concurrency, ...(prompt !== undefined && { prompt }) };
}

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

/**
 * Each area's severities from its preset, under `lint.areas`: the preset's over the config's, and the
 * rules of a plugin only an area's preset adds, which are off elsewhere, at their own.
 */
function presetAreas(
  rules: ResolvedConfig['lint']['rules'],
  areas: { area: string; lint: Required<PresetLint> }[],
  everywhere: Plugin[],
  own: Record<string, Severity>,
): Record<string, Record<string, Severity>> {
  const global = new Set(everywhere.map((p) => p.name));
  const areaOnly = (name: string) =>
    name.includes('/') && !global.has(name.slice(0, name.indexOf('/'))) && !name.startsWith(`${VOICE.name}/`);
  const out: Record<string, Record<string, Severity>> = {};
  for (const { area, lint } of areas) {
    const set: Record<string, Severity> = {};
    for (const [name, { severity }] of Object.entries(rules)) {
      const preset = severityIn(lint.rules, name);
      const ownsIt = areaOnly(name) && lint.plugins.some((p) => name.startsWith(`${p.name}/`));
      if (ownsIt || preset !== undefined) set[name] = atLeast(severity, preset);
    }
    out[area] = set;
  }
  // A rule only an area's preset adds holds there alone, unless the config's own lint.rules says otherwise.
  for (const [name, rule] of Object.entries(rules)) if (areaOnly(name) && severityIn(own, name) === undefined) rule.severity = 'off';
  return out;
}

function lintRules(
  lint: LintConfig,
  source: string,
  presets: Required<PresetLint>,
  areaPlugins: Plugin[],
): ResolvedConfig['lint']['rules'] {
  const base = lint.extends ?? 'recommended';
  const all: [string, CheckRule][] = Object.entries(CORE_RULES);
  const seen = new Set<string>();
  // A preset's plugin, extended by the config and by an area, or listed in lint.plugins too, is the one plugin.
  const own = lint.plugins ?? [];
  const fromPresets = [...new Set([...presets.plugins, ...areaPlugins])].filter((p) => !own.includes(p));
  for (const plugin of [VOICE, ...fromPresets, ...own]) {
    if (!/^[a-z][a-z0-9-]*$/i.test(plugin.name))
      throw new Error(`lint.plugins: "${plugin.name}" is not a plugin name: use letters, digits and dashes`);
    if (seen.has(plugin.name)) {
      throw new Error(
        plugin.name === VOICE.name
          ? `lint.plugins: "${VOICE.name}" is prosebook's own: name yours otherwise`
          : `lint.plugins: "${plugin.name}" is added twice: remove one`,
      );
    }
    seen.add(plugin.name);
    for (const [name, rule] of Object.entries(plugin.rules)) {
      const full = `${plugin.name}/${name}`;
      all.push([full, compileRule(full, rule)]);
    }
  }
  // The voice guidelines are written in English, for a source written in it.
  const english = source.split('-')[0]!.toLowerCase() === 'en';
  const preset = (name: string, rule: CheckRule): Severity =>
    base === 'none' || (!english && name.startsWith(`${VOICE.name}/`))
      ? 'off'
      : base === 'strict'
        ? (rule.strict ?? 'error')
        : (rule.recommended ?? 'off');
  const rules = Object.fromEntries(
    all.map(([name, rule]) => [
      name,
      { rule, severity: severityIn(lint.rules, name) ?? atLeast(preset(name, rule), severityIn(presets.rules, name)) },
    ]),
  );
  for (const name of Object.keys(lint.rules ?? {})) if (!namesRule(name, rules)) throw new Error(`lint.rules.${name} ${notARule(rules)}`);
  return rules;
}

const notARule = (rules: Record<string, unknown>) =>
  `is not a rule: name one of ${Object.keys(rules).join(', ')}, or every rule of a plugin as <plugin>/*`;
