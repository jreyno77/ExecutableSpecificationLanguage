import { describe, expect, it } from 'vitest';
import { AntlrSyntaxReader } from '../../src/grammar/reader.js';
import { DescriptionInspection, ExternalInspection, type ModuleInspection } from '../../src/inspection.js';
import { Resolver } from '../../src/resolution/resolve.js';

function source(text: string): ModuleInspection {
  const read = new AntlrSyntaxReader().read({ sourceId: 'report.expec', text });
  if (read.status !== 'accepted') throw new Error('The report example must be grammatical');
  return new DescriptionInspection('entry', read.description);
}

describe('a consumer keeps completed resolution views independent', () => {
  it('owns fresh builtin handles while preserving the same supplied declaration handles', () => {
    const inspection = source('type Message { body: Text }');
    const resolver = new Resolver();
    const first = resolver.resolve(inspection, { modules: [], packages: [] });
    const second = resolver.resolve(inspection, { modules: [], packages: [] });
    const earlier = [...first.nodes('builtin-type')].find(node => first.name(node.payload.name) === 'Text')!;
    const current = [...second.nodes('builtin-type')].find(node => second.name(node.payload.name) === 'Text')!;
    expect(earlier.id).not.toBe(current.id);
    expect(() => second.node(earlier.id)).toThrowError(expect.objectContaining({ name: 'InspectionError', code: 'foreign-node' }));
    const declaration = [...inspection.nodes('record-type-declaration')][0]!;
    expect(first.node(declaration.id).id).toBe(declaration.id);
    expect(second.node(declaration.id).id).toBe(declaration.id);
  });

  it('retains an earlier invalid reference after another call obtains its missing dependency', () => {
    const inspection = source('use Cart from "shopping"');
    const reference = [...inspection.nodes('reference')][0]!;
    const resolver = new Resolver();
    const missing = resolver.resolve(inspection, { modules: [], packages: [] });
    const present = resolver.resolve(inspection, { modules: [new ExternalInspection('shopping', [
      { kind: 'record-type', name: 'Cart', fields: [] },
    ])], packages: [] });
    expect(missing.node(reference.id, 'reference').payload.resolution.status).toBe('invalid');
    expect(missing.problems.map(problem => problem.code)).toContain('unavailable-module');
    expect(present.node(reference.id, 'reference').payload.resolution.status).toBe('bound');
    expect(present.problems).toEqual([]);
  });

  it('enumerates entry roots, primitives and reached module roots in the documented order', () => {
    const inspection = source('use Zed from "z"\nuse Alpha from "a"\ntype Entry {}');
    const result = new Resolver().resolve(inspection, { modules: [
      new ExternalInspection('z', [{ kind: 'record-type', name: 'Zed', fields: [] }]),
      new ExternalInspection('a', [{ kind: 'record-type', name: 'Alpha', fields: [] }]),
    ], packages: [] });
    const roots = [...result.roots()].map(id => {
      const node = result.node(id);
      return 'name' in node.payload ? result.name(node.payload.name) : node.payload.kind;
    });
    expect(roots).toEqual(['use', 'use', 'Entry', 'Text', 'Number', 'Boolean', 'List', 'Nothing', 'Alpha', 'Zed']);
  });
});
