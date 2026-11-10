/**
 * What the demo shows of an entry: the real tools (`prosebook/playground`) over a catalog of that one
 * entry, held in memory. The page calls it as it is built, so the first view is there without a script,
 * and the browser calls it on every edit, loading this module late since it carries the tools.
 */
import { createCopy } from 'prosebook';
import { fix, play, type Finding, type ProsebookConfig } from 'prosebook/playground';
import { t } from '#src/copy.ts';
import { escape, fieldsOf, type Sample } from './samples.ts';

const FILE = 'copy/catalog/cart.yaml';
const CONFIG: ProsebookConfig = { lint: { extends: 'strict' } };

/** The entry as its catalog file. The text is JSON, which YAML reads as a double-quoted string. */
function filesOf(sample: Sample, text: string) {
  const fields = fieldsOf(sample).map(([field, value]) => `  ${field}: ${value}\n`);
  const args = sample.count === undefined ? '' : `  args:\n    count: ${sample.count}\n`;
  return { [FILE]: `${sample.key}:\n${fields.join('')}${args}  en: ${JSON.stringify(text)}\n` };
}

export interface View {
  /** The text with each finding's match marked, for the layer under the field. */
  marks: string;
  /** The text as the app shows it; none while the message doesn't parse. */
  shown: string | undefined;
  /** The problems and findings, as list items. */
  notes: string;
}

/** The text with the findings' places marked. A place inside one already marked is left out. */
function marked(text: string, findings: Finding[]): string {
  const places = findings.flatMap((f) => (f.at === undefined ? [] : [f.at])).sort((a, b) => a.start - b.start);
  let out = '';
  let from = 0;
  for (const { start, end } of places) {
    if (start < from) continue;
    out += `${escape(text.slice(from, start))}<mark>${escape(text.slice(start, end))}</mark>`;
    from = end;
  }
  // A last line that is empty has no height of its own in the layer; the space gives it one.
  return `${out}${escape(text.slice(from))} `;
}

export function view(sample: Sample, text: string, count: number): View {
  const played = play(filesOf(sample, text), CONFIG);
  const errors = played.problems.filter((p) => p.severity === 'error');
  const problems = errors.map((p) => `<li class="note"><code>error</code><span>${escape(p.message)}</span></li>`);
  // In the order the text reads, those about the whole text first; each keeps its place in the lint's list for `fixed`.
  const inOrder = played.findings.map((f, i) => ({ f, i })).sort((a, b) => (a.f.at?.start ?? -1) - (b.f.at?.start ?? -1));
  const findings = inOrder.map(({ f, i }) => {
    const button = f.fix === undefined || f.unsafe === true ? '' : `<button type="button" data-fix="${i}">${escape(t('try.fix'))}</button>`;
    return `<li class="note"><code>${escape(f.rule)}</code><span>${escape(f.message)}</span>${button}</li>`;
  });
  const notes = [...problems, ...findings];
  if (notes.length === 0) notes.push(`<li class="note clean">${escape(t('try.clean'))}</li>`);
  // An entry with an error is left out of the catalog, so there is nothing to read.
  const read = createCopy(played.catalog).t;
  return {
    marks: marked(text, played.findings),
    shown: errors.length > 0 ? undefined : read(sample.key, { count }),
    notes: notes.join(''),
  };
}

/** The text with the `index`th finding's fix made, as `lint --fix` makes it; the text as it was if it can't be. */
export function fixed(sample: Sample, text: string, index: number): string {
  const files = filesOf(sample, text);
  const finding = play(files, CONFIG).findings[index];
  if (finding?.fix === undefined) return text;
  const written = fix(files, [finding], CONFIG).files[FILE]?.match(/^ {2}en: (".*")$/m)?.[1];
  if (written === undefined) return text;
  try {
    const mended: unknown = JSON.parse(written);
    return typeof mended === 'string' ? mended : text;
  } catch {
    return text;
  }
}
