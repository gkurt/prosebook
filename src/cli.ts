#!/usr/bin/env node
/**
 * The `prosebook` command. Each subcommand is a function of the resolved config; `check` runs the
 * ones CI needs in one go.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { watchCatalog } from './tools/bundle.ts';
import { CatalogError, entryLocator, SCHEMA_LINE, whereOf, type Catalog, type Problem } from './tools/catalog.ts';
import { CONFIG_FILES, loadConfig, type ResolvedConfig } from './tools/config.ts';
import { applyFixes, importTranslations } from './tools/entry.ts';
import { exportOf, type ExchangeFormat } from './tools/exchange.ts';
import { applyExtract, planExtract } from './tools/extract.ts';
import { generate, render } from './tools/generate.ts';
import { lint, type Finding } from './tools/lint.ts';
import { changeOf, type StaleTranslation } from './tools/lock.ts';
import { applyMigrate, planMigrate } from './tools/migrate.ts';
import { SarifReport } from './tools/sarif.ts';
import { isReferenced, scan, sourceFiles } from './tools/scan.ts';
import { SYNTAX_NAME } from './tools/syntax.ts';
import { todoOf } from './tools/todo.ts';

const HELP = `prosebook: every string your app shows, in one typed catalog

Usage: prosebook <command> [options]

Commands:
  init                    Create a config and a first catalog file
  generate                Compile the catalog into typed modules  (--check: fail if out of date, --watch)
  lint                    Check the messages and their translations against the writing rules
                          (--fix: write the fixes the rules know, such as spellings and …)
  status                  Translation coverage and stale translations per locale  (--strict, --verbose)
  accept <locale> [keys]  Mark stale translations as still right  (--all for every stale one)
  todo <locale>           Print the missing and stale entries of a locale, ready to translate
                          (--prompt: as a prompt for a model, saying how to reply)
  export <locale> [file]  Write the entries todo lists as XLIFF 2.0 or JSON, for a translation tool
                          (--all: every entry; the format from the file's extension, or --format)
  import <locale> [file]  Write translations from todo's YAML filled in, a model's reply to --prompt,
                          or a tool's XLIFF or JSON (stdin without a file); each is checked first,
                          and one that fails is left out
  scan                    Find hardcoded text in JSX and catalog keys no code reads  (--strict)
  extract [paths]         Move hardcoded JSX text into the catalog and rewrite the code to read it
                          (dry run unless --write; --area <name> puts every entry in one area)
  migrate <1|2>           Rewrite the catalog and translations in ICU MessageFormat (1) or MessageFormat 2
                          (dry run unless --write)
  check                   generate --check, lint and status --strict together, for CI

Options:
  --root <dir>            Project root (default: the current directory)
  --format <text|sarif>   With lint, scan, status and check: sarif writes a SARIF 2.1.0 log to stdout
                          for code scanning, and the usual text to stderr
  --format <xliff|json>   With export: the file's format (XLIFF by default on stdout)
  -h, --help              Show this help
`;

const SARIF_COMMANDS = ['lint', 'scan', 'status', 'check'];
const EXCHANGE_FORMATS: Record<string, ExchangeFormat> = { xliff: 'xliff', xlf: 'xliff', json: 'json' };

/** What the checks that aren't lint rules hold the project to, for the rules in a SARIF log. */
const RULES = {
  catalog: 'The catalog and its translations parse, and each translation keeps the placeholders of its source.',
  'out-of-date': 'The generated modules match the catalog: run `prosebook generate`.',
  'missing-translation': 'Every locale translates every entry.',
  'stale-translation': 'A translation was made from the source text as it is now.',
  'hardcoded-text': 'Text a person reads comes from the catalog, not from a literal in JSX.',
  'unused-key': 'Code reads every catalog key.',
  allow: "An entry's exemption names a rule the entry breaks, and says why in a sentence.",
};

/** Text for people. Under `--format sarif` stdout holds only the log, so this goes to stderr. */
let out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s = '') => process.stderr.write(`${s}\n`);

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      check: { type: 'boolean' },
      watch: { type: 'boolean' },
      strict: { type: 'boolean' },
      verbose: { type: 'boolean' },
      all: { type: 'boolean' },
      write: { type: 'boolean' },
      fix: { type: 'boolean' },
      prompt: { type: 'boolean' },
      area: { type: 'string' },
      format: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || command === undefined) {
    out(HELP);
    return 0;
  }
  if (command === 'export') {
    if (values.format !== undefined && EXCHANGE_FORMATS[values.format] === undefined) {
      err(`prosebook: export writes xliff or json, not "${values.format}"`);
      return 1;
    }
  } else if (values.format !== undefined && values.format !== 'text' && values.format !== 'sarif') {
    err(`prosebook: --format is text or sarif, not "${values.format}"`);
    return 1;
  }
  const report = values.format === 'sarif' ? new SarifReport() : undefined;
  if (report !== undefined) {
    if (!SARIF_COMMANDS.includes(command)) {
      err(`prosebook: --format sarif works with ${SARIF_COMMANDS.join(', ')}`);
      return 1;
    }
    out = err;
  }
  const root = values.root ?? process.cwd();
  if (command === 'init') return init(root);
  const config = await loadConfig(root);
  let code: number;
  try {
    switch (command) {
      case 'generate':
      case 'gen':
        if (values.watch) return watchMode(config);
        return runGenerate(config, values.check === true);
      case 'lint':
        code = runLint(config, report, values.fix === true);
        break;
      case 'status':
        code = runStatus(config, values.strict === true, values.verbose === true, report);
        break;
      case 'accept':
        return runAccept(config, rest, values.all === true);
      case 'todo':
        return runTodo(config, rest[0], values.prompt === true);
      case 'export':
        return runExport(config, rest[0], rest[1], values.format, values.all === true);
      case 'import':
        return runImport(config, rest[0], rest[1]);
      case 'scan':
        code = runScan(config, values.strict === true, report);
        break;
      case 'extract':
        return runExtract(config, rest, values.write === true, values.area);
      case 'migrate':
        return runMigrate(config, rest[0], values.write === true);
      case 'check': {
        const results = [runGenerate(config, true, report), runLint(config, report), runStatus(config, true, false, report)];
        code = results.some((r) => r !== 0) ? 1 : 0;
        break;
      }
      default:
        err(`prosebook: no command "${command}"\n`);
        out(HELP);
        return 1;
    }
  } catch (e) {
    if (!(e instanceof CatalogError)) throw e;
    reportProblems(config, e.problems, report);
    err(`\n${e.problems.filter((p) => p.severity === 'error').length} error(s) in the catalog.`);
    code = 1;
  }
  if (report !== undefined) process.stdout.write(`${JSON.stringify(report.toJSON(config.root, tool()), null, 2)}\n`);
  return code;
}

function tool() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string; homepage: string };
  return { name: 'prosebook', version: pkg.version, informationUri: pkg.homepage };
}

function reportProblems(config: ResolvedConfig, problems: Problem[], report?: SarifReport) {
  for (const p of problems) err(`${p.severity === 'error' ? 'error' : 'warn '} ${whereOf(p)}: ${p.message}`);
  if (report === undefined) return;
  const locate = entryLocator(config.root);
  report.rule('catalog', RULES.catalog);
  for (const p of problems) {
    report.add({
      rule: 'catalog',
      level: p.severity === 'error' ? 'error' : 'warning',
      message: p.message,
      file: p.file,
      ...(p.file !== undefined && p.key !== undefined ? locate(p.file, p.key) : {}),
    });
  }
}

const errorsIn = (catalog: Catalog) => catalog.problems.filter((p) => p.severity === 'error');

/** Said once per run, as `check` renders the catalog for each of its parts. */
let saidErrors = false;

/**
 * The catalog rendered with each broken entry left out, so one entry being edited doesn't stop the
 * rest from being generated and checked. Its errors are reported, once, and fail the command.
 */
function rendered(config: ResolvedConfig, report?: SarifReport) {
  const generated = render(config, undefined, { partial: true });
  sayErrors(config, generated.catalog, report);
  return generated;
}

function sayErrors(config: ResolvedConfig, catalog: Catalog, report?: SarifReport) {
  const problems = errorsIn(catalog);
  if (saidErrors || problems.length === 0) return;
  saidErrors = true;
  reportProblems(config, problems, report);
  err(`${problems.length} error(s) in the catalog: those entries are left out until they're fixed.\n`);
}

function rel(config: ResolvedConfig, path: string) {
  return relative(config.root, path).replaceAll('\\', '/');
}

function runGenerate(config: ResolvedConfig, check: boolean, report?: SarifReport): number {
  const { changed, catalog, stale } = generate(config, { check, partial: true });
  const broken = errorsIn(catalog).length > 0 ? 1 : 0;
  // Warnings first, then the errors with what they mean.
  reportProblems(
    config,
    catalog.problems.filter((p) => p.severity !== 'error'),
    report,
  );
  sayErrors(config, catalog, report);
  const staleCount = [...stale.values()].reduce((n, s) => n + s.size, 0);
  const summary = `${catalog.messages.length} messages, ${catalog.locales.length + 1} locale(s)${staleCount > 0 ? `, ${staleCount} stale translation(s)` : ''}`;
  if (check) {
    if (changed.length === 0) {
      out(`prosebook: generated files are up to date (${summary})`);
      return broken;
    }
    // A catalog file is listed for its schema line, which generate adds.
    const why = (p: string) =>
      dirname(p) === config.catalog && p.endsWith('.yaml')
        ? `its first line isn't \`${SCHEMA_LINE}\`, so editors can't find the schema`
        : 'out of date';
    err(
      `prosebook: out of date, run \`prosebook generate\`:\n  ${changed.map((p) => `${rel(config, p)}${why(p) === 'out of date' ? '' : `: ${why(p)}`}`).join('\n  ')}`,
    );
    report?.rule('out-of-date', RULES['out-of-date']);
    for (const p of changed)
      report?.add({ rule: 'out-of-date', level: 'error', message: `${why(p)}: run \`prosebook generate\``, file: rel(config, p) });
    return 1;
  }
  // A dev server may have written them a moment before, so "nothing changed" would mislead.
  out(`prosebook: ${changed.length === 0 ? 'the generated files are current' : `wrote ${changed.length} file(s)`} (${summary})`);
  return broken;
}

function watchMode(config: ResolvedConfig): Promise<number> {
  const regenerate = () => {
    saidErrors = false;
    try {
      runGenerate(config, false);
    } catch (e) {
      if (e instanceof CatalogError) reportProblems(config, e.problems);
      else err(String(e));
    }
  };
  regenerate();
  watchCatalog(config, regenerate);
  out('prosebook: watching the catalog for changes');
  return new Promise(() => {});
}

function runLint(config: ResolvedConfig, report?: SarifReport, fix = false): number {
  let { catalog } = rendered(config, report);
  let findings = lint(catalog.messages, config);
  if (fix) {
    const { fixed, problems } = applyFixes(config, catalog, findings);
    if (problems.length > 0) {
      reportProblems(config, problems, report);
      err('The fixes would break the catalog, so nothing was written.');
      return 1;
    }
    if (fixed > 0) {
      out(`prosebook: fixed ${fixed} finding(s); run prosebook generate to compile them`);
      ({ catalog } = rendered(config, report));
      findings = lint(catalog.messages, config);
    }
  }
  const placed = printFindings(config, findings);
  if (report !== undefined) {
    for (const [name, { rule }] of Object.entries(config.lint.rules)) report.rule(name, rule.description);
    report.rule('allow', RULES.allow);
    for (const f of placed) {
      report.add({
        rule: f.rule,
        level: f.severity === 'error' ? 'error' : 'warning',
        message: `${f.key}: ${f.message}`,
        file: f.file,
        line: f.line,
        column: f.column,
      });
    }
  }
  const errors = findings.filter((f) => f.severity === 'error').length;
  const fixable = findings.filter((f) => f.fix !== undefined).length;
  const broken = errorsIn(catalog).length;
  if (findings.length === 0) {
    out(
      `prosebook: ${catalog.messages.length} messages pass the writing rules${broken > 0 ? `, and ${broken} broken entr${broken === 1 ? 'y was' : 'ies were'} left out` : ''}`,
    );
  } else {
    err(
      `\n${errors} error(s), ${findings.length - errors} warning(s). Fix the string, or add \`allow: { <rule>: <why> }\` where the rule is wrong about it.`,
    );
    if (fixable > 0) err(`${fixable} of them can be fixed with prosebook lint --fix.`);
  }
  return errors + broken > 0 ? 1 : 0;
}

/** Each finding on its line, placed at its entry's words. */
function printFindings(config: ResolvedConfig, findings: Finding[]) {
  const locate = entryLocator(config.root);
  const placed = findings.map((f) => ({ ...f, ...locate(f.file, f.key, f.at?.start, config.source) }));
  for (const f of placed) {
    const severity = f.severity === 'error' ? 'error' : 'warn ';
    err(`${severity} ${f.file}:${f.line}:${f.column} ${f.key}: [${f.rule}] ${f.message}${f.fix === undefined ? '' : ' (fixable)'}`);
  }
  return placed;
}

function missingKeys(catalog: Catalog, locale: string): string[] {
  return catalog.messages.filter((m) => !m.translations.has(locale)).map((m) => m.key);
}

function runStatus(config: ResolvedConfig, strict: boolean, verbose: boolean, report?: SarifReport): number {
  const { catalog, stale } = rendered(config, report);
  const broken = errorsIn(catalog).length > 0 ? 1 : 0;
  if (report !== undefined) reportStatus(config, catalog, stale, strict ? 'error' : 'warning', report);
  const total = catalog.messages.length;
  if (catalog.locales.length === 0) {
    out(`prosebook: ${total} messages in ${config.source}, no translations yet`);
    return broken;
  }
  let incomplete = false;
  out(`${'locale'.padEnd(10)} ${'translated'.padStart(12)} ${'missing'.padStart(8)} ${'stale'.padStart(6)}`);
  for (const locale of catalog.locales) {
    const missing = missingKeys(catalog, locale);
    const staleHere = stale.get(locale) ?? new Map<string, StaleTranslation>();
    const staleKeys = [...staleHere.keys()];
    const done = total - missing.length;
    if (missing.length > 0 || staleKeys.length > 0) incomplete = true;
    const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
    out(
      `${locale.padEnd(10)} ${`${done}/${total} ${String(pct).padStart(3)}%`.padStart(12)} ${String(missing.length).padStart(8)} ${String(staleKeys.length).padStart(6)}`,
    );
    if (verbose) {
      for (const key of missing) out(`  missing ${key}`);
      for (const [key, s] of staleHere) out(`  stale   ${key}: ${changeOf(s)}`);
    }
  }
  if (incomplete && !verbose)
    out('\n`prosebook status --verbose` lists the keys; `prosebook todo <locale>` prints them ready to translate.');
  return strict && incomplete ? 1 : broken;
}

function reportStatus(
  config: ResolvedConfig,
  catalog: Catalog,
  stale: Map<string, Map<string, StaleTranslation>>,
  level: 'error' | 'warning',
  report: SarifReport,
) {
  const locate = entryLocator(config.root);
  report.rule('missing-translation', RULES['missing-translation']);
  report.rule('stale-translation', RULES['stale-translation']);
  for (const locale of catalog.locales) {
    for (const m of catalog.messages) {
      if (m.translations.has(locale)) continue;
      const message = `${m.key} has no ${locale} translation: \`prosebook todo ${locale}\` prints it ready to translate`;
      report.add({ rule: 'missing-translation', level, message, file: m.file, ...locate(m.file, m.key) });
    }
    for (const [key, s] of stale.get(locale) ?? []) {
      const file = catalog.messages.find((m) => m.key === key)?.translations.get(locale)?.file;
      if (file === undefined) continue;
      const message = `the ${locale} translation of ${key} was made from an earlier source (${changeOf(s)}): update it, or \`prosebook accept ${locale} ${key}\` if it is still right`;
      report.add({ rule: 'stale-translation', level, message, file, ...locate(file, key) });
    }
  }
}

function runAccept(config: ResolvedConfig, args: string[], all: boolean): number {
  const [locale, ...keys] = args;
  if (locale === undefined || (keys.length === 0 && !all)) {
    err('Usage: prosebook accept <locale> <key>... | prosebook accept <locale> --all');
    return 1;
  }
  const before = rendered(config).stale.get(locale) ?? new Map<string, StaleTranslation>();
  const accepting = all ? new Set(before.keys()) : new Set(keys);
  for (const key of accepting) if (!before.has(key)) err(`warn  ${locale} ${key} is not stale`);
  generate(config, { accept: new Map([[locale, all ? true : new Set(keys)]]), partial: true });
  out(`prosebook: accepted ${[...accepting].filter((k) => before.has(k)).length} translation(s) in ${locale}`);
  return 0;
}

function runTodo(config: ResolvedConfig, locale: string | undefined, prompt: boolean): number {
  if (locale === undefined) {
    err('Usage: prosebook todo <locale> [--prompt]');
    return 1;
  }
  const { catalog, stale } = rendered(config);
  const todo = todoOf(config, catalog, stale.get(locale) ?? new Map(), locale, prompt);
  out(todo.text);
  if (prompt && todo.count > 0) err(`\nHand this to a model, save its reply, and \`prosebook import ${locale} <reply>\`.`);
  return 0;
}

function runExport(
  config: ResolvedConfig,
  locale: string | undefined,
  file: string | undefined,
  named: string | undefined,
  all: boolean,
): number {
  if (locale === undefined) {
    err('Usage: prosebook export <locale> [file] [--all] [--format xliff|json]');
    return 1;
  }
  const format = EXCHANGE_FORMATS[named ?? (file === undefined ? 'xliff' : extname(file).slice(1).toLowerCase())];
  if (format === undefined) {
    err(`prosebook: ${file} is neither .xlf nor .json: name the format with --format xliff or --format json`);
    return 1;
  }
  const { catalog, stale } = rendered(config);
  const exported = exportOf(config, catalog, stale.get(locale) ?? new Map(), locale, format, all);
  if (exported.count === 0) {
    err(`prosebook: ${locale} is complete; --all exports every entry`);
    return 0;
  }
  if (file === undefined) {
    process.stdout.write(exported.text);
    return 0;
  }
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, exported.text);
  out(`prosebook: exported ${exported.count} entr${exported.count === 1 ? 'y' : 'ies'} for ${locale} to ${file}`);
  if (locale !== config.source) out(`Translate them, then \`prosebook import ${locale} ${file}\`.`);
  return 0;
}

function runImport(config: ResolvedConfig, locale: string | undefined, file: string | undefined): number {
  if (locale === undefined || ((file === undefined || file === '-') && process.stdin.isTTY)) {
    err('Usage: prosebook import <locale> <file>, or the reply on stdin');
    return 1;
  }
  const reply = readFileSync(file === undefined || file === '-' ? 0 : resolve(file), 'utf8');
  const { written, unchanged, problems } = importTranslations(config, locale, reply);
  reportProblems(config, problems);
  if (written.length + unchanged.length > 0) {
    // A stale translation given back unchanged was looked at and still holds.
    const stale = rendered(config).stale.get(locale) ?? new Map<string, StaleTranslation>();
    const kept = unchanged.filter((key) => stale.has(key));
    const { catalog } = generate(config, { accept: new Map([[locale, new Set(kept)]]), partial: true });
    out(
      `prosebook: imported ${written.length} translation(s) into ${locale}${kept.length > 0 ? `, and accepted ${kept.length} stale one(s) as still right` : ''}`,
    );
    const imported = new Set(written);
    printFindings(
      config,
      lint(
        catalog.messages.filter((m) => imported.has(m.key)),
        config,
      ).filter((f) => f.locale === locale),
    );
  }
  if (problems.length === 0) return 0;
  err(`\n${problems.length} left out: fix them, or hand these lines back to the model, and import again.`);
  return 1;
}

function runScan(config: ResolvedConfig, strict: boolean, report?: SarifReport): number {
  const { catalog } = rendered(config, report);
  const result = scan(config.scan.dirs, config.scan.extensions, config.scan.attributes, config.root, [config.out]);
  for (const h of result.hardcoded)
    err(`${h.file}:${h.line}:${h.column} hardcoded ${h.where === 'text' ? 'text' : `${h.where}=`} "${h.text}"`);
  const unused = catalog.messages.filter((m) => !isReferenced(m.key, result.refs));
  for (const m of unused) err(`${m.file} ${m.key}: no code reads this key`);
  if (report !== undefined) {
    const level = strict ? 'error' : 'warning';
    const locate = entryLocator(config.root);
    report.rule('hardcoded-text', RULES['hardcoded-text']);
    report.rule('unused-key', RULES['unused-key']);
    for (const h of result.hardcoded) {
      const what = `${h.where === 'text' ? '' : `${h.where}=`}"${h.text}"`;
      const message = `${what} is hardcoded: move it into the catalog with \`prosebook extract\`, or mark the line \`prosebook-ignore\``;
      report.add({ rule: 'hardcoded-text', level, message, file: h.file, line: h.line, column: h.column });
    }
    for (const m of unused)
      report.add({ rule: 'unused-key', level, message: `no code reads ${m.key}: remove it`, file: m.file, ...locate(m.file, m.key) });
  }
  out(
    `prosebook: scanned ${result.files} file(s): ${result.hardcoded.length} hardcoded string(s), ${unused.length} unused key(s)` +
      (result.hardcoded.length > 0
        ? '. `prosebook extract` moves the text into the catalog; mark a deliberate line `prosebook-ignore`.'
        : ''),
  );
  return strict && result.hardcoded.length + unused.length > 0 ? 1 : errorsIn(catalog).length > 0 ? 1 : 0;
}

async function runExtract(config: ResolvedConfig, paths: string[], write: boolean, area: string | undefined): Promise<number> {
  const targets = paths.length > 0 ? paths.map((p) => resolve(config.root, p)) : config.scan.dirs;
  const files = sourceFiles(targets, ['.tsx', '.jsx'], [config.out]).concat(targets.filter((t) => /\.[jt]sx$/.test(t) && existsSync(t)));
  const plan = await planExtract(config, [...new Set(files)], { area });
  const extractions = plan.files.flatMap((f) => f.extractions);
  for (const x of extractions) {
    out(`${x.file}:${x.line}:${x.column}  ${x.where === 'text' ? '' : `${x.where}=`}"${x.message}"`);
    out(`  → ${x.key}${x.reused ? ' (already in the catalog)' : ''}: ${x.replacement.trim()}`);
  }
  for (const f of plan.files) for (const w of f.warnings) err(`warn  ${w}`);
  if (extractions.length === 0) {
    out('prosebook: no hardcoded text to extract');
    return 0;
  }
  const changedFiles = plan.files.filter((f) => f.edits.length > 0).length;
  const areas = [...new Set(plan.entries.map((e) => e.area))].map((a) => `${a}.yaml`);
  const summary = `${extractions.length} string(s) in ${changedFiles} file(s), ${plan.entries.length} new entr${plan.entries.length === 1 ? 'y' : 'ies'}${areas.length > 0 ? ` in ${areas.join(', ')}` : ''}`;
  out(`
Placeholder types: ${plan.types === 'syntax' ? 'read from the code alone (no TypeScript 7 project found)' : `from ${plan.types}`}.`);
  if (!write) {
    out(`prosebook: would extract ${summary}. Run again with --write to apply.`);
    return 0;
  }
  applyExtract(config, plan);
  out(`
prosebook: extracted ${summary}.`);
  out('The new entries are marked `TODO(prosebook extract)`: check each key, kind, context and argument, then run `prosebook lint`.');
  return runGenerate(config, false);
}

function runMigrate(config: ResolvedConfig, target: string | undefined, write: boolean): number {
  const to = target === '1' ? 1 : target === '2' ? 2 : undefined;
  if (to === undefined) {
    err('Usage: prosebook migrate <1|2> [--write]');
    return 1;
  }
  if (config.messageFormat === to) {
    out(`prosebook: the catalog is already in ${SYNTAX_NAME[to]}`);
    return 0;
  }
  const plan = planMigrate(config, to);
  const where = (x: { file: string; key: string; locale: string }) =>
    `${x.file} ${x.key}${x.locale === config.source ? '' : ` (${x.locale})`}`;
  for (const r of plan.rewrites) out(`${where(r)}\n  ${r.after.replaceAll('\n', '\n  ')}`);
  for (const c of plan.changed) err(`warn  ${where(c)}: renders differently for ${c.values}: "${c.before}" becomes "${c.after}"`);
  for (const b of plan.blocked) err(`error ${where(b)}: ${b.reason}`);
  if (plan.blocked.length > 0) {
    err(`
prosebook: ${plan.blocked.length} message(s) have no ${SYNTAX_NAME[to]} equivalent. Change them, then migrate again; nothing was written.`);
    return 1;
  }
  const files = new Set(plan.rewrites.map((r) => r.file)).size;
  const summary = `${plan.rewrites.length} message(s) in ${files} file(s) in ${SYNTAX_NAME[to]}`;
  if (!write) {
    out(`
prosebook: would rewrite ${summary}. Run again with --write to apply.`);
    return 0;
  }
  applyMigrate(config, plan);
  out(`
prosebook: rewrote ${summary}.`);
  out(`Now set \`messageFormat: ${to}\` in the config, then run \`prosebook generate\`.`);
  return 0;
}

const SAMPLE_CONFIG = `import { defineConfig } from 'prosebook/config';

export default defineConfig({
  catalog: 'copy/catalog',
  locales: 'copy/locales',
  out: 'src/copy',
  source: 'en',
  // Write messages in Unicode MessageFormat 2 rather than ICU MessageFormat:
  // messageFormat: 2,
});
`;

const SAMPLE_CATALOG = `${SCHEMA_LINE}
app.title:
  kind: name
  surface: title
  context: The app's name, in the window title and the header.
  en: My app

app.greeting:
  kind: state
  surface: status
  context: Greets the person signed in, at the top of the home page.
  args:
    name: the person's first name
  en: Welcome back, {name}.
`;

function init(root: string): number {
  const configured = CONFIG_FILES.find((f) => existsSync(join(root, f)));
  if (configured === undefined) {
    writeFileSync(join(root, 'prosebook.config.ts'), SAMPLE_CONFIG);
    out('created prosebook.config.ts');
  }
  const catalogDir = join(root, 'copy', 'catalog');
  if (!existsSync(catalogDir)) {
    mkdirSync(catalogDir, { recursive: true });
    mkdirSync(join(root, 'copy', 'locales'), { recursive: true });
    writeFileSync(join(catalogDir, 'app.yaml'), SAMPLE_CATALOG);
    out('created copy/catalog/app.yaml');
  }
  out('\nNext: `prosebook generate`, then `createCopy(catalog)` from the generated src/copy.');
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    err(e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exit(1);
  },
);
