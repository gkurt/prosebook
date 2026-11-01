/**
 * `copydeck/tools`: the build-time half, for scripts and other bundler integrations. The CLI and the
 * Vite plugin are written on these.
 */
export {
  CatalogError,
  KEY_PATTERN,
  loadCatalog,
  previewOf,
  type Catalog,
  type Message,
  type Problem,
  type Translation,
} from './catalog.ts';
export { compileLocale, localeExpression, localeModule, type CompiledLocale, type Entry } from './compile.ts';
export { defineConfig, loadConfig, resolveConfig, type CopydeckConfig, type ResolvedConfig } from './config.ts';
export { catalogSchema, generate, localeEntries, localesOf, render, writeFiles, type Generated } from './generate.ts';
export { lint, LINT_RULES, type Finding, type LintRule } from './lint.ts';
export { hash, readLock, reconcile, serializeLock, type Lock } from './lock.ts';
export { DEFAULT_KINDS, DEFAULT_SURFACES, STRICT_LISTS, type KindRule, type Severity } from './presets.ts';
export { pseudoAst, pseudoText } from './pseudo.ts';
export { hardcodedText, isReferenced, keyRefs, scan, sourceFiles, type Hardcoded, type KeyRefs } from './scan.ts';
