/**
 * A locale in the URL's path: `/de/cart` beside `/cart`. `localeRoutes` reads the locale a URL names,
 * writes a URL in another locale, lists a page's alternates for `hreflang`, and says where a server
 * redirects a request to. It knows no framework: a middleware hands it the request's URL.
 */
import { negotiate } from './locale.ts';

export interface LocaleRoutesOptions<L extends string> {
  /** Every locale with pages, the source among them: `catalog.locales`. */
  locales: readonly L[];
  /** The locale a URL with no prefix is in, and the one `x-default` names. */
  source: L;
  /**
   * Which locales have a prefix. `as-needed`, the default: every locale but the source, whose pages
   * stay at `/cart`. `always`: the source too, `/en/cart`, and a URL with no prefix is redirected.
   */
  prefix?: 'as-needed' | 'always';
  /** The path the app is served under, `/docs`, which stays before the locale. */
  base?: string;
}

export interface LocaleRoutes<L extends string> {
  /**
   * The locale a URL is in and its path without the base and the prefix, which is what a router
   * matches. No locale where every locale takes a prefix and the URL has none.
   */
  split(url: string | URL): { locale: L | undefined; path: string };
  /** The same page in `locale`: the URL as given, a path or a whole URL, with that locale's prefix. */
  path(url: string | URL, locale: L): string;
  /** The page in every locale, and in the source as `x-default`, for `<link rel="alternate" hreflang>`. Give a whole URL: `hreflang` takes no path. */
  alternates(url: string | URL): { hreflang: string; href: string }[];
  /**
   * Where to send a request for `url`, or nothing where it is served as it is. A URL with no prefix
   * goes to the best of `requested` the app has, unless that one takes no prefix; a prefix written
   * in another case, or the source's where it takes none, goes to the URL as `path` writes it.
   */
  redirect(url: string | URL, requested?: string | readonly string[]): string | undefined;
}

// A URL's origin where it has one, its path, and the query and hash after it.
const PARTS = /^([a-z][a-z\d+.-]*:\/\/[^/?#]*)?([^?#]*)(.*)$/i;

export function localeRoutes<L extends string>(options: LocaleRoutesOptions<L>): LocaleRoutes<L> {
  const { locales, source, prefix = 'as-needed' } = options;
  const base = (options.base ?? '').replace(/\/+$/, '');

  // `tail` is the path after the prefix as written: empty for `/de`, so `/fr` is written back, not `/fr/`.
  const read = (url: string | URL) => {
    const [, origin = '', pathname = '', rest = ''] = PARTS.exec(String(url)) ?? [];
    const inside = base !== '' && (pathname === base || pathname.startsWith(`${base}/`)) ? pathname.slice(base.length) : pathname;
    const [, first = '', tail = ''] = /^\/([^/]*)(.*)$/.exec(inside) ?? [];
    const named = first === '' ? undefined : locales.find((l) => l.toLowerCase() === first.toLowerCase());
    return named === undefined ? { origin, rest, tail: inside } : { origin, rest, tail, named, written: first };
  };

  const path = (url: string | URL, locale: L) => {
    const { origin, rest, tail } = read(url);
    const lead = prefix === 'always' || locale !== source ? `/${locale}` : '';
    return `${origin}${base}${lead === '' ? tail || '/' : lead + tail}${rest}`;
  };

  return {
    split(url) {
      const { named, tail } = read(url);
      return { locale: named ?? (prefix === 'always' ? undefined : source), path: tail || '/' };
    },
    path,
    alternates(url) {
      return [
        ...locales.map((locale) => ({ hreflang: locale, href: path(url, locale) })),
        { hreflang: 'x-default', href: path(url, source) },
      ];
    },
    redirect(url, requested = []) {
      const { named, written } = read(url);
      if (named === undefined) {
        const wanted = negotiate(requested, locales, source);
        return prefix === 'always' || wanted !== source ? path(url, wanted) : undefined;
      }
      return written !== named || (prefix === 'as-needed' && named === source) ? path(url, named) : undefined;
    },
  };
}
