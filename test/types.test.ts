/**
 * Type-level checks: `bun typecheck` fails if any `@ts-expect-error` here stops being an error, so a
 * loosened signature is caught. The test itself only confirms the file loads. Its tag is not `link`,
 * which the example app registers as a default tag for the whole program.
 */
import { expect, test } from 'bun:test';

import { createCopy, defineCatalog, type MessageKey, type Translate } from 'prosebook';

// As the generated index registers the formats the config names.
declare module 'prosebook' {
  interface Register {
    formats: { number: 'price'; date: 'receipt' };
  }
}

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

  copy.number(9, 'price');
  copy.number(9, { style: 'percent' });
  copy.date(0, 'receipt');
  // @ts-expect-error: no number format has that name
  copy.number(9, 'receipt');
  // @ts-expect-error: no date format has that name
  copy.date(0, 'price');

  // A key held in a map, and a `t` handed to a function, check as they would at a read.
  const labels: Record<'on' | 'off', MessageKey<Messages>> = { on: 'a.plain', off: 'a.link' };
  // @ts-expect-error: not a key
  const wrong: MessageKey<Messages> = 'a.nope';
  const title = (t: Translate<Messages>) => t(labels.on) + t('a.count', { n: 2 });
  title(copy.t);
  // @ts-expect-error: the argument is required
  const untitled = (t: Translate<Messages>) => t('a.count');
  void [wrong, untitled];
}

test('the type checks above compile', () => {
  expect(typeof typed).toBe('function');
});
