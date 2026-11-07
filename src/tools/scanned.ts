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

/** The places' text as entries, one per distinct words and set of exemptions. */
export function scannedMessages(places: readonly Hardcoded[]): Message[] {
  const byText = new Map<string, Hardcoded[]>();
  for (const place of places) {
    const allow = Object.entries(place.allow ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    const id = `${place.text}\u0000${JSON.stringify(allow)}`;
    byText.set(id, [...(byText.get(id) ?? []), place]);
  }
  return [...byText.values()].map((at) => {
    const [first] = at as [Hardcoded];
    const { text, ast, args } = messageOf(first.text);
    return {
      key: first.text,
      area: '',
      file: first.file,
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
  if (place.where === 'text') return 'Text in a component.';
  if (place.via === 'call') return `Passed to ${place.where}().`;
  return place.via === 'property' ? `The ${place.where} of an object in a component.` : `The ${place.where} attribute of an element.`;
}

/** The text in code under `scan.dirs`, as entries. */
export function scannedOf(config: ResolvedConfig): Message[] {
  return scannedMessages(scan(config.scan, config.root, [config.out]).hardcoded);
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
