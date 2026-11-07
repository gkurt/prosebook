/**
 * Text in code, linted where it is written: for a project with no catalog (`catalog: false`), and
 * `prosebook scan --lint` in one with. Each string `scan` finds becomes an entry of its own, keyed by
 * its words, so an approval (`prosebook approve`, `judge.ts`) holds wherever the words stand and ends
 * once they change. The same words in several places are one entry, unless a place's
 * `prosebook-allow` comments exempt it from rules the others aren't: an exemption is the place's.
 */
import type { Message } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { parseMessage, type MessageFormatElement } from './icu.ts';
import { lint, type Finding, type Verdict } from './lint.ts';
import { scan, whereOf, type Hardcoded } from './scan.ts';

/** A template's `${…}`, read as a placeholder named by its last identifier, so `${user.name}` says `{name}`. */
const HOLE = /\$\{([^}]*)\}/g;

/** The text as an ICU message: literal text escaped, and each of a template's holes a placeholder. */
export function messageOf(text: string): { text: string; ast: MessageFormatElement[]; args: Map<string, string> } {
  const args = new Map<string, string>();
  let out = '';
  let at = 0;
  for (const hole of text.matchAll(HOLE)) {
    out += escaped(text.slice(at, hole.index));
    const base = /([A-Za-z_]\w*)\W*$/.exec(hole[1]!)?.[1] ?? 'value';
    let name = base;
    for (let n = 2; args.has(name); n++) name = `${base}${n}`;
    args.set(name, 'string');
    out += `{${name}}`;
    at = hole.index + hole[0].length;
  }
  out += escaped(text.slice(at));
  return { text: out, ast: parseMessage(out), args };
}

/** Text written literally in an ICU message, apostrophes doubled where ICU would read them as quotes. */
const escaped = (text: string) => text.replace(/'/g, "''").replace(/[{}<]/g, (c) => `'${c}'`);

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
  if (place.via === 'call') {
    if (/(?:^|\.)error$/.test(place.where)) return { kind: 'state', surface: 'error' };
    if (/^toast\b/.test(place.where)) return { kind: 'state', surface: 'toast' };
    return place.where === 'confirm' ? { surface: 'confirm' } : {};
  }
  if (place.via === 'property') return PROPERTIES[place.where] ?? {};
  if (place.where !== 'text') return ATTRIBUTES[place.where] ?? {};
  for (const element of [...(place.inside ?? [])].reverse()) {
    if (INLINE.has(element)) continue;
    if (/^[a-z]/.test(element)) return ELEMENTS[element] ?? {};
    return COMPONENTS.find(([name]) => name.test(element))?.[1] ?? {};
  }
  return {};
}

/**
 * The role guessed, kept to the kinds and surfaces the config defines. A guess naming one `scan.roles`
 * turns off is none at all: `{ heading: false }` leaves a heading no kind either, not a name on nothing.
 */
function roleIn(config: ResolvedConfig, place: Hardcoded): Role {
  const { roles = {} } = config.scan;
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
    const { text, ast, args } = messageOf(first.text);
    return {
      key: first.text,
      area: '',
      file: first.file,
      ...role,
      context: contextOf(first),
      argDocs: new Map(),
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

/** Where the text stands, in words a model reads as its role. */
function contextOf(place: Hardcoded): string {
  const element = place.inside?.findLast((e) => !INLINE.has(e));
  if (place.where === 'text') return element === undefined ? 'Text in a component.' : `Text in a <${element}>.`;
  if (place.via === 'call') return `Passed to ${place.where}().`;
  if (place.via === 'property') return `The ${place.where} of an object in a component.`;
  return element === undefined ? `The ${place.where} attribute of an element.` : `The ${place.where} attribute of a <${element}>.`;
}

/** The text in code under `scan.dirs`, as entries. */
export function scannedOf(config: ResolvedConfig): Message[] {
  return scannedMessages(config, scan(config.scan, config.root, [config.out]).hardcoded);
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
    lint([message], config, [], verdict).flatMap(({ key, locale, rule, severity, message: said }) =>
      (message.places ?? []).map((p) => ({
        key,
        file: p.file,
        locale,
        rule,
        severity,
        message: said,
        line: p.line,
        column: p.column,
        where: whereOf(p),
      })),
    ),
  );
}
