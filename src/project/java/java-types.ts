import type { Item } from '../../model/inspection-item.js';
import type { TypeCatalog } from '../../compiler/type-catalog.js';
import type { TypeFact, TypeId } from '../../compiler/type-description.js';
import { decimal } from '../../compiler/decimal.js';

/** Exact ordinary list classes cannot override element traversal with application hooks. */
export function javaListClass(type: string): string {
  return ['java.util.ArrayList.class','java.util.LinkedList.class','java.util.List.of().getClass()',
    'java.util.List.of(0).getClass()','java.util.Arrays.asList(0).getClass()'].map(allowed=>type+' == '+allowed).join(' || ');
}

/** Pure generated data validation, reused when verifying fixture construction. */
export function javaData(): string { return `final class ExpecData {
    private ExpecData() {}
    static <T> T required(T value, String path) { if (value == null) throw new IllegalArgumentException(path + ": required data"); return value; }
    static double number(double value, String path) { if (!java.lang.Double.isFinite(value)) throw new IllegalArgumentException(path + ": finite Number required"); return value; }
    static <T> T literal(T value, String path, boolean matches) { if (!matches) throw new IllegalArgumentException(path + ": literal value required"); return required(value, path); }
    static <T> java.util.Optional<T> optional(java.util.Optional<T> value, String path, java.util.function.Function<T,T> check) { return required(value, path).map(check); }
    static <T> java.util.List<T> list(java.util.List<T> value, String path, java.util.function.Function<T,T> check) { Class<?> kind = required(value, path).getClass(); if (!(${javaListClass("kind")})) throw new IllegalArgumentException(path + ": ordinary list data required"); return value.stream().map(check).toList(); }
}`; }
export function javaRecordBody(validation: readonly string[]): string {
  return '{\n'+validation.map(line=>'        '+line).join('\n')+'\n    }';
}

/** One generated tuple representation, shared by contracts and acceptance data. */
export function javaTuple(arity: number): string {
  return 'public record Tuple' + arity + '<' + Array.from({ length: arity }, (_, index) => 'T' + (index + 1)).join(', ') + '>('
    + Array.from({ length: arity }, (_, index) => 'T' + (index + 1) + ' item' + (index + 1)).join(', ') + ') {\n'
    + '    public Tuple' + arity + ' { ' + Array.from({ length: arity }, (_, index) => 'ExpecData.required(item' + (index + 1) + ', "item' + (index + 1) + '");').join(' ') + ' }\n}';
}

/** Native spelling and constructor validation of the shared checked types. */
export class JavaTypes {
  readonly tuples = new Set<number>();
  private needed = false;
  constructor(private readonly catalog: TypeCatalog, private readonly packageName: string,
    private readonly reference: (item: Item) => string,
    private readonly problem: (code: string, message: string, item: Item) => void,
    private readonly sharedTuples: ReadonlyMap<number,string> = new Map(),
    private readonly recordValue?: (id:TypeId,expression:string,path:string)=>string|undefined) {}
  tuple(arity:number): string { this.tuples.add(arity); return this.sharedTuples.get(arity) ?? this.packageName + ".Tuple" + arity; }
  known<T>(fact: TypeFact<T>): T {
    if (fact.status !== 'known') throw new TypeError('Java projection requires checked type facts.');
    return fact.value;
  }
  of(item: Item, boxed = false): string { return this.name(this.known(this.catalog.typeOf(item.id)), item, boxed); }
  erased(id: TypeId, at: Item): string {
    const type = this.catalog.describe(id);
    if (type.kind === 'alias') return this.erased(this.known(type.target), at);
    if (type.kind === 'parameter') return 'java.lang.Object';
    return this.name(id, at).replace(/<.*>$/, '');
  }
  name(id: TypeId, at: Item, boxed = false): string {
    const type = this.catalog.describe(id);
    if (type.kind === 'alias') return this.name(this.known(type.target), at, boxed);
    if (type.kind === 'optional') return 'java.util.Optional<' + this.name(type.inner, at, true) + '>';
    if (type.kind === 'tuple') {
      return this.tuple(type.elements.length) + '<' + type.elements.map(element => this.name(element, at, true)).join(', ') + '>';
    }
    if (type.kind === 'union') {
      const alternatives = type.alternatives.map(id => this.catalog.describe(id));
      const names = type.alternatives.map(id => this.name(id, at, boxed));
      if (alternatives.every(type => type.kind === 'literal') && new Set(names).size === 1) return names[0]!;
      this.problem('unsupported-native-type', 'Java requires an explicit native mapping for this union.', at); return 'java.lang.Object';
    }
    if (type.kind === 'literal') {
      const item = this.catalog.inspection.read(type.expression, 'literal-type'), literal = item.value;
      if (literal.kind === 'string-literal') return 'java.lang.String';
      if (literal.kind === 'boolean-literal') return boxed ? 'java.lang.Boolean' : 'boolean';
      const token = (item.negative ? '-' : '') + literal.token, value = Number(token);
      if (!Number.isFinite(value) || decimal(token) !== decimal(String(value))) this.problem('unsupported-native-number', 'Java double cannot preserve ' + token + '.', item);
      return boxed ? 'java.lang.Double' : 'double';
    }
    const node = this.catalog.inspection.read(type.declaration);
    if (type.kind === 'parameter') return this.reference(node);
    if (type.kind === 'builtin' && node.kind === 'builtin-type') {
      if (node.name === 'List') return 'java.util.List<' + type.arguments.map(arg => this.name(arg, at, true)).join(', ') + '>';
      return ({ Text: 'java.lang.String', Number: boxed ? 'java.lang.Double' : 'double', Boolean: boxed ? 'java.lang.Boolean' : 'boolean', Nothing: boxed ? 'java.lang.Void' : 'void' } as const)[node.name as 'Text'];
    }
    return this.reference(node) + (type.arguments.length ? '<' + type.arguments.map(arg => this.name(arg, at, true)).join(', ') + '>' : '');
  }
  value(id: TypeId, expression: string, path: string, boxed = false, depth = 0): string {
    this.needed = true;
    const type = this.catalog.describe(id), support = this.packageName + '.ExpecData.';
    const required = support + 'required(' + expression + ', ' + path + ')';
    if (type.kind === 'alias') return this.value(this.known(type.target), expression, path, boxed, depth);
    if (type.kind === 'optional') return support + 'optional(' + expression + ', ' + path + ', item' + depth + ' -> ' + this.value(type.inner, 'item' + depth, path, true, depth + 1) + ')';
    if (type.kind === 'tuple') return 'new ' + this.tuple(type.elements.length) + '<>('
      + type.elements.map((element, index) => this.value(element, '(' + required + ').item' + (index + 1) + '()', path, true, depth + 1)).join(', ') + ')';
    if (type.kind === 'literal' || type.kind === 'union') {
      const ids = type.kind === 'union' ? type.alternatives : [id];
      const conditions = ids.map(id => {
        const meaning = this.catalog.describe(id);
        if (meaning.kind !== 'literal') return 'false';
        const literal = this.catalog.inspection.read(meaning.expression, 'literal-type');
        return literal.value.kind === 'string-literal' ? JSON.stringify(literal.value.value) + '.equals(' + expression + ')'
          : '(' + expression + ' == ' + (literal.value.kind === 'boolean-literal' ? literal.value.value : (literal.negative ? '-' : '') + literal.value.token + 'd') + ')';
      });
      return support + 'literal(' + expression + ', ' + path + ', ' + conditions.join(' || ') + ')';
    }
    if (type.kind === 'builtin') {
      const name = this.catalog.inspection.read(type.declaration, 'builtin-type').name;
      if (name === 'Number') return support + 'number(' + (boxed ? required : expression) + ', ' + path + ')';
      if (name === 'Boolean' && !boxed) return expression;
      if (name === 'List') return support + 'list(' + expression + ', ' + path + ', item' + depth + ' -> ' + this.value(type.arguments[0]!, 'item' + depth, path, true, depth + 1) + ')';
    }
    return this.recordValue?.(id,expression,path) ?? required;
  }
  support(): { name: string; text: string }[] {
    if (!this.needed && !this.tuples.size) return [];
    return [{ name: 'ExpecData', text: javaData() }, ...[...this.tuples].filter(arity=>!this.sharedTuples.has(arity)).sort((a, b) => a - b).map(arity => ({ name: 'Tuple' + arity, text: javaTuple(arity) }))];
  }
}
