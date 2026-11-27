/**
 * What `prosebook init` does past the config and the catalog: deictic installed where it's missing, as the copy
 * inspector is a deictic plugin, and prosebook's integration added to the bundler's config, through deictic's own
 * config editor (`deictic/setup`), last in the list, as deictic goes first. Where it can't, it says what to do.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** Each package manager's lockfiles, in the order they're looked for in a folder. */
const LOCKS: [string, PackageManager][] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];
const MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

type Bundler = 'next' | 'astro' | 'vite' | 'rspack' | 'webpack' | 'metro' | 'bun';

/** What `deictic/setup`'s `addToConfig` takes. */
interface ConfigEntry {
  imports: [string, string][];
  value: string;
  list?: string;
  wrap?: string;
  last?: boolean;
}

interface Integration {
  /** The config files it looks for, in order. */
  files: string[];
  entry: ConfigEntry;
  /** The snippet for a config it can't edit. */
  snippet: string;
  /** What more the bundler needs, said once it's added. */
  next?: string;
}

const extensions = (base: string) => ['ts', 'mts', 'js', 'mjs', 'cts', 'cjs'].map((e) => `${base}.${e}`);
const WEBPACK_THEN =
  "the generated index imports './en.js' for en.ts: add resolve: { extensionAlias: { '.js': ['.ts', '.js'] } }, or set importExtension: '' in the prosebook config";

const INTEGRATIONS: Record<Exclude<Bundler, 'bun'>, Integration> = {
  next: {
    files: extensions('next.config'),
    entry: { imports: [['{ withProsebook }', 'prosebook/next']], value: '', wrap: 'withProsebook' },
    snippet: "import { withProsebook } from 'prosebook/next';\n\nexport default withProsebook(nextConfig);",
    next: "Turbopack doesn't resolve './en.js' to en.ts: set importExtension: '' in the prosebook config",
  },
  astro: {
    files: extensions('astro.config'),
    entry: { imports: [['{ prosebook }', 'prosebook/astro']], list: 'integrations', value: 'prosebook()', last: true },
    snippet: "import { prosebook } from 'prosebook/astro';\n\nexport default defineConfig({ integrations: [prosebook()] });",
  },
  vite: {
    files: extensions('vite.config'),
    entry: { imports: [['{ prosebook }', 'prosebook/vite']], list: 'plugins', value: 'prosebook()', last: true },
    snippet: "import { prosebook } from 'prosebook/vite';\n\nexport default defineConfig({ plugins: [react(), prosebook()] });",
  },
  rspack: {
    files: extensions('rspack.config'),
    entry: { imports: [['{ ProsebookPlugin }', 'prosebook/webpack']], list: 'plugins', value: 'new ProsebookPlugin()', last: true },
    snippet: "import { ProsebookPlugin } from 'prosebook/webpack';\n\nexport default { plugins: [new ProsebookPlugin()] };",
    next: WEBPACK_THEN,
  },
  webpack: {
    files: extensions('webpack.config'),
    entry: { imports: [['{ ProsebookPlugin }', 'prosebook/webpack']], list: 'plugins', value: 'new ProsebookPlugin()', last: true },
    snippet: "import { ProsebookPlugin } from 'prosebook/webpack';\n\nexport default { plugins: [new ProsebookPlugin()] };",
    next: WEBPACK_THEN,
  },
  metro: {
    files: extensions('metro.config'),
    entry: { imports: [['{ withProsebook }', 'prosebook/metro']], value: '', wrap: 'withProsebook' },
    snippet: "const { withProsebook } = require('prosebook/metro');\n\nmodule.exports = withProsebook(getDefaultConfig(__dirname));",
  },
};

const BUN_SNIPPET = `# bunfig.toml: the dev server's plugins
[serve.static]
plugins = ["prosebook/bun"]`;

export interface SetupOptions {
  /** Installs deictic where it's missing; false only says the command. */
  install?: boolean;
  log: (line: string) => void;
  /** Runs a command in the project, and answers whether it succeeded. */
  run?: (command: string, cwd: string) => boolean;
}

const runIn = (command: string, cwd: string) => spawnSync(command, { cwd, stdio: 'inherit', shell: true }).status === 0;

/** deictic installed and prosebook's integration added, from the config's folder `root`. */
export async function setUp(root: string, { install = true, log, run = runIn }: SetupOptions): Promise<void> {
  const project = projectOf(root);
  if (project === undefined) {
    log('prosebook: no package.json here or above, so no bundler to add prosebook to: see API.md#bundlers');
    return;
  }

  if (installed(project, 'deictic')) {
    log('prosebook: deictic is installed, so the copy inspector is there in dev (Alt-click a string)');
  } else {
    const command = installCommand(packageManager(project), project);
    if (!install) {
      log(`prosebook: the copy inspector is a deictic plugin: install deictic with ${command}`);
    } else {
      log(`prosebook: ${command}, for the copy inspector`);
      if (!run(command, project)) log(`prosebook: installing deictic failed: run ${command} yourself`);
    }
  }

  const bundler = bundlerOf(project);
  if (bundler === undefined) {
    log('prosebook: no bundler it knows in package.json (Vite, Next.js, Astro, webpack, Rspack, Metro, Bun): see API.md#bundlers');
    return;
  }
  if (bundler === 'bun') {
    log(`prosebook: add the Bun plugin, and the inspector's routes, as API.md#bun says:\n\n${BUN_SNIPPET}\n`);
    return;
  }
  const integration = INTEGRATIONS[bundler];
  const file = integration.files.map((f) => join(project, f)).find((f) => existsSync(f));
  if (file === undefined) {
    log(`prosebook: no ${integration.files[0]} here: add prosebook to your ${bundler} config:\n\n${integration.snippet}\n`);
    return;
  }
  const name = relative(project, file).replaceAll('\\', '/');
  const code = readFileSync(file, 'utf8');
  if (/['"]prosebook\//.test(code)) {
    log(`prosebook: ${name} has it already`);
    return;
  }
  const addToConfig = await configEditor(project);
  const added = addToConfig?.(file, code, integration.entry);
  if (added === undefined) {
    const why = addToConfig === undefined ? '' : `couldn't tell where it goes in ${name}: `;
    log(`prosebook: ${why}add it to ${name} yourself:\n\n${integration.snippet}\n`);
    return;
  }
  writeFileSync(file, added);
  log(`prosebook: added it to ${name}`);
  if (integration.next !== undefined) log(`prosebook: ${integration.next}`);
}

/** deictic's config editor, from the project: nothing where deictic isn't installed, or is older than it. */
async function configEditor(
  project: string,
): Promise<((file: string, code: string, entry: ConfigEntry) => string | undefined) | undefined> {
  try {
    const path = createRequire(join(project, 'package.json')).resolve('deictic/setup');
    const setup = (await import(pathToFileURL(path).href)) as {
      addToConfig?: (file: string, code: string, entry: ConfigEntry) => string | undefined;
    };
    return setup.addToConfig;
  } catch {
    return undefined;
  }
}

/** The project's root: the nearest folder with a package.json, from `dir` up. */
function projectOf(dir: string): string | undefined {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, 'package.json'))) return at;
    if (dirname(at) === at) return undefined;
  }
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** The bundler the project runs, from its dependencies, or none prosebook has an integration for. */
export function bundlerOf(project: string): Bundler | undefined {
  const manifest = readJson(join(project, 'package.json')) ?? {};
  const has = new Set([manifest.dependencies, manifest.devDependencies].flatMap((d) => Object.keys((d as object | undefined) ?? {})));
  if (has.has('next')) return 'next';
  if (has.has('astro')) return 'astro';
  if (has.has('expo') || has.has('react-native')) return 'metro';
  if (has.has('vite')) return 'vite';
  if (has.has('@rspack/core') || has.has('@rspack/cli')) return 'rspack';
  if (has.has('webpack')) return 'webpack';
  if (existsSync(join(project, 'bunfig.toml'))) return 'bun';
  return undefined;
}

/**
 * The project's package manager: its `packageManager` field, or the lockfile nearest it (a workspace's is above), or the
 * one running this, or npm. The lockfile wins over what runs this, as `npx prosebook init` runs under npm anywhere.
 */
export function packageManager(project: string, agent = process.env.npm_config_user_agent): PackageManager {
  for (let dir = project; ; dir = dirname(dir)) {
    const field = readJson(join(dir, 'package.json'))?.packageManager;
    const named = MANAGERS.find((m) => typeof field === 'string' && field.split('@')[0] === m);
    if (named !== undefined) return named;
    const lock = LOCKS.find(([file]) => existsSync(join(dir, file)));
    if (lock !== undefined) return lock[1];
    if (dirname(dir) === dir) break;
  }
  return MANAGERS.find((m) => m === agent?.split('/')[0]) ?? 'npm';
}

/** The command that adds deictic to the project's dev dependencies. A pnpm workspace's root takes it only with `-w`. */
export function installCommand(manager: PackageManager, project: string): string {
  const pnpm = existsSync(join(project, 'pnpm-workspace.yaml')) ? 'pnpm add -D -w' : 'pnpm add -D';
  return `${{ npm: 'npm install -D', pnpm, yarn: 'yarn add -D', bun: 'bun add -d' }[manager]} deictic`;
}

/** Whether the project can import `name`: found from its root, as the bundler finds it. */
function installed(project: string, name: string): boolean {
  try {
    createRequire(join(project, 'package.json')).resolve(`${name}/package.json`);
    return true;
  } catch (e) {
    // There, but its `exports` don't name its package.json: only "not found" means it's missing.
    return (e as { code?: string }).code !== 'MODULE_NOT_FOUND';
  }
}
