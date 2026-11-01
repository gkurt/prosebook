/**
 * Prints a receipt in the locale named on the command line, or the one the environment prefers:
 * `node src/main.ts de 3`. No framework and no bundler: Node runs the generated TypeScript as it is.
 */
import { createCopy, preferredLocales } from 'prosebook';

import { catalog } from './copy/index.ts';

const PRICE = 4.5;
const [locale, items = '3'] = process.argv.slice(2);
const count = Number(items);

const copy = createCopy(catalog, { locale: locale ?? preferredLocales() });
await copy.ready;
const { t } = copy;

console.log(
  [
    t('receipt.title'),
    t('receipt.items', { count }),
    t('receipt.total', { amount: count * PRICE }),
    t('receipt.printed', { when: new Date() }),
    t('receipt.thanks'),
  ].join('\n'),
);
