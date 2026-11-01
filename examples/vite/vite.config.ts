import react from '@vitejs/plugin-react';
import { prosebook } from 'prosebook/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), prosebook()],
});
