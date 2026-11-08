/**
 * The model as a Kotlin file: an enum class of locales with a property or function per message, and
 * a file-private object holding what formats them. For the JVM and Android.
 */
import type { NativeTarget } from '#src/tools/config.ts';
import { pieceExpr, type DateSpec } from './date.ts';
import { camel, checkNames, conditionCode, float, leading, stringLiteral, upper, wordsOf } from './emit.ts';
import type { NativeMessage, NativeModel, Part } from './model.ts';
import type { NumberSpec } from './number.ts';

const KEYWORDS = new Set(
  'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while'.split(
    ' ',
  ),
);

const ident = (name: string) => (KEYWORDS.has(name) ? `\`${name}\`` : name);
const lit = (value: string) => stringLiteral(value, 'kotlin');
const entry = (tag: string) => leading(upper(wordsOf(tag)));
const argName = (name: string) => ident(leading(camel(wordsOf(name))));

function doc(lines: string[], indent: string): string {
  const safe = lines.map((l) => l.replaceAll('*/', '*\\/'));
  return `${indent}/**\n${safe.map((l) => (l === '' ? `${indent} *` : `${indent} * ${l}`)).join('\n')}\n${indent} */\n`;
}

/** The parts as an expression of type `String`, with `rt` the runtime object. */
function expr(parts: Part[], indent: string, rt: string): string {
  if (parts.length === 0) return '""';
  return parts.map((p) => (p.type === 'text' ? lit(p.value) : value(p, indent, rt))).join(' + ');
}

function value(part: Exclude<Part, { type: 'text' }>, indent: string, rt: string): string {
  const inner = `${indent}    `;
  if (part.type === 'string') return argName(part.arg);
  if (part.type === 'number') {
    const of = part.offset === 0 ? argName(part.arg) : `${argName(part.arg)} - ${float(part.offset)}`;
    return `${rt}.number(${of}, ${rt}.F${part.format}, ${lit(part.fallback)})`;
  }
  if (part.type === 'date') return `${rt}.d${part.format}(${argName(part.arg)})`;
  if (part.type === 'select') {
    const arms = part.arms.map((a) => `${inner}${lit(a.key)} -> ${expr(a.parts, inner, rt)}\n`).join('');
    return `when (${argName(part.arg)}) {\n${arms}${inner}else -> ${expr(part.other, inner, rt)}\n${indent}}`;
  }
  // A plural, the one kind left. With only `other`, there is nothing to select on.
  if (part.arms.length + part.exact.length === 0) return expr(part.other, indent, rt);
  const arg = argName(part.arg);
  const on = part.on === 'round' ? `${rt}.round(${arg})` : part.on === 'percent' ? `${arg} * 100.0` : arg;
  const { minFrac, maxFrac } = part.rounding;
  const exact = part.exact.map((e) => `${float(e.value)} to ${lit(`=${e.value}`)}`).join(', ');
  const arms = [...part.exact.map((e) => ({ key: `=${e.value}`, parts: e.parts })), ...part.arms]
    .map((a) => `${inner}${lit(a.key)} -> ${expr(a.parts, inner, rt)}\n`)
    .join('');
  const pick = `${rt}.plural(${on}, ${float(part.offset)}, listOf(${exact}), ${rt}::r${part.rules}, ${minFrac}, ${maxFrac})`;
  return `when (${pick}) {\n${arms}${inner}else -> ${expr(part.other, inner, rt)}\n${indent}}`;
}

function member(m: NativeMessage, name: string, rt: string): string {
  const branches = m.bodies.map((b) => `            ${b.locales.map(entry).join(', ')} -> ${expr(b.parts, '            ', rt)}\n`).join('');
  const argDocs = m.args.filter((a) => a.doc !== undefined).map((a) => `@param ${argName(a.name)} ${a.doc}`);
  const head = doc(argDocs.length > 0 ? [...m.doc, '', ...argDocs] : m.doc, '    ');
  const body = `when (this) {\n${branches}        }`;
  if (m.args.length === 0) return `${head}    val ${name}: String\n        get() = ${body}\n`;
  const params = m.args
    .map((a) => `${argName(a.name)}: ${a.type === 'number' ? 'Number' : a.type === 'date' ? 'java.time.Instant' : 'String'}`)
    .join(', ');
  const numbers = m.args
    .map((a) =>
      a.type === 'number'
        ? `        val ${argName(a.name)} = ${argName(a.name)}.toDouble()\n`
        : a.type === 'date'
          ? `        val ${argName(a.name)} = ${argName(a.name)}.atZone(java.time.ZoneId.systemDefault())\n`
          : '',
    )
    .join('');
  return `${head}    fun ${name}(${params}): String {\n${numbers}        return ${body}\n    }\n`;
}

function formatConst(spec: NumberSpec, i: number): string {
  const affix = ([prefix, suffix]: readonly [string, string]) => `${lit(prefix)} to ${lit(suffix)}`;
  const fields = [
    spec.minInt,
    spec.minFrac,
    spec.maxFrac,
    spec.shift,
    spec.grouping.primary,
    spec.grouping.secondary,
    spec.grouping.min,
    lit(spec.decimal),
    lit(spec.group),
    spec.digits === undefined ? 'null' : `listOf(${spec.digits.map(lit).join(', ')})`,
    affix(spec.positive),
    affix(spec.negative),
    affix(spec.zero),
    affix(spec.negativeZero),
    lit(spec.infinity),
    lit(spec.negativeInfinity),
  ];
  return `    val F${i} = Format(\n${fields.map((f) => `        ${f}`).join(',\n')},\n    )\n`;
}

const FIELDS: Record<string, string> = {
  year: 't.year',
  month: 't.monthValue',
  day: 't.dayOfMonth',
  hour: 't.hour',
  minute: 't.minute',
  second: 't.second',
  weekday: '(t.dayOfWeek.value % 7)',
};

/** A date format as a function of the date in the system's time zone. */
function dateFn(spec: DateSpec, i: number): string {
  const digits = spec.digits === undefined ? 'null' : `G${i}`;
  const at = (field: string) => FIELDS[field]!;
  const lines = spec.pieces.map((piece) => {
    if (piece.type === 'text') return `append(${lit(piece.value)})`;
    if (piece.type === 'name') return `append(arrayOf(${piece.names.map(lit).join(', ')})[${pieceExpr(piece, at)}])`;
    return `append(pad(${pieceExpr(piece, at)}, ${piece.pad}, ${digits}))`;
  });
  const table = spec.digits === undefined ? '' : `    private val G${i} = arrayOf(${spec.digits.map(lit).join(', ')})\n`;
  const body = lines.map((l) => `        ${l}\n`).join('');
  return `${table}    fun d${i}(t: java.time.ZonedDateTime): String = buildString {\n${body}    }\n`;
}

const DATE = `
    /** \`value\` written with at least \`width\` digits, in \`digits\` where the locale has its own. */
    private fun pad(value: Int, width: Int, digits: Array<String>?): String {
        val text = value.toString().padStart(width, '0')
        return if (digits == null) text else text.map { if (it in '0'..'9') digits[it - '0'] else it.toString() }.joinToString("")
    }
`;

const NUMBER = `
    /** A number format, taken apart when the file was generated. */
    class Format(
        val minInt: Int,
        val minFrac: Int,
        val maxFrac: Int,
        val shift: Int,
        val primary: Int,
        val secondary: Int,
        val minGroup: Int,
        val decimal: String,
        val group: String,
        val digits: List<String>?,
        val positive: Pair<String, String>,
        val negative: Pair<String, String>,
        val zero: Pair<String, String>,
        val negativeZero: Pair<String, String>,
        val infinity: String,
        val negativeInfinity: String,
    )

    /** \`value\` as \`format\` writes it, or \`fallback\` where it isn't a number. */
    fun number(value: Double, format: Format, fallback: String): String {
        if (value.isNaN()) return fallback
        if (value.isInfinite()) return if (value > 0) format.infinity else format.negativeInfinity
        val (written, frac) = digits(Math.abs(value), format.shift, format.minFrac, format.maxFrac)
        val zero = (written + frac).all { it == '0' }
        val negative = value.toRawBits() < 0
        val (prefix, suffix) = if (zero) (if (negative) format.negativeZero else format.zero) else (if (negative) format.negative else format.positive)
        val int = written.padStart(maxOf(format.minInt, 1), '0')
        val grouped = format.minGroup > 0 && int.length >= format.primary + format.minGroup
        val out = StringBuilder(prefix)
        for ((i, digit) in int.withIndex()) {
            val left = int.length - i
            if (grouped && i > 0 && (left == format.primary || (left > format.primary && (left - format.primary) % format.secondary == 0))) {
                out.append(format.group)
            }
            out.append(shown(digit, format))
        }
        if (frac.isNotEmpty()) {
            out.append(format.decimal)
            for (digit in frac) out.append(shown(digit, format))
        }
        return out.append(suffix).toString()
    }

    private fun shown(digit: Char, format: Format): String = format.digits?.get(digit - '0') ?: digit.toString()

    /**
     * The shortest digits that read back as \`value\`, as \`Intl\` rounds them: moved \`shift\` places
     * right, rounded half away from zero to \`max\` fraction digits, and trailing zeros cut to \`min\`.
     */
    fun digits(value: Double, shift: Int, min: Int, max: Int): Pair<String, String> {
        // \`toString\` writes the shortest digits that read back, with an exponent past a size.
        val plain = java.math.BigDecimal(value.toString()).toPlainString()
        val int = plain.substringBefore('.')
        val all = (int + plain.substringAfter('.', "")).map { it - '0' }.toMutableList()
        var point = int.length + shift
        while (all.size <= point + max) all.add(0)
        val next = all[point + max]
        while (all.size > point + max) all.removeAt(all.size - 1)
        if (next >= 5) {
            var at = all.size - 1
            while (at >= 0 && all[at] == 9) all[at--] = 0
            if (at < 0) {
                all.add(0, 1)
                point += 1
            } else {
                all[at] += 1
            }
        }
        val frac = all.subList(point, all.size).toMutableList()
        while (frac.size > min && frac.last() == 0) frac.removeAt(frac.size - 1)
        return all.subList(0, point).dropWhile { it == 0 }.joinToString("") to frac.joinToString("")
    }
`;

const PLURAL = `
    /** CLDR's plural operands of a number as written. */
    class Operands(val n: Double, val i: Double, val v: Double, val w: Double, val f: Double, val t: Double, val c: Double, val e: Double)

    /** The arm a plural takes: the \`=N\` that \`value\` equals, else the category of \`value\` less \`offset\`. */
    fun plural(value: Double, offset: Double, exact: List<Pair<Double, String>>, rules: (Operands) -> String, min: Int, max: Int): String =
        exact.firstOrNull { it.first == value }?.second ?: category(rules, value - offset, min, max)

    /** The category \`rules\` give \`value\`, rounded to between \`min\` and \`max\` fraction digits. */
    private fun category(rules: (Operands) -> String, value: Double, min: Int, max: Int): String {
        if (!value.isFinite()) return "other"
        val (written, frac) = digits(Math.abs(value), 0, min, max)
        val int = written.ifEmpty { "0" }
        val trimmed = frac.trimEnd('0')
        val read = { s: String -> s.toDoubleOrNull() ?: 0.0 }
        return rules(
            Operands(
                n = read(if (frac.isEmpty()) int else "$int.$frac"),
                i = read(int),
                v = frac.length.toDouble(),
                w = trimmed.length.toDouble(),
                f = read(frac),
                t = read(trimmed),
                c = 0.0,
                e = 0.0,
            ),
        )
    }

    /** An integer in the range, as CLDR's ranges hold. */
    private fun within(value: Double, from: Double, to: Double): Boolean = value % 1.0 == 0.0 && value >= from && value <= to

    /** \`Math.round\`: half up, toward positive infinity. */
    fun round(value: Double): Double {
        val floor = Math.floor(value)
        return if (value - floor >= 0.5) floor + 1 else floor
    }
`;

export function kotlinFile(model: NativeModel, target: NativeTarget & { name: string }, banner: string): string {
  const name = target.name;
  const rt = `${name}Runtime`;
  const names = model.messages.map((m): [string, string] => [m.key, ident(leading(camel(m.words)))]);
  checkNames('kotlin', names, ['tag', 'name', 'ordinal', 'entries', 'negotiate', 'SOURCE']);
  const entries = model.locales
    .map((l) => `    /** \`${l}\`${l === model.source ? ', the source' : ''}. */\n    ${entry(l)}(${lit(l)})`)
    .join(',\n');
  const members = model.messages.map((m, i) => member(m, names[i]![1], rt)).join('\n');
  const rules = model.rules
    .map(({ name: rule, rules }, i) => {
      const checks = rules.map(
        ([category, condition]) =>
          `        if (${conditionCode(condition, { field: (op) => `o.${op}`, mod: (v, by) => `${v} % ${by}`, within: (v, from, to) => `within(${v}, ${from}, ${to})` })}) return ${lit(category)}\n`,
      );
      return `    /** ${rule} */\n    fun r${i}(o: Operands): String {\n${checks.join('')}        return "other"\n    }\n`;
    })
    .join('\n');
  const runtime =
    model.formats.length + model.rules.length + model.dates.length === 0
      ? ''
      : `
/** What formats the messages, generated with them. */
private object ${rt} {${model.formats.length + model.rules.length > 0 ? NUMBER : ''}${model.rules.length > 0 ? PLURAL : ''}${model.dates.length > 0 ? DATE : ''}
${[...model.formats.map(formatConst), ...model.dates.map(dateFn)].join('\n')}${rules === '' ? '' : `\n${rules}`}}
`;

  return `${banner}
@file:Suppress("ktlint", "unused", "NAME_SHADOWING", "KotlinConstantConditions", "ConvertTwoComparisonsToRangeCheck")
${target.package === undefined ? '' : `\npackage ${target.package}\n`}
/** A locale the catalog is written or translated in, and its messages. */
enum class ${name}(val tag: String) {
${entries};

${members}
    companion object {
        /** The locale the catalog is written in, which every message falls back to. */
        val SOURCE: ${name} = ${entry(model.source)}

        /**
         * The best locale for what was asked, most preferred first: each tag tries an exact match, then
         * its parents (\`pt-BR\` finds \`pt\`), then any locale of its language. The source if none is.
         */
        fun negotiate(requested: List<String>): ${name} {
            fun language(tag: String) = tag.substringBefore('-').lowercase()
            for (want in requested) {
                var tag = want
                while (true) {
                    entries.firstOrNull { it.tag.equals(tag, ignoreCase = true) }?.let { return it }
                    val cut = tag.lastIndexOf('-')
                    if (cut < 0) break
                    tag = tag.substring(0, cut)
                }
                entries.firstOrNull { language(it.tag) == language(want) }?.let { return it }
            }
            return SOURCE
        }
    }
}
${runtime}`;
}
