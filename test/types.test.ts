/**
 * Type-level checks: `bun typecheck` fails if any `@ts-expect-error` here stops being an error, so a
 * loosened signature is caught. The test itself only confirms the file loads. Its tag is not `link`,
 * which the example app registers as a default tag for the whole program.
 */
import { expect, test } from 'bun:test';

import { createCopy, defineCatalog } from 'copydeck';

type Messages = {
  'a.plain': { args: {}; tags: never };
  'a.count': { args: { readonly n: number }; tags: never };
  'a.pick': { args: { readonly mode: 'dark' | 'light' | (string & {}) }; tags: never };
  'a.link': { args: {}; tags: 'anchor' };
};

const copy = createCopy(defineCatalog<Messages, 'en' | 'de'>({ source: 'en', locales: ['en', 'de'], messages: { en: {} }, loaders: {} }));

export function typed() {
  copy.t('a.plain');
  copy.t('a.count', { n: 1 });
  copy.t('a.pick', { mode: 'dark' });
  copy.t('a.pick', { mode: 'anything' });
  copy.t('a.link');
  copy.rich('a.link', { anchor: (chunks) => chunks.join('') });
  void copy.setLocale('de');

  // @ts-expect-error: no such key
  copy.t('a.nope');
  // @ts-expect-error: the argument is required
  copy.t('a.count');
  // @ts-expect-error: a count is a number, not text
  copy.t('a.count', { n: '1' });
  // @ts-expect-error: the tag's renderer is required in a rich read
  copy.rich('a.link');
  // @ts-expect-error: only messages with tags are read rich
  copy.rich('a.plain');
}

test('the type checks above compile', () => {
  expect(typeof typed).toBe('function');
});
