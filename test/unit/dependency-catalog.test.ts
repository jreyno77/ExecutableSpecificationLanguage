import { describe, expect, it } from 'vitest';
import { DependencyCatalog } from '../../src/resolution/dependency-catalog.js';
import { builtins } from '../../src/resolution/identity.js';
import type { DependencyDeclaration, DependencyModule, DependencySnapshot } from '../../src/resolution/contracts.js';

const record = (id: string, changes: Partial<DependencyDeclaration> = {}): DependencyDeclaration => ({ id, name: id, kind: 'record-type', links: [], ...changes });
const moduleWith = (locator: string, declarations: readonly DependencyDeclaration[], exports = declarations.filter(d => !d.owner).map(d => ({ path: [d.name], declaration: d.id }))): DependencyModule => ({ locator, declarations, exports });
const catalogOf = (modules: readonly DependencyModule[], packages: DependencySnapshot['packages'] = []) => new DependencyCatalog({ modules, packages }, builtins());

function declaredBy(catalog: DependencyCatalog, module: string, path: readonly string[]) {
  const result = catalog.export(module, path);
  expect(result.status).toBe('found');
  if (result.status !== 'found') throw new Error(`Expected ${module}:${path.join('.')} to be available`);
  return result.declaration;
}

function problemsFor(catalog: DependencyCatalog, module: string, path: readonly string[]) {
  const result = catalog.export(module, path);
  expect(result.status).toBe('invalid');
  if (result.status !== 'invalid') throw new Error('Expected an invalid export');
  return result.problems;
}

describe('supplied dependency declarations', () => {
  it('preserves one external identity through two advertised names without exposing unrequested declarations', () => {
    const catalog = catalogOf([moduleWith('shopping', [record('cart'), record('unused')], [
      { path: ['Cart'], declaration: 'cart' }, { path: ['Basket'], declaration: 'cart' },
    ])]);
    expect(Array.from(catalog.declarations())).toEqual([]);
    const cart = declaredBy(catalog, 'shopping', ['Cart']);
    expect(declaredBy(catalog, 'shopping', ['Basket']).id).toBe(cart.id);
    expect(cart.origin).toEqual({ kind: 'external', module: 'shopping', declaration: 'cart' });
    expect(Array.from(catalog.declarations()).map(d => d.name)).toEqual(['cart']);
  });

  it('keeps quoted dots distinct from qualified export paths', () => {
    const catalog = catalogOf([moduleWith('shopping', [record('literal'), record('qualified')], [
      { path: ['Sales.Cart'], declaration: 'literal' }, { path: ['Sales', 'Cart'], declaration: 'qualified' },
    ])]);
    expect(declaredBy(catalog, 'shopping', ['Sales.Cart']).id).not.toBe(declaredBy(catalog, 'shopping', ['Sales', 'Cart']).id);
  });

  it('admits required local declarations and preserves ownership', () => {
    const catalog = catalogOf([moduleWith('shopping', [record('Cart', {
      kind: 'concept', links: [{ label: 'public.save', target: { kind: 'local', declaration: 'save' } }],
    }), record('save', { kind: 'capability', owner: 'Cart' })])]);
    const cart = declaredBy(catalog, 'shopping', ['Cart']);
    const save = Array.from(catalog.declarations()).find(d => d.name === 'save');
    expect(save?.owner).toBe(cart.id);
  });

  it('reports an absent messages type at its supplied link rather than fabricating a type', () => {
    const catalog = catalogOf([moduleWith('results', [record('ValidationResult', {
      links: [{ label: 'messages.type', target: { kind: 'local', declaration: 'MissingType' } }],
    })])]);
    expect(problemsFor(catalog, 'results', ['ValidationResult'])).toEqual([expect.objectContaining({
      code: 'invalid-dependency-catalog', message: expect.stringContaining('messages.type'),
      at: { kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'links', 0, 'target'] },
    })]);
    expect(Array.from(catalog.declarations())).toEqual([]);
  });

  it('resolves a transitive imported target to the identity of its advertised declaration', () => {
    const catalog = catalogOf([
      moduleWith('results', [record('ValidationResult', { links: [{ label: 'messages.type', target: { kind: 'import', module: 'messages', path: ['Message'] } }] })]),
      moduleWith('messages', [record('Message', { links: [{ label: 'body.type', target: { kind: 'builtin', name: 'Text' } }] })]),
    ]);
    declaredBy(catalog, 'results', ['ValidationResult']);
    const transitive = Array.from(catalog.declarations()).find(d => d.name === 'Message');
    expect(transitive?.id).toBe(declaredBy(catalog, 'messages', ['Message']).id);
    expect(catalog.problems).toEqual([]);
  });

  it('retains the import chain when a transitive module is absent', () => {
    const catalog = catalogOf([
      moduleWith('results', [record('ValidationResult', { links: [{ label: 'message', target: { kind: 'import', module: 'messages', path: ['Message'] } }] })]),
      moduleWith('messages', [record('Message', { links: [{ label: 'body.type', target: { kind: 'import', module: 'text', path: ['Body'] } }] })]),
    ]);
    expect(problemsFor(catalog, 'results', ['ValidationResult'])).toEqual([
      expect.objectContaining({
        code: 'unavailable-module',
        at: { kind: 'dependency', path: ['modules', 1, 'declarations', 0, 'links', 0, 'target'] },
        related: expect.arrayContaining([{ kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'links', 0, 'target'] }]),
      }),
      expect.objectContaining({
        code: 'invalid-dependency-catalog', message: expect.stringContaining('body.type'),
        at: { kind: 'dependency', path: ['modules', 1, 'declarations', 0, 'links', 0, 'target'] },
        related: expect.arrayContaining([{ kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'links', 0, 'target'] }]),
      }),
    ]);
  });

  it('allows reference cycles without expanding aliases or admitting the same declaration twice', () => {
    const catalog = catalogOf([
      moduleWith('a', [record('First', { kind: 'alias-type', links: [{ label: 'target', target: { kind: 'import', module: 'b', path: ['Second'] } }] })]),
      moduleWith('b', [record('Second', { kind: 'alias-type', links: [{ label: 'target', target: { kind: 'import', module: 'a', path: ['First'] } }] })]),
    ]);
    declaredBy(catalog, 'a', ['First']);
    expect(Array.from(catalog.declarations()).map(d => d.name)).toEqual(['First', 'Second']);
    expect(catalog.problems).toEqual([]);
  });

  it('rejects an exported descendant of a local declaration', () => {
    const catalog = catalogOf([moduleWith('shopping', [record('Hidden', { kind: 'concept', local: true }), record('Cart', { owner: 'Hidden' })], [{ path: ['Cart'], declaration: 'Cart' }])]);
    expect(problemsFor(catalog, 'shopping', ['Cart'])).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-dependency-catalog', message: expect.stringContaining('local') })]));
  });

  it('rejects a missing owner at its metadata property', () => {
    const catalog = catalogOf([moduleWith('shopping', [record('Cart', { owner: 'Missing' })], [{ path: ['Cart'], declaration: 'Cart' }])]);
    expect(problemsFor(catalog, 'shopping', ['Cart'])).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'invalid-dependency-catalog', at: { kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'owner'] },
    })]));
  });

  it('rejects containment cycles even though ordinary reference cycles are allowed', () => {
    const catalog = catalogOf([moduleWith('shopping', [record('A', { owner: 'B' }), record('B', { owner: 'A' })], [{ path: ['A'], declaration: 'A' }])]);
    expect(problemsFor(catalog, 'shopping', ['A'])).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-dependency-catalog', message: expect.stringContaining('cycle') })]));
  });

  it('reports both duplicate module introductions without choosing one', () => {
    const catalog = catalogOf([moduleWith('shopping', [record('Cart')]), moduleWith('shopping', [record('Cart')])]);
    expect(problemsFor(catalog, 'shopping', ['Cart'])).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'invalid-dependency-catalog', at: { kind: 'dependency', path: ['modules', 1, 'locator'] },
      related: [{ kind: 'dependency', path: ['modules', 0, 'locator'] }],
    })]));
  });

  it('rejects duplicate declaration IDs and duplicate advertised paths', () => {
    const catalog = catalogOf([moduleWith('shopping', [record('Cart'), record('Cart')], [
      { path: ['Cart'], declaration: 'Cart' }, { path: ['Cart'], declaration: 'Cart' },
    ])]);
    const problems = problemsFor(catalog, 'shopping', ['Cart']);
    expect(problems.map(p => p.at)).toEqual(expect.arrayContaining([
      { kind: 'dependency', path: ['modules', 0, 'declarations', 1, 'id'] },
      { kind: 'dependency', path: ['modules', 0, 'exports', 1, 'path'] },
    ]));
  });

  it('requires an actual declaration and a nonempty advertised path', () => {
    const catalog = catalogOf([moduleWith('shopping', [], [{ path: [], declaration: 'Missing' }])]);
    expect(catalog.problems.map(p => p.at)).toEqual(expect.arrayContaining([
      { kind: 'dependency', path: ['modules', 0, 'exports', 0, 'path'] },
      { kind: 'dependency', path: ['modules', 0, 'exports', 0, 'declaration'] },
    ]));
  });

  it('distinguishes a missing module from a missing advertised export', () => {
    const catalog = catalogOf([moduleWith('shopping', [record('Cart')])]);
    expect(problemsFor(catalog, 'missing', ['Cart'])).toEqual([expect.objectContaining({ code: 'unavailable-module' })]);
    expect(problemsFor(catalog, 'shopping', ['Receipt'])).toEqual([expect.objectContaining({ code: 'unresolved-reference' })]);
  });

  it('checks supplied package aliases and authored phases without claiming installation', () => {
    const catalog = catalogOf([], [{ alias: 'vite', phases: ['build'] }]);
    expect(catalog.package('vite', 'build')).toEqual([]);
    expect(catalog.package('vite')).toEqual([]);
    expect(catalog.package('vite', 'runtime')).toEqual([expect.objectContaining({ code: 'unavailable-package' })]);
    expect(catalog.package('supabase')).toEqual([expect.objectContaining({ code: 'unavailable-package' })]);
  });

  it('rejects duplicate package aliases and duplicate phases', () => {
    const catalog = catalogOf([], [{ alias: 'vite', phases: ['build', 'build'] }, { alias: 'vite', phases: ['runtime'] }]);
    expect(catalog.problems.map(p => p.at)).toEqual(expect.arrayContaining([
      { kind: 'dependency', path: ['packages', 0, 'phases', 1] }, { kind: 'dependency', path: ['packages', 1, 'alias'] },
    ]));
    expect(catalog.package('vite')).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-dependency-catalog' })]));
  });

  it('does not mutate the supplied snapshot or retain removed modules across new catalogs', () => {
    const snapshot: DependencySnapshot = { modules: [moduleWith('shopping', [record('Cart')])], packages: [] };
    const before = JSON.stringify(snapshot);
    const first = new DependencyCatalog(snapshot, builtins());
    declaredBy(first, 'shopping', ['Cart']);
    expect(JSON.stringify(snapshot)).toBe(before);
    const next = catalogOf([]);
    expect(problemsFor(next, 'shopping', ['Cart'])).toEqual([expect.objectContaining({ code: 'unavailable-module' })]);
  });
});

describe('independent supplied exports', () => {
  it('keeps a complete export usable when a different selection names a missing declaration', () => {
    const catalog = catalogOf([moduleWith('results', [record('Valid')], [
      { path: ['Valid'], declaration: 'Valid' }, { path: ['Bad'], declaration: 'Missing' },
    ])]);
    expect(declaredBy(catalog, 'results', ['Valid']).name).toBe('Valid');
    expect(catalog.problems).toEqual(expect.arrayContaining([expect.objectContaining({
      at: { kind: 'dependency', path: ['modules', 0, 'exports', 1, 'declaration'] },
    })]));
    expect(problemsFor(catalog, 'results', ['Bad'])).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-dependency-catalog' })]));
    expect(Array.from(catalog.declarations()).map(d => d.name)).toEqual(['Valid']);
  });

  it('retains the requested link when a transitive module contains conflicting identities', () => {
    const catalog = catalogOf([
      moduleWith('results', [record('ValidationResult', { links: [{ label: 'messages.type', target: { kind: 'import', module: 'messages', path: ['Message'] } }] })]),
      moduleWith('messages', [record('Message'), record('Message')], [{ path: ['Message'], declaration: 'Message' }]),
    ]);
    expect(problemsFor(catalog, 'results', ['ValidationResult'])).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'invalid-dependency-catalog',
      at: { kind: 'dependency', path: ['modules', 1, 'declarations', 1, 'id'] },
      related: expect.arrayContaining([
        { kind: 'dependency', path: ['modules', 1, 'declarations', 0, 'id'] },
        { kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'links', 0, 'target'] },
      ]),
    })]));
  });
});

describe('incomplete supplied export contracts', () => {
  it('reports an incomplete selected export while retaining its absent transitive module as the cause', () => {
    const catalog = catalogOf([moduleWith('results', [record('ValidationResult', {
      links: [{ label: 'messages.type', target: { kind: 'import', module: 'messages', path: ['Message'] } }],
    })])]);
    const problems = problemsFor(catalog, 'results', ['ValidationResult']);
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unavailable-module', at: { kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'links', 0, 'target'] } }),
      expect.objectContaining({ code: 'invalid-dependency-catalog', message: expect.stringContaining('messages.type'), at: { kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'links', 0, 'target'] } }),
    ]));
    expect(problems).toHaveLength(2);
  });

  it('reports an incomplete supplied link when its module does not advertise the requested target', () => {
    const catalog = catalogOf([
      moduleWith('results', [record('ValidationResult', { links: [{ label: 'messages.type', target: { kind: 'import', module: 'messages', path: ['Message'] } }] })]),
      moduleWith('messages', [record('OtherMessage')]),
    ]);
    const problems = problemsFor(catalog, 'results', ['ValidationResult']);
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unresolved-reference' }),
      expect.objectContaining({ code: 'invalid-dependency-catalog', message: expect.stringContaining('messages.type'), at: { kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'links', 0, 'target'] } }),
    ]));
    expect(problems).toHaveLength(2);
  });
});
