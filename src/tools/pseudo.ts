/**
 * Pseudo-localization: the source with every letter accented, vowels doubled for the length a
 * translation usually adds, and brackets around the whole. A screen in the pseudo-locale shows at a
 * glance which text is hardcoded (it is plain), which is clipped (a bracket is missing), and which
 * splices fragments together (brackets inside brackets).
 */
import { TYPE, type MessageFormatElement } from './icu.ts';

const PLAIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ACCENTED = [...'áƀçðéƒĝĥíĵķļɱñóþǫŕšţúṽŵẋýžÁƁÇÐÉƑĜĤÍĴĶĻṀÑÓÞǪŔŠŢÚṼŴẊÝŽ'];

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
      return { ...el, options } as MessageFormatElement;
    }
    return el;
  });
}

export function pseudoAst(ast: MessageFormatElement[]): MessageFormatElement[] {
  const out: MessageFormatElement[] = [];
  // Adjacent literals are joined, so a message with no placeholders still compiles to a plain string.
  for (const el of [{ type: TYPE.literal, value: '⟦' }, ...transform(ast), { type: TYPE.literal, value: '⟧' }] as MessageFormatElement[]) {
    const last = out.at(-1);
    if (el.type === TYPE.literal && last?.type === TYPE.literal) out[out.length - 1] = { ...last, value: last.value + el.value };
    else out.push(el);
  }
  return out;
}
