import { prosebook } from 'prosebook/vite';
import { defineConfig } from 'vite';

// Vite's own JSX transform, aimed at Preact; `@preact/preset-vite` works as well, and adds Fast Refresh.
export default defineConfig({
  oxc: { jsx: { importSource: 'preact' } },
  plugins: [prosebook()],
});
