import type { ProsebookConfig } from 'prosebook/config';

export default {
  catalog: 'copy/catalog',
  out: 'src/copy',
  source: 'en',
  lint: {
    extends: 'strict',
    properNouns: ['prosebook', 'YAML', 'Vite', 'Next.js', 'Bun', 'Astro', 'GitHub', 'MIT', 'Gokhan', 'Kurt', 'Rust', 'Swift', 'Kotlin'],
  },
} satisfies ProsebookConfig;
