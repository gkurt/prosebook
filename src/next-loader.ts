/**
 * The Turbopack loader `prosebook/next` sets on the generated modules. In a build it hands over a
 * locale module `withProsebook` has already pruned, since that reads the source once for every
 * locale. In dev, in the browser, it makes the index set up the hot hooks and each locale module
 * update the copies holding it whenever Fast Refresh runs it again.
 */
import { HOT_SET, notifyingLocale } from './tools/bundle.ts';

export type LoaderOptions = { code: string } | { index: true } | { locale: string };

export default function loader(this: { getOptions(): LoaderOptions }, source: string): string {
  const options = this.getOptions();
  if ('code' in options) return options.code;
  return 'index' in options ? HOT_SET + source : notifyingLocale(source, options.locale);
}
