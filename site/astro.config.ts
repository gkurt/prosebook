import { defineConfig } from 'astro/config';
import { prosebook } from 'prosebook/astro';

// Served from gkurt.com/prosebook/, and deployed from _site at the repo's root by pages.yml.
export default defineConfig({
  site: 'https://gkurt.com',
  base: '/prosebook',
  outDir: '../_site',
  integrations: [prosebook()],
  // The playground loads the tools late; prebundled up front, the dev server doesn't find their
  // dependencies only then and reload the page.
  vite: { optimizeDeps: { include: ['prosebook/playground'] } },
});
