/**
 * The writing guide `generate` writes for whoever writes the copy next, a person or an agent: the
 * kinds, the surfaces and the rules the lint holds them to, said as instructions before the writing
 * rather than as findings after it.
 *
 * Generated rather than written by hand, so it says what the config says: a rule that is off isn't
 * in it, a word added to a list is, and `generate --check` fails on a guide the config has moved past.
 */
import { relative } from 'node:path';

import type { ResolvedConfig } from './config.ts';
import type { CheckRule, CoreRule } from './lint.ts';
import type { KindRule } from './presets.ts';
import { SYNTAX_NAME } from './syntax.ts';

const code = (s: string) => `\`${s}\``;
// Not Intl.ListFormat, whose English has the serial comma this prose doesn't.
const list = (items: string[], joiner: 'and' | 'or' = 'and') =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${joiner} ${items.at(-1)}`;
const sentencesOf = (n: number) => `${n} sentence${n === 1 ? '' : 's'}`;

/** The examples a message rule gives, in the syntax the catalog is written in. */
const EXAMPLES = {
  plural: {
    1: ['{count, plural, one {# file} other {# files}}'],
    2: ['.input {$count :number}', '.match $count', 'one {{{$count} file}}', '*   {{{$count} files}}'],
  },
  count: { 1: '#', 2: '{$count}' },
  formatted: {
    1: ['{price, number, ::currency/EUR}', '{rate, number, percent}', '{n, number}'],
    2: ['{$price :currency currency=EUR}', '{$rate :percent}', '{$n :number}'],
  },
};

type Advice =
  /** A rule that holds a string to its kind: said as what each kind is held to. */
  | { under: 'kinds'; say: (kind: KindRule) => string | undefined }
  | { under: 'words' | 'messages'; say: (config: ResolvedConfig) => string[] };

/** What each core rule asks, as an instruction. Every rule has one, so a new rule can't be left out. */
const ADVICE: Record<CoreRule, Advice> = {
  'word-budget': { under: 'kinds', say: (k) => (k.maxWords === undefined ? undefined : `at most ${k.maxWords} words`) },
  'sentence-budget': {
    under: 'kinds',
    say: (k) => {
      const on = Object.entries(k.maxSentencesOn ?? {});
      if (k.maxSentences === undefined && on.length === 0) return undefined;
      const per = new Map<number, string[]>();
      for (const [surface, n] of on) per.set(n, [...(per.get(n) ?? []), surface]);
      const exceptions = [...per].map(([n, surfaces]) => `${sentencesOf(n)} on ${list(surfaces)}`);
      if (k.maxSentences === undefined) return `at most ${list(exceptions)}`;
      return `at most ${sentencesOf(k.maxSentences)}${exceptions.length > 0 ? ` (${list(exceptions)})` : ''}`;
    },
  },
  period: {
    under: 'kinds',
    say: (k) =>
      k.period === 'always' ? 'ends with a period' : Array.isArray(k.period) ? `ends with a period on ${list(k.period)}` : undefined,
  },
  'no-period': { under: 'kinds', say: (k) => (k.period === 'never' ? 'no period at the end' : undefined) },
  'bare-name': { under: 'kinds', say: (k) => (k.bare === true ? 'no explanation after a dash or a colon' : undefined) },
  'sentence-case': { under: 'kinds', say: (k) => (k.sentenceCase === true ? 'sentence case' : undefined) },
  whitespace: { under: 'words', say: () => ['No leading, trailing or doubled spaces.'] },
  'banned-word': {
    under: 'words',
    say: ({ lint }) =>
      lint.banned.length === 0
        ? []
        : [
            'Never write these, for the reason beside each:',
            ...lint.banned.map(({ words, why }) => `  - ${words.map(code).join(', ')}: ${why}.`),
          ],
  },
  spelling: {
    under: 'words',
    say: ({ lint }) => {
      const pairs = Object.entries(lint.spelling);
      return pairs.length === 0 ? [] : [`Spell ${list(pairs.map(([not, use]) => `${use} (not ${not})`))}.`];
    },
  },
  'one-word': {
    under: 'words',
    say: ({ lint }) => {
      const by = new Map<string, string[]>();
      for (const [not, use] of Object.entries(lint.concepts)) by.set(use, [...(by.get(use) ?? []), not]);
      return by.size === 0
        ? []
        : ['One word per concept:', ...[...by].map(([use, nots]) => `  - ${code(use)}, never ${list(nots.map(code), 'or')}.`)];
    },
  },
  contractions: { under: 'words', say: () => ["Write `could not`, `is not` and `cannot` as contractions: couldn't, isn't, can't."] },
  'no-em-dash': {
    under: 'words',
    say: () => ['No em-dashes, and no spaced hyphen standing in for one: a comma, a period or a colon does the job.'],
  },
  ellipsis: { under: 'words', say: () => ['An ellipsis is one character, …, not three periods.'] },
  path: {
    under: 'words',
    say: ({ lint: { pathSeparator: s } }) => [`A path through menus or settings is written with a spaced ${s}: Settings ${s} General.`],
  },
  'plural-count': {
    under: 'messages',
    say: ({ messageFormat: f }) => [
      `A count beside a noun is a plural, never \`{count} files\`, which reads "1 files":`,
      ...block(EXAMPLES.plural[f]),
    ],
  },
  'plural-one': {
    under: 'messages',
    say: ({ messageFormat: f }) => [
      `A plural's \`one\` arm writes ${code(EXAMPLES.count[f])}, not 1, since one is not only 1 in every language, and says something other than \`other\` does.`,
    ],
  },
  'arm-endings': { under: 'messages', say: () => ['The arms of a plural or select end alike: all with a stop, or all without one.'] },
  'formatted-by-hand': {
    under: 'messages',
    say: ({ messageFormat: f }) => [
      'Never type a currency symbol or `%` beside a placeholder, or group digits by hand (`10,000`): format the placeholder, which writes them as the locale does. A percent takes the fraction, 0.5 for 50%.',
      ...block(EXAMPLES.formatted[f]),
    ],
  },
  'source-ending': {
    under: 'messages',
    say: () => ["A translation ends with a stop where its source does, and without one where it doesn't."],
  },
};

/** Lines of code, as a block inside a list item. */
function block(lines: string[]): string[] {
  return ['', '  ```', ...lines.map((l) => `  ${l}`), '  ```', ''];
}

/** Which entries a plugin's rule reads, in words to lead its line: `On toast`. */
function scopeOf({ on }: CheckRule): string | undefined {
  if (on === undefined) return undefined;
  const parts = [
    on.kind && `for ${list(on.kind.map(code), 'or')}`,
    on.surface && `on ${list(on.surface.map(code), 'or')}`,
    on.area &&
      `in ${list(
        on.area.map((a) => code(`${a}.*`)),
        'or',
      )}`,
    on.locale === undefined ? undefined : on.locale === 'all' ? 'in every locale' : `in ${list(on.locale.map(code))}`,
  ].filter((p): p is string => typeof p === 'string');
  if (parts.length === 0) return undefined;
  const scope = parts.join(', ');
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

function languageOf(locale: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}

/** The guide, as Markdown. */
export function writingGuide(config: ResolvedConfig): string {
  const rules = config.lint.rules;
  const isOn = (name: string) => rules[name] !== undefined && rules[name].severity !== 'off';
  const said = (under: 'words' | 'messages') =>
    Object.entries(ADVICE).flatMap(([name, advice]) =>
      advice.under === under && isOn(name) ? advice.say(config).map((line, i) => (i === 0 ? `- ${line}` : line)) : [],
    );
  const catalog = relative(config.root, config.catalog).replaceAll('\\', '/') || '.';
  const required = new Set<string>(config.require);
  const field = (name: string, what: string, needed = required.has(name)) => `- ${code(name)}${needed ? ' (required)' : ''}: ${what}`;

  const out = [
    '<!-- Generated by `prosebook generate` from the config and the lint rules it turns on. Do not edit: change the config. -->',
    '',
    '# Writing the copy',
    '',
    'How this project writes the text of its interface. Read it before adding or changing an entry in the catalog: `prosebook lint` checks what can be checked, after the fact, and this says it before.',
    '',
    '## Where it goes',
    '',
    `Every string a person reads is an entry in the catalog, \`${catalog}/<area>.yaml\`, written in ${languageOf(config.source)}. A key's first segment names its file: \`cart.items\` lives in \`cart.yaml\`. Code reads the entry by its key; text a person reads is never a literal in the code.`,
    '',
    'An entry says about itself:',
    '',
    field(config.source, `the message, in ${SYNTAX_NAME[config.messageFormat]}.`, true),
    field('context', 'one sentence telling a translator where the string appears and what it answers to.'),
    field(
      'args',
      `what each placeholder holds, one line each${required.has('context') ? ', for every placeholder' : ''}.`,
      required.has('context'),
    ),
    field('kind', 'what sort of string it is, below.'),
    field('surface', 'where it sits, below.'),
    field('fragment', '`true` where it completes something beside it, so the sentence rules leave it alone.', false),
  ];

  const kindRules = Object.entries(ADVICE).flatMap(([name, a]) => (a.under === 'kinds' && isOn(name) ? [a] : []));
  out.push('', '## Kinds', '');
  for (const [name, kind] of Object.entries(config.kinds)) {
    const held = kindRules.flatMap((a) => a.say(kind) ?? []);
    out.push(`- ${code(name)}: ${kind.doc}${held.length > 0 ? ` Held to: ${held.join('; ')}.` : ''}`);
  }
  const notes = [
    isOn('word-budget') && "Articles, short prepositions and asides in parentheses don't count as words.",
    isOn('sentence-case') &&
      config.lint.properNouns.length > 0 &&
      `In sentence case, these keep their capitals: ${list(config.lint.properNouns.map(code))}.`,
  ].filter((n): n is string => typeof n === 'string');
  if (notes.length > 0) out.push('', ...notes);

  out.push('', '## Surfaces', '');
  for (const [name, doc] of Object.entries(config.surfaces)) out.push(`- ${code(name)}: ${doc}`);

  const words = said('words');
  if (words.length > 0) out.push('', '## Words', '', ...words);
  const messages = said('messages');
  if (messages.length > 0) out.push('', '## Messages', '', ...messages);

  const house = Object.entries(rules).filter(([name, { severity }]) => name.includes('/') && severity !== 'off');
  if (house.length > 0) {
    out.push('', '## House rules', '');
    for (const [, { rule }] of house) {
      const scope = scopeOf(rule);
      out.push(`- ${scope === undefined ? '' : `${scope}: `}${rule.description}`);
    }
  }

  const areas = Object.entries(config.lint.areas);
  if (areas.length > 0) {
    out.push('', '## Areas', '', 'Where an area sets a rule apart from the rest:', '');
    for (const [area, set] of areas)
      out.push(`- ${code(`${area}.*`)}: ${list(Object.entries(set).map(([rule, severity]) => `${code(rule)} is ${severity}`))}.`);
  }

  out.push(
    '',
    '## Before you finish',
    '',
    '- Run `prosebook lint` and fix what it finds; `prosebook lint --fix` writes the fixes it offers. Where a rule is wrong about an entry, exempt the entry under `allow` with the reason, a sentence a reviewer can check.',
    '- `comment` and `remove` on an entry are requests from whoever looked at it last: make the change, then delete the field.',
    '- A new or changed source leaves its translations missing or stale: `prosebook todo <locale>` lists them.',
    '- `prosebook check` runs it all, as CI does.',
    '',
  );
  return out.join('\n');
}
