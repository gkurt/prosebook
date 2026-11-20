/**
 * What the framework tests need from Bun. Solid and Svelte name their server builds for every runtime
 * but a browser's, and those don't react, so each server module here hands over its browser twin; and
 * `.svelte` files are compiled as the app's bundler would. And `Error.captureStackTrace` takes any object,
 * whatever `Error.prepareStackTrace` hook a tool left.
 */
import { readFileSync } from 'node:fs';

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
// leaves its own while one is open. Each wraps the hook it found, Bun's own, which throws when
// `Error.captureStackTrace` is given an object that isn't an Error, as a Vite loaded afresh gives it. Every test file
// runs in one process, and such a hook may be set between tests or as a file loads, where no test hook puts it back;
// once one was, putting Bun's back doesn't help. So a capture refused is made into an Error and its stack copied over.
// (Vite's errors inherit from `Error.prototype` without being made by it, so `instanceof` can't tell.)
const capture = Error.captureStackTrace.bind(Error);
Error.captureStackTrace = (target: object, constructor?: Function) => {
  try {
    capture(target, constructor);
  } catch {
    const into = new Error();
    capture(into, constructor);
    Object.defineProperty(target, 'stack', { value: into.stack, writable: true, configurable: true });
  }
};
