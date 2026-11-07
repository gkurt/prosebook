import { join } from 'node:path';

import { defineConfig } from 'tsdown';

// One entry per export in package.json, plus the CLI, the dev inspector each integration loads from
// beside itself and the loader the Next config and the webpack plugin name by path. The frameworks, Vite, Bun and
// Node built-ins stay external.
/** Where the playground's build finds each Node built-in the tools import: in memory, or a stand-in. */
export const BROWSER_SHIMS = Object.fromEntries(
  ['fs', 'path', 'crypto', 'module', 'url'].map((name) => [`node:${name}`, join(import.meta.dirname, 'src', 'browser', `${name}.ts`)]),
);

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'react/index': 'src/react/index.tsx',
      'react/server': 'src/react/server.ts',
      'preact/index': 'src/preact/index.ts',
      'vue/index': 'src/vue/index.ts',
      'solid/index': 'src/solid/index.ts',
      'svelte/index': 'src/svelte/index.ts',
      vite: 'src/vite.ts',
      next: 'src/next.ts',
      loader: 'src/loader.ts',
      webpack: 'src/webpack.ts',
      metro: 'src/metro.ts',
      bun: 'src/bun.ts',
      astro: 'src/astro.ts',
      inspector: 'src/inspector.ts',
      config: 'src/tools/config.ts',
      tools: 'src/tools/index.ts',
      cli: 'src/cli.ts',
      ai: 'src/ai.ts',
    },
    format: 'esm',
    platform: 'node',
    // `@types/bun` declares the `bun` module ambiently, which the declaration bundler can't follow.
    // `Text.svelte` ships as source, with its types, for the app's Svelte compiler.
    deps: { neverBundle: ['bun', /\.svelte$/] },
    copy: [{ from: ['src/svelte/Text.svelte', 'src/svelte/Text.svelte.d.ts'], to: 'dist/svelte' }],
    // `.js`, as package.json names them: the package is `type: module`.
    fixedExtension: false,
    dts: true,
    sourcemap: true,
  },
  // The tools, built for the browser: the same code, over the in-memory files of `src/browser/fs.ts`.
  {
    entry: { playground: 'src/playground.ts' },
    format: 'esm',
    platform: 'browser',
    alias: BROWSER_SHIMS,
    fixedExtension: false,
    dts: true,
    sourcemap: true,
    // Beside the first build's files, which it must not clear.
    clean: false,
  },
]);
