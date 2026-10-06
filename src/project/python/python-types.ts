import type { TypeCatalog } from '../../compiler/type-catalog.js';
import type { TypeId } from '../../compiler/types.js';
import type { Item } from '../../model/inspection-item.js';
import { decimal } from '../../compiler/decimal.js';

/** One Python spelling policy for checked contract and acceptance signatures. */
export class PythonTypes {
  readonly imports = new Set<string>();
  constructor(private readonly catalog: TypeCatalog, private readonly reference: (item: Item) => string,
    private readonly problem: (code: string, item: Item, message: string) => void) {}
  text(id: TypeId): string {
    const type = this.catalog.describe(id), inspection = this.catalog.inspection;
    if (type.kind === 'parameter') return this.reference(inspection.read(type.declaration));
    if (type.kind === 'builtin') {
      const name = inspection.read(type.declaration, 'builtin-type').name;
      return name === 'List' ? 'list[' + type.arguments.map(value => this.text(value)).join(', ') + ']'
        : ({ Text: 'str', Number: 'float', Boolean: 'bool', Nothing: 'None' } as Record<string, string>)[name]!;
    }
    if (type.kind === 'alias' || type.kind === 'declared') return this.reference(inspection.read(type.declaration)) + (type.arguments.length ? '[' + type.arguments.map(value => this.text(value)).join(', ') + ']' : '');
    if (type.kind === 'tuple') return 'tuple[' + (type.elements.map(value => this.text(value)).join(', ') || '()') + ']';
    if (type.kind === 'union') return type.alternatives.map(value => this.text(value)).join(' | ');
    if (type.kind === 'optional') return this.text(type.inner) + ' | Absent';
    if (type.kind !== 'literal') throw Error('Unknown checked Python type.');
    const literal = inspection.read(type.expression, 'literal-type'), value = literal.value;
    let token = value.kind === 'string-literal' ? JSON.stringify(value.value) : value.kind === 'boolean-literal' ? value.value ? 'True' : 'False' : (literal.negative ? '-' : '') + value.token;
    if (value.kind === 'number-literal') {
      const number = Number(token);
      if (!Number.isFinite(number) || decimal(token) !== decimal(String(number))) this.problem('unsupported-native-number', literal, 'Python Number cannot retain ' + token + ' as binary64.');
      else if (!Number.isInteger(number)) this.problem('unsupported-native-type', literal, 'Python Literal cannot represent ' + token + '.');
      else token = BigInt(number).toString();
    }
    this.imports.add('Literal'); return 'Literal[' + token + ']';
  }
}
