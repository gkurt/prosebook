/**
 * Holds every source message to the mechanical half of a writing guide: budgets, periods, case,
 * dashes, spelling, contractions, the product's one word per concept, and banned words. What needs
 * judgment stays with review. An entry a rule is wrong about says so under `allow`, with the reason,
 * and an exemption that no longer matches anything fails too, so none outlive the words they excused.
 *
 * The core rules are written as a plugin's are: a project adds its own through `lint.plugins`, as
 * code or as data, and they read the same readings of a message and are exempted the same way.
 */
import type { Message } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { staticLiteral, TYPE, walk, type MessageFormatElement } from './icu.ts';
import type { KindRule, Severity } from './presets.ts';

/** What a rule is given about one message in one locale. */
export interface RuleContext {
  /** The entry, as the source catalog has it. */
  message: Message;
  /** The locale read: the source, or a translation's. */
  locale: string;
  /** The message in that locale. */
  ast: MessageFormatElement[];
  /** The shape the message's kind is held to, when it names a kind the config defines. */
  kind: KindRule | undefined;
  /** The message in that locale, as prose. */
  text: Readings;
  /** The source message as prose, to hold a translation to it: `text` itself in the source locale. */
  source: Readings;
  config: ResolvedConfig;
}

interface RuleBase {
  /** One sentence: what the rule holds a string to. */
  description: string;
  /** Its severity under `extends: 'recommended'`; off when unset. */
  recommended?: Severity;
  /** Its severity under `extends: 'strict'`; `error` when unset. */
  strict?: Severity;
  /**
   * Only entries of these kinds, on these surfaces, or in these areas (a key's first segment); an
   * entry that says no kind or surface is skipped by a rule that names some. Only the source unless
   * `locale` says otherwise, since most writing rules are written for one language: `all` reads
   * every locale, and a list those languages and their regions (`de` covers `de-CH`).
   */
  on?: { kind?: string[]; surface?: string[]; area?: string[]; locale?: 'all' | string[] };
  /** Said in the writing guide too, before the writing, for a rule worth knowing before the lint finds it. */
  guide?: boolean;
}

/** A rule written as code. */
export interface CheckRule extends RuleBase {
  /** What is wrong with the message, a sentence each that states the fix; none when it passes. */
  check(context: RuleContext): (string | Report)[];
}

/** A finding that can say where it is, and what to write instead. */
export interface Report {
  message: string;
  /** The words the finding is about, as a reading has them: found in the message's text, in any case. */
  match?: string;
  /** What `prosebook lint --fix` writes in place of `match`, wherever it stands; its case follows the text's. */
  fix?: string;
}

/** A replacement in a message's text, by offset. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

/*
 * Rules written as data, after Vale's, so a JSON config can carry them. Words and patterns are looked
 * for in every reading, so one in a `one` arm is found; counts and case read the `other` arms. A
 * pattern is a regular expression with the `u` flag, and sees a placeholder as `HOLE`. A message
 * names what was found with `{match}`, and the other fields its rule lists.
 */

/** Words or patterns a string never uses. */
export interface ExistenceRule extends RuleBase {
  type: 'existence';
  /** Words or phrases, matched whole and in any case. `{match}` is the one listed. */
  words?: string[];
  /** `{match}` is the text matched. */
  patterns?: string[];
  ignoreCase?: boolean;
  message: string;
}

/** A word or phrase the product writes another way. */
export interface SubstitutionRule extends RuleBase {
  type: 'substitution';
  /** A word or phrase, matched whole and in any case, and the one written instead. */
  swap: Record<string, string>;
  /** `{match}` and `{use}`; `"{match}" is written "{use}"` when unset. */
  message?: string;
}

/** A budget, beside the one a kind sets: per surface, say, or in characters. */
export interface OccurrenceRule extends RuleBase {
  type: 'occurrence';
  /** Every word, placeholders included; sentences; or characters, placeholders not included. */
  count: 'words' | 'sentences' | 'characters';
  max?: number;
  min?: number;
  /** `max` and `min` are multiples of the source's count: `max: 1.4` is 40% longer than the source at most. */
  relative?: boolean;
  /** `{count}`, `{max}`, `{min}`, and with `relative`, `{source}` (the source's count) and `{limit}`. */
  message?: string;
}

export interface CapitalizationRule extends RuleBase {
  type: 'capitalization';
  /** `sentence` capitalizes only the first word and proper nouns, `title` every word but short function words. */
  case: 'sentence' | 'title' | 'lower' | 'upper';
  /** Words that keep their case, beside `lint.properNouns`. */
  exceptions?: string[];
  /** `{match}` is the first word out of case. */
  message?: string;
}

/** A string that matches `when` (every string, when unset) matches `require` too. */
export interface ConditionalRule extends RuleBase {
  type: 'conditional';
  when?: string;
  require: string;
  ignoreCase?: boolean;
  /** `{match}` is the text `when` matched. */
  message: string;
}

/**
 * Advice no pattern can check: "an error says what to do next". Said in the writing guide only, as its
 * description, and on under either preset unless it says otherwise, since no finding comes of it.
 */
export interface GuidelineRule extends RuleBase {
  type: 'guideline';
}

export type Rule = CheckRule | ExistenceRule | SubstitutionRule | OccurrenceRule | CapitalizationRule | ConditionalRule | GuidelineRule;

/** A set of rules, named `<name>/<rule>` in `lint.rules` and in an entry's `allow`. */
export interface Plugin {
  name: string;
  rules: Record<string, Rule>;
}

/** Typed plugin, for `lint.plugins`. */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}

export interface Finding {
  key: string;
  /** The catalog file, or for a translation, the locale's file. */
  file: string;
  /** The locale whose text the finding is about; the source for an `allow` finding. */
  locale: string;
  /** The rule's name, or `allow` for an exemption that is itself wrong. */
  rule: string;
  severity: Exclude<Severity, 'off'>;
  message: string;
  /** Where in the locale's message text, when the rule named a match and it is written there as read. */
  at?: { start: number; end: number };
  /** The edits that fix it, at every place the match stands. */
  fix?: Edit[];
}

/** Stands in for a placeholder in a reading, which no prose rule reads. */
export const HOLE = '\u2063';
/** Tags whose content is code or a literal the reader types, not prose. */
const VERBATIM_TAGS = new Set(['code', 'mono', 'kbd', 'keycap', 'nums']);

function renderAs(elements: MessageFormatElement[], arm: string | null): string {
  let out = '';
  for (const el of elements) {
    if (el.type === TYPE.literal) {
      out += el.value;
    } else if (el.type === TYPE.tag) {
      out += VERBATIM_TAGS.has(el.value) ? HOLE : renderAs(el.children, arm);
    } else if (el.type === TYPE.plural || el.type === TYPE.select) {
      const option = arm === null ? undefined : (el.options[arm] ?? el.options['other']);
      out += option === undefined ? HOLE : renderAs(option.value, arm);
    } else {
      out += HOLE;
    }
  }
  return out;
}

/** The message as prose: placeholders and verbatim tags read as `HOLE`, and `’` as `'` in `variants`. */
export interface Readings {
  /** Every `other` arm taken: what a budget is measured on. */
  primary: string;
  /** One reading per arm, so a word hidden in `one` is still found. */
  variants: string[];
  /** Only the words the message always carries. */
  skeleton: string;
}

function readings(message: MessageFormatElement[]): Readings {
  const literal = staticLiteral(message);
  const ast = literal === undefined ? message : ([{ type: TYPE.literal, value: literal }] as MessageFormatElement[]);
  const arms = new Set<string>();
  const collect = (els: MessageFormatElement[]) => {
    for (const el of els) {
      if (el.type === TYPE.plural || el.type === TYPE.select) {
        for (const [name, option] of Object.entries(el.options)) {
          arms.add(name);
          collect(option.value);
        }
      }
      if (el.type === TYPE.tag) collect(el.children);
    }
  };
  collect(ast);
  const primary = renderAs(ast, 'other');
  const variants = new Set([primary, ...[...arms].map((arm) => renderAs(ast, arm))]);
  return { primary, variants: [...variants].map((v) => v.replace(/\u2019/g, "'")), skeleton: renderAs(ast, null) };
}

/** What a reader sees end to end, less a placeholder appended at the very end. */
const prose = (text: string) => text.replace(new RegExp(`[\\s${HOLE}]+$`), '');

const FREE = new Set('a an the this that these those it its them your and or to of for by in on at from with'.split(' '));

const tokens = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w) || w.includes(HOLE));

/** The words a budget counts: articles, short prepositions and asides in parentheses are free. */
export function words(text: string): string[] {
  return tokens(text.replace(/\s*\([^)]*\)/g, '')).filter((w) => !FREE.has(w.toLowerCase().replace(/[^\p{L}]/gu, '')));
}

const ABBREVIATIONS = /\b(?:e\.g|i\.e|vs|etc)\.$/i;

export function sentences(text: string): number {
  let count = 1;
  const boundary = /[.!?…]+["')\]]*\s+(?=\S)/g;
  for (let m = boundary.exec(text); m !== null; m = boundary.exec(text))
    if (!ABBREVIATIONS.test(text.slice(0, m.index + m[0].trimEnd().length))) count += 1;

  return count;
}

/** A word or phrase on its own, not inside a longer word or a hyphenated compound. */
export function phrase(p: string): RegExp {
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}'-])${escaped}(?![\\p{L}\\p{N}'-])`, 'iu');
}

/** The words and phrases of `list` that some reading carries. */
const listed = (variants: string[], list: string[]) => list.filter((w) => variants.some((v) => phrase(w).test(v)));

const unquoted = (token: string) => token.replace(/^[("'“‘]+|[)"'”’.,:;!?]+$/g, '');

function capitalizedWord(text: string, proper: Set<string>): string | undefined {
  const parts = text.split(/\s+/).filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const word = unquoted(parts[i]!);
    if (!/^\p{Lu}\p{Ll}/u.test(word) || proper.has(word)) continue;
    if (/[.:?!]["')]*$/.test(parts[i - 1]!)) continue;
    return word;
  }
  return undefined;
}

/** Words a count is followed by that are not plural nouns, though they end in s. */
const NOT_PLURAL = new Set([
  'is',
  'was',
  'has',
  'does',
  'this',
  'its',
  'plus',
  'minus',
  'less',
  'yes',
  'us',
  'as',
  'bus',
  'gas',
  'news',
  'series',
]);

/**
 * The singular of an English plural noun, or nothing where it doesn't look like one. A word with no
 * vowel is a unit or an abbreviation (`kbps`, `fps`, `hrs`), which reads the same after 1.
 */
export function singularOf(word: string): string | undefined {
  const lower = word.toLowerCase();
  if (word.length < 3 || !lower.endsWith('s') || lower.endsWith('ss') || NOT_PLURAL.has(lower)) return undefined;
  if (!/[aeiouy]/.test(lower)) return undefined;
  if (/[^aeiou]ies$/.test(lower)) return `${word.slice(0, -3)}y`;
  if (/(?:s|x|z|ch|sh)es$/.test(lower)) return word.slice(0, -2);
  return word.slice(0, -1);
}

const MINOR = new Set('a an the and but or nor for so yet as at by in of off on per to up via with'.split(' '));

/** The first word out of `style` case, less those in `keep`. */
function outOfCase(text: string, style: CapitalizationRule['case'], keep: Set<string>): string | undefined {
  if (style === 'sentence') return capitalizedWord(text, keep);
  const list = text
    .split(/\s+/)
    .map(unquoted)
    .filter((w) => /\p{L}/u.test(w) && !keep.has(w));
  return list.find((w, i) => {
    if (style === 'lower') return /\p{Lu}/u.test(w);
    if (style === 'upper') return /\p{Ll}/u.test(w);
    return /^\p{Ll}/u.test(w) && (i === 0 || !MINOR.has(w));
  });
}

const CONTRACTIONS: [RegExp, string][] = [
  [/\bcannot\b/i, "can't"],
  [/\bcan not\b/i, "can't"],
  [/\bwill not\b/i, "won't"],
  [/\b(could|would|should|is|are|was|were|do|does|did|has|have|had|must|need) not\b/i, "n't"],
];

/** Calls `visit` on every run of elements that sit side by side, with the arguments a plural around it counts. */
function eachRun(
  elements: MessageFormatElement[],
  visit: (run: MessageFormatElement[], counted: ReadonlySet<string>) => void,
  counted: ReadonlySet<string> = new Set(),
): void {
  visit(elements, counted);
  for (const el of elements) {
    if (el.type === TYPE.plural) for (const o of Object.values(el.options)) eachRun(o.value, visit, new Set([...counted, el.value]));
    if (el.type === TYPE.select) for (const o of Object.values(el.options)) eachRun(o.value, visit, counted);
    if (el.type === TYPE.tag) eachRun(el.children, visit, counted);
  }
}

/**
 * The total of a ratio, `{used} of {total} tokens`: what it counts is a whole, which is one only as
 * the ratio's other side is, and "1 of 1 tokens" is rare enough to leave to `allow`.
 */
function isTotal(run: MessageFormatElement[], i: number): boolean {
  const before = run[i - 1];
  const part = run[i - 2];
  return (
    before?.type === TYPE.literal &&
    /^\s+of\s+$/.test(before.value) &&
    (part?.type === TYPE.number || part?.type === TYPE.argument || part?.type === TYPE.pound)
  );
}

/** A plain placeholder named as a count. A number placeholder is one whatever its name. */
const COUNT_NAME = /^(?:n|num|count|total|amount|quantity)$|(?:count|total)$/i;

/**
 * Whether an arm ends with a stop; nothing for an arm with no words, or one that trails off in an
 * ellipsis (`Saving…`, `Save as…`), which is neither. Which stop is the arm's own: a question in
 * `one` and a second sentence after it in `other` both end well.
 */
function endsWithStop(arm: MessageFormatElement[]): boolean | undefined {
  const text = prose(renderAs(arm, 'other')).trim();
  if (text.replaceAll(HOLE, '').trim() === '' || /(?:…|\.{3})["')”»」』]*$/u.test(text)) return undefined;
  return hasStop(text);
}

/** Ends with a stop in any script (`。`, `؟`, `;` as Greek writes `?`), though not a comma. */
const hasStop = (text: string) => /(?![,，、،])[\p{Terminal_Punctuation}…]["')”»」』]*$/u.test(prose(text).trim());

const CURRENCY_BEFORE = /[$€£¥₹]\s?$/;

/** A unit written after a number by hand (`{h, number}h`, `{size, number} MB`), and the `Intl` unit that writes it. */
const UNIT_AFTER = /^\s?(ms|sec|secs|min|mins|hrs?|[hmsd]|[kmgt]b|km|cm|mm|kg|lbs?|mi|ft)(?![\p{L}\d])/iu;
const UNITS: Record<string, string> = {
  ms: 'millisecond',
  s: 'second',
  sec: 'second',
  secs: 'second',
  m: 'minute',
  min: 'minute',
  mins: 'minute',
  h: 'hour',
  hr: 'hour',
  hrs: 'hour',
  d: 'day',
  kb: 'kilobyte',
  mb: 'megabyte',
  gb: 'gigabyte',
  tb: 'terabyte',
  km: 'kilometer',
  cm: 'centimeter',
  mm: 'millimeter',
  kg: 'kilogram',
  lb: 'pound',
  lbs: 'pound',
  mi: 'mile',
  ft: 'foot',
};

/**
 * The ways a path through menus is written, the separator in a group: an arrow or `›` however
 * spaced, and `>` or `/` only spaced between words or placeholders, with a capital after a slash,
 * since "2 > 1" and "and / or" are no paths. The match takes the spaces around, so the fix spaces
 * the separator.
 */
const PATH_SEPARATORS = new RegExp(
  String.raw`\s*(→|->|›)\s*|(?<=[\p{L}${HOLE}])\s+(>)\s+(?=[\p{L}${HOLE}])|(?<=\p{L})\s+(\/)\s+(?=\p{Lu})`,
  'gu',
);

const OFF_SCREEN = new Set(['aria']);

const an = (word = 'string') => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;

export const CORE_RULES = {
  whitespace: {
    description: 'No leading, trailing or doubled spaces.',
    recommended: 'error',
    on: { locale: 'all' },
    check: ({ text }) => {
      const message = 'no leading, trailing or doubled spaces';
      // As a match, two spaces stand for a run of any length.
      if (text.variants.some((v) => v.includes('  '))) return [{ message, match: '  ', fix: ' ' }];
      return text.variants.some((v) => /^\s|\s$/.test(v.replaceAll(HOLE, 'x'))) ? [message] : [];
    },
  },
  'word-budget': {
    description: "A kind with `maxWords` stays within it. Articles, short prepositions and asides in parentheses don't count.",
    recommended: 'warn',
    check: ({ message: m, kind, text }) => {
      if (kind?.maxWords === undefined || OFF_SCREEN.has(m.surface ?? '')) return [];
      const n = words(text.primary).length;
      return n > kind.maxWords ? [`${an(m.kind)} is ${kind.maxWords} words at most, and this is ${n}`] : [];
    },
  },
  'sentence-budget': {
    description: 'A kind with `maxSentences` stays within it.',
    recommended: 'warn',
    check: ({ message: m, kind, text }) => {
      const most = (m.surface !== undefined ? kind?.maxSentencesOn?.[m.surface] : undefined) ?? kind?.maxSentences;
      if (most === undefined) return [];
      const n = sentences(prose(text.primary));
      return n > most
        ? [
            `${an(m.kind)}${kind?.maxSentencesOn?.[m.surface ?? ''] !== undefined ? ` on ${m.surface}` : ''} is ${most} sentence(s) at most, and this is ${n}`,
          ]
        : [];
    },
  },
  period: {
    description: 'A kind with `period: always` (or on a listed surface) ends with a period, unless the entry is a fragment.',
    recommended: 'warn',
    check: ({ message: m, kind, text }) => {
      const rule = kind?.period;
      const applies = rule === 'always' || (Array.isArray(rule) && rule.includes(m.surface ?? ''));
      return applies && !m.fragment && !/[.?!…:]["')”]*$/.test(prose(text.primary))
        ? [`${an(m.kind)} ends with a period, or is marked fragment: true`]
        : [];
    },
  },
  'no-period': {
    description: 'A kind with `period: never` ends without one.',
    recommended: 'warn',
    check: ({ message: m, kind, text }) =>
      kind?.period === 'never' && /[^.]\.$/.test(prose(text.primary)) ? [`${an(m.kind)} ends without a period`] : [],
  },
  'bare-name': {
    description: 'A kind with `bare: true` carries no explanation after a dash or a colon.',
    recommended: 'warn',
    // A colon before a value is a readout, as in "Zoom: 120%", not an explanation.
    check: ({ message: m, kind, text }) =>
      kind?.bare === true && new RegExp(`\\s[—–-]\\s|\\p{L}:\\s(?!${HOLE})`, 'u').test(text.skeleton)
        ? [`${an(m.kind)} carries no explanation after a dash or a colon`]
        : [],
  },
  'sentence-case': {
    description: 'A kind with `sentenceCase: true` capitalizes only its first word and proper nouns.',
    check: ({ message: m, kind, text, config }) => {
      if (kind?.sentenceCase !== true) return [];
      const word = outOfCase(text.primary, 'sentence', new Set(config.lint.properNouns));
      if (word === undefined) return [];
      return [
        { message: `"${word}" is capitalized in a sentence-case ${m.kind}: add it to lint.properNouns if it is a name`, match: word },
      ];
    },
  },
  'banned-word': {
    description: 'A word or phrase from the banned lists.',
    recommended: 'warn',
    check: ({ text, config }) =>
      config.lint.banned.flatMap(({ words: list, why }) =>
        listed(text.variants, list).map((w) => ({ message: `"${w}" ${why}`, match: w })),
      ),
  },
  spelling: {
    description: 'A spelling the product writes another way.',
    recommended: 'warn',
    check: ({ text, config: { lint } }) =>
      listed(text.variants, Object.keys(lint.spelling)).map((w) => ({
        message: `"${w}" is spelled "${lint.spelling[w]}"`,
        match: w,
        fix: lint.spelling[w],
      })),
  },
  'one-word': {
    description: 'A near-synonym for a concept the product has one word for.',
    recommended: 'warn',
    check: ({ text, config: { lint } }) =>
      listed(text.variants, Object.keys(lint.concepts)).map((w) => ({
        message: `"${w}" is "${lint.concepts[w]}" everywhere in the product`,
        match: w,
        fix: lint.concepts[w],
      })),
  },
  'no-em-dash': {
    description: 'No em-dashes, and no spaced hyphen standing in for one.',
    check: ({ text }) => {
      const match = text.variants.map((v) => /—|\s[–-]\s/.exec(v)?.[0]).find((m) => m !== undefined);
      return match === undefined ? [] : [{ message: 'no em-dash: a comma, a period or a colon does the job', match }];
    },
  },
  path: {
    description: 'A path through menus or settings is written with `lint.pathSeparator`, spaced: Settings › General.',
    check: ({ text, config }) => {
      const use = config.lint.pathSeparator;
      for (const v of text.variants) {
        for (const m of v.matchAll(PATH_SEPARATORS)) {
          if ((m[1] ?? m[2] ?? m[3]) === use) continue;
          return [{ message: `a path is written with a spaced ${use}`, match: m[0], fix: ` ${use} ` }];
        }
      }
      return [];
    },
  },
  contractions: {
    description: '`could not`, `is not` and `cannot` are written as contractions.',
    check: ({ text }) =>
      CONTRACTIONS.flatMap(([pattern, short]) => {
        const found = text.variants.map((v) => pattern.exec(v)).find((f) => f !== null);
        if (found === undefined || found === null) return [];
        const fix = short === "n't" ? `${found[1]}n't` : short;
        return [{ message: `"${found[0]}" is written as a contraction (${short})`, match: found[0], fix }];
      }),
  },
  ellipsis: {
    description: 'An ellipsis is one character, `…`, not three periods.',
    on: { locale: 'all' },
    check: ({ text }) =>
      text.variants.some((v) => v.includes('...')) ? [{ message: 'an ellipsis is one character: …', match: '...', fix: '…' }] : [],
  },
  'plural-count': {
    description: 'A count followed by a plural noun, `{count} files`, is a plural, or it reads "1 files". English.',
    recommended: 'warn',
    check: ({ ast }) => {
      // By message, so the same words in each arm of a select are one finding.
      const said = new Map<string, Report>();
      eachRun(ast, (run, counted) =>
        run.forEach((el, i) => {
          if (el.type !== TYPE.number && el.type !== TYPE.argument) return;
          if (counted.has(el.value) || (el.type === TYPE.argument && !COUNT_NAME.test(el.value))) return;
          if (isTotal(run, i)) return;
          const next = run[i + 1];
          const word = next?.type === TYPE.literal ? /^\s+(\p{L}+)(?![\p{L}'])/u.exec(next.value)?.[1] : undefined;
          const one = word === undefined ? undefined : singularOf(word);
          if (word === undefined || one === undefined) return;
          const message = `${el.value} is followed by "${word}", which reads "1 ${word}": make it a plural with a "# ${one}" arm`;
          said.set(message, { message, match: word });
        }),
      );
      return [...said.values()];
    },
  },
  'plural-one': {
    description: "A plural's `one` arm says something other than `other`, and says `#` rather than `1`.",
    recommended: 'warn',
    on: { locale: 'all' },
    check: ({ ast, locale, config }) => {
      const said: Report[] = [];
      walk(ast, (el) => {
        if (el.type !== TYPE.plural || el.pluralType !== 'cardinal') return;
        const { one, other } = el.options;
        if (one === undefined) return;
        // Turkish says "# dosya" for one and other alike, so only the source must tell them apart.
        if (locale === config.source && other !== undefined && renderAs(one.value, 'other') === renderAs(other.value, 'other'))
          said.push({ message: `the one and other arms of ${el.value} say the same: write the singular in one` });
        let literalOne = false;
        walk(one.value, (inner) => {
          if (inner.type === TYPE.literal && /(?<![\d.,])1(?![\d.,])/.test(inner.value)) literalOne = true;
        });
        // Russian's `one` is also 21 and 31, so a translator copying a written 1 gets it wrong there.
        if (!literalOne) return;
        const message = `the one arm of ${el.value} writes 1, which one is not in every language: write #, or make the arm =1`;
        said.push({ message, match: '1' });
      });
      return said;
    },
  },
  'arm-endings': {
    description: 'The arms of a plural or select end alike: all with a stop, or all without one.',
    recommended: 'warn',
    on: { locale: 'all' },
    check: ({ ast }) => {
      const said: string[] = [];
      walk(ast, (el) => {
        if (el.type !== TYPE.plural && el.type !== TYPE.select) return;
        const endings = new Set(Object.values(el.options).flatMap((o) => endsWithStop(o.value) ?? []));
        if (endings.size > 1) said.push(`some arms of ${el.value} end with a stop and some without: end them alike`);
      });
      return said;
    },
  },
  'formatted-by-hand': {
    description: 'A currency symbol or `%` typed beside a placeholder, or digits grouped by hand, which only suit one locale.',
    recommended: 'warn',
    on: { locale: 'all' },
    check: ({ ast, text, config }) => {
      const said = new Map<string, Report>();
      const say = (message: string, match: string) => said.set(message, { message, match });
      eachRun(ast, (run) =>
        run.forEach((el, i) => {
          if (el.type !== TYPE.number && el.type !== TYPE.argument) return;
          const before = run[i - 1];
          const after = run[i + 1];
          const symbol = before?.type === TYPE.literal ? CURRENCY_BEFORE.exec(before.value)?.[0].trim() : undefined;
          if (symbol !== undefined)
            say(`"${symbol}" is typed before ${el.value}: format it as a currency, which puts the symbol where the locale does`, symbol);
          if (after?.type === TYPE.literal && /^\s?%/.test(after.value))
            say(`"%" is typed after ${el.value}: format it as a percent, which takes the fraction (0.5 for 50%)`, '%');
          // A plain placeholder only where its name says it counts: `{name}s` is a word, not seconds.
          const unit = after?.type === TYPE.literal ? UNIT_AFTER.exec(after.value)?.[1] : undefined;
          if (unit !== undefined && (el.type === TYPE.number || COUNT_NAME.test(el.value))) {
            const name = UNITS[unit.toLowerCase()]!;
            const written =
              config.messageFormat === 2
                ? `{$${el.value} :unit unit=${name} unitDisplay=narrow}`
                : `{${el.value}, number, ::unit/${name} unit-width-narrow}`;
            say(`"${unit}" is typed after ${el.value}: format it as a unit, ${written}, which writes it as the locale does`, unit);
          }
        }),
      );
      const grouped = text.variants.map((v) => /\d{1,3}(?:,\d{3})+(?!\d)/.exec(v)?.[0]).find((g) => g !== undefined);
      if (grouped !== undefined)
        say(`"${grouped}" groups its digits the English way: make it a placeholder formatted as a number`, grouped);
      return [...said.values()];
    },
  },
  'source-ending': {
    description: 'A translation ends with a stop where its source does, and without one where it does not.',
    recommended: 'warn',
    on: { locale: 'all' },
    check: ({ text, source }) => {
      const ends = hasStop(text.primary);
      if (ends === hasStop(source.primary)) return [];
      return [
        ends
          ? 'ends with a stop, and the source does not: drop it'
          : 'the source ends with a stop, and this does not: end it as the source does',
      ];
    },
  },
} satisfies Record<string, CheckRule>;

export type CoreRule = keyof typeof CORE_RULES;

const fill = (message: string, values: Record<string, string | number | undefined>) =>
  message.replace(/\{(\w+)\}/g, (all, name: string) => (values[name] === undefined ? all : String(values[name])));

const graphemes = new Intl.Segmenter();

const COUNTERS: Record<OccurrenceRule['count'], (text: string) => number> = {
  words: (text) => tokens(text).length,
  sentences: (text) => sentences(prose(text)),
  characters: (text) => [...graphemes.segment(text.replaceAll(HOLE, ''))].length,
};

/** A rule as code, checked once when the config loads: a JSON config is not type-checked. */
export function compileRule(name: string, rule: Rule): CheckRule {
  const fail = (problem: string): never => {
    throw new Error(`lint rule ${name} ${problem}`);
  };
  const pattern = (source: unknown, field: string, ignoreCase: boolean | undefined) => {
    if (typeof source !== 'string') return fail(`${field} is not a string: write the pattern as one`);
    try {
      return new RegExp(source, ignoreCase === true ? 'iu' : 'u');
    } catch (e) {
      return fail(`${field} is not a regular expression: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const said = (message: unknown) =>
    typeof message === 'string' && message !== '' ? message : fail('has no message: say what to write instead');
  if (typeof rule.description !== 'string' || rule.description === '') fail('has no description: say what it holds a string to');
  if ('check' in rule) return typeof rule.check === 'function' ? rule : fail('has a check that is not a function');
  const { description, recommended, strict, on, guide } = rule;
  const base = { description, recommended, strict, on, guide };
  switch (rule.type) {
    case 'guideline':
      return { ...base, recommended: recommended ?? 'warn', guide: true, check: () => [] };
    case 'existence': {
      const list = rule.words ?? [];
      const patterns = (rule.patterns ?? []).map((p, i) => pattern(p, `patterns[${i}]`, rule.ignoreCase));
      if (list.length + patterns.length === 0) fail('has no words or patterns: list what a string never says');
      const message = said(rule.message);
      return {
        ...base,
        check: ({ text }) => {
          const matched = patterns.flatMap((p) => text.variants.map((v) => p.exec(v)?.[0]).find((m) => m !== undefined) ?? []);
          return [...new Set([...listed(text.variants, list), ...matched])].map((match) => ({ message: fill(message, { match }), match }));
        },
      };
    }
    case 'substitution': {
      const swap = rule.swap ?? {};
      if (Object.keys(swap).length === 0) fail('has nothing in swap: map a word to the one written instead');
      const message = rule.message === undefined ? '"{match}" is written "{use}"' : said(rule.message);
      return {
        ...base,
        check: ({ text }) =>
          listed(text.variants, Object.keys(swap)).map((match) => ({
            message: fill(message, { match, use: swap[match] }),
            match,
            fix: swap[match],
          })),
      };
    }
    case 'occurrence': {
      const { count: unit, max, min, relative } = rule;
      const counter = Object.hasOwn(COUNTERS, unit) ? COUNTERS[unit] : fail(`counts ${unit}: count words, sentences or characters`);
      if (max === undefined && min === undefined) fail('has no max or min: give it one');
      if (rule.message !== undefined) said(rule.message);
      return {
        ...base,
        check: ({ text, source }) => {
          const count = counter(text.primary);
          const of = relative === true ? counter(source.primary) : 1;
          const over = max !== undefined && count > max * of;
          const under = min !== undefined && count < min * of;
          if (!over && !under) return [];
          // The limit shown is one the count could meet: 1.5 times 11 characters is 16 at most, 17 at least.
          const limit = over && max !== undefined ? Math.floor(max * of) : Math.ceil((min ?? 0) * of);
          const bound = over ? 'at most' : 'at least';
          const fallback =
            relative === true
              ? `{limit} ${unit} ${bound} ({${over ? 'max' : 'min'}} times the source's {source}), and this is {count}`
              : `{${over ? 'max' : 'min'}} ${unit} ${bound}, and this is {count}`;
          return [fill(rule.message ?? fallback, { count, max, min, source: relative === true ? of : undefined, limit })];
        },
      };
    }
    case 'capitalization': {
      const style = rule.case;
      if (!['sentence', 'title', 'lower', 'upper'].includes(style)) fail(`has case ${style}: use sentence, title, lower or upper`);
      const message =
        rule.message === undefined
          ? `"{match}" is out of ${style} case: change it, or add it to exceptions if it is a name`
          : said(rule.message);
      const exceptions = rule.exceptions ?? [];
      return {
        ...base,
        check: ({ text, config }) => {
          const match = outOfCase(text.primary, style, new Set([...config.lint.properNouns, ...exceptions]));
          return match === undefined ? [] : [{ message: fill(message, { match }), match }];
        },
      };
    }
    case 'conditional': {
      const when = rule.when === undefined ? undefined : pattern(rule.when, 'when', rule.ignoreCase);
      const required = pattern(rule.require, 'require', rule.ignoreCase);
      const message = said(rule.message);
      return {
        ...base,
        check: ({ text }) => {
          for (const v of text.variants) {
            const match = when === undefined ? '' : when.exec(v)?.[0];
            if (match !== undefined && !required.test(v)) return [fill(message, { match })];
          }
          return [];
        },
      };
    }
    default:
      return fail(
        `has type ${String((rule as { type?: unknown }).type)}: use existence, substitution, occurrence, capitalization, conditional or guideline, or give it a check`,
      );
  }
}

/** What `allow` gives where it names a reason in `lint.reasons` rather than writing one. */
export const REASON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A reason is a sentence a reviewer can check, not a shrug. */
export function reasonProblem(why: string): string | undefined {
  if (why.split(/\s+/).length < 4) return 'is four words at least: say why the rule is wrong here';
  if (/^(?:intentional|needed|required|ok|fine|false positive|by design|legacy|todo)\b/i.test(why))
    return 'names the reason, not that there is one';
  return undefined;
}

/** A locale is one a rule reads when it names its language, or the locale and a region of it. */
const readsLocale = (locales: 'all' | string[] | undefined, locale: string, sourceLocale: string) =>
  locales === undefined
    ? locale === sourceLocale
    : locales === 'all' ||
      locales.some((l) => locale.toLowerCase() === l.toLowerCase() || locale.toLowerCase().startsWith(`${l.toLowerCase()}-`));

/** Whether a rule reads an entry in a locale, by its `on`. */
export function applies(rule: RuleBase, message: Message, locale: string, sourceLocale: string): boolean {
  const { kind, surface, area, locale: locales } = rule.on ?? {};
  return (
    readsLocale(locales, locale, sourceLocale) &&
    (kind === undefined || (message.kind !== undefined && kind.includes(message.kind))) &&
    (surface === undefined || (message.surface !== undefined && surface.includes(message.surface))) &&
    (area === undefined || area.includes(message.area))
  );
}

/** A rule's severity for an entry: its area's, where `lint.areas` sets one. */
export const severityOf = (config: ResolvedConfig, name: string, message: Message): Severity | undefined =>
  config.lint.areas[message.area]?.[name] ?? config.lint.rules[name]?.severity;

interface Literal {
  start: number;
  value: string;
}

/**
 * Where the message's literals are written in its text, each looked for after the one before. A
 * literal escaped in the text (`''`, `\{`) isn't written as read, so it has no place, and nor does a
 * finding in it.
 */
function literalsIn(ast: MessageFormatElement[], text: string): Literal[] {
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

/** Every place `match` stands in the literals, in any case, whole where it starts or ends with a letter. */
function placesOf(match: string, literals: Literal[]): { start: number; end: number }[] {
  const body = match
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/ /g, '\\s+')
    .replace(/'/g, "['’]");
  const before = /^[\p{L}\p{N}]/u.test(match) ? '(?<![\\p{L}\\p{N}])' : '';
  const after = /[\p{L}\p{N}]$/u.test(match) ? '(?![\\p{L}\\p{N}])' : '';
  const pattern = new RegExp(`${before}${body}${after}`, 'giu');
  const places = new Map<number, number>();
  for (const { start, value } of literals)
    for (const m of value.matchAll(pattern)) places.set(start + m.index, start + m.index + m[0].length);
  return [...places].sort(([a], [b]) => a - b).map(([start, end]) => ({ start, end }));
}

/** A fix in the case of what it replaces: "Colour" becomes "Color". */
const inCaseOf = (found: string, fix: string) =>
  /^\p{Lu}/u.test(found) && /^\p{Ll}/u.test(fix) ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix;

/** `text` with the edits made, leaving out any that overlaps one before it. */
export function applyEdits(text: string, edits: Edit[]): string {
  let out = '';
  let at = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (edit.start < at) continue;
    out += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return out + text.slice(at);
}

export function lint(messages: Message[], config: ResolvedConfig): Finding[] {
  const findings: Finding[] = [];
  const rules = Object.entries(config.lint.rules);
  for (const message of messages) {
    const kind = message.kind === undefined ? undefined : config.kinds[message.kind];
    const source = readings(message.ast);
    const locales = [
      { locale: config.source, ast: message.ast, written: message.text, file: message.file },
      ...[...message.translations].map(([locale, t]) => ({ locale, ast: t.ast, written: t.text, file: t.file })),
    ];
    // An exemption is the entry's, so it holds in every locale, and is still needed if any locale needs it.
    const fired = new Set<string>();
    for (const { locale, ast, written, file } of locales) {
      const text = locale === config.source ? source : readings(ast);
      const context: RuleContext = { message, locale, ast, kind, text, source, config };
      let literals: Literal[] | undefined;
      for (const [name, { rule }] of rules) {
        const severity = severityOf(config, name, message)!;
        if (severity === 'off' || !applies(rule, message, locale, config.source)) continue;
        let said: (string | Report)[];
        try {
          said = rule.check(context);
        } catch (cause) {
          throw new Error(`lint rule ${name} failed on ${message.key} in ${locale}: fix or turn off the rule`, { cause });
        }
        if (said.length === 0) continue;
        fired.add(name);
        if (message.allow.has(name)) continue;
        for (const s of said) {
          const { message: text, match, fix } = typeof s === 'string' ? { message: s } : s;
          const finding: Finding = { key: message.key, file, locale, rule: name, severity, message: text };
          if (match !== undefined && match !== '') {
            literals ??= literalsIn(ast, written);
            const places = placesOf(match, literals);
            if (places.length > 0) finding.at = places[0];
            if (places.length > 0 && fix !== undefined)
              finding.fix = places.map((p) => ({ ...p, text: inCaseOf(written.slice(p.start, p.end), fix) }));
          }
          findings.push(finding);
        }
      }
    }
    for (const [name, why] of message.allow) {
      const at = { key: message.key, file: message.file, locale: config.source, rule: 'allow', severity: 'error' as const };
      const rule = config.lint.rules[name];
      if (rule === undefined) {
        findings.push({ ...at, message: `allow.${name} is not a rule: ${rules.map(([n]) => n).join(', ')}` });
      } else if (severityOf(config, name, message) === 'off') {
        continue;
      } else if (!fired.has(name)) {
        findings.push({ ...at, message: `allow.${name} exempts the entry from a rule it passes: remove it` });
      } else if (REASON_NAME.test(why) && config.lint.reasons[why] === undefined) {
        const named = Object.keys(config.lint.reasons);
        findings.push({
          ...at,
          message: `allow.${name} names the reason "${why}", which lint.reasons doesn't hold${named.length > 0 ? `: ${named.join(', ')}` : ''}`,
        });
      } else if (config.lint.reasons[why] === undefined) {
        // A named reason was checked as the config loaded.
        const problem = reasonProblem(why);
        if (problem !== undefined) findings.push({ ...at, message: `allow.${name} ${problem}` });
      }
    }
  }
  return findings;
}
