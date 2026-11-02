import { defineConfig } from 'tsdown';

// One entry per export in package.json, plus the CLI, the dev inspector each integration loads from
// beside itself and the Turbopack loader the Next config names by path. React, Vite, Bun and Node
// built-ins stay external.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.tsx',
    'react/server': 'src/react/server.ts',
    vite: 'src/vite.ts',
    next: 'src/next.ts',
    'next-loader': 'src/next-loader.ts',
    bun: 'src/bun.ts',
    inspector: 'src/inspector.ts',
    config: 'src/tools/config.ts',
    tools: 'src/tools/index.ts',
    cli: 'src/cli.ts',
  },
  format: 'esm',
  platform: 'node',
  // `@types/bun` declares the `bun` module ambiently, which the declaration bundler can't follow.
  deps: { neverBundle: ['bun'] },
  // `.js`, as package.json names them: the package is `type: module`.
  fixedExtension: false,
  dts: true,
  sourcemap: true,
});
