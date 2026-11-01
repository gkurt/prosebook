/**
 * Findings as SARIF 2.1.0, the static-analysis format code scanning reads (GitHub's among them), so
 * `lint`, `scan`, `status` and `check` can annotate a pull request on the line the string is written.
 *
 * Paths are relative to the project root under `%SRCROOT%`, which the log maps to the root itself:
 * a project that isn't at the top of its repository still resolves to the right files.
 */
import { pathToFileURL } from 'node:url';

export interface SarifResult {
  /** A rule the report describes, or one of a lint plugin's. */
  rule: string;
  level: 'error' | 'warning';
  message: string;
  /** Relative to the project root, with forward slashes; none for a problem that isn't in a file. */
  file?: string;
  /** From 1; none for the file as a whole. */
  line?: number;
  column?: number;
}

export interface SarifTool {
  name: string;
  version: string;
  informationUri: string;
}

/** Collects what a command found, then writes it as one SARIF run. */
export class SarifReport {
  readonly results: SarifResult[] = [];
  private readonly rules = new Map<string, string | undefined>();

  /** Describes a rule in one sentence; the first description given for an id stands. */
  rule(id: string, description?: string): void {
    if (this.rules.get(id) === undefined) this.rules.set(id, description);
  }

  add(result: SarifResult): void {
    if (!this.rules.has(result.rule)) this.rules.set(result.rule, undefined);
    this.results.push(result);
  }

  toJSON(root: string, tool: SarifTool): object {
    const ids = [...this.rules.keys()];
    return {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              ...tool,
              rules: ids.map((id) => {
                const description = this.rules.get(id);
                return description === undefined ? { id } : { id, shortDescription: { text: description } };
              }),
            },
          },
          originalUriBaseIds: { '%SRCROOT%': { uri: pathToFileURL(root).href.replace(/\/?$/, '/') } },
          results: this.results.map((r) => ({
            ruleId: r.rule,
            ruleIndex: ids.indexOf(r.rule),
            level: r.level,
            message: { text: r.message },
            locations: r.file === undefined ? [] : [location(r.file, r.line, r.column)],
          })),
        },
      ],
    };
  }
}

function location(file: string, line: number | undefined, column: number | undefined): object {
  return {
    physicalLocation: {
      artifactLocation: { uri: encodeURI(file), uriBaseId: '%SRCROOT%' },
      ...(line === undefined ? {} : { region: { startLine: line, startColumn: column ?? 1 } }),
    },
  };
}
