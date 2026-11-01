import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { prosebook } from '#src/vite.ts';

const src = (path: string) => fileURLToPath(new URL(`../../src/${path}`, import.meta.url));

// The example runs prosebook from source; an app would `import { prosebook } from 'prosebook/vite'`.
export default defineConfig({
  plugins: [react(), prosebook()],
  resolve: {
    alias: [
      { find: /^prosebook\/react$/, replacement: src('react/index.tsx') },
      { find: /^prosebook$/, replacement: src('index.ts') },
    ],
  },
});
