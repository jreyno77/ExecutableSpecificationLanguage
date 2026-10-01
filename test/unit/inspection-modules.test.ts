import { describe, expect, it } from 'vitest';
import { LangiumReader, QueryInspection } from '../../src/index.js';
import { LangiumModel, ExternalModel, ExternalInputError,
  type ExternalDefinition, type Model, type NodeId } from '../../src/index.js';
import { describeType } from '../driver/type-description.js';

function source(text: string) {
  const read = new LangiumReader().read({ sourceId: 'library.expec', text });
  if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
  return read.document;
}
function recordFields(model: Model): string[] {
  const record = Array.from(new QueryInspection(model).query('record-type-declaration'))[0]!;
  return record.fields.map(item => {
    const field = item.kind === 'local' ? item.declaration : item;
    if (field.kind !== 'field') throw new Error('Expected a record field declaration');
    return `${field.name}: ${describeType(field.declaredType)}`;
  });
}
function inspectableKinds(model: Model, ids: Iterable<NodeId>): string[] {
  return Array.from(ids, id => model.node(id).kind);
}
function name(model: Model, id: NodeId): string { return model.node(id, 'name').decoded; }
function reference(model: Model, id: NodeId): readonly string[] {
  return model.node(id, 'reference').segments.map(segment => name(model, segment));
}
const cart = (): ExternalDefinition[] => [{ kind: 'record-type', name: 'Cart', fields: [
  { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' } },
] }];

describe('a consumer reads declared facts from either module producer', () => {
  it('reads Cart fields using the same consumer for source and external input', () => {
    const authored = new LangiumModel('shopping', source('type Cart { title: Text }'));
    const external = new ExternalModel('shopping', cart());
    expect(recordFields(authored)).toEqual(['title: Text']);
    expect(recordFields(external)).toEqual(['title: Text']);
    expect(inspectableKinds(authored, authored.roots())).toEqual(['record-type-declaration']);
    expect(inspectableKinds(external, external.roots())).toEqual(['record-type-declaration']);
  });

  it('preserves module, original source and external paths without fabricating locations', () => {
    const authored = new LangiumModel('shopping', source('type Cart { title: Text }'));
    const external = new ExternalModel('shopping', cart());
    const sourceField = Array.from(authored.nodes('field'))[0]!;
    const externalField = Array.from(external.nodes('field'))[0]!;
    expect(sourceField.origin).toMatchObject({ kind: 'source', module: 'shopping', range: { sourceId: 'library.expec' } });
    expect(externalField.origin).toEqual({ kind: 'external', module: 'shopping', path: [0, 'fields', 0] });
    expect(external.node(externalField.name, 'name')).toMatchObject({ kind: 'name', decoded: 'title' });
  });

  it('keeps a captured source snapshot after its author changes the input', () => {
    const document = { sourceId: 'library.expec', text: 'type Cart { title: Text }' };
    const read = new LangiumReader().read(document);
    if (read.status !== 'accepted') throw new Error('Expected an accepted record declaration');
    const inspection = new LangiumModel('shopping', read.document);
    document.text = 'type Changed {}';
    document.sourceId = 'changed.expec';
    expect(recordFields(inspection)).toEqual(['title: Text']);
    expect(Array.from(inspection.roots())).toHaveLength(1);
    expect(read.document.source).toEqual({ sourceId: 'library.expec', text: 'type Cart { title: Text }' });
  });
  it('keeps a captured external snapshot after its author changes the input', () => {
    const input = cart();
    const inspection = new ExternalModel('shopping', input);
    input.length = 0;
    expect(recordFields(inspection)).toEqual(['title: Text']);
  });

  it('starts references unanalyzed and retains explicit lookup instructions', () => {
    const inspection = new ExternalModel('shopping', [{ kind: 'alias-type', name: 'Items', target: {
      kind: 'builtin', name: 'List', arguments: [{ kind: 'named', path: ['Item'], module: 'inventory' }],
    } }]);
    const references = Array.from(inspection.nodes('reference'));
    expect(references.map(node => reference(inspection, node.id))).toEqual([['List'], ['Item']]);
    expect(references.map(node => node.lookup)).toEqual([{ kind: 'builtin' }, { kind: 'module', locator: 'inventory' }]);
    expect(references.map(node => inspection.resolution(node.id))).toEqual([{ status: 'not-analyzed' }, { status: 'not-analyzed' }]);
  });

  it('makes owner-specific generic parameters into declarations before their name children', () => {
    const inspection = new LangiumModel('shopping', source('type Pair<T> = [T, T]\ntype Page<T> = List<T>'));
    const parameters = Array.from(inspection.nodes('type-parameter'));
    expect(parameters.map(node => name(inspection, node.name))).toEqual(['T', 'T']);
    expect(parameters[0]!.id).not.toBe(parameters[1]!.id);
    expect(Array.from(inspection.nodes('alias-type-declaration'), node => node.typeParameters)).toEqual(parameters.map(node => [node.id]));
    const parameter = parameters[0]!, declaredName = inspection.node(parameter.name, 'name');
    expect(parameter.kind).toBe('type-parameter');
    expect(declaredName.kind).toBe('name');
    expect(parameter.id).not.toBe(declaredName.id);
    expect(inspection.children(parameter.id)).toEqual([declaredName.id]);
    const authoredOrigin = { kind: 'source', module: 'shopping', range: { sourceId: 'library.expec',
      start: { offset: 10, line: 1, column: 11 }, end: { offset: 11, line: 1, column: 12 } } };
    expect(parameter.origin).toMatchObject(authoredOrigin);
    expect(declaredName.origin).toMatchObject(authoredOrigin);
  });

  it('distinguishes authored absence, available bodies and unavailable external bodies', () => {
    const authored = new LangiumModel('shopping', source('function empty()\nfunction supplied() { promises "saved" }'));
    const external = new ExternalModel('shopping', [{ kind: 'function', name: 'external', parameters: [] }]);
    expect(Array.from(authored.nodes('function'), node => node.body.kind)).toEqual(['absent', 'available']);
    expect(Array.from(external.nodes('function'), node => node.body)).toEqual([{ kind: 'unavailable' }]);
    expect(Array.from(external.nodes('function'))[0]!.returnType).toBeUndefined();
  });

  it('preserves default presence without inventing an external expression', () => {
    const inspection = new ExternalModel('shopping', [{ kind: 'function', name: 'save', parameters: [
      { name: 'title', type: { kind: 'builtin', name: 'Text' }, hasDefault: true },
    ] }]);
    const parameter = Array.from(inspection.nodes('parameter'))[0]!;
    expect(parameter.hasDefault).toBe(true);
    expect(parameter.defaultValue).toBeUndefined();
  });

  it('preserves exact decimal spelling through common literal nodes', () => {
    const inspection = new ExternalModel('numbers', [{ kind: 'alias-type', name: 'Value', target: {
      kind: 'literal', value: { kind: 'number', decimal: '-9007199254740993.125e+2' },
    } }]);
    const alias = Array.from(inspection.nodes('alias-type-declaration'))[0]!;
    expect(describeType(new QueryInspection(inspection).read(alias.targetType))).toBe('-9007199254740993.125e+2');
  });
});

describe('an external contract author receives structural input failures', () => {
  it('rejects missing record structure while distinguishing empty and explicitly opaque types', () => {
    expect(() => new ExternalModel('shopping', [{ kind: 'record-type', name: 'Cart' }] as unknown as ExternalDefinition[]))
      .toThrowError(expect.objectContaining({ code: 'invalid-dependency-input', problems: [expect.objectContaining({ at: {
        kind: 'external', module: 'shopping', path: [0, 'fields'],
      } })] }));
    const inspection = new ExternalModel('shopping', [
      { kind: 'record-type', name: 'Empty', fields: [] }, { kind: 'opaque-type', name: 'Opaque' },
    ]);
    expect(inspectableKinds(inspection, inspection.roots())).toEqual(['record-type-declaration', 'opaque-type-declaration']);
  });

  it('rejects a capability at module level', () => {
    expect(() => new ExternalModel('shopping', [{ kind: 'capability', name: 'save', parameters: [] }]))
      .toThrowError(ExternalInputError);
  });

  it('rejects unknown type forms instead of inventing an opaque type', () => {
    const input = [{ kind: 'alias-type', name: 'Cart', target: { kind: 'foreign-magic' } }] as unknown as ExternalDefinition[];
    expect(() => new ExternalModel('shopping', input)).toThrowError(ExternalInputError);
  });

  it('rejects cyclic data objects while accepting recursive declared references', () => {
    const recursive: Record<string, unknown> = { kind: 'optional' };
    recursive.inner = recursive;
    expect(() => new ExternalModel('shopping', [{ kind: 'alias-type', name: 'Broken', target: recursive }] as unknown as ExternalDefinition[]))
      .toThrowError(ExternalInputError);
    const inspection = new ExternalModel('trees', [{ kind: 'record-type', name: 'Tree', fields: [
      { kind: 'field', name: 'parent', type: { kind: 'named', path: ['Tree'] } },
    ] }]);
    expect(recordFields(inspection)).toEqual(['parent: Tree']);
  });
});


describe('external adaptation retains declaration and type structure', () => {
  it('retains concept construction, public promises and local declarations', () => {
    const inspection = new ExternalModel('shopping', [{ kind: 'concept', name: 'Store', public: ['save'],
      construction: [{ name: 'cart', type: { kind: 'named', path: ['Cart'] } }], members: [
        { kind: 'record-type', name: 'Cart', fields: [], local: true },
        { kind: 'capability', name: 'save', parameters: [], result: { kind: 'builtin', name: 'Nothing' } },
      ],
    }]);
    const concept = Array.from(inspection.nodes('concept'))[0]!;
    expect(inspectableKinds(inspection, concept.members)).toEqual(['construction', 'public', 'local', 'capability']);
    const visibility = Array.from(inspection.nodes('public'))[0]!;
    expect(visibility.references.map(id => reference(inspection, id))).toEqual([['save']]);
    const local = Array.from(inspection.nodes('local'))[0]!;
    expect(inspection.node(local.declaration).kind).toBe('record-type-declaration');
  });

  it('retains generics, nested union, tuple, optional and literal type structure', () => {
    const inspection = new ExternalModel('shopping', [{ kind: 'alias-type', name: 'Value', typeParameters: ['T'], target: {
      kind: 'tuple', elements: [
        { kind: 'parameter', name: 'T' },
        { kind: 'optional', inner: { kind: 'union', alternatives: [
          { kind: 'literal', value: { kind: 'text', value: '' } },
          { kind: 'literal', value: { kind: 'boolean', value: false } },
        ] } },
      ],
    } }]);
    const alias = Array.from(inspection.nodes('alias-type-declaration'))[0]!;
    expect(describeType(new QueryInspection(inspection).read(alias.targetType))).toBe('[T, "" | false?]');
    const generic = inspection.node(alias.typeParameters[0]!, 'type-parameter');
    expect(name(inspection, generic.name)).toBe('T');
    const reference = Array.from(inspection.nodes('reference'))[0]!;
    expect(reference.lookup).toEqual({ kind: 'type-parameter' });
  });

  it('does not accept null in place of an optional collection', () => {
    expect(() => new ExternalModel('shopping', [
      { kind: 'opaque-type', name: 'Cart', typeParameters: null },
    ] as unknown as ExternalDefinition[])).toThrowError(ExternalInputError);
  });

  it('does not discard missing array entries in a supplied definition list', () => {
    const definitions = new Array<ExternalDefinition>(1);
    expect(() => new ExternalModel('shopping', definitions)).toThrowError(ExternalInputError);
  });

  it('rejects unsupported fields rather than silently dropping their meaning', () => {
    const definitions = [{ kind: 'opaque-type', name: 'Cart', extends: 'Base' }] as unknown as ExternalDefinition[];
    expect(() => new ExternalModel('shopping', definitions)).toThrowError(ExternalInputError);
  });
});
