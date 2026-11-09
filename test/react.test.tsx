import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { acceptedLocales, defineCatalog, type DevHooks, type HotHook } from 'prosebook';
import { CopyProvider, Text, useCopy } from 'prosebook/react';
import { createServerCopy } from 'prosebook/react/server';

import { parseMessage } from '#src/tools/icu.ts';

import { compiled, copyOf, turning } from './fixture.ts';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const link = (chunks: ReactNode) => <a href="#t">{chunks}</a>;

test('components re-render on a locale switch, and rich messages become keyed elements', async () => {
  const copy = copyOf({
    en: { 'a.title': 'Cart', 'a.items': '{n, plural, one {# item} other {# items}}', 'a.terms': 'Read <link>the <b>terms</b></link>.' },
    de: { 'a.title': 'Warenkorb', 'a.terms': 'Lies <link>die <b>Bedingungen</b></link>.' },
  });
  function View() {
    // Untyped reads: the example app's `Register` would otherwise type these keys for the whole program.
    const { t, rich } = useCopy() as unknown as { t: (key: string) => string; rich: (key: string, values: object) => ReactNode };
    return (
      <div>
        <h1>{t('a.title')}</h1>
        <Text id={'a.items' as never} values={{ n: 3 } as never} />
        <p>{rich('a.terms', { link })}</p>
      </div>
    );
  }
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CopyProvider copy={copy} tags={{ b: (c) => <strong>{c}</strong> }}>
        <View />
      </CopyProvider>,
    ),
  );
  expect(host.innerHTML).toBe('<div><h1>Cart</h1>3 items<p>Read <a href="#t">the <strong>terms</strong></a>.</p></div>');
  await act(() => copy.setLocale('de'));
  expect(host.innerHTML).toBe('<div><h1>Warenkorb</h1>3 items<p>Lies <a href="#t">die <strong>Bedingungen</strong></a>.</p></div>');
  await act(async () => root.unmount());
  console.error = original;
  // No missing-key warnings from React for the nested elements.
  expect(errors).toEqual([]);
});

test('in dev, a catalog edit re-renders what reads it, keeping the locale', async () => {
  const hot = new Set<HotHook>();
  (globalThis as DevHooks).__PROSEBOOK_HOT__ = hot;
  const copy = copyOf({ en: { 'a.title': 'Cart' }, de: { 'a.title': 'Warenkorb' } });
  delete (globalThis as DevHooks).__PROSEBOOK_HOT__;
  await copy.setLocale('de');
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CopyProvider copy={copy}>
        <Text id={'a.title' as never} values={{}} />
      </CopyProvider>,
    ),
  );
  expect(host.innerHTML).toBe('Warenkorb');
  await act(async () => {
    for (const update of hot) update('de', { 'a.title': 'Dein Warenkorb' });
  });
  expect(host.innerHTML).toBe('Dein Warenkorb');
  await act(async () => root.unmount());
});

test('a server copy asks for the locale, negotiates it, and comes back with its messages loaded', async () => {
  const catalog = defineCatalog({
    source: 'en',
    locales: ['en', 'de'],
    messages: { en: compiled([['a.b', parseMessage('Cart {n, number}')]]) },
    loaders: { de: async () => ({ default: compiled([['a.b', parseMessage('Warenkorb {n, number}')]]) }) },
  });
  const errors: string[] = [];
  const serverCopy = createServerCopy(catalog, async () => acceptedLocales('fr, de-AT;q=0.8, en;q=0.5'), {
    onError: (error) => errors.push(error.message),
  });
  const copy = await serverCopy();
  expect(copy.locale).toBe('de');
  expect([copy.t('a.b' as never, { n: 1234 } as never), copy.t('a.b' as never)]).toEqual(['Warenkorb 1.234', 'Warenkorb {n}']);
  expect(errors).toEqual(['{n} has no value']);
});

test('a server copy asks for its options per request too', async () => {
  const catalog = defineCatalog({
    source: 'en',
    locales: ['en'],
    messages: { en: compiled([['a.b', parseMessage('{d, date, ::yMMMd}')]]) },
    loaders: {},
  });
  const serverCopy = createServerCopy(
    catalog,
    () => 'en',
    async () => ({ timeZone: 'Asia/Tokyo' }),
  );
  const copy = await serverCopy();
  expect(copy.t('a.b' as never, { d: Date.UTC(2025, 11, 31, 23, 30) })).toBe('Jan 1, 2026');
});

test("useCopy()'s t keeps its identity while the provider re-renders, until the locale changes", async () => {
  const copy = copyOf({ en: { 'a.title': 'Cart' }, de: { 'a.title': 'Warenkorb' } });
  const seen: unknown[] = [];
  function View() {
    seen.push(useCopy().t);
    return null;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  const tree = (n: number) => (
    <CopyProvider copy={copy} key="p">
      <View key={0} />
      {n}
    </CopyProvider>
  );
  await act(async () => root.render(tree(1)));
  await act(async () => root.render(tree(2)));
  expect(seen.length).toBe(2);
  expect(seen[1]).toBe(seen[0]);
  await act(() => copy.setLocale('de'));
  expect(seen.at(-1)).not.toBe(seen[0]);
  await act(async () => root.unmount());
});

test('a <Text> saying a relative time renders itself again once it reads differently, and nothing else', async () => {
  const { copy, at } = turning();
  let renders = 0;
  function View() {
    renders++;
    return (
      <p>
        <Text id={'a.opened' as never} values={{ at } as never} />
      </p>
    );
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CopyProvider copy={copy}>
        <View />
      </CopyProvider>,
    ),
  );
  expect(host.innerHTML).toBe('<p>Opened now</p>');
  await act(() => Bun.sleep(150));
  expect(host.innerHTML).toBe('<p>Opened 1 minute ago</p>');
  expect(renders).toBe(1);
  await act(async () => root.unmount());
});
