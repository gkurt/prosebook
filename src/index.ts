/**
 * `prosebook`: every string an app shows, in one typed catalog.
 *
 * The catalog is YAML, one entry per string, with the context a translator needs beside it.
 * `prosebook generate` compiles it into typed modules, one per locale, whose messages are plain
 * functions: this runtime looks them up, picks the locale and falls back, and parses nothing.
 */
export { addArea, createCopy, defineCatalog, type Catalog, type Copy, type CopyOptions, type Translate } from './runtime/copy.ts';
export { acceptedLocales, chainOf, negotiate, preferredLocales } from './runtime/locale.ts';
export { createHelpers, flatten } from './runtime/helpers.ts';
export type { Formats, FormatTable } from './runtime/formats.ts';
export type {
  AnyTagFn,
  ArgsParam,
  Chunks,
  Compiled,
  CompiledMessages,
  DateFormatName,
  DefaultTags,
  Helpers,
  DevHooks,
  HotHook,
  MessageKey,
  MessageShape,
  MessageShapes,
  NumberFormatName,
  ReadHook,
  Register,
  RegisteredLocale,
  RegisteredMessages,
  RichKey,
  RichParam,
  RichValues,
  TagFn,
} from './runtime/types.ts';
