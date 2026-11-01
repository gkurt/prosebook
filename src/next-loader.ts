/**
 * The Turbopack loader `prosebook/next` sets on the generated modules. In a build it hands over a
 * locale module `withProsebook` has already pruned, since that reads the source once for every
 * locale. In dev, in the browser, it puts what `withProsebook` hands it before the index (the hot
 * hooks, and the inspector), and makes each locale module update the copies holding it whenever Fast
 * Refresh runs it again.
 */
import { notifyingLocale } from './tools/bundle.ts';

export type LoaderOptions = { code: string } | { prepend: string } | { locale: string };

export default function loader(this: { getOptions(): LoaderOptions }, source: string): string {
  const options = this.getOptions();
  if ('code' in options) return options.code;
  return 'prepend' in options ? options.prepend + source : notifyingLocale(source, options.locale);
}
