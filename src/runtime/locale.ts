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

function languageOf(tag: string): string {
  return tag.split('-', 1)[0]!.toLowerCase();
}
