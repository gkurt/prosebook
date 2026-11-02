// scripts/smoke.mts — runs an example's production build as a user would and checks what it says.
//
// `bun scripts/smoke.mts next`, after the example's `build`. A server example is started with its
// `start` script and asked for pages in English and German; a page rendered in the browser is
// checked through the scripts it loads. The Node example is run and its output checked.

import { join } from 'node:path';

const PORT = 4173;
// A chunk's imports as Vite and Bun write them, minified or not: `import"./a.js"`, `from"./a.js"`,
// and the lazy ``import(`./Cart-….js`)``.
const STATIC = /\b(?:from|import)\s*["'`](\.{1,2}\/[^"'`]+\.js)["'`]/g;
const DYNAMIC = /\bimport\(\s*["'`](\.{1,2}\/[^"'`]+\.js)["'`]\s*\)/g;

interface Request {
  path: string;
  /** Sent as Accept-Language. */
  language?: string;
  /** Also look in the module scripts the page loads, for a page rendered in the browser. */
  scripts?: boolean;
  says: string[];
  /** Said only by the chunks those scripts import lazily, and not by the scripts themselves. */
  lazy?: string[];
  /** Said by the scripts themselves, not only by the page. */
  inScripts?: string[];
  /** Said by none of the scripts: another route's messages, say. */
  notInScripts?: string[];
  /** Said by the module files the page links for preloading: a split page's areas in a lazy locale. */
  preloaded?: string[];
}

type Example = { requests: Request[] } | { run: string[]; says: string[] };

const SHOP: Request[] = [
  { path: '/', language: 'de', says: ['Eckladen', 'Willkommen zurück, Ada.', 'Warenkorb leeren'] },
  { path: '/', language: 'en', says: ['Corner Shop', 'Welcome back, Ada.', 'Empty cart'] },
  // By weight, not by order: English first.
  { path: '/', language: 'de;q=0.1, en;q=0.9', says: ['Corner Shop', 'Welcome back, Ada.'] },
];

const EXAMPLES: Record<string, Example> = {
  vite: { requests: [{ path: '/', scripts: true, says: ['Corner Shop'], lazy: ['Add to cart'] }] },
  preact: { requests: [{ path: '/', scripts: true, says: ['Corner Shop', 'Add to cart'] }] },
  vue: { requests: [{ path: '/', scripts: true, says: ['Corner Shop', 'Add to cart'] }] },
  svelte: { requests: [{ path: '/', scripts: true, says: ['Corner Shop', 'Add to cart'] }] },
  solid: { requests: [{ path: '/', scripts: true, says: ['Corner Shop', 'Add to cart'] }] },
  bun: {
    requests: [
      { path: '/', scripts: true, says: ['Corner Shop'], lazy: ['Add to cart'] },
      { path: '/api/cart?count=3', language: 'de', says: ['3 Artikel im Warenkorb.'] },
      { path: '/api/cart?count=1', language: 'en', says: ['1 item in your cart.'] },
    ],
  },
  next: {
    requests: [
      { path: '/', language: 'de', says: ['Eckladen', 'Willkommen zurück, Ada.'] },
      { path: '/', language: 'en', says: ['Corner Shop', 'Welcome back, Ada.'] },
      { path: '/', language: 'de;q=0.1, en;q=0.9', says: ['Corner Shop', 'Welcome back, Ada.'] },
      { path: '/cart', language: 'de', says: ['Eckladen', 'Warenkorb leeren'] },
      { path: '/cart', language: 'en', says: ['Corner Shop', 'Empty cart'] },
      // Split by area: the cart's messages ship with the cart route's client code, not the home page's.
      { path: '/', scripts: true, says: [], inScripts: ['Language'], notInScripts: ['Add to cart'] },
      { path: '/cart', scripts: true, says: [], inScripts: ['Add to cart'] },
    ],
  },
  'tanstack-start': {
    // Split, the server links the German file of the areas the page reads.
    requests: SHOP.map((r) => (r.language === 'de' ? { ...r, preloaded: ['Warenkorb leeren'] } : r)),
  },
  node: { run: ['node', 'src/main.ts', 'de', '3'], says: ['Eckladen', '3 Artikel gekauft.', 'Summe: 13,50'] },
};

const name = process.argv[2] ?? '';
const example = EXAMPLES[name];
if (example === undefined) throw new Error(`name an example: ${Object.keys(EXAMPLES).join(', ')}`);
const cwd = join(import.meta.dir, '..', 'examples', name);

const failures: string[] = [];
const expect = (what: string, text: string, says: string[]) => {
  for (const s of says) if (!text.includes(s)) failures.push(`${what} does not say "${s}"`);
};

if ('run' in example) {
  const result = Bun.spawnSync(example.run, { cwd, stderr: 'inherit' });
  if (result.exitCode !== 0) failures.push(`${example.run.join(' ')} exited with ${result.exitCode}`);
  expect(example.run.join(' '), result.stdout.toString(), example.says);
} else {
  const server = Bun.spawn(['bun', 'run', '--no-orphans', 'start'], {
    cwd,
    env: { ...process.env, PORT: String(PORT) },
    stdout: 'inherit',
  });
  const base = `http://localhost:${PORT}`;
  try {
    await ready(base);
    for (const request of example.requests) {
      const headers = request.language === undefined ? undefined : { 'Accept-Language': request.language };
      const res = await fetch(base + request.path, { headers });
      if (!res.ok) failures.push(`${request.path} answered ${res.status}`);
      const page = await res.text();
      const scripts = request.scripts === true ? await scriptsOf(page, base + request.path) : new Map<string, string>();
      const loaded = [...scripts.values()].join('\n');
      const what = `${request.path} in ${request.language ?? 'the default locale'}`;
      expect(what, page + loaded, request.says);
      expect(`${what}, in its scripts`, loaded, request.inScripts ?? []);
      for (const s of request.notInScripts ?? []) if (loaded.includes(s)) failures.push(`${what} says "${s}" in its scripts`);
      if (request.preloaded !== undefined) {
        const links = [...page.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map(([, href]) => new URL(href, base));
        const texts = await Promise.all(links.map(async (url) => (await fetch(url)).text()));
        expect(`${what}, in the files it preloads`, texts.join('\n'), request.preloaded);
      }
      if (request.lazy !== undefined) {
        for (const s of request.lazy) if (loaded.includes(s)) failures.push(`${what} says "${s}" in its scripts, not only lazily`);
        expect(`${what}, lazily`, await lazyChunksOf(scripts), request.lazy);
      }
    }
  } finally {
    server.kill();
  }
}

if (failures.length > 0) {
  console.error(`${name}: ${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`${name}: says what it should`);

/** Each script at `urls` and every chunk it imports statically, fetched once, keyed by URL. */
async function withImports(urls: URL[], into = new Map<string, string>()): Promise<Map<string, string>> {
  const visit = async (url: URL): Promise<void> => {
    if (into.has(url.href)) return;
    into.set(url.href, '');
    const text = await (await fetch(url)).text();
    into.set(url.href, text);
    await Promise.all([...text.matchAll(STATIC)].map(([, file]) => visit(new URL(file, url))));
  };
  await Promise.all(urls.map(visit));
  return into;
}

/** The module scripts a page loads, and what they import before it runs. */
async function scriptsOf(page: string, url: string): Promise<Map<string, string>> {
  return withImports([...page.matchAll(/<script[^>]+src="([^"]+)"/g)].map(([, src]) => new URL(src, url)));
}

/** The chunks those scripts import lazily, and what those import that the page had not, joined. */
async function lazyChunksOf(scripts: Map<string, string>): Promise<string> {
  const lazy = [...scripts].flatMap(([url, text]) => [...text.matchAll(DYNAMIC)].map(([, file]) => new URL(file, url)));
  const all = await withImports(lazy, new Map(scripts));
  return [...all]
    .filter(([url]) => !scripts.has(url))
    .map(([, text]) => text)
    .join('\n');
}

async function ready(base: string): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(base);
      return;
    } catch {
      await Bun.sleep(250);
    }
  }
  throw new Error(`${name}: nothing answered at ${base} within 30 seconds`);
}
