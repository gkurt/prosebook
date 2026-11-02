import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { prosebook } from 'prosebook/vite';
import { defineConfig } from 'vite';

// TanStack Start is a Vite plugin, so prosebook's is the same as in any Vite app: it regenerates on
// catalog edits, swaps the messages in place, and prunes the client and server bundles alike. Split,
// the page loads each area's messages with the code reading it, and the server links their files.
export default defineConfig({
  server: { port: 3000 },
  plugins: [tanstackStart(), prosebook({ split: true }), react()],
});
