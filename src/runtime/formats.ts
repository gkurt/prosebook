/**
 * Named formats: a number or date format the config names once (`price`, `receipt`), which a message
 * names in place of its options (`{total, number, price}`) and `copy.number(total, 'price')` names in
 * code, so every page shows the same thing the same way and one edit changes it everywhere.
 */

type OptionsOf = { number: Intl.NumberFormatOptions; date: Intl.DateTimeFormatOptions };

export interface FormatTable {
  readonly number?: { readonly [name: string]: Intl.NumberFormatOptions };
  readonly date?: { readonly [name: string]: Intl.DateTimeFormatOptions };
}

export interface Formats extends FormatTable {
  /**
   * A format as one locale or language shows it, in place of the one above: `{ de: { date: { receipt: … } } }`.
   * A locale takes its own, then its parents' (`de-AT`, then `de`).
   */
  readonly locales?: { readonly [locale: string]: FormatTable };
}

/** The options a named format has in `locale`, or nothing where no format has that name. */
export function formatIn<K extends keyof OptionsOf>(
  formats: Formats | undefined,
  kind: K,
  name: string,
  locale: string,
): OptionsOf[K] | undefined {
  if (formats === undefined) return undefined;
  for (let tag = locale; ; tag = tag.slice(0, tag.lastIndexOf('-'))) {
    const own = formats.locales?.[tag]?.[kind]?.[name];
    if (own !== undefined) return own;
    if (!tag.includes('-')) break;
  }
  return formats[kind]?.[name];
}
