/**
 * `node:fs` in the browser build (`prosebook/playground`): files held in memory, by absolute POSIX
 * path, which the tools read and write as they would a disk. Only what they call is here.
 */
export const volume = new Map<string, string>();

const missing = (path: string) => Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' });
const under = (dir: string) => (dir.endsWith('/') ? dir : `${dir}/`);
const isDirectory = (path: string) => [...volume.keys()].some((file) => file.startsWith(under(path)));

export function existsSync(path: string): boolean {
  return volume.has(path) || isDirectory(path);
}

export function readFileSync(path: string): string {
  const content = volume.get(path);
  if (content === undefined) throw missing(path);
  return content;
}

export function writeFileSync(path: string, content: string): void {
  volume.set(path, content);
}

/** Folders are the files' paths; there is nothing to make. */
export function mkdirSync(): void {}

export function readdirSync(dir: string): string[] {
  const names = new Set<string>();
  for (const file of volume.keys()) if (file.startsWith(under(dir))) names.add(file.slice(under(dir).length).split('/')[0]!);
  if (names.size === 0 && !volume.has(dir)) throw missing(dir);
  return [...names];
}

export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean; mtimeMs: number } {
  if (!existsSync(path)) throw missing(path);
  const file = volume.has(path);
  return { isDirectory: () => !file, isFile: () => file, mtimeMs: 0 };
}

export function watch(): never {
  throw new Error('prosebook: nothing to watch in the browser');
}
