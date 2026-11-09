/**
 * `prosebook`: every string an app shows, in one typed catalog.
 *
 * The catalog is YAML, one entry per string, with the context a translator needs beside it.
 * `prosebook generate` compiles it into typed modules, one per locale, whose messages are plain
 * functions: this runtime looks them up, picks the locale and falls back, and parses nothing.
 */
export { addArea, createCopy, defineCatalog, type Catalog, type Copy, type CopyOptions, type Translate } from './runtime/copy.ts';
export { acceptedLocales, chainOf, dirOf, negotiate, preferredLocales } from './runtime/locale.ts';
export { createHelpers, flatten, type HelperOptions } from './runtime/helpers.ts';
export { defineFormatters } from './runtime/formats.ts';
export { relativeTime, type RelativeTime } from './runtime/relative.ts';
export type {
  DateFormatOptions,
  DurationFormatOptions,
  DurationUnit,
  Formats,
  Formatters,
  FormatterContext,
  FormatTable,
  ListFormatOptions,
  NumberFormatOptions,
  NumberStep,
  RelativeContext,
  RelativeFormatOptions,
  RelativeText,
  RelativeUnit,
} from './runtime/formats.ts';
export type {
  AnyTagFn,
  ArgsParam,
  Chunks,
  Compiled,
  CompiledMessages,
  DateFormatName,
  DefaultTags,
  DurationFormatName,
  Helpers,
  DevHooks,
  HotHook,
  ListFormatName,
  ListItem,
  MessageKey,
  MessageShape,
  MessageShapes,
  NumberFormatName,
  RelativeFormatName,
  ReadHook,
  Register,
  RegisteredLocale,
  RegisteredMessages,
  RichKey,
  RichParam,
  RichValues,
  TagFn,
} from './runtime/types.ts';
