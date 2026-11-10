/**
 * The inspector on the built page: the real one (`prosebook/inspector`), its endpoints answered here in
 * the browser, since a static page has no dev server. In dev the integration starts it, so this does nothing.
 */
import type { DevHooks } from 'prosebook';
import { install, type Read } from 'prosebook/inspector';

function start() {
  // What the build read, which the page carries since the DOM carries no keys.
  const served = JSON.parse(document.querySelector('#reads')!.textContent) as [string, Read[]][];
  // There before any copy is made, so each adds itself and a saved edit reaches its messages.
  (globalThis as DevHooks).__PROSEBOOK_HOT__ = new Set();

  // The tools answer an entry's requests, and load on the first one.
  const importBackend = () => import('./backend.ts');
  let backend: ReturnType<typeof importBackend> | undefined;
  install({
    base: import.meta.env.BASE_URL.replace(/\/?$/, '/'),
    fetch: async (url, init) => {
      if (url.endsWith('__prosebook/reads')) return Response.json(served);
      const { answer } = await (backend ??= importBackend());
      return (await answer(served, new Request(new URL(url, location.href), init))) ?? new Response(null, { status: 404 });
    },
  });
}

if (import.meta.env.PROD) start();
