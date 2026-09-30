import { describe, expect, it } from 'vitest';
import { ExternalInspection, Resolver, TypeDescriber, type ExternalDefinition } from '../../src/index.js';

describe('a type viewer retains externally declared fields', () => {
  it('reads a local record field through its original field identity', () => {
    const { inspection, catalog, type } = describeExternal({ kind: 'record-type', name: 'Cart', fields: [
      { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' }, local: true },
    ] });

    const fields = catalog.fields(type);

    expect(fields.status).toBe('known');
    if (fields.status !== 'known' || fields.value.kind !== 'available') throw new Error('Expected declared fields');
    expect(fields.value.fields.map(field => field.declaration)).toEqual([...inspection.nodes('field')].map(field => field.id));
    expect(fields.value.fields[0]!.type.status).toBe('known');
  });

  it('keeps local and ordinary concept fields in their declared order', () => {
    const { inspection, catalog, type } = describeExternal({ kind: 'concept', name: 'Cart', public: [], members: [
      { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' }, local: true },
      { kind: 'field', name: 'count', type: { kind: 'builtin', name: 'Number' } },
    ] });

    const fields = catalog.fields(type);

    expect(fields.status).toBe('known');
    if (fields.status !== 'known' || fields.value.kind !== 'available') throw new Error('Expected declared fields');
    expect(fields.value.fields.map(field => inspection.name(inspection.node(field.declaration, 'field').payload.name))).toEqual(['title', 'count']);
    expect(fields.value.fields.map(field => field.type.status)).toEqual(['known', 'known']);
  });
});

function describeExternal(definition: ExternalDefinition) {
  const inspection = new Resolver().resolve(new ExternalInspection('external', [definition]), { modules: [], packages: [] });
  const catalog = new TypeDescriber().describe(inspection);
  return { inspection, catalog, type: catalog.declaredType([...catalog.typeDeclarations()][0]!) };
}
