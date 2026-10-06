import { describe, expect, it } from 'vitest';
import { ExternalModel, Resolver, TypeDescriber, type ExternalDefinition } from '../../../src/index.js';

describe('a type viewer retains externally declared fields', () => {
  it('reads a local record field through its original field identity', () => {
    const { resolution, catalog, type } = describeExternal({ kind: 'record-type', name: 'Cart', fields: [
      { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' }, local: true },
    ] });

    const fields = catalog.fields(type);

    expect(fields.status).toBe('known');
    if (fields.status !== 'known' || fields.value.kind !== 'available') throw new Error('Expected declared fields');
    expect(fields.value.fields.map(field => field.declaration)).toEqual([...resolution.model.nodes('field')].map(field => field.id));
    expect(fields.value.fields[0]!.type.status).toBe('known');
  });

  it('lets a caller navigate a local record field through the readable inspection', () => {
    const { catalog, type } = describeExternal({ kind: 'record-type', name: 'Cart', fields: [
      { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' }, local: true },
    ] });
    const record = [...catalog.inspection.query('record-type-declaration')][0]!;
    const member = record.fields[0]!;

    expect(member.kind).toBe('local');
    if (member.kind !== 'local') throw new Error('Expected the authored local field');
    const field = member.declaration;
    expect(field.kind).toBe('field');
    if (field.kind !== 'field') throw new Error('Expected a field declaration');
    const fields = catalog.fields(type);
    if (fields.status !== 'known' || fields.value.kind !== 'available') throw new Error('Expected declared fields');
    expect(field.name).toBe('title');
    expect(field.id).toBe(fields.value.fields[0]!.declaration);
  });

  it('keeps local and ordinary concept fields in their declared order', () => {
    const { catalog, type } = describeExternal({ kind: 'concept', name: 'Cart', public: [], members: [
      { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' }, local: true },
      { kind: 'field', name: 'count', type: { kind: 'builtin', name: 'Number' } },
    ] });

    const fields = catalog.fields(type);

    expect(fields.status).toBe('known');
    if (fields.status !== 'known' || fields.value.kind !== 'available') throw new Error('Expected declared fields');
    expect(fields.value.fields.map(field => catalog.inspection.read(field.declaration, 'field').name)).toEqual(['title', 'count']);
    expect(fields.value.fields.map(field => field.type.status)).toEqual(['known', 'known']);
    const concept = [...catalog.inspection.query('concept')][0]!;
    const directField = concept.members.find(member => member.kind === 'field');
    expect(directField?.name).toBe('count');
    expect(directField?.id).toBe(fields.value.fields[1]!.declaration);
  });
});

function describeExternal(definition: ExternalDefinition) {
  const resolution = new Resolver().resolve(new ExternalModel('external', [definition]), { modules: [], packages: [] });
  const catalog = new TypeDescriber().describe(resolution);
  return { resolution, catalog, type: catalog.declaredType([...catalog.typeDeclarations()][0]!) };
}
