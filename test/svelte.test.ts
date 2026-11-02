import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { flushSync, mount, unmount } from 'svelte';

import type { DevHooks, HotHook } from 'prosebook';

import { copyOf } from './fixture.ts';
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
