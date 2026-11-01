/**
 * `prosebook/tools`: the build-time half, for scripts and other bundler integrations. The CLI and the
 * Vite plugin are written on these.
 */
export {
  CatalogError,
  entryLocation,
  KEY_PATTERN,
  loadCatalog,
  previewOf,
  type Catalog,
  type EntryLocation,
  type Message,
  type Problem,
  type Translation,
} from './catalog.ts';
export { compileLocale, localeExpression, localeModule, type CompiledLocale, type Entry } from './compile.ts';
export {
  applyExtract,
  areaOf,
  draftPlurals,
  planExtract,
  singularOf,
  slugOf,
  type Extraction,
  type ExtractPlan,
  type FilePlan,
  type NewEntry,
} from './extract.ts';
export { defineConfig, loadConfig, resolveConfig, type ProsebookConfig, type ResolvedConfig } from './config.ts';
export { catalogSchema, generate, localeEntries, localesOf, render, writeFiles, type Generated } from './generate.ts';
export { lint, LINT_RULES, type Finding, type LintRule } from './lint.ts';
export { formatDiff, wordDiff, type DiffPart } from './diff.ts';
export { emptyLock, hash, readLock, reconcile, serializeLock, type Lock, type StaleTranslation } from './lock.ts';
export { DEFAULT_KINDS, DEFAULT_SURFACES, STRICT_LISTS, type KindRule, type Severity } from './presets.ts';
export { pseudoAst, pseudoText } from './pseudo.ts';
export { intlDate, intlNumber, parseMf2, toMf2, type Mf2Function } from './mf2.ts';
export { toMf1 } from './mf1.ts';
export { applyMigrate, planMigrate, type MigratePlan } from './migrate.ts';
export { readMessage, SYNTAX_NAME, writeMessage, type MessageFormatVersion } from './syntax.ts';
export { syntaxKind, typescriptOracle, type Span, type TypeOracle, type ValueKind } from './types.ts';
export { hardcodedText, isReferenced, keyRefs, looksLikeCode, scan, sourceFiles, type Hardcoded, type KeyRefs } from './scan.ts';
