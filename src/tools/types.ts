/**
 * What kind of value an expression in JSX holds, so `extract` can write `{n, number}` for a number and
 * `{d, date, medium}` for a date instead of a bare `{x}`, which is text and prints a number unformatted.
 *
 * The project's own TypeScript (7 or later, through its `unstable/async` API) answers where it can; the
 * syntax of the expression answers where it can't: a JavaScript project, a file outside any tsconfig,
 * or no TypeScript installed. Not the `unstable/sync` API: on Linux and macOS it reads the compiler's
 * pipes through a Node internal (`stdout._handle.fd`) that Bun doesn't have, so under Bun it throws.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type * as TsAsync from 'typescript/unstable/async';
import type { Checker, Type } from 'typescript/unstable/async';

// oxlint-disable-next-line typescript/no-explicit-any -- a loose ESTree node: the walk reads whichever fields each node type has
type Node = { type: string; start: number; end: number; [field: string]: any };

type TsNode = { pos: number; end: number; forEachChild(visit: (child: TsNode) => unknown): unknown };

/** `node` is markup or an object, which a message can't hold as text. */
export type ValueKind = 'string' | 'number' | 'date' | 'node' | 'unknown';

export interface Span {
  start: number;
  end: number;
}

export interface TypeOracle {
  /** Where the answers come from, for the report. */
  readonly source: string;
  /** The kind of each span's expression in `file`, or nothing where the oracle can't say. */
  kinds(file: string, spans: readonly Span[]): Promise<(ValueKind | undefined)[]>;
  close(): Promise<void>;
}

/** The nearest `tsconfig.json` at or above the file's folder. */
function tsconfigFor(file: string): string | undefined {
  for (let dir = dirname(resolve(file)); ; dir = dirname(dir)) {
    const candidate = join(dir, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

// TypeFlags, as the TypeScript 7 API numbers them.
const ANY_OR_UNKNOWN = 3;
const NUMBER_LIKE = 67648 | 4224;
const STRING_LIKE = 12583968;
const UNION = 134217728;
const OBJECT = 1048576;

/**
 * An oracle over the projects the files belong to, or nothing where TypeScript 7 isn't installed or
 * none of the files has a tsconfig. One compiler process serves every project and is closed by `close`.
 */
export async function typescriptOracle(root: string, files: readonly string[]): Promise<TypeOracle | undefined> {
  const configs = [...new Set(files.map(tsconfigFor).filter((c) => c !== undefined))];
  if (configs.length === 0) return undefined;
  let ts: typeof TsAsync;
  try {
    ts = await import('typescript/unstable/async');
  } catch {
    return undefined;
  }
  let api: InstanceType<typeof ts.API>;
  let snapshot: Awaited<ReturnType<InstanceType<typeof ts.API>['updateSnapshot']>>;
  try {
    api = new ts.API({ cwd: root });
    snapshot = await api.updateSnapshot({ openProjects: configs });
  } catch {
    return undefined;
  }

  const classify = async (checker: Checker, type: Type | undefined): Promise<ValueKind | undefined> => {
    if (type === undefined) return undefined;
    const t = (await checker.getNonNullableType(type)) ?? type;
    if ((t.flags & ANY_OR_UNKNOWN) !== 0) return 'unknown';
    if ((t.flags & UNION) !== 0) {
      const members = (await (t as Type & { getTypes(): Promise<readonly Type[] | undefined> }).getTypes()) ?? [];
      const kinds = new Set(await Promise.all(members.map((m) => classify(checker, m))));
      if (kinds.size === 1) return [...kinds][0];
      return kinds.has('node') ? 'node' : 'unknown';
    }
    if ((t.flags & NUMBER_LIKE) !== 0) return 'number';
    if ((t.flags & STRING_LIKE) !== 0) return 'string';
    if ((await checker.typeToString(t)) === 'Date') return 'date';
    if ((t.flags & OBJECT) !== 0) return 'node';
    return 'unknown';
  };

  return {
    source: 'TypeScript',
    async kinds(file, spans) {
      const project = await snapshot.getDefaultProjectForFile(resolve(file));
      const sourceFile = await project?.program.getSourceFile(resolve(file));
      if (project === undefined || sourceFile === undefined) return spans.map(() => undefined);
      // The smallest node covering each span is the expression itself.
      const nodes = spans.map(({ start, end }) => {
        let node: TsNode = sourceFile;
        for (;;) {
          let next: TsNode | undefined;
          node.forEachChild((child) => {
            if (next === undefined && child.pos <= start && child.end >= end) next = child;
          });
          if (next === undefined) return node;
          node = next;
        }
      });
      const types = await project.checker.getTypeAtLocation(nodes as never[]);
      return Promise.all(types.map((type) => classify(project.checker, type)));
    },
    close() {
      return api.close();
    },
  };
}

/** The kind an expression's syntax gives away, where it does: `items.length`, `a * b`, `new Date()`. */
export function syntaxKind(expr: Node): ValueKind | undefined {
  switch (expr.type) {
    case 'Literal':
      return typeof expr.value === 'number' ? 'number' : typeof expr.value === 'string' ? 'string' : undefined;
    case 'TemplateLiteral':
      return 'string';
    case 'MemberExpression':
      return !expr.computed && ['length', 'size', 'count'].includes(expr.property?.name as string) ? 'number' : undefined;
    case 'BinaryExpression':
      return ['-', '*', '/', '%', '**'].includes(expr.operator as string) ? 'number' : undefined;
    case 'NewExpression':
      return expr.callee?.type === 'Identifier' && expr.callee.name === 'Date' ? 'date' : undefined;
    case 'CallExpression':
      return expr.callee?.type === 'MemberExpression' && expr.callee.object?.name === 'Math' ? 'number' : undefined;
    default:
      return undefined;
  }
}
