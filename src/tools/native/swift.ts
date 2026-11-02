/**
 * The model as a Swift file: a `String`-backed enum of locales with a property or method per
 * message, and a file-private enum holding what formats them.
 */
import type { NativeTarget } from '#src/tools/config.ts';
import { camel, checkNames, conditionCode, float, leading, stringLiteral, wordsOf } from './emit.ts';
import type { NativeMessage, NativeModel, Part } from './model.ts';
import type { NumberSpec } from './number.ts';

const KEYWORDS = new Set(
  'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private precedencegroup protocol public rethrows static struct subscript typealias var break case catch continue default defer do else fallthrough for guard if in repeat return throw switch where while Any as await false is nil self Self super throws true try'.split(
    ' ',
  ),
);

const ident = (name: string) => (KEYWORDS.has(name) ? `\`${name}\`` : name);
const lit = (value: string) => stringLiteral(value, 'swift');
const caseName = (tag: string) => ident(leading(camel(wordsOf(tag))));
const argName = (name: string) => ident(leading(camel(wordsOf(name))));

function doc(lines: string[], indent: string): string {
  return lines.map((l) => (l === '' ? `${indent}///\n` : `${indent}/// ${l}\n`)).join('');
}

/** The parts as an expression of type `String`, with `rt` the runtime enum. */
function expr(parts: Part[], indent: string, rt: string): string {
  if (parts.length === 0) return '""';
  const values = parts.map((p) => (p.type === 'text' ? lit(p.value) : value(p, indent, rt)));
  return values.length === 1 ? values[0]! : `[${values.join(', ')}].joined()`;
}

function value(part: Exclude<Part, { type: 'text' }>, indent: string, rt: string): string {
  const inner = `${indent}    `;
  if (part.type === 'string') return argName(part.arg);
  if (part.type === 'number') {
    const of = part.offset === 0 ? argName(part.arg) : `${argName(part.arg)} - ${float(part.offset)}`;
    return `${rt}.number(${of}, ${rt}.f${part.format}, ${lit(part.fallback)})`;
  }
  if (part.type === 'select') {
    const arms = part.arms.map((a) => `${inner}case ${lit(a.key)}: return ${expr(a.parts, inner, rt)}\n`).join('');
    return `{ () -> String in\n${inner}switch ${argName(part.arg)} {\n${arms}${inner}default: return ${expr(part.other, inner, rt)}\n${inner}}\n${indent}}()`;
  }
  // A plural, the one kind left. With only `other`, there is nothing to select on.
  if (part.arms.length + part.exact.length === 0) return expr(part.other, indent, rt);
  const arg = argName(part.arg);
  const on = part.on === 'round' ? `${rt}.round(${arg})` : part.on === 'percent' ? `${arg} * 100.0` : arg;
  const { minFrac, maxFrac } = part.rounding;
  const exact = part.exact.map((e) => `(${float(e.value)}, ${lit(`=${e.value}`)})`).join(', ');
  const arms = [...part.exact.map((e) => ({ key: `=${e.value}`, parts: e.parts })), ...part.arms]
    .map((a) => `${inner}case ${lit(a.key)}: return ${expr(a.parts, inner, rt)}\n`)
    .join('');
  const pick = `${rt}.plural(${on}, ${float(part.offset)}, [${exact}], ${rt}.r${part.rules}, ${minFrac}, ${maxFrac})`;
  return `{ () -> String in\n${inner}switch ${pick} {\n${arms}${inner}default: return ${expr(part.other, inner, rt)}\n${inner}}\n${indent}}()`;
}

/** The protocol a number argument takes, and the property that reads it as a `Double`. */
interface NumberProtocol {
  type: string;
  value: string;
}

function member(m: NativeMessage, name: string, rt: string, number: NumberProtocol): string {
  const cases = (render: (parts: Part[]) => string) =>
    m.bodies.map((b) => `        case ${b.locales.map((l) => `.${caseName(l)}`).join(', ')}: return ${render(b.parts)}\n`).join('');
  const argDocs = m.args.filter((a) => a.doc !== undefined).map((a) => `- ${argName(a.name)}: ${a.doc}`);
  const head = doc(argDocs.length > 0 ? [...m.doc, '', ...argDocs] : m.doc, '    ');
  const body = `        switch self {\n${cases((parts) => expr(parts, '        ', rt))}        }\n`;
  if (m.args.length === 0) return `${head}    public var ${name}: String {\n${body}    }\n`;
  const params = m.args.map((a) => `${argName(a.name)}: ${a.type === 'number' ? `some ${number.type}` : 'String'}`).join(', ');
  const numbers = m.args
    .filter((a) => a.type === 'number')
    .map((a) => `        let ${argName(a.name)} = ${argName(a.name)}.${number.value}\n`)
    .join('');
  return `${head}    public func ${name}(${params}) -> String {\n${numbers}${body}    }\n`;
}

function formatConst(spec: NumberSpec, i: number): string {
  const affix = ([prefix, suffix]: readonly [string, string]) => `(${lit(prefix)}, ${lit(suffix)})`;
  const fields = [
    `minInt: ${spec.minInt}`,
    `minFrac: ${spec.minFrac}`,
    `maxFrac: ${spec.maxFrac}`,
    `shift: ${spec.shift}`,
    `primary: ${spec.grouping.primary}`,
    `secondary: ${spec.grouping.secondary}`,
    `minGroup: ${spec.grouping.min}`,
    `decimal: ${lit(spec.decimal)}`,
    `group: ${lit(spec.group)}`,
    `digits: ${spec.digits === undefined ? 'nil' : `[${spec.digits.map(lit).join(', ')}]`}`,
    `positive: ${affix(spec.positive)}`,
    `negative: ${affix(spec.negative)}`,
    `zero: ${affix(spec.zero)}`,
    `negativeZero: ${affix(spec.negativeZero)}`,
    `infinity: ${lit(spec.infinity)}`,
    `negativeInfinity: ${lit(spec.negativeInfinity)}`,
  ];
  return `    static let f${i} = Format(\n${fields.map((f) => `        ${f}`).join(',\n')}\n    )\n`;
}

const NUMBER = `
    /// A number format, taken apart when the file was generated.
    struct Format {
        let minInt: Int
        let minFrac: Int
        let maxFrac: Int
        let shift: Int
        let primary: Int
        let secondary: Int
        let minGroup: Int
        let decimal: String
        let group: String
        let digits: [String]?
        let positive: (String, String)
        let negative: (String, String)
        let zero: (String, String)
        let negativeZero: (String, String)
        let infinity: String
        let negativeInfinity: String
    }

    /// \`value\` as \`format\` writes it, or \`fallback\` where it isn't a number.
    static func number(_ value: Double, _ format: Format, _ fallback: String) -> String {
        if value.isNaN { return fallback }
        if value.isInfinite { return value > 0 ? format.infinity : format.negativeInfinity }
        let (written, frac) = digits(abs(value), format.shift, format.minFrac, format.maxFrac)
        var int = written
        let zero = (written + frac).allSatisfy { $0 == "0" }
        let negative = value.sign == .minus
        let (prefix, suffix) = zero ? (negative ? format.negativeZero : format.zero) : (negative ? format.negative : format.positive)
        while int.count < max(format.minInt, 1) { int = "0" + int }
        let grouped = format.minGroup > 0 && int.count >= format.primary + format.minGroup
        var out = prefix
        for (i, digit) in int.enumerated() {
            let left = int.count - i
            if grouped && i > 0 && (left == format.primary || (left > format.primary && (left - format.primary) % format.secondary == 0)) {
                out += format.group
            }
            out += shown(digit, format)
        }
        if !frac.isEmpty {
            out += format.decimal
            for digit in frac { out += shown(digit, format) }
        }
        return out + suffix
    }

    private static func shown(_ digit: Character, _ format: Format) -> String {
        guard let digits = format.digits, let ascii = digit.asciiValue else { return String(digit) }
        return digits[Int(ascii - 48)]
    }

    /// The shortest digits that read back as \`value\`, as \`Intl\` rounds them: moved \`shift\` places
    /// right, rounded half away from zero to \`max\` fraction digits, and trailing zeros cut to \`min\`.
    static func digits(_ value: Double, _ shift: Int, _ min: Int, _ max: Int) -> (String, String) {
        // \`description\` writes the shortest digits that read back, with an exponent past a size.
        let written = value.description.split(separator: "e", maxSplits: 1).map(String.init)
        let exponent = written.count > 1 ? Int(written[1]) ?? 0 : 0
        let pieces = written[0].split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        var all = (pieces[0] + (pieces.count > 1 ? pieces[1] : "")).compactMap { $0.wholeNumberValue }
        var point = pieces[0].count + exponent + shift
        if point < 0 {
            all = Array(repeating: 0, count: -point) + all
            point = 0
        }
        while all.count <= point + max { all.append(0) }
        let next = all[point + max]
        all = Array(all.prefix(point + max))
        if next >= 5 {
            var at = all.count - 1
            while at >= 0 && all[at] == 9 {
                all[at] = 0
                at -= 1
            }
            if at < 0 {
                all.insert(1, at: 0)
                point += 1
            } else {
                all[at] += 1
            }
        }
        var frac = Array(all[point...])
        while frac.count > min && frac.last == 0 { frac.removeLast() }
        let int = all[..<point].drop(while: { $0 == 0 })
        return (int.map(String.init).joined(), frac.map(String.init).joined())
    }
`;

const PLURAL = `
    /// CLDR's plural operands of a number as written.
    struct Operands {
        let n: Double
        let i: Double
        let v: Double
        let w: Double
        let f: Double
        let t: Double
        let c: Double
        let e: Double
    }

    /// The arm a plural takes: the \`=N\` that \`value\` equals, else the category of \`value\` less \`offset\`.
    static func plural(
        _ value: Double, _ offset: Double, _ exact: [(Double, String)], _ rules: (Operands) -> String, _ min: Int, _ max: Int
    ) -> String {
        exact.first(where: { $0.0 == value })?.1 ?? category(rules, value - offset, min, max)
    }

    /// The category \`rules\` give \`value\`, rounded to between \`min\` and \`max\` fraction digits.
    private static func category(_ rules: (Operands) -> String, _ value: Double, _ min: Int, _ max: Int) -> String {
        guard value.isFinite else { return "other" }
        let (written, frac) = digits(abs(value), 0, min, max)
        let int = written.isEmpty ? "0" : written
        var trimmed = Substring(frac)
        while trimmed.last == "0" { trimmed.removeLast() }
        let read = { (s: String) in Double(s) ?? 0 }
        return rules(Operands(
            n: read(frac.isEmpty ? int : int + "." + frac),
            i: read(int),
            v: Double(frac.count),
            w: Double(trimmed.count),
            f: read(frac),
            t: read(String(trimmed)),
            c: 0,
            e: 0
        ))
    }

    /// An integer in the range, as CLDR's ranges hold.
    private static func within(_ value: Double, _ from: Double, _ to: Double) -> Bool {
        value.truncatingRemainder(dividingBy: 1) == 0 && value >= from && value <= to
    }

    /// \`Math.round\`: half up, toward positive infinity.
    static func round(_ value: Double) -> Double {
        let floor = value.rounded(.down)
        return value - floor >= 0.5 ? floor + 1 : floor
    }
`;

const NUMBER_TYPES = [
  'Int',
  'Int8',
  'Int16',
  'Int32',
  'Int64',
  'UInt',
  'UInt8',
  'UInt16',
  'UInt32',
  'UInt64',
  'Double',
  'Float',
  'CGFloat',
];

export function swiftFile(model: NativeModel, target: NativeTarget & { name: string }, banner: string): string {
  const name = target.name;
  const rt = `${name}Runtime`;
  const names = model.messages.map((m): [string, string] => [m.key, ident(leading(camel(m.words)))]);
  checkNames('swift', names, ['tag', 'source', 'negotiate', 'rawValue', 'allCases', 'hashValue']);
  const cases = model.locales
    .map((l) => `    /// \`${l}\`${l === model.source ? ', the source' : ''}.\n    case ${caseName(l)} = ${lit(l)}\n`)
    .join('');
  // Named after the type, so two generated files in one module don't both add a property to `Int`.
  const number = { type: `${name}Number`, value: `${name.charAt(0).toLowerCase()}${name.slice(1)}Value` };
  const members = model.messages.map((m, i) => member(m, names[i]![1], rt, number)).join('\n');
  const usesNumbers = model.messages.some((m) => m.args.some((a) => a.type === 'number'));
  const numberProtocol = !usesNumbers
    ? ''
    : `
/// A number a message formats: any of Swift's integers or floats.
public protocol ${number.type} {
    var ${number.value}: Double { get }
}

${NUMBER_TYPES.map((t) => `extension ${t}: ${number.type} { public var ${number.value}: Double { Double(self) } }`).join('\n')}
`;
  const rules = model.rules
    .map(({ name: rule, rules }, i) => {
      const checks = rules.map(
        ([category, condition]) =>
          `        if ${conditionCode(condition, { field: (op) => `o.${op}`, mod: (v, by) => `${v}.truncatingRemainder(dividingBy: ${by})`, within: (v, from, to) => `within(${v}, ${from}, ${to})` })} { return ${lit(category)} }\n`,
      );
      return `    /// ${rule}\n    static func r${i}(_ o: Operands) -> String {\n${checks.join('')}        return "other"\n    }\n`;
    })
    .join('\n');
  const runtime =
    model.formats.length + model.rules.length === 0
      ? ''
      : `
/// What formats the messages, generated with them.
private enum ${rt} {${NUMBER}${model.rules.length > 0 ? PLURAL : ''}
${model.formats.map(formatConst).join('\n')}${rules === '' ? '' : `\n${rules}`}}
`;

  return `${banner}
import Foundation
${numberProtocol}
/// A locale the catalog is written or translated in, and its messages.
public enum ${name}: String, CaseIterable, Sendable {
${cases}
    /// The locale the catalog is written in, which every message falls back to.
    public static let source: ${name} = .${caseName(model.source)}

    /// The locale's BCP 47 tag.
    public var tag: String { rawValue }

    /// The best locale for what was asked, most preferred first: each tag tries an exact match, then
    /// its parents (\`pt-BR\` finds \`pt\`), then any locale of its language. The source if none is.
    public static func negotiate(_ requested: [String]) -> ${name} {
        let language = { (tag: String) in tag.split(separator: "-").first.map { $0.lowercased() } ?? "" }
        for want in requested {
            var tag = want
            while true {
                if let found = allCases.first(where: { $0.tag.lowercased() == tag.lowercased() }) { return found }
                guard let cut = tag.lastIndex(of: "-") else { break }
                tag = String(tag[..<cut])
            }
            if let found = allCases.first(where: { language($0.tag) == language(want) }) { return found }
        }
        return source
    }

${members}}
${runtime}`;
}
