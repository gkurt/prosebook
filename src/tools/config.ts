/**
 * `prosebook/config`: where the catalog lives, what an entry may say about itself, and how strictly
 * its words are checked. Written as `prosebook.config.ts` (or `.js`, `.mjs`, `.json`) at the project root.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { compileRule, CORE_RULES, type CheckRule, type CoreRule, type Plugin } from './lint.ts';
import type { Isolate } from './mf2.ts';
import { DEFAULT_KINDS, DEFAULT_SURFACES, STRICT_LISTS, type KindRule, type Severity } from './presets.ts';

export type { KindRule, Severity };
export {
  definePlugin,
  HOLE,
  phrase,
  sentences,
  words,
  type CapitalizationRule,
  type CheckRule,
  type ConditionalRule,
  type ExistenceRule,
  type OccurrenceRule,
  type Plugin,
  type Readings,
  type Report,
  type Rule,
  type RuleContext,
  type SubstitutionRule,
} from './lint.ts';

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
}

/**
 * Native code generated from the catalog, for the parts of an app outside the browser: a tray, a
 * menu bar, a CLI. One file, holding every locale, with a typed function per message; for Android,
 * string resources, a file per locale.
 */
export interface NativeTarget {
  language: 'rust' | 'swift' | 'kotlin' | 'android';
  /** The file written; for Android, the `res` folder its `values*` folders go in. */
  out: string;
  /**
   * Key prefixes the file holds: `['native']` takes every `native.*` key, which it names without the
   * prefix (`native.tray.quit` is `tray_quit`). Every key, named in full, by default.
   */
  keys?: string[];
  /**
   * The type holding the locales and messages: `Locale` in Rust, `Copy` in Swift and Kotlin. For
   * Android, the resource file's name: `strings`, for `values/strings.xml`.
   */
  name?: string;
  /** Kotlin's package. */
  package?: string;
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
  /** Rust, Swift or Kotlin files `generate` writes beside the TypeScript. */
  native?: NativeTarget[];
  /** Where `prosebook scan` looks for hardcoded text and catalog keys. */
  scan?: {
    dirs?: string[];
    extensions?: string[];
    /** JSX attributes whose literal value a person reads. */
    attributes?: string[];
  };
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
  } & Required<WordLists>;
  native: (NativeTarget & { name: string })[];
  scan: { dirs: string[]; extensions: string[]; attributes: string[] };
}

const NATIVE_NAMES = { rust: 'Locale', swift: 'Copy', kotlin: 'Copy', android: 'strings' };

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
  for (const [area, severities] of Object.entries(lint.areas ?? {})) {
    for (const name of Object.keys(severities))
      if (!(name in rules)) throw new Error(`lint.areas.${area}.${name} is not a rule: name one of ${Object.keys(rules).join(', ')}`);
  }
  return {
    root,
    catalog: at(config.catalog ?? 'copy/catalog'),
    locales: at(config.locales ?? 'copy/locales'),
    out: at(config.out ?? 'src/copy'),
    lock: at(config.lock ?? 'copy/lock.json'),
    source: config.source ?? 'en',
    messageFormat: config.messageFormat ?? 1,
    isolate: config.isolate ?? 'rtl',
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
      banned: [...(strict ? STRICT_LISTS.banned : []), ...(lint.banned ?? [])],
      spelling: { ...(strict ? STRICT_LISTS.spelling : {}), ...lint.spelling },
      concepts: { ...lint.concepts },
      properNouns: lint.properNouns ?? [],
      pathSeparator: lint.pathSeparator ?? '›',
    },
    native: (config.native ?? []).map((target, i) => {
      if (!(target.language in NATIVE_NAMES))
        throw new Error(`native[${i}].language is "${target.language}": name one of ${Object.keys(NATIVE_NAMES).join(', ')}`);
      return { ...target, out: at(target.out), name: target.name ?? NATIVE_NAMES[target.language] };
    }),
    scan: {
      dirs: (config.scan?.dirs ?? ['src']).map(at),
      extensions: config.scan?.extensions ?? ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'],
      attributes: config.scan?.attributes ?? ['alt', 'title', 'placeholder', 'label', 'aria-label', 'aria-description', 'aria-placeholder'],
    },
  };
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
