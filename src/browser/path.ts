/** `node:path` in the browser build: POSIX paths, as the in-memory files (`fs.ts`) are kept. */
export const sep = '/';

function normalized(path: string): string {
  const absolute = path.startsWith('/');
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') parts.pop();
    else if (part !== '..' || !absolute) parts.push(part);
  }
  const joined = parts.join('/');
  return absolute ? `/${joined}` : joined || '.';
}

export const isAbsolute = (path: string) => path.startsWith('/');

export const join = (...paths: string[]) => normalized(paths.filter((p) => p !== '').join('/'));

export function resolve(...paths: string[]): string {
  let out = '/';
  for (const path of paths) out = isAbsolute(path) ? path : `${out}/${path}`;
  return normalized(out);
}

export function relative(from: string, to: string): string {
  const a = resolve(from).split('/').filter(Boolean);
  const b = resolve(to).split('/').filter(Boolean);
  let shared = 0;
  while (shared < a.length && a[shared] === b[shared]) shared++;
  return [...a.slice(shared).map(() => '..'), ...b.slice(shared)].join('/');
}

export function dirname(path: string): string {
  const cut = normalized(path).lastIndexOf('/');
  return cut === -1 ? '.' : cut === 0 ? '/' : path.slice(0, cut);
}

export const basename = (path: string) => normalized(path).split('/').pop() ?? '';

export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
}

export default { sep, isAbsolute, join, resolve, relative, dirname, basename, extname };
