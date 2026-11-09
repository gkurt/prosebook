import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { h, render, type ComponentChildren } from 'preact';
import { act } from 'preact/test-utils';

import type { DevHooks, HotHook } from 'prosebook';
import { CopyProvider, Text, useCopy, useLocale } from 'prosebook/preact';

import { copyOf, turning } from './fixture.ts';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const link = (chunks: ComponentChildren) => h('a', { href: '#t' }, chunks);

test('components render again on a locale switch, and rich messages become elements', async () => {
  const copy = copyOf({
    en: { 'a.title': 'Cart', 'a.items': '{n, plural, one {# item} other {# items}}', 'a.terms': 'Read <link>the <b>terms</b></link>.' },
    de: { 'a.title': 'Warenkorb', 'a.terms': 'Lies <link>die <b>Bedingungen</b></link>.' },
  });
  function View() {
    // Untyped reads, as in the React test.
    const { t, rich } = useCopy() as unknown as { t: (key: string) => string; rich: (key: string, values: object) => ComponentChildren };
    return h(
      'div',
      { lang: useLocale() },
      h('h1', null, t('a.title')),
      h(Text, { id: 'a.items' as never, values: { n: 3 } as never }),
      h('p', null, rich('a.terms', { link })),
    );
  }
  const host = document.createElement('div');
  await act(() => render(h(CopyProvider, { copy, tags: { b: (c) => h('strong', null, c) } }, h(View, null)), host));
  expect(host.innerHTML).toBe('<div lang="en"><h1>Cart</h1>3 items<p>Read <a href="#t">the <strong>terms</strong></a>.</p></div>');
  await act(() => copy.setLocale('de'));
  expect(host.innerHTML).toBe(
    '<div lang="de"><h1>Warenkorb</h1>3 items<p>Lies <a href="#t">die <strong>Bedingungen</strong></a>.</p></div>',
  );
  await act(() => render(null, host));
});

test('in dev, a catalog edit renders again what reads it, keeping the locale', async () => {
  const hot = new Set<HotHook>();
  (globalThis as DevHooks).__PROSEBOOK_HOT__ = hot;
  const copy = copyOf({ en: { 'a.title': 'Cart' }, de: { 'a.title': 'Warenkorb' } });
  delete (globalThis as DevHooks).__PROSEBOOK_HOT__;
  await copy.setLocale('de');
  const host = document.createElement('div');
  await act(() => render(h(CopyProvider, { copy }, h(Text, { id: 'a.title' as never, values: {} })), host));
  expect(host.innerHTML).toBe('Warenkorb');
  await act(() => {
    for (const update of hot) update('de', { 'a.title': 'Dein Warenkorb' });
  });
  expect(host.innerHTML).toBe('Dein Warenkorb');
  await act(() => render(null, host));
});

test("useCopy()'s t keeps its identity while the provider renders again, until the locale changes", async () => {
  const copy = copyOf({ en: { 'a.title': 'Cart' }, de: { 'a.title': 'Warenkorb' } });
  const seen: unknown[] = [];
  function View() {
    seen.push(useCopy().t);
    return null;
  }
  const host = document.createElement('div');
  const tree = (n: number) => h(CopyProvider, { copy }, h(View, null), String(n));
  await act(() => render(tree(1), host));
  await act(() => render(tree(2), host));
  expect(seen.length).toBe(2);
  expect(seen[1]).toBe(seen[0]);
  await act(() => copy.setLocale('de'));
  expect(seen.at(-1)).not.toBe(seen[0]);
  await act(() => render(null, host));
});

test('a <Text> saying a relative time renders itself again once it reads differently, and nothing else', async () => {
  const { copy, at } = turning();
  let renders = 0;
  function View() {
    renders++;
    return h('p', null, h(Text, { id: 'a.opened' as never, values: { at } as never }));
  }
  const host = document.createElement('div');
  await act(() => render(h(CopyProvider, { copy }, h(View, null)), host));
  expect(host.innerHTML).toBe('<p>Opened now</p>');
  await act(() => Bun.sleep(150));
  expect(host.innerHTML).toBe('<p>Opened 1 minute ago</p>');
  expect(renders).toBe(1);
  await act(() => render(null, host));
});

test('a relative time read as text stays current, rendering again only the component that read it', async () => {
  const { copy, at } = turning();
  let lineRenders = 0;
  let otherRenders = 0;
  function Line() {
    lineRenders++;
    const text = useCopy().t('a.opened' as never, { at });
    return h('span', { title: text }, text);
  }
  function Other() {
    otherRenders++;
    useCopy();
    return h('i', null);
  }
  const host = document.createElement('div');
  await act(() => render(h(CopyProvider, { copy }, h(Line, null), h(Other, null)), host));
  expect(host.innerHTML).toBe('<span title="Opened now">Opened now</span><i></i>');
  await act(() => Bun.sleep(150));
  expect(host.innerHTML).toBe('<span title="Opened 1 minute ago">Opened 1 minute ago</span><i></i>');
  expect([lineRenders, otherRenders]).toEqual([2, 1]);
  await act(() => render(null, host));
});
