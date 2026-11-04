/**
 * `prosebook todo`: a locale's missing and stale entries, each with what a translator needs above it,
 * as the YAML to fill in. `prosebook import` reads it back filled.
 *
 * With `prompt`, it leads with what a model must be told to reply in that form. prosebook writes the
 * prompt and checks the reply; which model answers it, and how, is left to whoever runs it.
 */
import { stringify } from 'yaml';

import { heldAs, type Catalog, type Message } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { TYPE, walk } from './icu.ts';
import { applies, severityOf } from './lint.ts';
import { changeOf, type StaleTranslation } from './lock.ts';
import { SYNTAX_NAME } from './syntax.ts';

export interface Todo {
  /** How many entries want a translation. */
  count: number;
  /** The entries as YAML, by area, with the prompt first when one was asked for. */
  text: string;
}

export function todoOf(
  config: ResolvedConfig,
  catalog: Catalog,
  stale: ReadonlyMap<string, StaleTranslation>,
  locale: string,
  prompt = false,
): Todo {
  const wanted = todoMessages(catalog, stale, locale);
  if (wanted.length === 0) return { count: 0, text: `# ${locale} is complete` };
  const byArea = new Map<string, string[]>();
  for (const m of wanted) {
    const lines = byArea.get(m.area) ?? [];
    lines.push('');
    if (m.context) lines.push(`# ${m.context}`);
    const what = [m.kind && `kind: ${m.kind}`, m.surface && `surface: ${m.surface}`].filter(Boolean).join(', ');
    if (what) lines.push(`# ${what}`);
    for (const [arg, said] of m.argDocs) lines.push(`#   ${heldAs(m, arg)}: ${said}`);
    lines.push(`# ${config.source}: ${m.text.replaceAll('\n', ' ')}`);
    const change = stale.get(m.key);
    if (change !== undefined) lines.push(`# stale, the source changed: ${changeOf(change)}`);
    lines.push(stringify({ [m.key]: m.translations.get(locale)?.text ?? '' }, { lineWidth: 0 }).trimEnd());
    byArea.set(m.area, lines);
  }
  const entries = [...byArea].map(([area, lines]) => `\n# ── ${area}.yaml ──\n${lines.join('\n')}`).join('\n');
  const count = wanted.length;
  if (prompt) {
    const head = promptFor(
      config,
      wanted,
      locale,
      wanted.some((m) => stale.has(m.key)),
    );
    return { count, text: `${head}\n${entries.trimStart()}\n\`\`\`` };
  }
  const head = `# prosebook todo: ${count} entr${count === 1 ? 'y' : 'ies'} for ${locale}. Fill them in, then \`prosebook import ${locale} <this file>\`.`;
  return { count, text: `${head}\n${entries}` };
}

/** The entries a locale wants a translation of: those it lacks, and those gone stale. */
export function todoMessages(catalog: Catalog, stale: ReadonlyMap<string, StaleTranslation>, locale: string): Message[] {
  return catalog.messages.filter((m) => !m.translations.has(locale) || stale.has(m.key));
}

function promptFor(config: ResolvedConfig, wanted: Message[], locale: string, anyStale: boolean): string {
  const mf2 = config.messageFormat === 2;
  const [target, source] = [nameOf(locale), nameOf(config.source)];
  const plurals = { cardinal: false, ordinal: false };
  for (const m of wanted) {
    walk(m.ast, (el) => {
      if (el.type === TYPE.plural) plurals[el.pluralType === 'ordinal' ? 'ordinal' : 'cardinal'] = true;
    });
  }
  const categories = (type: Intl.PluralRuleType) => {
    const forms = new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories;
    return forms.length === 1 ? `only the form ${forms[0]}` : `the forms ${new Intl.ListFormat('en').format(forms)}`;
  };
  const exact = mf2 ? '`0`' : '`=0`';

  const rules = [
    mf2
      ? `Each message is in MessageFormat 2. Keep every {$placeholder}, every markup tag ({#b}…{/b}) around the same words, and every .input, .local and .match line; translate the text, not the names.`
      : `Each message is in ICU MessageFormat. Keep every {placeholder}, and every <tag> around the same words; translate the text inside plural and select arms, not the arm or argument names.`,
    plurals.cardinal &&
      `A plural in ${target} takes ${categories('cardinal')}: give each its own ${mf2 ? 'variant' : 'arm'}, and keep exact ones such as ${exact} where the ${source} has them.`,
    plurals.ordinal && `An ordinal in ${target} takes ${categories('ordinal')}.`,
    'The comments above an entry say where it appears, what kind of string it is, and what each placeholder holds. Hold each to its kind, as described below: a button stays as short as the source.',
    anyStale &&
      'An entry marked stale has a translation made from an earlier source. The diff shows what changed in the source ({+added+}, [-removed-]): change the translation only as much as that needs, and give it back unchanged if it still holds.',
    'Quote a value in single quotes when it starts with { or holds ": ", as YAML needs, and double any single quote inside it.',
  ].filter((r): r is string => typeof r === 'string');

  const kinds = new Set(wanted.flatMap((m) => (m.kind === undefined ? [] : [m.kind])));
  const surfaces = new Set(wanted.flatMap((m) => (m.surface === undefined ? [] : [m.surface])));
  // The guide's rules that read this locale, as the lint would: only those some entry here answers to.
  const guidelines = Object.entries(config.lint.rules).flatMap(([name, { rule }]) =>
    rule.guide === true && wanted.some((m) => applies(rule, m, locale, config.source) && severityOf(config, name, m) !== 'off')
      ? [rule.description]
      : [],
  );
  const legend = [
    ...(kinds.size > 0 ? ['', 'Kinds of string:'] : []),
    ...[...kinds].map((k) => `- ${k}: ${config.kinds[k]?.doc ?? ''}`),
    ...(surfaces.size > 0 ? ['', 'Surfaces:'] : []),
    ...[...surfaces].map((s) => `- ${s}: ${config.surfaces[s] ?? ''}`),
    ...(guidelines.length > 0 ? ['', 'Guidelines:', ...guidelines.map((g) => `- ${g}`)] : []),
  ];

  return [
    `Translate the entries below from ${source} (${config.source}) into ${target} (${locale}). They are the text of an app's interface.`,
    '',
    'Reply with one YAML code block holding every key below, each with its translation as the value, and nothing else in the block.',
    '',
    ...rules.map((r) => `- ${r}`),
    ...legend,
    '',
    `The entries, in ${SYNTAX_NAME[config.messageFormat]}:`,
    '',
    '```yaml',
  ].join('\n');
}

function nameOf(locale: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}
