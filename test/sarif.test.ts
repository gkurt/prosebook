import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { fixture } from './fixture.ts';

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');

type Log = {
  version: string;
  runs: {
    tool: { driver: { name: string; rules: { id: string; shortDescription?: { text: string } }[] } };
    originalUriBaseIds: Record<string, { uri: string }>;
    results: {
      ruleId: string;
      ruleIndex: number;
      level: string;
      message: { text: string };
      locations: {
        physicalLocation: { artifactLocation: { uri: string; uriBaseId: string }; region?: { startLine: number; startColumn: number } };
      }[];
    }[];
  }[];
};

function cli(root: string, ...args: string[]) {
  const proc = Bun.spawnSync(['bun', '--conditions=prosebook@dev', CLI, ...args, '--root', root]);
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function run(root: string, ...args: string[]) {
  const { code, stdout, stderr } = cli(root, ...args, '--format', 'sarif');
  return { code, log: JSON.parse(stdout) as Log, stderr };
}

/** Each result as `rule level file:line message`, the rule checked against the run's rules. */
function results(log: Log): string[] {
  const [run] = log.runs;
  return run!.results.map((r) => {
    expect(run!.tool.driver.rules[r.ruleIndex]!.id).toBe(r.ruleId);
    const at = r.locations[0]?.physicalLocation;
    return `${r.ruleId} ${r.level} ${at?.artifactLocation.uri ?? '-'}:${at?.region?.startLine ?? '-'} ${r.message.text}`;
  });
}

const CATALOG = [
  'cart.title:',
  '  kind: name',
  '  context: The heading of the cart page.',
  '  en: Your cart',
  '',
  'cart.empty:',
  '  kind: state',
  '  context: Shown when the cart holds nothing.',
  '  en: "Nothing  here yet."',
  '',
].join('\n');

describe('--format sarif', () => {
  test('check reports lint findings and missing translations at their entries, and fails', () => {
    const config = fixture({ 'copy/catalog/cart.yaml': CATALOG, 'copy/locales/de.yaml': 'cart.title: Ihr Warenkorb\n' });
    cli(config.root, 'generate');
    const { code, log, stderr } = run(config.root, 'check');
    expect(code).toBe(1);
    expect(log.version).toBe('2.1.0');
    expect(log.runs[0]!.tool.driver.name).toBe('prosebook');
    expect(log.runs[0]!.originalUriBaseIds['%SRCROOT%']!.uri).toEndWith('/');
    expect(results(log)).toEqual([
      'whitespace error copy/catalog/cart.yaml:6 cart.empty: no leading, trailing or doubled spaces',
      'missing-translation error copy/catalog/cart.yaml:6 cart.empty has no de translation: `prosebook todo de` prints it ready to translate',
    ]);
    expect(log.runs[0]!.tool.driver.rules.find((r) => r.id === 'whitespace')?.shortDescription?.text).toBeString();
    // The text people read still goes out, on stderr.
    expect(stderr).toContain('[whitespace]');
  });

  test('scan reports hardcoded text at its line and column, as warnings unless --strict', () => {
    const config = fixture({
      'copy/catalog/cart.yaml': 'cart.title:\n  kind: name\n  context: The heading of the cart page.\n  en: Your cart\n',
      'src/Cart.tsx': "export const Cart = () => (\n  <h1>\n    Your cart\n  </h1>\n);\nexport const key = 'cart.title';\n",
    });
    const loose = run(config.root, 'scan');
    expect(loose.code).toBe(0);
    expect(results(loose.log)).toEqual([
      'hardcoded-text warning src/Cart.tsx:3 "Your cart" is hardcoded: move it into the catalog with `prosebook extract`, or mark the line `prosebook-ignore`',
    ]);
    expect(loose.log.runs[0]!.results[0]!.locations[0]!.physicalLocation.region?.startColumn).toBe(5);

    const strict = run(config.root, 'scan', '--strict');
    expect(strict.code).toBe(1);
    expect(strict.log.runs[0]!.results.map((r) => r.level)).toEqual(['error']);
  });

  test('a catalog that fails to load is reported at the entry, and the log is still written', () => {
    const config = fixture({ 'copy/catalog/cart.yaml': CATALOG, 'copy/locales/de.yaml': 'cart.title: Ihr Warenkorb\ncart.empty: "{n}"\n' });
    const { code, log } = run(config.root, 'lint');
    expect(code).toBe(1);
    expect(results(log)).toEqual(['catalog error copy/locales/de.yaml:2 differs from the source: unknown {n}']);
  });

  test('is refused by a command it does not apply to', () => {
    const config = fixture({ 'copy/catalog/cart.yaml': CATALOG });
    const { code, stdout, stderr } = cli(config.root, 'todo', 'de', '--format', 'sarif');
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('--format sarif works with lint, scan, status, check');
  });
});
