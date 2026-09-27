import { describe, expect, it } from 'vitest';
import { createSyntaxReader } from '../../src/index.js';
import { DescriptionInspection, ExternalInspection, InspectionInputError,
  type ExternalDefinition, type Inspection, type NodeId } from '../../src/inspection.js';
import { describeType } from '../support/type-description.js';

function source(text: string) {
  const read = createSyntaxReader().read({ sourceId: 'library.expec', text });
  if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
  return read.description;
}
function recordFields(inspection: Inspection): string[] {
  const record = Array.from(inspection.nodes('record-type-declaration'))[0]!;
  return record.payload.fields.map(id => {
    const field = inspection.node(id, 'field');
    return `${inspection.name(field.payload.name)}: ${describeType(inspection, field.payload.declaredType)}`;
  });
}
function inspectableKinds(inspection: Inspection, ids: Iterable<NodeId>): string[] {
  return Array.from(ids, id => inspection.node(id).payload.kind);
}

const cart = (): ExternalDefinition[] => [{ kind: 'record-type', name: 'Cart', fields: [
  { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' } },
] }];

describe('a consumer reads declared facts from either module producer', () => {
  it('reads Cart fields using the same consumer for source and external input', () => {
    const authored = new DescriptionInspection('shopping', source('type Cart { title: Text }'));
    const external = new ExternalInspection('shopping', cart());
    expect(recordFields(authored)).toEqual(['title: Text']);
    expect(recordFields(external)).toEqual(['title: Text']);
    expect(inspectableKinds(authored, authored.roots())).toEqual(['record-type-declaration']);
    expect(inspectableKinds(external, external.roots())).toEqual(['record-type-declaration']);
  });

  it('preserves module, original source and external paths without fabricating locations', () => {
    const authored = new DescriptionInspection('shopping', source('type Cart { title: Text }'));
    const external = new ExternalInspection('shopping', cart());
    const sourceField = Array.from(authored.nodes('field'))[0]!;
    const externalField = Array.from(external.nodes('field'))[0]!;
    expect(sourceField.origin).toMatchObject({ kind: 'source', module: 'shopping', range: { sourceId: 'library.expec' } });
    expect(externalField.origin).toEqual({ kind: 'external', module: 'shopping', path: [0, 'fields', 0] });
    expect(external.node(externalField.payload.name, 'name').payload).toEqual({ kind: 'name', decoded: 'title' });
  });

  it('keeps a captured source snapshot after its author changes the input', () => {
    const description = source('type Cart { title: Text }');
    const inspection = new DescriptionInspection('shopping', description);
    const name = description.nodes.find(node => node.payload.kind === 'name' && node.payload.decoded === 'title')!;
    if (name.payload.kind === 'name') name.payload.decoded = 'changed';
    description.roots.length = 0;
    expect(recordFields(inspection)).toEqual(['title: Text']);
    expect(Array.from(inspection.roots())).toHaveLength(1);
  });

  it('keeps a captured external snapshot after its author changes the input', () => {
    const input = cart();
    const inspection = new ExternalInspection('shopping', input);
    input.length = 0;
    expect(recordFields(inspection)).toEqual(['title: Text']);
  });

  it('starts references unanalyzed and retains explicit lookup instructions', () => {
    const inspection = new ExternalInspection('shopping', [{ kind: 'alias-type', name: 'Items', target: {
      kind: 'builtin', name: 'List', arguments: [{ kind: 'named', path: ['Item'], module: 'inventory' }],
    } }]);
    const references = Array.from(inspection.nodes('reference'));
    expect(references.map(node => inspection.reference(node.id))).toEqual([['List'], ['Item']]);
    expect(references.map(node => node.payload.lookup)).toEqual([{ kind: 'builtin' }, { kind: 'module', locator: 'inventory' }]);
    expect(references.map(node => node.payload.resolution)).toEqual([{ status: 'not-analyzed' }, { status: 'not-analyzed' }]);
  });

  it('makes owner-specific generic parameters into declarations before their name children', () => {
    const inspection = new DescriptionInspection('shopping', source('type Pair<T> = [T, T]\ntype Page<T> = List<T>'));
    const parameters = Array.from(inspection.nodes('type-parameter'));
    expect(parameters.map(node => inspection.name(node.payload.name))).toEqual(['T', 'T']);
    expect(parameters[0]!.id).not.toBe(parameters[1]!.id);
    expect(Array.from(inspection.nodes('alias-type-declaration'), node => node.payload.typeParameters)).toEqual(parameters.map(node => [node.id]));
    expect(parameters[0]!.origin).toEqual(inspection.node(parameters[0]!.payload.name).origin);
  });

  it('distinguishes authored absence, available bodies and unavailable external bodies', () => {
    const authored = new DescriptionInspection('shopping', source('function empty()\nfunction supplied() { promises "saved" }'));
    const external = new ExternalInspection('shopping', [{ kind: 'function', name: 'external', parameters: [] }]);
    expect(Array.from(authored.nodes('function'), node => node.payload.body.kind)).toEqual(['absent', 'available']);
    expect(Array.from(external.nodes('function'), node => node.payload.body)).toEqual([{ kind: 'unavailable' }]);
    expect(Array.from(external.nodes('function'))[0]!.payload.returnType).toBeUndefined();
  });

  it('preserves default presence without inventing an external expression', () => {
    const inspection = new ExternalInspection('shopping', [{ kind: 'function', name: 'save', parameters: [
      { name: 'title', type: { kind: 'builtin', name: 'Text' }, hasDefault: true },
    ] }]);
    const parameter = Array.from(inspection.nodes('parameter'))[0]!;
    expect(parameter.payload.hasDefault).toBe(true);
    expect(parameter.payload.defaultValue).toBeUndefined();
  });

  it('preserves exact decimal spelling through common literal nodes', () => {
    const inspection = new ExternalInspection('numbers', [{ kind: 'alias-type', name: 'Value', target: {
      kind: 'literal', value: { kind: 'number', decimal: '-9007199254740993.125e+2' },
    } }]);
    const alias = Array.from(inspection.nodes('alias-type-declaration'))[0]!;
    expect(describeType(inspection, alias.payload.targetType)).toBe('-9007199254740993.125e+2');
  });
});

describe('an external contract author receives structural input failures', () => {
  it('rejects missing record structure while distinguishing empty and explicitly opaque types', () => {
    expect(() => new ExternalInspection('shopping', [{ kind: 'record-type', name: 'Cart' }] as unknown as ExternalDefinition[]))
      .toThrowError(expect.objectContaining({ code: 'invalid-dependency-input', problems: [expect.objectContaining({ at: {
        kind: 'external', module: 'shopping', path: [0, 'fields'],
      } })] }));
    const inspection = new ExternalInspection('shopping', [
      { kind: 'record-type', name: 'Empty', fields: [] }, { kind: 'opaque-type', name: 'Opaque' },
    ]);
    expect(inspectableKinds(inspection, inspection.roots())).toEqual(['record-type-declaration', 'opaque-type-declaration']);
  });

  it('rejects a capability at module level', () => {
    expect(() => new ExternalInspection('shopping', [{ kind: 'capability', name: 'save', parameters: [] }]))
      .toThrowError(InspectionInputError);
  });

  it('rejects unknown type forms instead of inventing an opaque type', () => {
    const input = [{ kind: 'alias-type', name: 'Cart', target: { kind: 'foreign-magic' } }] as unknown as ExternalDefinition[];
    expect(() => new ExternalInspection('shopping', input)).toThrowError(InspectionInputError);
  });

  it('rejects cyclic data objects while accepting recursive declared references', () => {
    const recursive: Record<string, unknown> = { kind: 'optional' };
    recursive.inner = recursive;
    expect(() => new ExternalInspection('shopping', [{ kind: 'alias-type', name: 'Broken', target: recursive }] as unknown as ExternalDefinition[]))
      .toThrowError(InspectionInputError);
    const inspection = new ExternalInspection('trees', [{ kind: 'record-type', name: 'Tree', fields: [
      { kind: 'field', name: 'parent', type: { kind: 'named', path: ['Tree'] } },
    ] }]);
    expect(recordFields(inspection)).toEqual(['parent: Tree']);
  });
});


describe('external adaptation retains declaration and type structure', () => {
  it('retains concept construction, public promises and local declarations', () => {
    const inspection = new ExternalInspection('shopping', [{ kind: 'concept', name: 'Store', public: ['save'],
      construction: [{ name: 'cart', type: { kind: 'named', path: ['Cart'] } }], members: [
        { kind: 'record-type', name: 'Cart', fields: [], local: true },
        { kind: 'capability', name: 'save', parameters: [], result: { kind: 'builtin', name: 'Nothing' } },
      ],
    }]);
    const concept = Array.from(inspection.nodes('concept'))[0]!;
    expect(inspectableKinds(inspection, concept.payload.members)).toEqual(['construction', 'public', 'local', 'capability']);
    const visibility = Array.from(inspection.nodes('public'))[0]!;
    expect(visibility.payload.references.map(id => inspection.reference(id))).toEqual([['save']]);
    const local = Array.from(inspection.nodes('local'))[0]!;
    expect(inspection.node(local.payload.declaration).payload.kind).toBe('record-type-declaration');
  });

  it('retains generics, nested union, tuple, optional and literal type structure', () => {
    const inspection = new ExternalInspection('shopping', [{ kind: 'alias-type', name: 'Value', typeParameters: ['T'], target: {
      kind: 'tuple', elements: [
        { kind: 'parameter', name: 'T' },
        { kind: 'optional', inner: { kind: 'union', alternatives: [
          { kind: 'literal', value: { kind: 'text', value: '' } },
          { kind: 'literal', value: { kind: 'boolean', value: false } },
        ] } },
      ],
    } }]);
    const alias = Array.from(inspection.nodes('alias-type-declaration'))[0]!;
    expect(describeType(inspection, alias.payload.targetType)).toBe('[T, "" | false?]');
    const generic = inspection.node(alias.payload.typeParameters[0]!, 'type-parameter');
    expect(inspection.name(generic.payload.name)).toBe('T');
    const reference = Array.from(inspection.nodes('reference'))[0]!;
    expect(reference.payload.lookup).toEqual({ kind: 'type-parameter' });
  });

  it('does not accept null in place of an optional collection', () => {
    expect(() => new ExternalInspection('shopping', [
      { kind: 'opaque-type', name: 'Cart', typeParameters: null },
    ] as unknown as ExternalDefinition[])).toThrowError(InspectionInputError);
  });

  it('does not discard missing array entries in a supplied definition list', () => {
    const definitions = new Array<ExternalDefinition>(1);
    expect(() => new ExternalInspection('shopping', definitions)).toThrowError(InspectionInputError);
  });

  it('rejects unsupported fields rather than silently dropping their meaning', () => {
    const definitions = [{ kind: 'opaque-type', name: 'Cart', extends: 'Base' }] as unknown as ExternalDefinition[];
    expect(() => new ExternalInspection('shopping', definitions)).toThrowError(InspectionInputError);
  });
});
