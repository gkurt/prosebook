/**
 * `copydeck/config`: where the catalog lives, what an entry may say about itself, and how strictly
 * its words are checked. Written as `copydeck.config.ts` (or `.js`, `.mjs`, `.json`) at the project root.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { LintRule } from './lint.ts';
import { DEFAULT_KINDS, DEFAULT_SURFACES, RECOMMENDED_RULES, STRICT_LISTS, STRICT_RULES, type KindRule, type Severity } from './presets.ts';

export type { KindRule, Severity };

export interface WordLists {
  /** Words a string never uses, in groups that say why. */
  banned?: { words: string[]; why: string }[];
  /** A spelling, and the one the product uses instead. */
  spelling?: Record<string, string>;
  /** A near-synonym, and the one word the product uses for that concept. */
  concepts?: Record<string, string>;
  /** Words that keep their capital inside a sentence-case string: product names, platforms. */
  properNouns?: string[];
}

export interface LintConfig extends WordLists {
  /** `recommended` (the default) checks shape; `strict` adds the word lists and rules of a house style guide. */
  extends?: 'recommended' | 'strict' | 'none';
  rules?: Partial<Record<LintRule, Severity>>;
}

export interface CopydeckConfig {
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
  /** Where `copydeck scan` looks for hardcoded text and catalog keys. */
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
  bundled: string[];
  pseudo: string | false;
  stale: 'use' | 'fallback';
  language: 'ts' | 'js';
  importExtension: '.js' | '.ts' | '';
  require: ('context' | 'kind' | 'surface')[];
  kinds: Record<string, KindRule>;
  surfaces: Record<string, string>;
  lint: { rules: Record<LintRule, Severity> } & Required<WordLists>;
  scan: { dirs: string[]; extensions: string[]; attributes: string[] };
}

/** Typed config, for `copydeck.config.ts`. */
export function defineConfig(config: CopydeckConfig): CopydeckConfig {
  return config;
}

export const CONFIG_FILES = [
  'copydeck.config.ts',
  'copydeck.config.mts',
  'copydeck.config.js',
  'copydeck.config.mjs',
  'copydeck.config.json',
];

/** Finds and reads the config at `root`, or the defaults when there is none. */
export async function loadConfig(root: string, inline?: CopydeckConfig): Promise<ResolvedConfig> {
  if (inline) return resolveConfig(root, inline);
  for (const name of CONFIG_FILES) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    if (name.endsWith('.json')) return resolveConfig(root, JSON.parse(readFileSync(path, 'utf8')) as CopydeckConfig);
    const mod = (await import(pathToFileURL(path).href)) as { default?: CopydeckConfig };
    return resolveConfig(root, mod.default ?? {});
  }
  return resolveConfig(root, {});
}

export function resolveConfig(root: string, config: CopydeckConfig): ResolvedConfig {
  const at = (path: string) => (isAbsolute(path) ? path : resolve(root, path));
  const lint = config.lint ?? {};
  const base = lint.extends ?? 'recommended';
  const strict = base === 'strict';
  const rules = { ...(base === 'none' ? {} : strict ? STRICT_RULES : RECOMMENDED_RULES), ...lint.rules };
  const allRules = Object.fromEntries(Object.keys(STRICT_RULES).map((r) => [r, rules[r as LintRule] ?? 'off'])) as Record<
    LintRule,
    Severity
  >;
  return {
    root,
    catalog: at(config.catalog ?? 'copy/catalog'),
    locales: at(config.locales ?? 'copy/locales'),
    out: at(config.out ?? 'src/copy'),
    lock: at(config.lock ?? 'copy/lock.json'),
    source: config.source ?? 'en',
    bundled: config.bundled ?? [],
    pseudo: config.pseudo ?? false,
    stale: config.stale ?? 'use',
    language: config.language ?? 'ts',
    importExtension: config.importExtension ?? '.js',
    require: config.require ?? ['context'],
    kinds: config.kinds ?? DEFAULT_KINDS,
    surfaces: config.surfaces ?? DEFAULT_SURFACES,
    lint: {
      rules: allRules,
      banned: [...(strict ? STRICT_LISTS.banned : []), ...(lint.banned ?? [])],
      spelling: { ...(strict ? STRICT_LISTS.spelling : {}), ...lint.spelling },
      concepts: { ...lint.concepts },
      properNouns: lint.properNouns ?? [],
    },
    scan: {
      dirs: (config.scan?.dirs ?? ['src']).map(at),
      extensions: config.scan?.extensions ?? ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'],
      attributes: config.scan?.attributes ?? ['alt', 'title', 'placeholder', 'label', 'aria-label', 'aria-description', 'aria-placeholder'],
    },
  };
}
