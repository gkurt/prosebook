/**
 * The loader `prosebook/next` sets on the generated modules for Turbopack, and `prosebook/webpack` for
 * webpack and Rspack. In a build it hands over a locale module the integration has already pruned,
 * since that reads the source once for every locale. In dev, in the browser, it puts what the
 * integration hands it before the index (the hot hooks, and under Next the inspector), and makes each
 * locale module update the copies holding it whenever it runs again. Under Next with `split`, it also
 * runs over the app's own source in the browser, and appends to each file an import of every area
 * whose keys it names, from the folder of area files `withProsebook` writes.
 */
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { areaFile, areasNamed, importingAreas, notifyingLocale, relativeImport } from './tools/bundle.ts';

export type LoaderOptions =
  | { code: string }
  | { prepend: string; append?: string }
  | { locale: string; append?: string }
  | { areas: string[]; dir: string }
  | { plugin: string };

type Context = { getOptions(): LoaderOptions; resourcePath?: string; rootContext?: string };

/**
 * Each webpack plugin's options for each module, by its path, filled before each compile. Rspack hands
 * a loader the options its rule held when the config was read, so a rule names its plugin, and the
 * loader finds the rest here. On `globalThis`, as a bundler may load this file apart from the plugin.
 */
export const pluginModules: Map<string, Map<string, LoaderOptions>> = ((globalThis as { [k: symbol]: unknown })[
  Symbol.for('prosebook.loader')
] ??= new Map()) as never;

/** The path webpack's rules and this registry compare: forward slashes, as on any OS. */
export const modulePath = (path: string) => path.replaceAll('\\', '/');

export default function loader(this: Context, source: string): string {
  const { resourcePath = '', rootContext = process.cwd() } = this;
  const given = this.getOptions();
  const options = 'plugin' in given ? pluginModules.get(given.plugin)?.get(modulePath(resourcePath)) : given;
  if (options === undefined || 'plugin' in options) return source;
  if ('code' in options) return options.code;
  if ('prepend' in options) return options.prepend + source + (options.append ?? '');
  if ('locale' in options) return notifyingLocale(source, options.locale) + (options.append ?? '');
  const areas = areasNamed(source, new Set(options.areas));
  if (areas.length === 0) return source;
  const file = isAbsolute(resourcePath) ? resourcePath : resolve(rootContext, resourcePath);
  return importingAreas(source, file, areas, (area) => relativeImport(dirname(file), join(options.dir, areaFile(area))));
}
