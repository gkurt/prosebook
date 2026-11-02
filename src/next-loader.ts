/**
 * The Turbopack loader `prosebook/next` sets on the generated modules. In a build it hands over a
 * locale module `withProsebook` has already pruned, since that reads the source once for every
 * locale. In dev, in the browser, it puts what `withProsebook` hands it before the index (the hot
 * hooks, and the inspector), and makes each locale module update the copies holding it whenever Fast
 * Refresh runs it again. With `split`, it also runs over the app's own source in the browser, and
 * appends to each file an import of every area whose keys it names, from the folder of area files
 * `withProsebook` writes.
 */
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { areaFile, areasNamed, importingAreas, notifyingLocale, relativeImport } from './tools/bundle.ts';

export type LoaderOptions = { code: string } | { prepend: string } | { locale: string } | { areas: string[]; dir: string };

type Context = { getOptions(): LoaderOptions; resourcePath?: string; rootContext?: string };

export default function loader(this: Context, source: string): string {
  const { resourcePath = '', rootContext = process.cwd() } = this;
  const options = this.getOptions();
  if ('code' in options) return options.code;
  if ('prepend' in options) return options.prepend + source;
  if ('locale' in options) return notifyingLocale(source, options.locale);
  const areas = areasNamed(source, new Set(options.areas));
  if (areas.length === 0) return source;
  const file = isAbsolute(resourcePath) ? resourcePath : resolve(rootContext, resourcePath);
  return importingAreas(source, file, areas, (area) => relativeImport(dirname(file), join(options.dir, areaFile(area))));
}
