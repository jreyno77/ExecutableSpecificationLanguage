import { describe, expect, it } from 'vitest';
import { createCompiler, CompilationUnimplementedError, builtinCatalog } from '../../src/index.js';

const compile = (text: string) => createCompiler().compile({ source: { sourceId: 'unit.expec', text }, dependencies: { modules: [], packages: [] } });
const codes = (text: string) => compile(text).diagnostics.map(d => d.code);

describe('declared type and scope validation', () => {
  it('forward type references resolve without inventing declarations', () => {
    const result = compile('function take(item: Item) returns Nothing\ntype Item { label: Text }');
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') throw Error('Expected accepted compilation');
    const fn = result.specification.symbols.find(s => s.kind === 'function');
    const item = result.specification.symbols.find(s => s.path.join('.') === 'Item');
    const type = result.specification.types.find(t => t.id.value === fn?.parameters[0]?.valueType.value);
    expect(type?.shape).toEqual({ kind: 'declared', declaration: item?.id, arguments: [] });
  });
  it('aliases cannot form a nonterminating expansion', () => {
    expect(codes('type A = B\ntype B = A')).toContain('cyclic-type-alias');
  });
  it('recursive record fields are allowed', () => {
    expect(compile('type Node { next: Node? }').status).toBe('accepted');
  });
  it('generic arity belongs to the declaration', () => {
    expect(codes('type Pair<T> = [T, T]\ntype TooMany = Pair<Text, Number>')).toContain('generic-arity');
  });
  it('Nothing is not a field value', () => {
    expect(codes('type Broken { value: Nothing }')).toContain('type-mismatch');
  });
  it('a public capability cannot expose a local type', () => {
    expect(codes('concept X {\n local type Secret { value: Text }\n public expose\n capability expose(value: Secret) returns Nothing\n}')).toContain('inaccessible-public-type');
  });
  it('duplicate public declarations do not merge silently', () => {
    expect(codes('concept X {\n public run, run\n capability run() returns Nothing\n}')).toContain('duplicate-declaration');
  });
  it('an unfinished semantic feature is explicit, never silently accepted', () => {
    expect(() => compile('function value() returns Number { ensures result > 0 }')).toThrow(CompilationUnimplementedError);
  });
  it('literal defaults must match declared types', () => {
    expect(codes('type Settings { brightness: Number = "bright" }')).toContain('type-mismatch');
  });
  it('input snapshots remain unchanged', () => {
    const input = { source: { sourceId: 'unchanged.expec', text: 'type Item { value: Text }' }, dependencies: { modules: [], packages: [] } };
    const before = structuredClone(input);
    createCompiler().compile(input);
    expect(input).toEqual(before);
  });
  it('an omitted result keeps both implementation and result obligations', () => {
    const result = compile('function value() { promises "A useful value" }');
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') throw Error('Expected an accepted unfinished contract');
    expect(result.obligations.map(o => o.kind)).toEqual(expect.arrayContaining(['implementation-needed', 'result-type-unspecified', 'prose-needs-check']));
  });
  it('expanding a local alias does not make its public exposure legal', () => {
    expect(codes('concept X {\n local type Secret = Text\n public expose\n capability expose(value: Secret) returns Nothing\n}')).toContain('inaccessible-public-type');
  });
  it('numeric literal compatibility uses exact decimal meaning, not token spelling or floats', () => {
    expect(compile('type A { value: 1 = 1.0 }').status).toBe('accepted');
    expect(compile('type A { value: 1000 = 1e3 }').status).toBe('accepted');
    expect(codes('type A { value: 9007199254740992 = 9007199254740993 }')).toContain('type-mismatch');
  });
  it('qualification cannot leak a generic parameter outside its declaring type', () => {
    expect(codes('type Box<T> { value: T }\nfunction take(value: Box.T) returns Nothing')).toContain('inaccessible-reference');
  });
  it('conflicting package metadata cannot be selected by list order', () => {
    const result = createCompiler().compile({ source: { sourceId: 'packages.expec', text: 'concept Game { requires package "vite" for build }' }, dependencies: { modules: [], packages: [{ alias: 'vite', phases: ['build'] }, { alias: 'vite', phases: ['runtime'] }] } });
    expect(result.status).toBe('rejected');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-dependency-catalog', phase: 'input' }));
  });
  it('the public builtin profile cannot be mutated into different language semantics', () => {
    try { builtinCatalog.definitions[0]!.name = 'Replacement'; } catch { /* An immutable profile may reject the attempted edit. */ }
    expect(compile('type Value { text: Text }').status).toBe('accepted');
    expect(codes('type Value { text: Replacement }')).toContain('unresolved-reference');
  });
});
