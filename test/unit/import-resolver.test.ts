import { describe, expect, it } from 'vitest';
import { ModuleCatalog, type DependencyDeclaration, type DependencyModule } from '../../src/resolution/dependency-module.js';
import { ImportResolver } from '../../src/resolution/import-resolver.js';
import { builtins } from '../../src/resolution/builtins.js';

const record = (id: string, changes: Partial<DependencyDeclaration> = {}): DependencyDeclaration => ({ id, name: id, kind: 'record-type', links: [], ...changes });
const moduleWith = (locator: string, declarations: readonly DependencyDeclaration[], exports = declarations.filter(d => !d.owner).map(d => ({ path: [d.name], declaration: d.id }))): DependencyModule => ({ locator, declarations, exports });
const resolverOf = (modules: readonly DependencyModule[]) => new ImportResolver(new ModuleCatalog(modules), builtins());

function declaredBy(resolver: ImportResolver, module: string, path: readonly string[]) {
  const result = resolver.resolve([{ module, path }]).imports[0]!;
  expect(result.status).toBe('found');
  if (result.status !== 'found') throw new Error(`Expected ${module}:${path.join('.')} to be available`);
  return result.declaration;
}

function problemsFor(resolver: ImportResolver, module: string, path: readonly string[]) {
  const result = resolver.resolve([{ module, path }]).imports[0]!;
  expect(result.status).toBe('invalid');
  if (result.status !== 'invalid') throw new Error('Expected an invalid export');
  return result.problems;
}

describe('supplied dependency declarations', () => {
  it('preserves one external identity through two advertised names without exposing unrequested declarations', () => {
    const resolver = resolverOf([moduleWith('shopping', [record('cart'), record('unused')], [
      { path: ['Cart'], declaration: 'cart' }, { path: ['Basket'], declaration: 'cart' },
    ])]);
    expect(resolver.resolve([]).declarations).toEqual([]);
    const cart = declaredBy(resolver, 'shopping', ['Cart']);
    expect(declaredBy(resolver, 'shopping', ['Basket']).id).toBe(cart.id);
    expect(cart.origin).toEqual({ kind: 'external', module: 'shopping', declaration: 'cart' });
    expect(resolver.resolve([{ module: 'shopping', path: ['Cart'] }, { module: 'shopping', path: ['Basket'] }]).declarations.map(item => item.declaration.name)).toEqual(['cart']);
  });

  it('keeps quoted dots distinct from qualified export paths', () => {
    const resolver = resolverOf([moduleWith('shopping', [record('literal'), record('qualified')], [
      { path: ['Sales.Cart'], declaration: 'literal' }, { path: ['Sales', 'Cart'], declaration: 'qualified' },
    ])]);
    expect(declaredBy(resolver, 'shopping', ['Sales.Cart']).id).not.toBe(declaredBy(resolver, 'shopping', ['Sales', 'Cart']).id);
  });

  it('admits required local declarations and preserves ownership', () => {
    const resolver = resolverOf([moduleWith('shopping', [record('Cart', {
      kind: 'concept', links: [{ label: 'public.save', target: { kind: 'local', declaration: 'save' } }],
    }), record('save', { kind: 'capability', owner: 'Cart' })])]);
    const cart = declaredBy(resolver, 'shopping', ['Cart']);
    const save = resolver.resolve([{ module: 'shopping', path: ['Cart'] }]).declarations.find(item => item.declaration.name === 'save')?.declaration;
    expect(save?.owner).toBe(cart.id);
  });

  it('reports an absent messages type at its supplied link rather than fabricating a type', () => {
    const resolver = resolverOf([moduleWith('results', [record('ValidationResult', {
      links: [{ label: 'messages.type', target: { kind: 'local', declaration: 'MissingType' } }],
    })])]);
    expect(problemsFor(resolver, 'results', ['ValidationResult'])).toEqual([expect.objectContaining({
      code: 'invalid-dependency-catalog', message: expect.stringContaining('messages.type'),
      at: { kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'links', 0, 'target'] },
    })]);
    expect(resolver.resolve([{ module: 'results', path: ['ValidationResult'] }]).declarations).toEqual([]);
  });

  it('resolves a transitive imported target to the identity of its advertised declaration', () => {
    const resolver = resolverOf([
      moduleWith('results', [record('ValidationResult', { links: [{ label: 'messages.type', target: { kind: 'import', module: 'messages', path: ['Message'] } }] })]),
      moduleWith('messages', [record('Message', { links: [{ label: 'body.type', target: { kind: 'builtin', name: 'Text' } }] })]),
    ]);
    declaredBy(resolver, 'results', ['ValidationResult']);
    const transitive = resolver.resolve([{ module: 'results', path: ['ValidationResult'] }]).declarations.find(item => item.declaration.name === 'Message')?.declaration;
    expect(transitive?.id).toBe(declaredBy(resolver, 'messages', ['Message']).id);
    expect(resolver.resolve([]).problems).toEqual([]);
  });

  it('retains the import chain when a transitive module is absent', () => {
    const resolver = resolverOf([
      moduleWith('results', [record('ValidationResult', { links: [{ label: 'message', target: { kind: 'import', module: 'messages', path: ['Message'] } }] })]),
      moduleWith('messages', [record('Message', { links: [{ label: 'body.type', target: { kind: 'import', module: 'text', path: ['Body'] } }] })]),
    ]);
    expect(problemsFor(resolver, 'results', ['ValidationResult'])).toEqual([
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
    const resolver = resolverOf([
      moduleWith('a', [record('First', { kind: 'alias-type', links: [{ label: 'target', target: { kind: 'import', module: 'b', path: ['Second'] } }] })]),
      moduleWith('b', [record('Second', { kind: 'alias-type', links: [{ label: 'target', target: { kind: 'import', module: 'a', path: ['First'] } }] })]),
    ]);
    declaredBy(resolver, 'a', ['First']);
    expect(resolver.resolve([{ module: 'a', path: ['First'] }]).declarations.map(item => item.declaration.name)).toEqual(['First', 'Second']);
    expect(resolver.resolve([]).problems).toEqual([]);
  });

  it('rejects an exported descendant of a local declaration', () => {
    const resolver = resolverOf([moduleWith('shopping', [record('Hidden', { kind: 'concept', local: true }), record('Cart', { owner: 'Hidden' })], [{ path: ['Cart'], declaration: 'Cart' }])]);
    expect(problemsFor(resolver, 'shopping', ['Cart'])).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-dependency-catalog', message: expect.stringContaining('local') })]));
  });

  it('rejects a missing owner at its metadata property', () => {
    const resolver = resolverOf([moduleWith('shopping', [record('Cart', { owner: 'Missing' })], [{ path: ['Cart'], declaration: 'Cart' }])]);
    expect(problemsFor(resolver, 'shopping', ['Cart'])).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'invalid-dependency-catalog', at: { kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'owner'] },
    })]));
  });

  it('rejects containment cycles even though ordinary reference cycles are allowed', () => {
    const resolver = resolverOf([moduleWith('shopping', [record('A', { owner: 'B' }), record('B', { owner: 'A' })], [{ path: ['A'], declaration: 'A' }])]);
    expect(problemsFor(resolver, 'shopping', ['A'])).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-dependency-catalog', message: expect.stringContaining('cycle') })]));
  });

  it('reports both duplicate module introductions without choosing one', () => {
    const resolver = resolverOf([moduleWith('shopping', [record('Cart')]), moduleWith('shopping', [record('Cart')])]);
    expect(problemsFor(resolver, 'shopping', ['Cart'])).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'invalid-dependency-catalog', at: { kind: 'dependency', path: ['modules', 1, 'locator'] },
      related: [{ kind: 'dependency', path: ['modules', 0, 'locator'] }],
    })]));
  });

  it('rejects duplicate declaration IDs and duplicate advertised paths', () => {
    const resolver = resolverOf([moduleWith('shopping', [record('Cart'), record('Cart')], [
      { path: ['Cart'], declaration: 'Cart' }, { path: ['Cart'], declaration: 'Cart' },
    ])]);
    const problems = problemsFor(resolver, 'shopping', ['Cart']);
    expect(problems.map(p => p.at)).toEqual(expect.arrayContaining([
      { kind: 'dependency', path: ['modules', 0, 'declarations', 1, 'id'] },
      { kind: 'dependency', path: ['modules', 0, 'exports', 1, 'path'] },
    ]));
  });

  it('requires an actual declaration and a nonempty advertised path', () => {
    const resolver = resolverOf([moduleWith('shopping', [], [{ path: [], declaration: 'Missing' }])]);
    expect(resolver.resolve([]).problems.map(p => p.at)).toEqual(expect.arrayContaining([
      { kind: 'dependency', path: ['modules', 0, 'exports', 0, 'path'] },
      { kind: 'dependency', path: ['modules', 0, 'exports', 0, 'declaration'] },
    ]));
  });

  it('distinguishes a missing module from a missing advertised export', () => {
    const resolver = resolverOf([moduleWith('shopping', [record('Cart')])]);
    expect(problemsFor(resolver, 'missing', ['Cart'])).toEqual([expect.objectContaining({ code: 'unavailable-module' })]);
    expect(problemsFor(resolver, 'shopping', ['Receipt'])).toEqual([expect.objectContaining({ code: 'unresolved-reference' })]);
  });

  it('does not mutate the supplied snapshot or retain removed modules across new module catalogs', () => {
    const modules = [moduleWith('shopping', [record('Cart')])];
    const before = JSON.stringify(modules);
    const first = resolverOf(modules);
    declaredBy(first, 'shopping', ['Cart']);
    expect(JSON.stringify(modules)).toBe(before);
    const next = resolverOf([]);
    expect(problemsFor(next, 'shopping', ['Cart'])).toEqual([expect.objectContaining({ code: 'unavailable-module' })]);
  });
});

describe('independent supplied exports', () => {
  it('keeps a complete export usable when a different selection names a missing declaration', () => {
    const resolver = resolverOf([moduleWith('results', [record('Valid')], [
      { path: ['Valid'], declaration: 'Valid' }, { path: ['Bad'], declaration: 'Missing' },
    ])]);
    expect(declaredBy(resolver, 'results', ['Valid']).name).toBe('Valid');
    expect(resolver.resolve([]).problems).toEqual(expect.arrayContaining([expect.objectContaining({
      at: { kind: 'dependency', path: ['modules', 0, 'exports', 1, 'declaration'] },
    })]));
    expect(problemsFor(resolver, 'results', ['Bad'])).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid-dependency-catalog' })]));
    expect(resolver.resolve([{ module: 'results', path: ['Valid'] }, { module: 'results', path: ['Bad'] }]).declarations.map(item => item.declaration.name)).toEqual(['Valid']);
  });

  it('retains the requested link when a transitive module contains conflicting identities', () => {
    const resolver = resolverOf([
      moduleWith('results', [record('ValidationResult', { links: [{ label: 'messages.type', target: { kind: 'import', module: 'messages', path: ['Message'] } }] })]),
      moduleWith('messages', [record('Message'), record('Message')], [{ path: ['Message'], declaration: 'Message' }]),
    ]);
    expect(problemsFor(resolver, 'results', ['ValidationResult'])).toEqual(expect.arrayContaining([expect.objectContaining({
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
    const resolver = resolverOf([moduleWith('results', [record('ValidationResult', {
      links: [{ label: 'messages.type', target: { kind: 'import', module: 'messages', path: ['Message'] } }],
    })])]);
    const problems = problemsFor(resolver, 'results', ['ValidationResult']);
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unavailable-module', at: { kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'links', 0, 'target'] } }),
      expect.objectContaining({ code: 'invalid-dependency-catalog', message: expect.stringContaining('messages.type'), at: { kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'links', 0, 'target'] } }),
    ]));
    expect(problems).toHaveLength(2);
  });

  it('reports an incomplete supplied link when its module does not advertise the requested target', () => {
    const resolver = resolverOf([
      moduleWith('results', [record('ValidationResult', { links: [{ label: 'messages.type', target: { kind: 'import', module: 'messages', path: ['Message'] } }] })]),
      moduleWith('messages', [record('OtherMessage')]),
    ]);
    const problems = problemsFor(resolver, 'results', ['ValidationResult']);
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unresolved-reference' }),
      expect.objectContaining({ code: 'invalid-dependency-catalog', message: expect.stringContaining('messages.type'), at: { kind: 'dependency', path: ['modules', 0, 'declarations', 0, 'links', 0, 'target'] } }),
    ]));
    expect(problems).toHaveLength(2);
  });
});

describe('explicit import results', () => {
  it('keeps successive import selections independent using the same supplied module catalog', () => {
    const resolver = resolverOf([
      moduleWith('shopping', [record('Cart')]),
      moduleWith('shipping', [record('Receipt')]),
    ]);
    const shopping = resolver.resolve([{ module: 'shopping', path: ['Cart'] }]);

    const shipping = resolver.resolve([{ module: 'shipping', path: ['Receipt'] }]);

    expect(shipping.declarations.map(item => item.declaration.name)).toEqual(['Receipt']);
    expect(shopping.declarations.map(item => item.declaration.name)).toEqual(['Cart']);
    expect(resolver.resolve([]).declarations).toEqual([]);
  });

  it('keeps a missing import in its request outcome rather than later catalog findings', () => {
    const resolver = resolverOf([moduleWith('shopping', [record('Cart')])]);
    const missing = resolver.resolve([{ module: 'missing', path: ['Cart'] }]);

    const available = resolver.resolve([{ module: 'shopping', path: ['Cart'] }]);

    expect(missing.imports[0]).toEqual(expect.objectContaining({ status: 'invalid' }));
    expect(available.imports[0]).toEqual(expect.objectContaining({ status: 'found' }));
    expect(available.problems).toEqual([]);
    expect(missing.problems).toEqual([]);
  });
});



describe('static supplied module inventory', () => {
  it('keeps inventory and metadata findings distinct from selected import closures', () => {
    const catalog = new ModuleCatalog([
      moduleWith('shopping', [record('Cart'), record('Unused')], [
        { path: ['Cart'], declaration: 'Cart' }, { path: ['Broken'], declaration: 'Missing' },
      ]),
    ]);
    const declarations = catalog.declarations;
    const problems = catalog.problems;
    const resolver = new ImportResolver(catalog, builtins());

    const imported = resolver.resolve([{ module: 'shopping', path: ['Cart'] }]);
    resolver.resolve([{ module: 'missing', path: ['Whatever'] }]);

    expect(imported.declarations.map(item => item.declaration.name)).toEqual(['Cart']);
    expect(catalog.declarations).toBe(declarations);
    expect(catalog.declarations.map(item => item.declaration.name)).toEqual(['Cart', 'Unused']);
    expect(catalog.problems).toBe(problems);
    expect(catalog.problems).toEqual([expect.objectContaining({
      code: 'invalid-dependency-catalog',
      at: { kind: 'dependency', path: ['modules', 0, 'exports', 1, 'declaration'] },
    })]);
    expect(catalog.select('shopping', ['Cart']).status).toBe('found');
    expect(catalog.declaration('shopping', 'Cart')?.declaration.id).toBe(imported.declarations[0]?.declaration.id);
  });
});
