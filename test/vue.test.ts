import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { VNode, VNodeChild } from 'vue';

import type { DevHooks, HotHook } from 'prosebook';

import { copyOf, turning } from './fixture.ts';

// Vue's renderer keeps the `document` it finds as it loads, so it loads once there is one.
GlobalRegistrator.register();
afterAll(() => GlobalRegistrator.unregister());
const { createApp, defineComponent, h, nextTick } = await import('vue');
const { copyPlugin, provideCopy, Text, useCopy, useLocale } = await import('prosebook/vue');

const link = (chunks: VNodeChild[]) => h('a', { href: '#t' }, chunks);

test('templates render again on a locale switch, and rich messages become vnodes, their tags from slots too', async () => {
  const copy = copyOf({
    en: { 'a.title': 'Cart', 'a.items': '{n, plural, one {# item} other {# items}}', 'a.terms': 'Read <link>the <b>terms</b></link>.' },
    de: { 'a.title': 'Warenkorb', 'a.terms': 'Lies <link>die <b>Bedingungen</b></link>.' },
  });
  const View = defineComponent(() => {
    // Untyped reads, as in the React test.
    const copy = useCopy() as unknown as { t: (key: string) => string; rich: (key: string, values: object) => VNode };
    const locale = useLocale();
    return () =>
      h('div', { lang: locale.value }, [
        h('h1', copy.t('a.title')),
        h(Text as never, { id: 'a.items', values: { n: 3 } }),
        h('p', copy.rich('a.terms', { link })),
        h('p', h(Text as never, { id: 'a.terms' }, { link: ({ chunks }: { chunks: VNode }) => h('em', [chunks]) })),
      ]);
  });
  const host = document.createElement('div');
  const app = createApp(View).use(copyPlugin(copy, { tags: { b: (c) => h('strong', c) } }));
  app.mount(host);
  expect(host.innerHTML).toBe(
    '<div lang="en"><h1>Cart</h1>3 items<p>Read <a href="#t">the <strong>terms</strong></a>.</p><p>Read <em>the <strong>terms</strong></em>.</p></div>',
  );
  await copy.setLocale('de');
  await nextTick();
  expect(host.innerHTML).toBe(
    '<div lang="de"><h1>Warenkorb</h1>3 items<p>Lies <a href="#t">die <strong>Bedingungen</strong></a>.</p><p>Lies <em>die <strong>Bedingungen</strong></em>.</p></div>',
  );
  app.unmount();
});

test('provideCopy scopes a copy to a subtree, and in dev a catalog edit renders again what reads it', async () => {
  const hot = new Set<HotHook>();
  (globalThis as DevHooks).__PROSEBOOK_HOT__ = hot;
  const copy = copyOf({ en: { 'a.title': 'Cart' }, de: { 'a.title': 'Warenkorb' } });
  delete (globalThis as DevHooks).__PROSEBOOK_HOT__;
  await copy.setLocale('de');
  const Root = defineComponent(() => {
    provideCopy(copy);
    return () => h(Text as never, { id: 'a.title' });
  });
  const host = document.createElement('div');
  const app = createApp(Root);
  app.mount(host);
  expect(host.innerHTML).toBe('Warenkorb');
  for (const update of hot) update('de', { 'a.title': 'Dein Warenkorb' });
  await nextTick();
  expect(host.innerHTML).toBe('Dein Warenkorb');
  app.unmount();
});

test('a <Text> saying a relative time renders again once it reads differently, and nothing else does', async () => {
  const { copy, at } = turning();
  let renders = 0;
  const View = defineComponent(() => () => {
    renders++;
    return h('p', h(Text as never, { id: 'a.opened', values: { at } }));
  });
  const host = document.createElement('div');
  const app = createApp(View).use(copyPlugin(copy));
  app.mount(host);
  expect(host.innerHTML).toBe('<p>Opened now</p>');
  await Bun.sleep(150);
  await nextTick();
  expect(host.innerHTML).toBe('<p>Opened 1 minute ago</p>');
  expect(renders).toBe(1);
  app.unmount();
});

test('a relative time read as text stays current, rendering again only the component that read it', async () => {
  const { copy, at } = turning();
  const renders = { line: 0, other: 0 };
  const Line = defineComponent(() => {
    const { t } = useCopy() as unknown as { t: (key: string, values: object) => string };
    return () => {
      renders.line++;
      const text = t('a.opened', { at });
      return h('span', { title: text }, text);
    };
  });
  const Other = defineComponent(() => {
    const copy = useCopy();
    return () => {
      renders.other++;
      return h('i', copy.locale === 'en' ? '' : copy.locale);
    };
  });
  const host = document.createElement('div');
  const app = createApp(defineComponent(() => () => [h(Line), h(Other)])).use(copyPlugin(copy));
  app.mount(host);
  expect(host.innerHTML).toBe('<span title="Opened now">Opened now</span><i></i>');
  await Bun.sleep(150);
  await nextTick();
  expect(host.innerHTML).toBe('<span title="Opened 1 minute ago">Opened 1 minute ago</span><i></i>');
  expect(renders).toEqual({ line: 2, other: 1 });
  app.unmount();
});
