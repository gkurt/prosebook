import type { ProsebookConfig } from 'prosebook/config';

/** The lint the catalog is held to: by the CLI, from the config, and by the inspector on the built page. */
export const lint = {
  extends: 'strict',
  properNouns: ['prosebook', 'YAML', 'Vite', 'Next.js', 'Bun', 'Astro', 'GitHub', 'MIT', 'Gokhan', 'Kurt', 'Rust', 'Swift', 'Kotlin'],
} satisfies ProsebookConfig['lint'];
