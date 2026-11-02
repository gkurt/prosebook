// scripts/smoke.mts — runs an example's production build as a user would and checks what it says.
//
// `bun scripts/smoke.mts next`, after the example's `build`. A server example is started with its
// `start` script and asked for pages in English and German; a page rendered in the browser is
// checked through the scripts it loads. The Node example is run and its output checked.

import { join } from 'node:path';

const PORT = 4173;

interface Request {
  path: string;
  /** Sent as Accept-Language. */
  language?: string;
  /** Also look in the module scripts the page loads, for a page rendered in the browser. */
  scripts?: boolean;
  says: string[];
}

type Example = { requests: Request[] } | { run: string[]; says: string[] };

const SHOP: Request[] = [
  { path: '/', language: 'de', says: ['Eckladen', 'Willkommen zurück, Ada.', 'Warenkorb leeren'] },
  { path: '/', language: 'en', says: ['Corner Shop', 'Welcome back, Ada.', 'Empty cart'] },
  // By weight, not by order: English first.
  { path: '/', language: 'de;q=0.1, en;q=0.9', says: ['Corner Shop', 'Welcome back, Ada.'] },
];

const EXAMPLES: Record<string, Example> = {
  vite: { requests: [{ path: '/', scripts: true, says: ['Corner Shop', 'Add to cart'] }] },
  bun: {
    requests: [
      { path: '/', scripts: true, says: ['Corner Shop', 'Add to cart'] },
      { path: '/api/cart?count=3', language: 'de', says: ['3 Artikel im Warenkorb.'] },
      { path: '/api/cart?count=1', language: 'en', says: ['1 item in your cart.'] },
    ],
  },
  next: { requests: SHOP },
  'tanstack-start': { requests: SHOP },
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
      const text = request.scripts === true ? page + (await scriptsOf(page, base + request.path)) : page;
      expect(`${request.path} in ${request.language ?? 'the default locale'}`, text, request.says);
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

/** The module scripts a page loads, joined. */
async function scriptsOf(page: string, url: string): Promise<string> {
  const sources = [...page.matchAll(/<script[^>]+src="([^"]+)"/g)].map(([, src]) => new URL(src, url));
  return (await Promise.all(sources.map(async (src) => (await fetch(src)).text()))).join('\n');
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
