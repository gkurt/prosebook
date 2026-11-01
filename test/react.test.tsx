import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import type { DevHooks, HotHook } from 'prosebook';
import { CopyProvider, Text, useCopy } from 'prosebook/react';

import { copyOf } from './fixture.ts';

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
