/**
 * CLDR's plural rules, read into conditions a native target writes as code. Swift, the JVM and Rust
 * have no plural rules of their own that every platform carries, so each generated file brings the
 * rules of the locales it formats, from the same CLDR data `Intl.PluralRules` is built on.
 */
import ordinals from 'cldr-core/supplemental/ordinals.json' with { type: 'json' };
import cardinals from 'cldr-core/supplemental/plurals.json' with { type: 'json' };

/** CLDR's operands: `n` the absolute value, `i` its integer digits, `v`/`w` the count of fraction digits with and without trailing zeros, `f`/`t` those digits, `c`/`e` the compact exponent. */
export type Operand = 'n' | 'i' | 'v' | 'w' | 'f' | 't' | 'c' | 'e';

/** `i % 10 = 2..4, 7`: the operand, less its modulus, in (or with `negated`, not in) the ranges. A single value is a range of one. */
export interface Relation {
  operand: Operand;
  mod?: number;
  negated: boolean;
  ranges: (readonly [number, number])[];
}

/** Relations joined by `and`, those joined by `or`. */
export type Condition = Relation[][];

/** A locale's categories in CLDR's order, each with its condition. `other` holds wherever none does, so it has none. */
export type PluralRules = (readonly [category: string, Condition])[];

export type Operands = Record<Operand, number>;

type RuleData = Record<string, Record<string, string>>;

const DATA = {
  cardinal: cardinals.supplemental['plurals-type-cardinal'] as RuleData,
  ordinal: ordinals.supplemental['plurals-type-ordinal'] as RuleData,
};

/**
 * The rules for `locale`, found as `Intl.PluralRules` finds its locale, then by its parents
 * (`pt-PT`, then `pt`), so the generated code picks the category the browser would.
 */
export function pluralRules(locale: string, type: 'cardinal' | 'ordinal'): PluralRules {
  const data = DATA[type];
  let tag = new Intl.PluralRules(locale, { type }).resolvedOptions().locale;
  while (!(tag in data) && tag.includes('-')) tag = tag.slice(0, tag.lastIndexOf('-'));
  const rules = data[tag] ?? data['root'] ?? {};
  return Object.entries(rules).flatMap(([name, rule]) => {
    const category = name.slice('pluralRule-count-'.length);
    return category === 'other' ? [] : [[category, parseCondition(rule.split('@', 1)[0]!)] as const];
  });
}

/** `v = 0 and i % 10 = 1 or n = 0..1`, its samples already cut. */
export function parseCondition(source: string): Condition {
  return source
    .trim()
    .split(/\s+or\s+/)
    .map((and) => and.split(/\s+and\s+/).map(parseRelation));
}

function parseRelation(source: string): Relation {
  const match = /^([nivwftce])\s*(?:%\s*(\d+))?\s*(!?=)\s*(.+)$/.exec(source.trim());
  if (match === null) throw new Error(`prosebook: a CLDR plural rule it can't read: "${source}"`);
  const [, operand, mod, op, list] = match;
  return {
    operand: operand as Operand,
    ...(mod !== undefined && { mod: Number(mod) }),
    negated: op === '!=',
    ranges: list!.split(',').map((range) => {
      const [from, to = from] = range.trim().split('..');
      return [Number(from), Number(to)] as const;
    }),
  };
}

/** A range of one is an equality; a wider range holds integers only, as CLDR's `in` does. */
export function inRange(value: number, [from, to]: readonly [number, number]): boolean {
  return from === to ? value === from : Number.isInteger(value) && value >= from && value <= to;
}

function holds(relation: Relation, operands: Operands): boolean {
  const raw = operands[relation.operand];
  const value = relation.mod === undefined ? raw : raw % relation.mod;
  return relation.ranges.some((range) => inRange(value, range)) !== relation.negated;
}

/** The category `rules` give, as the generated code picks it. */
export function categoryOf(rules: PluralRules, operands: Operands): string {
  for (const [category, condition] of rules) if (condition.some((and) => and.every((r) => holds(r, operands)))) return category;
  return 'other';
}

/** The operands of a number written with `int` and `frac` digits, as CLDR reads them. */
export function operandsOf(int: string, frac: string): Operands {
  const trimmed = frac.replace(/0+$/, '');
  return {
    n: Number(`${int}.${frac || '0'}`),
    i: Number(int),
    v: frac.length,
    w: trimmed.length,
    f: Number(frac || '0'),
    t: Number(trimmed || '0'),
    c: 0,
    e: 0,
  };
}
