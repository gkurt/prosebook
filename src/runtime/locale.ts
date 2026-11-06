/**
 * Picks the best available locale for what was asked, in the order it was asked.
 *
 * Each requested tag tries an exact match, then its parents (`pt-BR` finds `pt`), then any locale
 * of the same language (`pt` finds `pt-BR`). Matching ignores case, as BCP 47 does.
 */
export function negotiate<L extends string>(requested: string | readonly string[], available: readonly L[], fallback: L): L {
  const find = (tag: string) => available.find((a) => a.toLowerCase() === tag.toLowerCase());
  for (const want of typeof requested === 'string' ? [requested] : requested) {
    let tag = want;
    for (;;) {
      const found = find(tag);
      if (found !== undefined) return found;
      const cut = tag.lastIndexOf('-');
      if (cut < 0) break;
      tag = tag.slice(0, cut);
    }
    const language = languageOf(want);
    const sibling = available.find((a) => languageOf(a) === language);
    if (sibling !== undefined) return sibling;
  }
  return fallback;
}

/** The locales a message is looked up in, in order: the locale, its available parents, then the source. */
export function chainOf<L extends string>(locale: L, available: readonly L[], source: L): L[] {
  const chain: L[] = [locale];
  let tag: string = locale;
  while (tag.includes('-')) {
    tag = tag.slice(0, tag.lastIndexOf('-'));
    const parent = available.find((a) => a.toLowerCase() === tag.toLowerCase());
    if (parent !== undefined && !chain.includes(parent)) chain.push(parent);
  }
  if (!chain.includes(source)) chain.push(source);
  return chain;
}

/** The locales the browser or the environment asks for, most preferred first. */
export function preferredLocales(): string[] {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  if (nav?.languages && nav.languages.length > 0) return [...nav.languages];
  if (nav?.language) return [nav.language];
  const resolved = Intl.DateTimeFormat().resolvedOptions().locale;
  return resolved ? [resolved] : [];
}

/**
 * The locales an `Accept-Language` header asks for, most preferred first: ordered by `q`, ties in
 * the header's order. `q=0` means "not this one", and `*` asks for nothing `negotiate`'s fallback
 * doesn't already give, so both are left out, as is a part whose `q` isn't a number.
 */
export function acceptedLocales(header: string | null | undefined): string[] {
  const weighed: { tag: string; q: number }[] = [];
  for (const part of (header ?? '').split(',')) {
    const [tag = '', ...params] = part.split(';').map((s) => s.trim());
    if (tag === '' || tag === '*') continue;
    const weight = params.find((p) => /^q\s*=/i.test(p));
    const q = weight === undefined ? 1 : Number(weight.slice(weight.indexOf('=') + 1).trim());
    if (Number.isNaN(q) || q <= 0) continue;
    weighed.push({ tag, q });
  }
  // Array.prototype.sort is stable, so equal weights keep the header's order.
  return weighed.sort((a, b) => b.q - a.q).map((w) => w.tag);
}

// The scripts written right to left, and the languages written in one where a tag names no script.
const RTL_SCRIPTS = new Set(['adlm', 'arab', 'hebr', 'mand', 'mend', 'nkoo', 'rohg', 'samr', 'syrc', 'thaa', 'yezi']);
const RTL_LANGUAGES = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'iw', 'ks', 'nqo', 'ps', 'sd', 'syr', 'ug', 'ur', 'yi']);

/**
 * The direction a locale's text runs in, for `<html dir>`: from its script, or its language's usual
 * one (`ur`, `pa-PK`). Without `Intl.Locale` (Hermes), from the tag alone.
 */
export function dirOf(locale: string): 'ltr' | 'rtl' {
  let tag = locale;
  try {
    tag = new Intl.Locale(locale).maximize().toString();
  } catch {
    // An invalid tag, or no `Intl.Locale`: the tag as given.
  }
  const script = tag.split('-').find((part, i) => i > 0 && part.length === 4);
  return (script === undefined ? RTL_LANGUAGES.has(languageOf(tag)) : RTL_SCRIPTS.has(script.toLowerCase())) ? 'rtl' : 'ltr';
}

function languageOf(tag: string): string {
  return tag.split('-', 1)[0]!.toLowerCase();
}
