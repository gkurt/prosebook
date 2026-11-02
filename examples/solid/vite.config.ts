import { prosebook } from 'prosebook/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid(), prosebook()],
});
