import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { setUp } from '#src/tools/setup.ts';

/** A project outside this repo, so nothing is found above it: with deictic installed, it's the real `deictic/setup`. */
function project(files: Record<string, string>, deictic = false): string {
  const root = mkdtempSync(join(tmpdir(), 'prosebook-init-'));
  const all = { ...files };
  if (deictic) {
    all['node_modules/deictic/package.json'] = JSON.stringify({
      name: 'deictic',
      type: 'module',
      exports: { './setup': './setup.js', './package.json': './package.json' },
    });
    all['node_modules/deictic/setup.js'] = `export * from ${JSON.stringify(import.meta.resolve('deictic/setup'))};\n`;
  }
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const run = async (root: string, install = true) => {
  const said: string[] = [];
  const ran: string[] = [];
  await setUp(root, { install, log: (line) => said.push(line), run: (command) => ran.push(command) > 0 });
  return { said: said.join('\n'), ran };
};

test("installs deictic with the project's package manager where it's missing, and says the snippet without deictic's editor", async () => {
  const root = project({
    'package.json': JSON.stringify({ devDependencies: { vite: '8' } }),
    'pnpm-lock.yaml': '',
    'vite.config.ts': 'export default { plugins: [] };\n',
  });
  const { said, ran } = await run(root);
  expect(ran).toEqual(['pnpm add -D deictic']);
  // The fake install put nothing there, so it says what to add.
  expect(said).toContain("import { prosebook } from 'prosebook/vite';");
  expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toBe('export default { plugins: [] };\n');
  expect((await run(root, false)).said).toContain('install deictic with pnpm add -D deictic');
});

test("adds prosebook after the config's plugins, deictic's among them, and once", async () => {
  const root = project(
    {
      'package.json': JSON.stringify({ devDependencies: { vite: '8' } }),
      'bun.lock': '',
      'vite.config.ts': "import { deictic } from 'deictic/vite';\n\nexport default { plugins: [deictic(), react()] };\n",
    },
    true,
  );
  const { said, ran } = await run(root);
  expect(ran).toEqual([]);
  expect(said).toContain('deictic is installed');
  expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toBe(
    "import { deictic } from 'deictic/vite';\nimport { prosebook } from 'prosebook/vite';\n\nexport default { plugins: [deictic(), react(), prosebook()] };\n",
  );
  expect((await run(root)).said).toContain('vite.config.ts has it already');
});

test("wraps Next's config, and says what more webpack needs", async () => {
  const next = project(
    {
      'package.json': JSON.stringify({ dependencies: { next: '16' } }),
      'next.config.ts': 'const nextConfig = {};\nexport default nextConfig;\n',
    },
    true,
  );
  await run(next);
  expect(readFileSync(join(next, 'next.config.ts'), 'utf8')).toContain('export default withProsebook(nextConfig);');
  const webpack = project(
    { 'package.json': JSON.stringify({ devDependencies: { webpack: '5' } }), 'webpack.config.js': 'module.exports = { plugins: [] };\n' },
    true,
  );
  const { said } = await run(webpack);
  expect(readFileSync(join(webpack, 'webpack.config.js'), 'utf8')).toBe(
    "const { ProsebookPlugin } = require('prosebook/webpack');\n\nmodule.exports = { plugins: [new ProsebookPlugin()] };\n",
  );
  expect(said).toContain('extensionAlias');
});
