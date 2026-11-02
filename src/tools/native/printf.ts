/**
 * Messages as printf-style format strings, for the targets whose platform fills values in itself:
 * Android's resources and Apple's `.strings` files. Text and plain `{name}` placeholders, as `%N$s`
 * with N the argument's place in the message's arguments, so a translation can put them in another
 * order; anything `Intl` would format fails with the fix.
 */
import { isDateElement, isNumberElement, isTimeElement } from '@formatjs/icu-messageformat-parser';

import type { Message } from '#src/tools/catalog.ts';
import { numberOptions, placeholderOf, TYPE, type MessageFormatElement } from '#src/tools/icu.ts';
import { docText } from './emit.ts';
import { LEAVE_OUT } from './model.ts';

export interface Printf {
  /** Who fills values in, and with what, as problems name them: `Android`, `String.format`. */
  platform: string;
  formatter: string;
  /** What holds the text, as problems name it: `Android resources`. */
  holder: string;
  /** A string argument's conversion: `s`, or `@` for Apple's objects. */
  string: string;
  /** Text as the file holds it; `formatted` when the string has arguments, so `%` must be doubled. */
  escape: (text: string, formatted: boolean) => string;
  /** The problem with a plural the target can't hold where it is. */
  plural: (name: string) => string;
}

/** The context and what each argument holds, on one line, for the comment above an entry. */
export function noteOf(m: Message): string {
  const lines = [
    m.context,
    ...[...m.args.keys()].map((a) => (m.argDocs.has(a) ? `${a}: ${m.argDocs.get(a)!.replace(/\.$/, '')}.` : undefined)),
  ];
  return docText(lines.filter((l) => l !== undefined && l !== '').join(' '));
}

/** What a plural's arms may hold as its count: `#`, or the count as a plain `:number` or `:integer`. */
function isCount(el: MessageFormatElement, count: string): boolean {
  if (el.type === TYPE.pound) return true;
  if (!isNumberElement(el) || el.value !== count) return false;
  const options = Object.entries(numberOptions(el) ?? {});
  return options.length === 0 || (options.length === 1 && options[0]![0] === 'maximumFractionDigits' && options[0]![1] === 0);
}

/** `elements` as a format string over `args`; inside a plural, its `count` is `%N$d`. */
export function formatString(elements: MessageFormatElement[], args: string[], printf: Printf, count?: string): string {
  const formatted = args.length > 0;
  const place = (el: MessageFormatElement, name: string, conversion: string) => {
    const at = args.indexOf(name);
    if (at < 0) throw new Error(`{${name}} is not an argument of this message: say it in the source text too`);
    const { isolate } = placeholderOf(el, name);
    const spec = `%${at + 1}$${conversion}`;
    return isolate === undefined ? spec : `${printf.escape(isolate[0], formatted)}${spec}${printf.escape(isolate[1], formatted)}`;
  };
  let out = '';
  for (const el of elements) {
    if (count !== undefined && isCount(el, count)) {
      out += place(el, count, 'd');
      continue;
    }
    if (isDateElement(el) || isTimeElement(el)) {
      throw new Error(
        `{${el.value}} is a date, which ${printf.holder} don't format: pass it formatted, as a plain {${el.value}}, ${LEAVE_OUT}`,
      );
    }
    if (isNumberElement(el)) {
      throw new Error(
        `{${el.value}} is a formatted number, and ${printf.platform} fills values in with ${printf.formatter}, not Intl: pass it formatted, as a plain {${el.value}}, ${LEAVE_OUT}`,
      );
    }
    switch (el.type) {
      case TYPE.literal:
        out += printf.escape(el.value, formatted);
        break;
      case TYPE.argument:
        out += place(el, el.value, printf.string);
        break;
      case TYPE.pound:
        // Outside a plural, `#` is text.
        out += '#';
        break;
      case TYPE.select:
        throw new Error(
          `{${el.value}} is a select, which ${printf.holder} can't hold: write a key per case and pick one in code, ${LEAVE_OUT}`,
        );
      case TYPE.plural:
        throw new Error(printf.plural(el.value));
      case TYPE.tag:
        throw new Error(`<${el.value}> is a tag, and ${printf.holder} here hold plain text: say it without the tag, ${LEAVE_OUT}`);
      default:
        throw new Error(`prosebook: no ${printf.platform} writer for ICU element type ${(el as MessageFormatElement).type}`);
    }
  }
  return out;
}
