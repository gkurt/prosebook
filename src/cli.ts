#!/usr/bin/env node
/**
 * The `copydeck` command. Each subcommand is a function of the resolved config; `check` runs the
 * ones CI needs in one go.
 */
import { existsSync, mkdirSync, watch, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { stringify } from 'yaml';

import { CatalogError, type Catalog } from './tools/catalog.ts';
import { CONFIG_FILES, loadConfig, type ResolvedConfig } from './tools/config.ts';
import { applyExtract, planExtract } from './tools/extract.ts';
import { generate, render } from './tools/generate.ts';
import { lint } from './tools/lint.ts';
import { isReferenced, scan, sourceFiles } from './tools/scan.ts';

const HELP = `copydeck: every string your app shows, in one typed catalog

Usage: copydeck <command> [options]

Commands:
  init                    Create a config and a first catalog file
  generate                Compile the catalog into typed modules  (--check: fail if out of date, --watch)
  lint                    Check the source messages against the writing rules
  status                  Translation coverage and stale translations per locale  (--strict, --verbose)
  accept <locale> [keys]  Mark stale translations as still right  (--all for every stale one)
  todo <locale>           Print the missing and stale entries of a locale, ready to translate
  scan                    Find hardcoded text in JSX and catalog keys no code reads  (--strict)
  extract [paths]         Move hardcoded JSX text into the catalog and rewrite the code to read it
                          (dry run unless --write; --area <name> puts every entry in one area)
  check                   generate --check, lint and status --strict together, for CI

Options:
  --root <dir>            Project root (default: the current directory)
  -h, --help              Show this help
`;

const out = (s = '') => process.stdout.write(`${s}\n`);
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
      area: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || command === undefined) {
    out(HELP);
    return 0;
  }
  const root = values.root ?? process.cwd();
  if (command === 'init') return init(root);
  const config = await loadConfig(root);
  try {
    switch (command) {
      case 'generate':
      case 'gen':
        if (values.watch) return watchMode(config);
        return runGenerate(config, values.check === true);
      case 'lint':
        return runLint(config);
      case 'status':
        return runStatus(config, values.strict === true, values.verbose === true);
      case 'accept':
        return runAccept(config, rest, values.all === true);
      case 'todo':
        return runTodo(config, rest[0]);
      case 'scan':
        return runScan(config, values.strict === true);
      case 'extract':
        return runExtract(config, rest, values.write === true, values.area);
      case 'check': {
        const results = [runGenerate(config, true), runLint(config), runStatus(config, true, false)];
        return results.some((r) => r !== 0) ? 1 : 0;
      }
      default:
        err(`copydeck: no command "${command}"\n`);
        out(HELP);
        return 1;
    }
  } catch (e) {
    if (e instanceof CatalogError) {
      reportProblems(e);
      return 1;
    }
    throw e;
  }
}

function reportProblems(e: CatalogError) {
  for (const p of e.problems) err(`${p.severity === 'error' ? 'error' : 'warn '} ${p.where}: ${p.message}`);
  err(`\n${e.problems.filter((p) => p.severity === 'error').length} error(s) in the catalog.`);
}

function rel(config: ResolvedConfig, path: string) {
  return relative(config.root, path).replaceAll('\\', '/');
}

function runGenerate(config: ResolvedConfig, check: boolean): number {
  const { changed, catalog, stale } = generate(config, { check });
  for (const p of catalog.problems) err(`warn  ${p.where}: ${p.message}`);
  const staleCount = [...stale.values()].reduce((n, s) => n + s.size, 0);
  const summary = `${catalog.messages.length} messages, ${catalog.locales.length + 1} locale(s)${staleCount > 0 ? `, ${staleCount} stale translation(s)` : ''}`;
  if (check) {
    if (changed.length === 0) {
      out(`copydeck: generated files are up to date (${summary})`);
      return 0;
    }
    err(`copydeck: out of date, run \`copydeck generate\`:\n  ${changed.map((p) => rel(config, p)).join('\n  ')}`);
    return 1;
  }
  out(`copydeck: ${changed.length === 0 ? 'nothing changed' : `wrote ${changed.length} file(s)`} (${summary})`);
  return 0;
}

function watchMode(config: ResolvedConfig): Promise<number> {
  const regenerate = () => {
    try {
      runGenerate(config, false);
    } catch (e) {
      if (e instanceof CatalogError) reportProblems(e);
      else err(String(e));
    }
  };
  regenerate();
  let timer: ReturnType<typeof setTimeout> | undefined;
  for (const dir of [config.catalog, config.locales]) {
    if (!existsSync(dir)) continue;
    watch(dir, { recursive: true }, (_event, file) => {
      if (file === null || !String(file).endsWith('.yaml')) return;
      clearTimeout(timer);
      timer = setTimeout(regenerate, 50);
    });
  }
  out('copydeck: watching the catalog for changes');
  return new Promise(() => {});
}

function runLint(config: ResolvedConfig): number {
  const { catalog } = render(config);
  const findings = lint(catalog.messages, config);
  for (const f of findings) err(`${f.severity === 'error' ? 'error' : 'warn '} ${f.file} ${f.key}: [${f.rule}] ${f.message}`);
  const errors = findings.filter((f) => f.severity === 'error').length;
  if (findings.length === 0) {
    out(`copydeck: ${catalog.messages.length} messages pass the writing rules`);
  } else {
    err(
      `\n${errors} error(s), ${findings.length - errors} warning(s). Fix the string, or add \`allow: { <rule>: <why> }\` where the rule is wrong about it.`,
    );
  }
  return errors > 0 ? 1 : 0;
}

function missingKeys(catalog: Catalog, locale: string): string[] {
  return catalog.messages.filter((m) => !m.translations.has(locale)).map((m) => m.key);
}

function runStatus(config: ResolvedConfig, strict: boolean, verbose: boolean): number {
  const { catalog, stale } = render(config);
  const total = catalog.messages.length;
  if (catalog.locales.length === 0) {
    out(`copydeck: ${total} messages in ${config.source}, no translations yet`);
    return 0;
  }
  let incomplete = false;
  out(`${'locale'.padEnd(10)} ${'translated'.padStart(12)} ${'missing'.padStart(8)} ${'stale'.padStart(6)}`);
  for (const locale of catalog.locales) {
    const missing = missingKeys(catalog, locale);
    const staleKeys = [...(stale.get(locale) ?? [])];
    const done = total - missing.length;
    if (missing.length > 0 || staleKeys.length > 0) incomplete = true;
    const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
    out(
      `${locale.padEnd(10)} ${`${done}/${total} ${String(pct).padStart(3)}%`.padStart(12)} ${String(missing.length).padStart(8)} ${String(staleKeys.length).padStart(6)}`,
    );
    if (verbose) {
      for (const key of missing) out(`  missing ${key}`);
      for (const key of staleKeys) out(`  stale   ${key}`);
    }
  }
  if (incomplete && !verbose) out('\n`copydeck status --verbose` lists the keys; `copydeck todo <locale>` prints them ready to translate.');
  return strict && incomplete ? 1 : 0;
}

function runAccept(config: ResolvedConfig, args: string[], all: boolean): number {
  const [locale, ...keys] = args;
  if (locale === undefined || (keys.length === 0 && !all)) {
    err('Usage: copydeck accept <locale> <key>... | copydeck accept <locale> --all');
    return 1;
  }
  const before = render(config).stale.get(locale) ?? new Set<string>();
  const accepting = all ? before : new Set(keys);
  for (const key of accepting) if (!before.has(key)) err(`warn  ${locale} ${key} is not stale`);
  generate(config, { accept: new Map([[locale, all ? true : new Set(keys)]]) });
  out(`copydeck: accepted ${[...accepting].filter((k) => before.has(k)).length} translation(s) in ${locale}`);
  return 0;
}

function runTodo(config: ResolvedConfig, locale: string | undefined): number {
  if (locale === undefined) {
    err('Usage: copydeck todo <locale>');
    return 1;
  }
  const { catalog, stale } = render(config);
  const staleKeys = stale.get(locale) ?? new Set<string>();
  const byArea = new Map<string, string[]>();
  let count = 0;
  for (const m of catalog.messages) {
    const current = m.translations.get(locale);
    if (current !== undefined && !staleKeys.has(m.key)) continue;
    count += 1;
    const lines = byArea.get(m.area) ?? [];
    lines.push('');
    if (m.context) lines.push(`# ${m.context}`);
    for (const [arg, said] of m.argDocs) lines.push(`#   {${arg}}: ${said}`);
    lines.push(`# ${config.source}: ${m.text.replaceAll('\n', ' ')}`);
    if (current !== undefined) lines.push('# stale: the source changed since this was translated');
    lines.push(stringify({ [m.key]: current?.text ?? '' }, { lineWidth: 0 }).trimEnd());
    byArea.set(m.area, lines);
  }
  if (count === 0) {
    out(`# ${locale} is complete`);
    return 0;
  }
  out(
    `# copydeck todo: ${count} entr${count === 1 ? 'y' : 'ies'} for ${locale}. Fill them in and paste each block into ${rel(config, config.locales)}/${locale}/<area>.yaml (or ${locale}.yaml).`,
  );
  for (const [area, lines] of byArea) {
    out(`\n# ── ${area}.yaml ──`);
    out(lines.join('\n'));
  }
  return 0;
}

function runScan(config: ResolvedConfig, strict: boolean): number {
  const { catalog } = render(config);
  const result = scan(config.scan.dirs, config.scan.extensions, config.scan.attributes, config.root, [config.out]);
  for (const h of result.hardcoded)
    err(`${h.file}:${h.line}:${h.column} hardcoded ${h.where === 'text' ? 'text' : `${h.where}=`} "${h.text}"`);
  const unused = catalog.messages.filter((m) => !isReferenced(m.key, result.refs));
  for (const m of unused) err(`${m.file} ${m.key}: no code reads this key`);
  out(
    `copydeck: scanned ${result.files} file(s): ${result.hardcoded.length} hardcoded string(s), ${unused.length} unused key(s)` +
      (result.hardcoded.length > 0
        ? '. `copydeck extract` moves the text into the catalog; mark a deliberate line `copydeck-ignore`.'
        : ''),
  );
  return strict && result.hardcoded.length + unused.length > 0 ? 1 : 0;
}

function runExtract(config: ResolvedConfig, paths: string[], write: boolean, area: string | undefined): number {
  const targets = paths.length > 0 ? paths.map((p) => resolve(config.root, p)) : config.scan.dirs;
  const files = sourceFiles(targets, ['.tsx', '.jsx'], [config.out]).concat(targets.filter((t) => /\.[jt]sx$/.test(t) && existsSync(t)));
  const plan = planExtract(config, [...new Set(files)], { area });
  const extractions = plan.files.flatMap((f) => f.extractions);
  for (const x of extractions) {
    out(`${x.file}:${x.line}:${x.column}  ${x.where === 'text' ? '' : `${x.where}=`}"${x.message}"`);
    out(`  → ${x.key}${x.reused ? ' (already in the catalog)' : ''}: ${x.replacement.trim()}`);
  }
  for (const f of plan.files) for (const w of f.warnings) err(`warn  ${w}`);
  if (extractions.length === 0) {
    out('copydeck: no hardcoded text to extract');
    return 0;
  }
  const changedFiles = plan.files.filter((f) => f.edits.length > 0).length;
  const areas = [...new Set(plan.entries.map((e) => e.area))].map((a) => `${a}.yaml`);
  const summary = `${extractions.length} string(s) in ${changedFiles} file(s), ${plan.entries.length} new entr${plan.entries.length === 1 ? 'y' : 'ies'}${areas.length > 0 ? ` in ${areas.join(', ')}` : ''}`;
  if (!write) {
    out(`
copydeck: would extract ${summary}. Run again with --write to apply.`);
    return 0;
  }
  applyExtract(config, plan);
  out(`
copydeck: extracted ${summary}.`);
  out('The new entries are marked `TODO(copydeck extract)`: check each key, kind, context and argument, then run `copydeck lint`.');
  return runGenerate(config, false);
}

const SAMPLE_CONFIG = `import { defineConfig } from 'copydeck/config';

export default defineConfig({
  catalog: 'copy/catalog',
  locales: 'copy/locales',
  out: 'src/copy',
  source: 'en',
});
`;

const SAMPLE_CATALOG = `# yaml-language-server: $schema=./catalog.schema.json
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
    writeFileSync(join(root, 'copydeck.config.ts'), SAMPLE_CONFIG);
    out('created copydeck.config.ts');
  }
  const catalogDir = join(root, 'copy', 'catalog');
  if (!existsSync(catalogDir)) {
    mkdirSync(catalogDir, { recursive: true });
    mkdirSync(join(root, 'copy', 'locales'), { recursive: true });
    writeFileSync(join(catalogDir, 'app.yaml'), SAMPLE_CATALOG);
    out('created copy/catalog/app.yaml');
  }
  out('\nNext: `copydeck generate`, then `createCopy(catalog)` from the generated src/copy.');
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    err(e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exit(1);
  },
);
