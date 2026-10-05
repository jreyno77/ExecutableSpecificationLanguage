import type { TypeCatalog } from './type-catalog.js';
import type { TypeId } from './types.js';

/** Runtime admission descriptions come from the checked catalog, including recursive records. */
export class PythonData {
  readonly shapes: unknown[][] = [];
  private readonly ids = new Map<TypeId, number>();
  constructor(private readonly catalog: TypeCatalog) {}
  shape(id: TypeId): number {
    const found = this.ids.get(id); if (found !== undefined) return found;
    const index = this.shapes.length; this.ids.set(id, index); this.shapes.push([]);
    const type = this.catalog.describe(id), inspection = this.catalog.inspection;
    let shape: unknown[];
    if (type.kind === 'builtin') shape = [inspection.read(type.declaration, 'builtin-type').name, ...type.arguments.map(value => this.shape(value))];
    else if (type.kind === 'optional') shape = ['optional', this.shape(type.inner)];
    else if (type.kind === 'tuple') shape = ['tuple', ...type.elements.map(value => this.shape(value))];
    else if (type.kind === 'union') shape = ['union', ...type.alternatives.map(value => this.shape(value))];
    else if (type.kind === 'alias') {
      if (type.target.status !== 'known') throw Error('A checked alias requires its target.'); shape = ['alias', this.shape(type.target.value)];
    } else if (type.kind === 'literal') {
      const literal = inspection.read(type.expression, 'literal-type'), value = literal.value;
      shape = ['literal', value.kind === 'number-literal' ? Number((literal.negative ? '-' : '') + value.token) : value.value];
    } else if (type.kind === 'declared' && inspection.read(type.declaration).kind === 'record-type-declaration') {
      const fields = this.catalog.fields(id);
      if (fields.status !== 'known' || fields.value.kind !== 'available') throw Error('A checked record requires its fields.');
      shape = ['record', ...fields.value.fields.map(field => {
        if (field.type.status !== 'known') throw Error('A checked field requires its type.');
        return [inspection.read(field.declaration, 'field').name, this.shape(field.type.value)];
      })];
    } else shape = ['unsupported'];
    this.shapes[index] = shape; return index;
  }
}
export function pythonValue(value: unknown): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(pythonValue).join(', ') + ']';
  throw Error('Expected finite generated Python data.');
}
