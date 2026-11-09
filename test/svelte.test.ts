import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { flushSync, mount, unmount } from 'svelte';

import type { DevHooks, HotHook } from 'prosebook';

import { copyOf, turning } from './fixture.ts';
import Line from './svelte/Line.svelte';
import Opened from './svelte/Opened.svelte';
import Shop from './svelte/Shop.svelte';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

/** The markup Svelte rendered, without the comments it anchors blocks with. */
const html = (host: Element) => host.innerHTML.replaceAll('<!---->', '').replaceAll(/<!--\[!?-->|<!--]-->/g, '');

test('markup runs again on a locale switch, and tags render through snippets, nested too', async () => {
  const hot = new Set<HotHook>();
  (globalThis as DevHooks).__PROSEBOOK_HOT__ = hot;
  const copy = copyOf({
    en: { 'a.title': 'Cart', 'a.items': '{n, plural, one {# item} other {# items}}', 'a.terms': 'Read <link>the <b>terms</b></link>.' },
    de: { 'a.title': 'Warenkorb', 'a.terms': 'Lies <link>die <b>Bedingungen</b></link>.' },
  });
  delete (globalThis as DevHooks).__PROSEBOOK_HOT__;
  const host = document.createElement('div');
  const app = mount(Shop, { target: host, props: { copy } });
  flushSync();
  expect(html(host)).toBe('<div lang="en"><h1>Cart</h1>3 items<p>Read <a href="#t">the <strong>terms</strong></a>.</p></div>');
  await copy.setLocale('de');
  flushSync();
  expect(html(host)).toBe('<div lang="de"><h1>Warenkorb</h1>3 items<p>Lies <a href="#t">die <strong>Bedingungen</strong></a>.</p></div>');
  // In dev, a catalog edit too.
  for (const update of hot) update('de', { 'a.title': 'Dein Warenkorb' });
  flushSync();
  expect(html(host)).toStartWith('<div lang="de"><h1>Dein Warenkorb</h1>');
  await unmount(app);
});

test('a <Text> saying a relative time renders again once it reads differently, and nothing else does', async () => {
  const { copy, at } = turning();
  let renders = 0;
  const host = document.createElement('div');
  const app = mount(Opened, { target: host, props: { copy, at, rendered: () => renders++ } });
  flushSync();
  expect(html(host)).toBe('<p>Opened now</p>');
  await Bun.sleep(150);
  flushSync();
  expect(html(host)).toBe('<p>Opened 1 minute ago</p>');
  expect(renders).toBe(1);
  await unmount(app);
});

test('a relative time read as text stays current, rendering again only what read it', async () => {
  const { copy, at } = turning();
  const renders = { line: 0, other: 0 };
  const host = document.createElement('div');
  const app = mount(Line, {
    target: host,
    props: { copy, at, line: () => renders.line++, other: () => renders.other++ },
  });
  flushSync();
  expect(html(host)).toBe('<span title="Opened now">Opened now</span><i></i>');
  await Bun.sleep(150);
  flushSync();
  expect(html(host)).toBe('<span title="Opened 1 minute ago">Opened 1 minute ago</span><i></i>');
  expect(renders).toEqual({ line: 2, other: 1 });
  await unmount(app);
});
