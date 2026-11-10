/**
 * Text in code, linted where it is written: for a project with no catalog (`catalog: false`), and
 * `prosebook scan --lint` in one with; and the prose of the `docs`, read by `docs.ts`. Each string `scan` finds becomes an entry of its own, keyed by
 * its words, so an approval (`prosebook approve`, `judge.ts`) holds wherever the words stand and ends
 * once they change. The same words in several places are one entry, unless a place's
 * `prosebook-allow` comments exempt it from rules the others aren't: an exemption is the place's.
 */
import { parseSync } from 'oxc-parser';

import type { Message } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { parseMessage, TYPE, type MessageFormatElement } from './icu.ts';
import { lint, type Finding, type Verdict } from './lint.ts';
import { pickOf, scan, unscanned, unwrapped, whereOf, type Hardcoded, type Node } from './scan.ts';

/** A template's `${…}`, read as a placeholder named for the value it shows, so `${user.name}` says `{name}`. */
const HOLE = /\$\{([^}]*)\}/g;

/** Text in code or a doc as an ICU message, and what each placeholder stands for, as written. */
export interface Scanned {
  text: string;
  ast: MessageFormatElement[];
  args: Map<string, string>;
  /** By placeholder: the code it was read from, `${user.name}`, or the doc's code span or URL. */
  holes: Map<string, string>;
}

/**
 * The text as an ICU message: literal text escaped, and each of a template's holes a placeholder. A
 * hole picking between two strings is a choice: `${n === 1 ? 'hop' : 'hops'}` a plural on `n`, any
 * other test a select, so the lint reads each arm. The same expression twice is one placeholder.
 */
export function messageOf(text: string): Scanned {
  const args = new Map<string, string>();
  const sources = new Map<string, string>();
  const nameFor = (base: string, source: string, type: string) => {
    let name = base;
    for (let n = 2; args.has(name) && sources.get(name) !== source; n++) name = `${base}${n}`;
    if (!args.has(name) || type === 'number') args.set(name, type);
    sources.set(name, source);
    return name;
  };
  let out = '';
  let at = 0;
  for (const hole of text.matchAll(HOLE)) {
    out += escaped(text.slice(at, hole.index));
    at = hole.index + hole[0].length;
    const source = hole[1]!.trim();
    const expr = expressionOf(source);
    const pick = expr === undefined ? undefined : pickOf(expr);
    if (pick === undefined) {
      out += `{${nameFor((expr && nameOf(expr)) ?? lastIdentifier(source), source, 'string')}}`;
      continue;
    }
    const [yes, no] = pick.arms;
    const count = countOf(pick.test);
    if (count !== undefined) {
      const name = nameFor(nameOf(count.of) ?? 'count', sourceOf(source, count.of), 'number');
      const [one, other] = count.oneFirst ? [yes, no] : [no, yes];
      out += `{${name}, plural, one {${escaped(one, true)}} other {${escaped(other, true)}}}`;
    } else {
      const name = nameFor(nameOf(pick.test) ?? 'choice', sourceOf(source, pick.test), 'string');
      out += `{${name}, select, true {${escaped(yes)}} other {${escaped(no)}}}`;
    }
  }
  out += escaped(text.slice(at));
  const holes = new Map([...sources].map(([name, source]) => [name, `\${${source}}`]));
  return { text: out, ast: parseMessage(out), args, holes };
}

/** In a doc's prose, what isn't words: a code span, `` `npm install` ``, and a bare URL. */
const NOT_WORDS = /(`+)(.+?)\1(?!`)|\bhttps?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]/g;

/**
 * A doc's prose as an ICU message (`docs.ts`): literal text escaped, and each code span or bare URL a
 * placeholder, `{code}` or `{link}`, so the lint reads the words around them and not what they hold.
 * The same span twice is one placeholder.
 */
export function docMessageOf(prose: string): Scanned {
  const args = new Map<string, string>();
  const names = new Map<string, string>();
  const holes = new Map<string, string>();
  let out = '';
  let at = 0;
  for (const found of prose.matchAll(NOT_WORDS)) {
    out += escaped(prose.slice(at, found.index));
    at = found.index + found[0].length;
    let name = names.get(found[0]);
    if (name === undefined) {
      const base = found[1] === undefined ? 'link' : 'code';
      name = base;
      for (let n = 2; args.has(name); n++) name = `${base}${n}`;
      names.set(found[0], name);
      holes.set(name, found[0]);
      args.set(name, 'string');
    }
    out += `{${name}}`;
  }
  out += escaped(prose.slice(at));
  return { text: out, ast: parseMessage(out), args, holes };
}

/**
 * A message read from code or a doc as it would be written there again: each placeholder the code or
 * code span it stands for. A plural or select it can't write back stays in the message's syntax.
 */
export function asWrittenIn(message: Message, text: string): string {
  let ast: MessageFormatElement[];
  try {
    ast = parseMessage(text);
  } catch {
    return text;
  }
  if (!ast.every((el) => el.type === TYPE.literal || el.type === TYPE.argument)) return text;
  return ast.map((el) => (el.type === TYPE.literal ? el.value : (message.argDocs.get(el.value) ?? `{${el.value}}`))).join('');
}

/** A doc's prose with its code spans and URLs taken out: what the lint reads as words. */
export const wordsOfDoc = (prose: string): string => prose.replace(NOT_WORDS, ' ');

/** A hole's code as an expression, or nothing where it doesn't parse as one. */
function expressionOf(source: string): Node | undefined {
  const { program, errors } = parseSync('hole.tsx', `(${source})`);
  const [statement] = program.body as unknown as Node[];
  if (errors.length > 0 || statement?.type !== 'ExpressionStatement') return undefined;
  return unwrapped(statement.expression as Node);
}

/** A node's code, out of the hole parsed as `(source)`. */
const sourceOf = (source: string, node: Node) => source.slice(node.start - 1, node.end - 1);

/** Methods that show the value they are called on: `rate.toFixed(1)` shows `rate`. */
const SHOWS_ITS_VALUE = /^(?:toFixed|toPrecision|toString|toLocale\w*|toUpperCase|toLowerCase|trim\w*|valueOf)$/;

/**
 * What a placeholder is called for the value it shows: `user.name` is `name`, `rate.toFixed(1)` and
 * `Math.round(rate * 100)` are `rate`, `format(when)` is `when`, `n === 1` is `n`.
 */
function nameOf(node: Node): string | undefined {
  const n = unwrapped(node);
  switch (n.type) {
    case 'Identifier':
      return argName(n.name as string);
    case 'MemberExpression': {
      const property = n.property as Node;
      return n.computed === true || property.type !== 'Identifier' ? nameOf(n.object as Node) : argName(property.name as string);
    }
    case 'ChainExpression':
      return nameOf(n.expression as Node);
    case 'CallExpression': {
      const callee = unwrapped(n.callee as Node);
      const method = callee.type === 'MemberExpression' && callee.computed !== true ? (callee.property as Node) : undefined;
      if (method?.type === 'Identifier' && SHOWS_ITS_VALUE.test(method.name as string)) return nameOf(callee.object as Node);
      const [first] = n.arguments as Node[];
      return (first !== undefined && first.type !== 'SpreadElement' ? nameOf(first) : undefined) ?? nameOf(callee);
    }
    case 'BinaryExpression':
    case 'LogicalExpression':
      return nameOf(n.left as Node) ?? nameOf(n.right as Node);
    case 'UnaryExpression':
    case 'AwaitExpression':
      return nameOf(n.argument as Node);
    default:
      return undefined;
  }
}

/** A name ICU reads as an argument's. */
const argName = (name: string) => (/^[A-Za-z_]\w*$/.test(name) ? name : undefined);

/** The last identifier in code that doesn't parse, as `${user.name}` was read before. */
const lastIdentifier = (source: string) => /([A-Za-z_]\w*)\W*$/.exec(source)?.[1] ?? 'value';

/** A test on a count, `n === 1`, `n !== 1` or `n > 1`: the count, and whether the first arm is its one. */
function countOf(test: Node): { of: Node; oneFirst: boolean } | undefined {
  if (test.type !== 'BinaryExpression') return undefined;
  const left = unwrapped(test.left as Node);
  const right = unwrapped(test.right as Node);
  const isOne = (n: Node) => n.type === 'Literal' && n.value === 1;
  const [of, flipped] = isOne(right) ? [left, false] : isOne(left) ? [right, true] : [undefined, false];
  if (of === undefined) return undefined;
  const operator = test.operator as string;
  if (operator === '===' || operator === '==') return { of, oneFirst: true };
  if (operator === '!==' || operator === '!=') return { of, oneFirst: false };
  // `n > 1` picks the plural first, as `1 < n` does.
  if ((operator === '>' && !flipped) || (operator === '<' && flipped)) return { of, oneFirst: false };
  return undefined;
}

/** Text written literally in an ICU message, apostrophes doubled where ICU would read them as quotes, and in a plural's arm `#`. */
const escaped = (text: string, inPlural = false) => text.replace(/'/g, "''").replace(inPlural ? /[{}<#]/g : /[{}<]/g, (c) => `'${c}'`);

/** A role guessed from where text stands: the kind and surface an entry would name. */
interface Role {
  kind?: string;
  surface?: string;
}

const ACTION: Role = { kind: 'action', surface: 'action' };
const HEADING: Role = { kind: 'name', surface: 'heading' };
const LABEL: Role = { kind: 'name', surface: 'label' };

/** HTML's elements whose text has a role of its own. */
const ELEMENTS: Record<string, Role> = {
  button: ACTION,
  h1: HEADING,
  h2: HEADING,
  h3: HEADING,
  h4: HEADING,
  h5: HEADING,
  h6: HEADING,
  th: HEADING,
  label: LABEL,
  legend: LABEL,
  dt: LABEL,
  option: { kind: 'name', surface: 'choice' },
  title: { kind: 'name', surface: 'title' },
};

/** Elements that only style the words in them, which the role of the element around them reaches through. */
const INLINE = new Set([
  'span',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'small',
  'mark',
  'abbr',
  'sub',
  'sup',
  'bdi',
  'bdo',
  'time',
  'data',
  'q',
  'cite',
  'var',
  '',
]);

/** Components by the last word of their name, as design systems name them: `SubmitButton`, `DialogTitle`. */
const COMPONENTS: [RegExp, Role][] = [
  [/Button$/, ACTION],
  [/MenuItem$/, ACTION],
  [/(?:Title|Heading)$/, HEADING],
  [/Label$/, LABEL],
  [/Tooltip(?:Content)?$/, { surface: 'tooltip' }],
];

const ATTRIBUTES: Record<string, Role> = {
  placeholder: { surface: 'placeholder' },
  'aria-placeholder': { surface: 'placeholder' },
  'aria-label': { surface: 'aria' },
  'aria-description': { surface: 'aria' },
  alt: { surface: 'aria' },
  title: { surface: 'tooltip' },
  label: LABEL,
};

const PROPERTIES: Record<string, Role> = {
  label: LABEL,
  title: HEADING,
  header: HEADING,
  description: { kind: 'description' },
  placeholder: { surface: 'placeholder' },
};

/**
 * The role text in code most likely has, from the element it is in, the attribute or property it is
 * the value of, or the call it is given to. A guess, so only where the place says it plainly: text in a
 * `<p>` or a `<Link>` has none.
 */
function roleOf(place: Hardcoded): Role {
  if (place.via === 'doc') return place.where === 'heading' || place.where === 'header' ? HEADING : {};
  if (place.via === 'call') {
    if (/(?:^|\.)error$/.test(place.where)) return { kind: 'state', surface: 'error' };
    if (/^toast\b/.test(place.where)) return { kind: 'state', surface: 'toast' };
    return place.where === 'confirm' ? { surface: 'confirm' } : {};
  }
  if (place.via === 'property') return PROPERTIES[place.where] ?? {};
  if (place.where !== 'text') {
    // A `label` is the text its element shows, so it takes the element's role: a `<Tooltip label>` is
    // a tooltip's, a `<MenuItem label>` an action's. Other attributes say their own role.
    const own = place.where === 'label' ? elementRole(place.inside?.at(-1) ?? '') : undefined;
    return own ?? ATTRIBUTES[place.where] ?? {};
  }
  for (const element of [...(place.inside ?? [])].reverse()) {
    if (INLINE.has(element)) continue;
    return elementRole(element) ?? {};
  }
  return {};
}

/** The role of the text an element shows: HTML's by name, a component's by the last word of its name. */
function elementRole(element: string): Role | undefined {
  if (/^[a-z]/.test(element)) return ELEMENTS[element];
  return COMPONENTS.find(([name]) => name.test(element))?.[1];
}

/**
 * The role guessed, kept to the kinds and surfaces the config defines. A guess naming one `scan.roles`
 * turns off is none at all: `{ heading: false }` leaves a heading no kind either, not a name on nothing.
 */
function roleIn(config: ResolvedConfig, place: Hardcoded): Role {
  // A doc's heading is one as Markdown says, not a guess, so `scan.roles` doesn't reach it.
  const { roles = {} } = place.via === 'doc' ? {} : config.scan;
  if (roles === false) return {};
  const { kind, surface } = roleOf(place);
  if ((kind !== undefined && roles[kind] === false) || (surface !== undefined && roles[surface] === false)) return {};
  return {
    ...(kind !== undefined && config.kinds[kind] !== undefined && { kind }),
    ...(surface !== undefined && config.surfaces[surface] !== undefined && { surface }),
  };
}

/** The places' text as entries, one per distinct words, guessed role and set of exemptions. */
export function scannedMessages(config: ResolvedConfig, places: readonly Hardcoded[]): Message[] {
  const byText = new Map<string, { role: Role; at: Hardcoded[] }>();
  for (const place of places) {
    const role = roleIn(config, place);
    const allow = Object.entries(place.allow ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    const id = JSON.stringify([place.text, role.kind, role.surface, allow]);
    const same = byText.get(id);
    if (same === undefined) byText.set(id, { role, at: [place] });
    else same.at.push(place);
  }
  return [...byText.values()].map(({ role, at }) => {
    const [first] = at as [Hardcoded];
    const { text, ast, args, holes } = first.via === 'doc' ? docMessageOf(first.text) : messageOf(first.text);
    return {
      key: first.text,
      area: '',
      file: first.file,
      ...role,
      context: contextOf(first),
      // What each placeholder stands for, which the judge reads, and `asWrittenIn` writes back.
      argDocs: holes,
      fragment: false,
      allow: new Map(Object.entries(first.allow ?? {})),
      closed: [],
      min: new Map(),
      remove: false,
      text,
      ast,
      args,
      argFormats: new Map(),
      tags: [],
      translations: new Map(),
      places: at,
    };
  });
}

/** A doc's blocks, as `contextOf` says them. */
const DOC_BLOCKS: Record<string, string> = {
  heading: 'A heading',
  paragraph: 'A paragraph',
  item: 'An item of a list',
  cell: 'A cell of a table',
  header: "A table's column heading",
  quote: 'A quote or a callout',
};

/** Where the text stands, in words a model reads as its role. */
function contextOf(place: Hardcoded): string {
  if (place.via === 'doc') return `${DOC_BLOCKS[place.where] ?? 'Prose'} in the doc ${place.file}.`;
  const element = place.inside?.findLast((e) => !INLINE.has(e));
  if (place.where === 'text') return element === undefined ? 'Text in a component.' : `Text in a <${element}>.`;
  if (place.via === 'call') return `Passed to ${place.where}().`;
  if (place.via === 'property') return `The ${place.where} of an object in a component.`;
  return element === undefined ? `The ${place.where} attribute of an element.` : `The ${place.where} attribute of a <${element}>.`;
}

/** The text in code under `scan.dirs`, as entries. */
export function scannedOf(config: ResolvedConfig): Message[] {
  return scannedMessages(config, scan(config.scan, config.root, unscanned(config)).hardcoded);
}

/** A finding at one place its words stand. */
export interface PlacedFinding extends Finding {
  line: number;
  column: number;
  /** The place as the code says it: `title=`, `toast.error(…)`, `label:`, or nothing for text. */
  where: string;
}

/**
 * The findings on the text in code, one at each place its words stand. No fix: the lint's fixes are
 * written to a catalog, and a literal in code may be more than its words. Each entry is linted
 * apart, held to no other, since text in code has no entries to merge.
 */
export function lintScanned(messages: readonly Message[], config: ResolvedConfig, verdict?: Verdict): PlacedFinding[] {
  return messages.flatMap((message) =>
    lint([message], config, [], verdict).flatMap(({ key, locale, rule, severity, message: said, suggestion }) =>
      (message.places ?? []).map((p) => ({
        key,
        file: p.file,
        locale,
        rule,
        severity,
        message: said,
        // No fix: text in code may be more than its words. The rewrite is said, as it would be written.
        ...(suggestion !== undefined && { suggestion: asWrittenIn(message, suggestion) }),
        line: p.line,
        column: p.column,
        where: whereOf(p),
      })),
    ),
  );
}
