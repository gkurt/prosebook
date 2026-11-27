import { defineConfig } from 'astro/config';
import { deictic } from 'deictic/vite';
import { prosebook } from 'prosebook/astro';
import { prosebook as copyInspector } from 'prosebook/deictic';

// Served from gkurt.com/prosebook/, and deployed from _site at the repo's root by pages.yml.
export default defineConfig({
  site: 'https://gkurt.com',
  base: '/prosebook',
  outDir: '../_site',
  integrations: [prosebook()],
  // The playground loads the tools late; prebundled up front, the dev server doesn't find their
  // dependencies only then and reload the page.
  vite: {
    optimizeDeps: { include: ['prosebook/playground'] },
    // The copy inspector in the build too, answered in the page (`src/standalone.ts`); in dev the integration's
    // deictic merges into this one.
    plugins: [deictic({ standalone: 'src/standalone.ts', plugins: [copyInspector()] })],
  },
});
