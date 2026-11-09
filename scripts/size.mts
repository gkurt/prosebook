/**
 * What prosebook costs an app, minified and gzipped, from `dist` as published, against a budget: the
 * runtime an app calls (a copy, its catalog, the reader's locales), alone and with each binding whole.
 * The frameworks are the app's own, so they stay out. Run after `bun run build`; fails over budget.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = join(import.meta.dir, '..');
const dist = (path: string) => JSON.stringify(join(root, 'dist', path).replaceAll('\\', '/'));
const CORE = `export { createCopy, defineCatalog, preferredLocales } from ${dist('index.js')};`;

// Bytes, gzipped. Raise one only with the reason in the commit: the README says what the runtime weighs.
const BUDGETS: Record<string, number> = {
  // Under 4.5 KB, as the README says: 4 KB until relative times, whose clock and reads every copy carries.
  runtime: 4500,
  react: 5200,
  preact: 5200,
  vue: 5250,
  solid: 5050,
  svelte: 4900,
};

const EXTERNAL = ['react', 'react/*', 'react-dom', 'preact', 'preact/*', 'vue', 'solid-js', 'solid-js/*', 'svelte', 'svelte/*', '*.svelte'];

const dir = join(root, 'node_modules', '.cache', 'prosebook-size');
mkdirSync(dir, { recursive: true });

let over = false;
for (const [name, budget] of Object.entries(BUDGETS)) {
  const entry = join(dir, `${name}.js`);
  writeFileSync(entry, name === 'runtime' ? CORE : `${CORE}\nexport * from ${dist(`${name}/index.js`)};\n`);
  const built = await Bun.build({ entrypoints: [entry], minify: true, external: EXTERNAL, target: 'browser' });
  if (!built.success) throw new AggregateError(built.logs, `${name} did not build`);
  const size = gzipSync(await built.outputs[0]!.text(), { level: 9 }).byteLength;
  const fits = size <= budget;
  over ||= !fits;
  console.log(`${fits ? 'ok  ' : 'OVER'} ${name.padEnd(8)} ${String(size).padStart(5)} B gzipped, budget ${budget}`);
}
if (over) {
  console.error('Over budget: make it smaller, or raise the budget in scripts/size.mts and say why in the commit.');
  process.exit(1);
}
