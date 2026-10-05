import { describe, expect, it } from 'vitest';
import { name } from '../driver/resolution-model.js';
import { LangiumReader } from '../../src/language/langium/reader.js';
import { LangiumModel, ExternalModel, type ModuleModel } from '../../src/index.js';
import { Resolver } from '../../src/compiler/resolution.js';

function source(text: string): ModuleModel {
  const read = new LangiumReader().read({ sourceId: 'report.expec', text });
  if (read.status !== 'accepted') throw new Error('The report example must be grammatical');
  return new LangiumModel('entry', read.document);
}

describe('a consumer keeps completed resolution views independent', () => {
  it('owns fresh builtin handles while preserving the same supplied declaration handles', () => {
    const inspection = source('type Message { body: Text }');
    const resolver = new Resolver();
    const first = resolver.resolve(inspection, { modules: [], packages: [] });
    const second = resolver.resolve(inspection, { modules: [], packages: [] });
    const earlier = [...first.model.nodes('builtin-type')].find(node => name(first.model, node.name) === 'Text')!;
    const current = [...second.model.nodes('builtin-type')].find(node => name(second.model, node.name) === 'Text')!;
    expect(earlier.id).not.toBe(current.id);
    expect(() => second.model.node(earlier.id)).toThrowError(expect.objectContaining({ name: 'QueryError', code: 'foreign-node' }));
    const declaration = [...inspection.nodes('record-type-declaration')][0]!;
    expect(first.model.node(declaration.id).id).toBe(declaration.id);
    expect(second.model.node(declaration.id).id).toBe(declaration.id);
  });

  it('retains an earlier invalid reference after another call obtains its missing dependency', () => {
    const inspection = source('use Cart from "shopping"');
    const reference = [...inspection.nodes('reference')][0]!;
    const resolver = new Resolver();
    const missing = resolver.resolve(inspection, { modules: [], packages: [] });
    const present = resolver.resolve(inspection, { modules: [new ExternalModel('shopping', [
      { kind: 'record-type', name: 'Cart', fields: [] },
    ])], packages: [] });
    expect(missing.model.resolution(reference.id).status).toBe('invalid');
    expect(missing.problems.map(problem => problem.code)).toContain('unavailable-module');
    expect(present.model.resolution(reference.id).status).toBe('bound');
    expect(present.problems).toEqual([]);
  });

  it('enumerates entry roots, primitives and reached module roots in the documented order', () => {
    const inspection = source('use Zed from "z"\nuse Alpha from "a"\ntype Entry {}');
    const result = new Resolver().resolve(inspection, { modules: [
      new ExternalModel('z', [{ kind: 'record-type', name: 'Zed', fields: [] }]),
      new ExternalModel('a', [{ kind: 'record-type', name: 'Alpha', fields: [] }]),
    ], packages: [] });
    const roots = [...result.model.roots()].map(id => {
      const node = result.model.node(id);
      return 'name' in node ? name(result.model, node.name) : node.kind;
    });
    expect(roots).toEqual(['use', 'use', 'Entry', 'Text', 'Number', 'Boolean', 'List', 'Nothing', 'Alpha', 'Zed']);
  });
});
