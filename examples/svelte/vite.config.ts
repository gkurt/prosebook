import { svelte } from '@sveltejs/vite-plugin-svelte';
import { prosebook } from 'prosebook/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte(), prosebook()],
});
