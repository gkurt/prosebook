/**
 * A catalog compiled and run in memory, as `createCopy` takes the generated index's: for the tools that
 * read messages as an app does without writing the modules, the playground and `prosebook/test`.
 */
import { RUNTIME, type Catalog as RuntimeCatalog } from '#src/runtime/copy.ts';
import type { Formats } from '#src/runtime/formats.ts';
import { numberLadder } from '#src/runtime/ladder.ts';
import { relativeTime } from '#src/runtime/relative.ts';
import type { CompiledMessages } from '#src/runtime/types.ts';

import { compileLocale, localeExpression, type Entry } from './compile.ts';
import type { ResolvedConfig } from './config.ts';
import { formatsCode, runtimeParts, type Generated } from './generate.ts';

/** The runtime's parts a catalog holds where it uses them, as the generated index imports them. */
const PARTS = { relativeTime, numberLadder };

/** A locale's messages as the generated module holds them, run. */
function evaluate(entries: Entry[]): CompiledMessages {
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- running the compiler's own output is the point
  return new Function(`return ${localeExpression(compileLocale(entries))};`)() as CompiledMessages;
}

/** What `render` made, every locale's messages loaded, for `createCopy`. */
export function evaluatedCatalog(config: ResolvedConfig, generated: Pick<Generated, 'catalog' | 'entries'>): RuntimeCatalog {
  const formats = formatsCode(config);
  return {
    runtime: RUNTIME,
    source: config.source,
    locales: [...generated.entries.keys()],
    messages: Object.fromEntries([...generated.entries].map(([locale, entries]) => [locale, evaluate(entries)])),
    loaders: {},
    // oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- the formats as the generated index ships them, each text compiled
    ...(formats !== undefined && { formats: new Function(`return ${formats};`)() as Formats }),
    ...(config.formatters?.table !== undefined && { formatters: config.formatters.table }),
    ...Object.fromEntries(runtimeParts(config, generated.catalog).map((p) => [p.field, PARTS[p.name]])),
  };
}
