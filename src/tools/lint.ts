/**
 * Holds every source message to the mechanical half of a writing guide: budgets, periods, case,
 * dashes, spelling, contractions, the product's one word per concept, and banned words. What needs
 * judgment stays with review. An entry a rule is wrong about says so under `allow`, with the reason,
 * and an exemption that no longer matches anything fails too, so none outlive the words they excused.
 *
 * The core rules are written as a plugin's are: a project adds its own through `lint.plugins`, and
 * they read the same readings of a message and are exempted the same way.
 */
import type { Message } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { staticLiteral, TYPE, type MessageFormatElement } from './icu.ts';
import type { KindRule, Severity } from './presets.ts';

/** What a rule is given about one source message. */
export interface RuleContext {
  message: Message;
  /** The shape the message's kind is held to, when it names a kind the config defines. */
  kind: KindRule | undefined;
  text: Readings;
  config: ResolvedConfig;
}

export interface Rule {
  /** One sentence: what the rule holds a string to. */
  description: string;
  /** Its severity under `extends: 'recommended'`; off when unset. */
  recommended?: Severity;
  /** Its severity under `extends: 'strict'`; `error` when unset. */
  strict?: Severity;
  /** Only entries of these kinds, or on these surfaces. An entry that says neither is skipped. */
  on?: { kind?: string[]; surface?: string[] };
  /** What is wrong with the message, a sentence each that states the fix; none when it passes. */
  check(context: RuleContext): string[];
}

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
  file: string;
  /** The rule's name, or `allow` for an exemption that is itself wrong. */
  rule: string;
  severity: Exclude<Severity, 'off'>;
  message: string;
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

function readings(message: Message): Readings {
  const literal = staticLiteral(message.ast);
  const ast = literal === undefined ? message.ast : ([{ type: TYPE.literal, value: literal }] as MessageFormatElement[]);
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

/** The words a budget counts: articles, short prepositions and asides in parentheses are free. */
export function words(text: string): string[] {
  return text
    .replace(/\s*\([^)]*\)/g, '')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w) || w.includes(HOLE))
    .filter((w) => !FREE.has(w.toLowerCase().replace(/[^\p{L}]/gu, '')));
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

function capitalizedWord(text: string, proper: Set<string>): string | undefined {
  const tokens = text.split(/\s+/).filter(Boolean);
  for (let i = 1; i < tokens.length; i++) {
    const word = tokens[i]!.replace(/^[("'“‘]+|[)"'”’.,:;!?]+$/g, '');
    if (!/^\p{Lu}\p{Ll}/u.test(word) || proper.has(word)) continue;
    if (/[.:?!]["')]*$/.test(tokens[i - 1]!)) continue;
    return word;
  }
  return undefined;
}

const CONTRACTIONS: [RegExp, string][] = [
  [/\bcannot\b/i, "can't"],
  [/\bcan not\b/i, "can't"],
  [/\bwill not\b/i, "won't"],
  [/\b(could|would|should|is|are|was|were|do|does|did|has|have|had|must|need) not\b/i, "n't"],
];

const OFF_SCREEN = new Set(['aria']);

const an = (word = 'string') => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;

export const CORE_RULES = {
  whitespace: {
    description: 'No leading, trailing or doubled spaces.',
    recommended: 'error',
    check: ({ text }) =>
      text.variants.some((v) => /^\s|\s$| {2}/.test(v.replaceAll(HOLE, 'x'))) ? ['no leading, trailing or doubled spaces'] : [],
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
      const word = capitalizedWord(text.primary, new Set(config.lint.properNouns));
      return word === undefined
        ? []
        : [`"${word}" is capitalized in a sentence-case ${m.kind}: add it to lint.properNouns if it is a name`];
    },
  },
  'banned-word': {
    description: 'A word or phrase from the banned lists.',
    recommended: 'warn',
    check: ({ text, config }) =>
      config.lint.banned.flatMap(({ words: list, why }) =>
        list.filter((w) => text.variants.some((v) => phrase(w).test(v))).map((w) => `"${w}" ${why}`),
      ),
  },
  spelling: {
    description: 'A spelling the product writes another way.',
    recommended: 'warn',
    check: ({ text, config }) =>
      Object.entries(config.lint.spelling)
        .filter(([wrong]) => text.variants.some((v) => phrase(wrong).test(v)))
        .map(([wrong, right]) => `"${wrong}" is spelled "${right}"`),
  },
  'one-word': {
    description: 'A near-synonym for a concept the product has one word for.',
    recommended: 'warn',
    check: ({ text, config }) =>
      Object.entries(config.lint.concepts)
        .filter(([word]) => text.variants.some((v) => phrase(word).test(v)))
        .map(([word, use]) => `"${word}" is "${use}" everywhere in the product`),
  },
  'no-em-dash': {
    description: 'No em-dashes, and no spaced hyphen standing in for one.',
    check: ({ text }) => (text.variants.some((v) => /—|\s[–-]\s/.test(v)) ? ['no em-dash: a comma, a period or a colon does the job'] : []),
  },
  contractions: {
    description: '`could not`, `is not` and `cannot` are written as contractions.',
    check: ({ text }) =>
      CONTRACTIONS.flatMap(([pattern, short]) => {
        const found = text.variants.map((v) => pattern.exec(v)).find((f) => f !== null);
        return found === undefined || found === null ? [] : [`"${found[0]}" is written as a contraction (${short})`];
      }),
  },
  ellipsis: {
    description: 'An ellipsis is one character, `…`, not three periods.',
    check: ({ text }) => (text.variants.some((v) => v.includes('...')) ? ['an ellipsis is one character: …'] : []),
  },
} satisfies Record<string, Rule>;

export type CoreRule = keyof typeof CORE_RULES;

/** A reason is a sentence a reviewer can check, not a shrug. */
function reasonProblem(why: string): string | undefined {
  if (why.split(/\s+/).length < 4) return 'is four words at least: say why the rule is wrong here';
  if (/^(?:intentional|needed|required|ok|fine|false positive|by design|legacy|todo)\b/i.test(why))
    return 'names the reason, not that there is one';
  return undefined;
}

function applies(rule: Rule, message: Message): boolean {
  if (rule.on === undefined) return true;
  const { kind, surface } = rule.on;
  return (
    (kind === undefined || (message.kind !== undefined && kind.includes(message.kind))) &&
    (surface === undefined || (message.surface !== undefined && surface.includes(message.surface)))
  );
}

export function lint(messages: Message[], config: ResolvedConfig): Finding[] {
  const findings: Finding[] = [];
  const rules = Object.entries(config.lint.rules);
  for (const message of messages) {
    const context: RuleContext = {
      message,
      kind: message.kind === undefined ? undefined : config.kinds[message.kind],
      text: readings(message),
      config,
    };
    const fired = new Set<string>();
    for (const [name, { rule, severity }] of rules) {
      if (severity === 'off' || !applies(rule, message)) continue;
      let said: string[];
      try {
        said = rule.check(context);
      } catch (cause) {
        throw new Error(`lint rule ${name} failed on ${message.key}: fix or turn off the rule`, { cause });
      }
      if (said.length === 0) continue;
      fired.add(name);
      if (message.allow.has(name)) continue;
      for (const s of said) findings.push({ key: message.key, file: message.file, rule: name, severity, message: s });
    }
    for (const [name, why] of message.allow) {
      const at = { key: message.key, file: message.file, rule: 'allow', severity: 'error' as const };
      const rule = config.lint.rules[name];
      if (rule === undefined) {
        findings.push({ ...at, message: `allow.${name} is not a rule: ${rules.map(([n]) => n).join(', ')}` });
      } else if (rule.severity === 'off') {
        continue;
      } else if (!fired.has(name)) {
        findings.push({ ...at, message: `allow.${name} exempts the entry from a rule it passes: remove it` });
      } else {
        const problem = reasonProblem(why);
        if (problem !== undefined) findings.push({ ...at, message: `allow.${name} ${problem}` });
      }
    }
  }
  return findings;
}
