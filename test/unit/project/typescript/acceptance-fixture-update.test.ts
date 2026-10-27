import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { AcceptancePreservation } from '../../../../src/project/typescript/acceptance-preservation.js';
import { acceptanceOptions } from '../../../../src/project/typescript/acceptance-bindings.js';
import { acceptancePlacement, type AcceptanceState } from '../../../../src/project/typescript/acceptance-state.js';
import type { ArtifactAssociation, ProjectSnapshot } from '../../../../src/index.js';

function fixtureUpdate(prior: string, current: string, requested: string): AcceptancePreservation {
  const path = 'test/dsl/books.ts', options = acceptanceOptions.parse({ domain: 'books' });
  const artifacts: ArtifactAssociation[] = [{ specId: 'fixture-book', locator: { outputId: 'acceptance', format: 'typescript-symbol-1', value: {
    file: path, declaration: [{ kind: 'class', name: 'Books' }, { kind: 'property', name: 'book', static: false }],
  } } }];
  const text = (property: string) => 'export class Books { ' + property + ' }', bytes = Buffer.from(text(current));
  const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
  const snapshot: ProjectSnapshot = { root: { path: '/fixture-unit', identity: 'owned' }, complete: true, files: [{ path, bytes, version: hash(bytes) }],
    excludeNames: [], excluded: [], problems: [] };
  const previous: AcceptanceState = { format: 1, options: acceptancePlacement(options), mappings: [], deleted: [], authored: [], files: [{
    id: 'dsl', path, generated: text(prior), hash: hash(text(prior)), confirmed: hash(text(prior)), artifacts,
    container: { role: 'dsl', declaration: [{ kind: 'class', name: 'Books' }] },
  }] };
  return new AcceptancePreservation(snapshot, options, previous, [{ path, text: text(requested) }], artifacts, artifacts, undefined);
}
function changedData(update: AcceptancePreservation): unknown {
  expect(update.problems).toEqual([]);
  const change = update.changes.find(item => item.kind === 'write' && item.path === 'test/dsl/books.ts');
  expect(change?.kind).toBe('write');
  if (!change || change.kind !== 'write') throw Error('No actual DSL write.');
  const source = ts.createSourceFile(change.path, Buffer.from(change.bytes).toString(), ts.ScriptTarget.Latest, true);
  const property = source.statements.filter(ts.isClassDeclaration).flatMap(node => node.members).find(ts.isPropertyDeclaration)!;
  expect(property.initializer).toBeDefined();
  return JSON.parse(JSON.stringify(runInNewContext('(' + property.initializer!.getText(source) + ')', Object.create(null), { timeout: 1000 })));
}

describe('retained fixture initializer preservation', () => {
  it('locates a missing initializer instead of silently recreating handwritten data', () => {
    const update = fixtureUpdate('readonly book: string = "Dune";', 'readonly book: string;', 'readonly book: string = "Hyperion";');
    expect(update.problems.map(problem => problem.code)).toContain('handwritten-fixture-conflict');
    const problem = update.problems.find(problem => problem.code === 'handwritten-fixture-conflict')!;
    expect(problem.at.kind).toBe('dependency');
    if (problem.at.kind !== 'dependency') throw Error('Expected actual native fixture location.');
    expect(problem.at.path[1]).toBe('test/dsl/books.ts');
    expect('export class Books { readonly book: string; }'.slice(Number(problem.at.path[2]), Number(problem.at.path[2]) + Number(problem.at.path[3])))
      .toBe('readonly book: string;');
  });
  it('replaces an owned nested record initializer with the requested literal data', () => {
    const prior = 'readonly book: { title: string; copies: number } = { title: "Dune", copies: 1 };';
    const update = fixtureUpdate(prior, prior, 'readonly book: { title: string; copies: number } = { title: "Hyperion", copies: 2 };');
    expect(changedData(update)).toEqual({ title: 'Hyperion', copies: 2 });
  });
});
