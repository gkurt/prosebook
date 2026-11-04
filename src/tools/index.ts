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
  whereOf,
  type Catalog,
  type EntryLocation,
  type LoadOptions,
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
  slugOf,
  type Extraction,
  type ExtractPlan,
  type FilePlan,
  type NewEntry,
} from './extract.ts';
export {
  applyFixes,
  editEntry,
  importTranslations,
  readEntry,
  type Imported,
  type EntryEdit,
  type EntryFields,
  type EntryFinding,
  type EntryView,
  type EntryYaml,
} from './entry.ts';
export { defineConfig, loadConfig, resolveConfig, type NativeTarget, type ProsebookConfig, type ResolvedConfig } from './config.ts';
export { catalogSchema, generate, localeEntries, localesOf, render, writeFiles, type Generated } from './generate.ts';
export { writingGuide } from './guide.ts';
export {
  applyEdits,
  compileRule,
  CORE_RULES,
  definePlugin,
  HOLE,
  lint,
  phrase,
  sentences,
  singularOf,
  words,
  type CapitalizationRule,
  type CheckRule,
  type ConditionalRule,
  type CoreRule,
  type Edit,
  type ExistenceRule,
  type Finding,
  type GuidelineRule,
  type OccurrenceRule,
  type Plugin,
  type Readings,
  type Report,
  type Rule,
  type RuleContext,
  type SubstitutionRule,
} from './lint.ts';
export { formatDiff, wordDiff, type DiffPart } from './diff.ts';
export { changeOf, emptyLock, hash, readLock, reconcile, serializeLock, type Lock, type StaleTranslation } from './lock.ts';
export { DEFAULT_KINDS, DEFAULT_SURFACES, STRICT_LISTS, type KindRule, type Severity } from './presets.ts';
export { pseudoAst, pseudoText } from './pseudo.ts';
export { intlDate, intlNumber, parseMf2, toMf2, type Isolate, type Mf2Function } from './mf2.ts';
export { toMf1 } from './mf1.ts';
export { applyMigrate, planMigrate, type MigratePlan } from './migrate.ts';
export { readMessage, SYNTAX_NAME, writeMessage, type MessageFormatVersion } from './syntax.ts';
export { syntaxKind, typescriptOracle, type Span, type TypeOracle, type ValueKind } from './types.ts';
export { todoMessages, todoOf, type Todo } from './todo.ts';
export { exportOf, readReturned, type ExchangeFormat, type Exported, type Returned } from './exchange.ts';
export { SarifReport, type SarifResult, type SarifTool } from './sarif.ts';
export {
  hardcodedText,
  isReferenced,
  keyRefs,
  looksLikeCode,
  READERS,
  scan,
  sourceFiles,
  unseenReads,
  type Hardcoded,
  type KeyRefs,
  type Reads,
  type UnseenRead,
} from './scan.ts';
