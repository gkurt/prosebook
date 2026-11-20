/**
 * What the framework tests need from Bun. Solid and Svelte name their server builds for every runtime
 * but a browser's, and those don't react, so each server module here hands over its browser twin; and
 * `.svelte` files are compiled as the app's bundler would. And `Error.prepareStackTrace` is put back after
 * each test.
 */
import { readFileSync } from 'node:fs';

import { afterEach } from 'bun:test';
import { plugin } from 'bun';
import { compile } from 'svelte/compiler';

// Bun matches these filters itself, where a character class with a slash in it doesn't match.
plugin({
  name: 'browser builds',
  setup(build) {
    build.onLoad({ filter: /solid-js.(web.)?dist.server\.js$/ }, ({ path }) => ({
      contents: `export * from ${JSON.stringify(path.replace(/server\.js$/, path.includes('web') ? 'web.js' : 'solid.js'))};`,
      loader: 'js',
    }));
    build.onLoad({ filter: /svelte.src.*-server\.js$/ }, ({ path }) => ({
      contents: `export * from ${JSON.stringify(path.replace(/-server\.js$/, '-client.js'))};`,
      loader: 'js',
    }));
    build.onLoad({ filter: /\.svelte$/ }, ({ path }) => ({
      contents: compile(readFileSync(path, 'utf8'), { filename: path, generate: 'client' }).js.code,
      loader: 'js',
    }));
  },
});

// Babel sets `Error.prepareStackTrace` the first time it transforms and never unsets it, and Vite's module runner
// leaves its own while one is open. Every test file runs in one process, and under such a hook Bun's
// `Error.captureStackTrace` refuses an object that isn't an Error, which a Vite loaded afresh passes it as it
// loads: whichever file runs after the framework plugins fails, so the outcome hung on the order Bun reads the
// folder in.
const PREPARE = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
afterEach(() => {
  if (PREPARE === undefined) Reflect.deleteProperty(Error, 'prepareStackTrace');
  else Object.defineProperty(Error, 'prepareStackTrace', PREPARE);
});
