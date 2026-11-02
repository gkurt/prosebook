import { expect, test } from 'bun:test';

import { areaGroups } from '#src/tools/chunks.ts';
import { generate } from '#src/tools/generate.ts';
import { fixture } from './fixture.ts';

test('areas group as a bundler chunks the modules naming them, by the entries that load them', () => {
  const areas = ['app', 'nav', 'cart', 'checkout', 'help', 'account', 'promo', 'banner', 'orphan'];
  const config = fixture(
    {
      ...Object.fromEntries(areas.map((a) => [`copy/catalog/${a}.yaml`, `${a}.title: ${a}\n`])),
      'src/main.ts': [
        "t('app.title'); t('nav.title');",
        "export const cart = () => import('./cart.ts');",
        'export const account = () => import("./account.ts");',
        // Any module the template names, so none in particular.
        'export const page = (name: string) => import(`./pages/${name}.ts`);',
      ].join('\n'),
      // The shell's area, read in the route too, is in memory whenever the route loads.
      'src/cart.ts': "import { row } from './row.js';\nexport * from './summary';\nt('cart.title'); t('app.title'); row();",
      'src/row.ts': "export const row = () => t('checkout.title');",
      'src/summary/index.ts': "export const help = () => t('help.title');",
      // A type loads no code, and a test loads in no page.
      'src/account.ts': "import type { row } from './row.ts';\nt('account.title');",
      'src/row.test.ts': "import { row } from './row.ts';\nrow();",
    },
    { require: [] },
  );
  const groups = areaGroups(config, generate(config), ['promo.*', 'banner.*']);
  expect(Object.fromEntries(groups)).toEqual({
    app: 'app',
    nav: 'app',
    cart: 'cart',
    checkout: 'cart',
    help: 'cart',
    account: 'account',
    orphan: 'orphan',
    banner: 'banner',
    promo: 'banner',
  });
});
