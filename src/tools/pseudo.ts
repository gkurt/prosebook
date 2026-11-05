/**
 * Pseudo-localization: the source with every letter accented, vowels doubled, padded to the length a
 * translation usually reaches, and brackets around the whole. A screen in the pseudo-locale shows at
 * a glance which text is hardcoded (it is plain), which is clipped (a bracket is missing), and which
 * splices fragments together (brackets inside brackets).
 */
import { inlined, TYPE, type MessageFormatElement } from './icu.ts';

const PLAIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ACCENTED = Array.from('áƀçðéƒĝĥíĵķļɱñóþǫŕšţúṽŵẋýžÁƁÇÐÉƑĜĤÍĴĶĻṀÑÓÞǪŔŠŢÚṼŴẊÝŽ');

export function pseudoText(text: string): string {
  return text.replace(/[A-Za-z]/g, (c) => {
    const accented = ACCENTED[PLAIN.indexOf(c)]!;
    return /[aeiou]/i.test(c) ? accented.repeat(2) : accented;
  });
}

function transform(elements: MessageFormatElement[]): MessageFormatElement[] {
  return elements.map((el) => {
    if (el.type === TYPE.literal) return { ...el, value: pseudoText(el.value) };
    if (el.type === TYPE.tag) return { ...el, children: transform(el.children) };
    if (el.type === TYPE.select || el.type === TYPE.plural) {
      const options = Object.fromEntries(Object.entries(el.options).map(([arm, o]) => [arm, { ...o, value: transform(o.value) }]));
      return { ...el, options };
    }
    return el;
  });
}

/**
 * How much longer a translation of a text this long runs, as IBM's guidelines have it: a short one
 * most, since a word or two can double ("Save" is "Speichern"), a long one about a third.
 */
const GROWTH: [upTo: number, factor: number][] = [
  [10, 2],
  [20, 1.8],
  [30, 1.6],
  [50, 1.5],
  [70, 1.4],
  [Infinity, 1.3],
];

/** The text a reader sees, every plural and select at its `other` arm, placeholders left out. */
function shown(elements: MessageFormatElement[]): string {
  return elements
    .map((el) => {
      if (el.type === TYPE.literal) return el.value;
      if (el.type === TYPE.tag) return shown(el.children);
      if (el.type === TYPE.select || el.type === TYPE.plural) return shown(el.options['other']?.value ?? []);
      return '';
    })
    .join('');
}

const graphemes = new Intl.Segmenter();
const charactersIn = (text: string) => [...graphemes.segment(text)].length;

/** What pads a pseudo message to the length its translations are likely to reach: none where doubling the vowels got there. */
function padding(ast: MessageFormatElement[], pseudo: MessageFormatElement[]): string {
  const length = charactersIn(shown(ast).trim());
  if (length === 0) return '';
  const factor = GROWTH.find(([upTo]) => length <= upTo)![1];
  const missing = Math.ceil(length * factor) - charactersIn(shown(pseudo));
  // A space first, so the padding wraps as a longer sentence would.
  return missing < 2 ? '' : ` ${'·'.repeat(missing - 1)}`;
}

export function pseudoAst(written: MessageFormatElement[]): MessageFormatElement[] {
  // A name the message says is accented with the rest of its text.
  const ast = inlined(written);
  const out: MessageFormatElement[] = [];
  const pseudo = transform(ast);
  const end = { type: TYPE.literal, value: `${padding(ast, pseudo)}⟧` };
  // Adjacent literals are joined, so a message with no placeholders still compiles to a plain string.
  for (const el of [{ type: TYPE.literal, value: '⟦' }, ...pseudo, end] as MessageFormatElement[]) {
    const last = out.at(-1);
    if (el.type === TYPE.literal && last?.type === TYPE.literal) out[out.length - 1] = { ...last, value: last.value + el.value };
    else out.push(el);
  }
  return out;
}
