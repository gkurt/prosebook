import { describe, expect, test } from 'bun:test';

import { acceptedLocales, localeRoutes } from '#src/index.ts';

const locales = ['en', 'de', 'pt-BR'] as const;

describe('localeRoutes', () => {
  const routes = localeRoutes({ locales, source: 'en' });

  test('a URL names its locale in its first segment, in any case, and the source with none', () => {
    expect(routes.split('/de/cart')).toEqual({ locale: 'de', path: '/cart' });
    expect(routes.split('/PT-br/cart?x=1#top')).toEqual({ locale: 'pt-BR', path: '/cart' });
    expect(routes.split('/cart')).toEqual({ locale: 'en', path: '/cart' });
    expect(routes.split('/de')).toEqual({ locale: 'de', path: '/' });
    expect(routes.split('/design')).toEqual({ locale: 'en', path: '/design' });
    expect(routes.split(new URL('https://shop.example/de/cart'))).toEqual({ locale: 'de', path: '/cart' });
  });

  test('a page is written in another locale, its origin, query and hash kept', () => {
    expect(routes.path('/cart', 'de')).toBe('/de/cart');
    expect(routes.path('/de/cart?x=1#top', 'pt-BR')).toBe('/pt-BR/cart?x=1#top');
    expect(routes.path('/de/cart', 'en')).toBe('/cart');
    expect(routes.path('/', 'de')).toBe('/de/');
    expect(routes.path('/de', 'pt-BR')).toBe('/pt-BR');
    expect(routes.path('/de', 'en')).toBe('/');
    expect(routes.path('https://shop.example/cart?x=1', 'de')).toBe('https://shop.example/de/cart?x=1');
  });

  test('alternates are the page in every locale, and the source as x-default', () => {
    expect(routes.alternates('https://shop.example/de/cart')).toEqual([
      { hreflang: 'en', href: 'https://shop.example/cart' },
      { hreflang: 'de', href: 'https://shop.example/de/cart' },
      { hreflang: 'pt-BR', href: 'https://shop.example/pt-BR/cart' },
      { hreflang: 'x-default', href: 'https://shop.example/cart' },
    ]);
  });

  test('a request with no prefix goes to the locale asked for, unless that is the source', () => {
    expect(routes.redirect('/cart', acceptedLocales('de-AT, en;q=0.5'))).toBe('/de/cart');
    expect(routes.redirect('/cart', ['en', 'de'])).toBeUndefined();
    expect(routes.redirect('/cart', 'fr')).toBeUndefined();
    expect(routes.redirect('/cart')).toBeUndefined();
  });

  test('a prefix is served as written, redirected only to its own spelling or off the source', () => {
    expect(routes.redirect('/de/cart', 'pt-BR')).toBeUndefined();
    expect(routes.redirect('/DE/cart')).toBe('/de/cart');
    expect(routes.redirect('/en/cart?x=1')).toBe('/cart?x=1');
  });

  test('with a prefix always, the source has one and a URL with none is redirected', () => {
    const always = localeRoutes({ locales, source: 'en', prefix: 'always' });
    expect(always.split('/cart')).toEqual({ locale: undefined, path: '/cart' });
    expect(always.path('/cart', 'en')).toBe('/en/cart');
    expect(always.redirect('/cart', 'fr')).toBe('/en/cart');
    expect(always.redirect('/', 'de')).toBe('/de/');
    expect(always.redirect('/en/cart')).toBeUndefined();
    expect(always.alternates('/cart').at(-1)).toEqual({ hreflang: 'x-default', href: '/en/cart' });
  });

  test('a base stays before the locale', () => {
    const under = localeRoutes({ locales, source: 'en', base: '/docs/' });
    expect(under.split('/docs/de/cart')).toEqual({ locale: 'de', path: '/cart' });
    expect(under.split('/docs')).toEqual({ locale: 'en', path: '/' });
    expect(under.path('/docs/cart', 'de')).toBe('/docs/de/cart');
    expect(under.path('/docs/de/cart', 'en')).toBe('/docs/cart');
    expect(under.redirect('/docs/', 'de')).toBe('/docs/de/');
  });
});
