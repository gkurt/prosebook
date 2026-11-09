import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createComponent, type JSX } from 'solid-js';
import h from 'solid-js/h';
import { render } from 'solid-js/web';

import type { DevHooks, HotHook } from 'prosebook';
import { CopyProvider, Text, useCopy, useLocale } from 'prosebook/solid';

import { copyOf, turning } from './fixture.ts';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

// `solid-js/h`, since Bun compiles JSX for React: each child given as a function stays reactive.
const link = (chunks: JSX.Element) => h('a', { href: '#t' }, chunks)() as JSX.Element;

test('what reads a message updates in place on a locale switch, and rich messages become elements', async () => {
  const copy = copyOf({
    en: { 'a.title': 'Cart', 'a.items': '{n, plural, one {# item} other {# items}}', 'a.terms': 'Read <link>the <b>terms</b></link>.' },
    de: { 'a.title': 'Warenkorb', 'a.terms': 'Lies <link>die <b>Bedingungen</b></link>.' },
  });
  let renders = 0;
  function View(): JSX.Element {
    renders++;
    // Untyped reads, as in the React test.
    const { t, rich } = useCopy() as unknown as { t: (key: string) => string; rich: (key: string, values: object) => JSX.Element };
    const locale = useLocale();
    return h(
      'div',
      { lang: locale },
      h('h1', () => t('a.title')),
      createComponent(Text, { id: 'a.items' as never, values: { n: 3 } as never }),
      h('p', () => rich('a.terms', { link })),
    ) as unknown as JSX.Element;
  }
  const host = document.createElement('div');
  const dispose = render(
    () =>
      createComponent(CopyProvider, {
        copy,
        tags: { b: (c) => h('strong', c)() as JSX.Element },
        get children() {
          return createComponent(View, {});
        },
      }),
    host,
  );
  expect(host.innerHTML).toBe('<div lang="en"><h1>Cart</h1>3 items<p>Read <a href="#t">the <strong>terms</strong></a>.</p></div>');
  await copy.setLocale('de');
  expect(host.innerHTML).toBe(
    '<div lang="de"><h1>Warenkorb</h1>3 items<p>Lies <a href="#t">die <strong>Bedingungen</strong></a>.</p></div>',
  );
  // Solid updates the text, never the component.
  expect(renders).toBe(1);
  dispose();
});

test('in dev, a catalog edit updates what reads it, keeping the locale', async () => {
  const hot = new Set<HotHook>();
  (globalThis as DevHooks).__PROSEBOOK_HOT__ = hot;
  const copy = copyOf({ en: { 'a.title': 'Cart' }, de: { 'a.title': 'Warenkorb' } });
  delete (globalThis as DevHooks).__PROSEBOOK_HOT__;
  await copy.setLocale('de');
  const host = document.createElement('div');
  const dispose = render(
    () =>
      createComponent(CopyProvider, {
        copy,
        // A getter, as Solid's compiler writes children, so they are made under the provider.
        get children() {
          return createComponent(Text, { id: 'a.title' as never, values: {} });
        },
      }),
    host,
  );
  expect(host.innerHTML).toBe('Warenkorb');
  for (const update of hot) update('de', { 'a.title': 'Dein Warenkorb' });
  expect(host.innerHTML).toBe('Dein Warenkorb');
  dispose();
});

test('a <Text> saying a relative time updates once it reads differently, and nothing else does', async () => {
  const { copy, at } = turning();
  let renders = 0;
  function View(): JSX.Element {
    renders++;
    return h('p', createComponent(Text, { id: 'a.opened' as never, values: { at } as never })) as unknown as JSX.Element;
  }
  const host = document.createElement('div');
  const dispose = render(
    () =>
      createComponent(CopyProvider, {
        copy,
        get children() {
          return createComponent(View, {});
        },
      }),
    host,
  );
  expect(host.innerHTML).toBe('<p>Opened now</p>');
  await Bun.sleep(150);
  expect(host.innerHTML).toBe('<p>Opened 1 minute ago</p>');
  expect(renders).toBe(1);
  dispose();
});
