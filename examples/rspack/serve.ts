// Serves the production build as a static host would, for `bun run start` and the smoke test.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';

const dist = join(import.meta.dirname, 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript' };

async function respond(req: IncomingMessage, res: ServerResponse) {
  // Rooted first, so `..` can't climb out of dist.
  const path = normalize(`/${new URL(req.url ?? '/', 'http://localhost').pathname}`).slice(1) || 'index.html';
  try {
    const body = await readFile(join(dist, path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}

createServer((req, res) => void respond(req, res)).listen(Number(process.env.PORT ?? 4173));
