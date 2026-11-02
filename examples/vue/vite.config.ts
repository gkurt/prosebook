import vue from '@vitejs/plugin-vue';
import { prosebook } from 'prosebook/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue(), prosebook()],
});
