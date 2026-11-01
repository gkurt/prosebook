import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { copydeck } from '../../src/vite.ts';

const src = (path: string) => fileURLToPath(new URL(`../../src/${path}`, import.meta.url));

// The example runs copydeck from source; an app would `import { copydeck } from 'copydeck/vite'`.
export default defineConfig({
  plugins: [react(), copydeck()],
  resolve: {
    alias: [
      { find: /^copydeck\/react$/, replacement: src('react/index.tsx') },
      { find: /^copydeck$/, replacement: src('index.ts') },
    ],
  },
});
