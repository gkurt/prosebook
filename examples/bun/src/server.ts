import { createCopy } from 'prosebook';

import { catalog } from './copy/index.ts';
import index from './index.html';

/** The locales a request asks for, most preferred first. */
const requested = (req: Request) =>
  (req.headers.get('accept-language') ?? '')
    .split(',')
    .map((part) => part.split(';', 1)[0]!.trim())
    .filter((tag) => tag !== '');

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    '/': index,
    // Read on the server: one copy per request, in the locale the request asks for.
    '/api/cart': async (req) => {
      const copy = createCopy(catalog, { locale: requested(req) });
      await copy.ready;
      const count = Number(new URL(req.url).searchParams.get('count') ?? 0);
      return new Response(copy.t('cart.items', { count }), { headers: { 'Content-Language': copy.locale } });
    },
  },
  development: process.env.NODE_ENV !== 'production' && { hmr: true, console: true },
});

console.log(`Listening on ${server.url}`);
