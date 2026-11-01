import { createCopy } from 'prosebook';

import { catalog } from './copy/index.ts';
import index from './index.html';

/** The locales a request asks for, most preferred first. */
const requested = (req: Request) =>
  (req.headers.get('accept-language') ?? '')
    .split(',')
    .map((part) => part.split(';', 1)[0]!.trim())
    .filter((tag) => tag !== '');

const dev = process.env.NODE_ENV !== 'production';

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    // In dev, the inspector's endpoints: Alt-click a string on the page to open its entry in the
    // editor, Alt-right-click to edit it there. Imported only then, so a build leaves them out.
    ...(dev ? (await import('prosebook/bun')).inspector() : {}),
    '/': index,
    // Read on the server: one copy per request, in the locale the request asks for.
    '/api/cart': async (req) => {
      const copy = createCopy(catalog, { locale: requested(req) });
      await copy.ready;
      const count = Number(new URL(req.url).searchParams.get('count') ?? 0);
      return new Response(copy.t('cart.items', { count }), { headers: { 'Content-Language': copy.locale } });
    },
  },
  development: dev && { hmr: true, console: true },
});

console.log(`Listening on ${server.url}`);
