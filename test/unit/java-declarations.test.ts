import { describe, expect, it } from 'vitest';
import { Compiler, SpecificationIdentity } from '../../src/index.js';
import { JavaDeclarations } from '../../src/project/java/java-declarations.js';
import { javaOptions } from '../../src/project/java/java-settings.js';

function project(text: string, options: Record<string, unknown> = {}) {
  const checked = new Compiler().compile({ locator: 'main', source: { sourceId: 'main.expec', text }, dependencies: { modules: [], packages: [] } });
  if (!checked.value) throw new Error(JSON.stringify(checked));
  let next = 0;
  const current = new SpecificationIdentity(() => 'declaration-' + ++next).associate(checked.value);
  if (!current.value) throw new Error(JSON.stringify(current));
  const projection = new JavaDeclarations(current.value, javaOptions.parse({ package: 'store', ...options }));
  return { files: projection.files(), problems: projection.problems, obligations: projection.obligations };
}
describe('Java declaration mapping', () => {
  it('reports literal refinements inside aliases and composed callable type arguments', () => {
    const result = project('type Title = "Dune" | "Foundation"\ntype Box<T> { value: T }\nfunction save(title: Title?, position: [Title, Number], box: Box<Title>) returns Nothing');
    expect(result.problems).toEqual([]);
    expect(result.obligations.map(item => item.code)).toEqual(['verification-required', 'verification-required', 'verification-required']);
    expect(result.obligations.map(item => item.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('save.title: Title?'), expect.stringContaining('save.position: [Title, Number]'), expect.stringContaining('save.box: Box<Title>'),
    ]));
  });
  it('does not duplicate a record field restriction as a callable obligation', () => {
    const result = project('type Book { title: "Dune" }\nfunction save(book: Book) returns Nothing');
    expect(result.problems).toEqual([]); expect(result.obligations).toEqual([]);
  });
  it('reports each authored default once despite native overload expansion', () => {
    const result = project('type Book { copies: Number = 1 }\nclass Store { construction(title: Text = "Dune", copies: Number = 2) }');
    expect(result.problems).toEqual([]);
    expect(result.obligations).toHaveLength(3);
    expect(result.obligations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'default-verification-required', message: expect.stringContaining('copies: 1') }),
      expect.objectContaining({ code: 'default-verification-required', message: expect.stringContaining('title: "Dune"') }),
      expect.objectContaining({ code: 'default-verification-required', message: expect.stringContaining('copies: 2') }),
    ]));
  });
  it('does not invent an obligation for an ordinary explicit Nothing result', () => {
    const result = project('function save() returns Nothing');
    expect(result.problems).toEqual([]); expect(result.obligations).toEqual([]);
  });
  it('keeps the conservative keyword profile even when a name could be legal in some positions', () => {
    expect(project('function open() returns Nothing').problems.map(problem => problem.code)).toContain('invalid-native-name');
  });
  it('rejects a name mapping that cannot select a checked declaration', () => {
    expect(project('class Store {}', { names: [{ declaration: ['Missing'], name: 'Shop' }] }).problems.map(problem => problem.code)).toContain('invalid-native-mapping');
  });
  it('rejects two fields that would become the same native record component', () => {
    const result = project('type Book { title: Text\ncopies: Number }', { names: [
      { declaration: ['Book', 'title'], name: 'value' }, { declaration: ['Book', 'copies'], name: 'value' },
    ] });
    expect(result.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('rejects two parameters that would become the same native binding', () => {
    const result = project('function save(title: Text, copies: Number) returns Nothing', { names: [
      { declaration: ['save', 'title'], name: 'value' }, { declaration: ['save', 'copies'], name: 'value' },
    ] });
    expect(result.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('refuses a generated tuple support name already owned by a declaration', () => {
    const result = project('type Tuple2 { label: Text }\ntype Point = [Number, Number]');
    expect(result.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('refuses two functions whose mapped native overloads have the same erasure', () => {
    const result = project('type Book { title: Text }\nfunction first(books: List<Book>) returns Nothing\nfunction second(titles: List<Text>) returns Nothing', {
      names: [{ declaration: ['first'], name: 'save' }, { declaration: ['second'], name: 'save' }],
    });
    expect(result.problems.map(problem => problem.code)).toContain('native-signature-conflict');
  });
  it('refuses a generic parameter mapping that hides a referenced contract name', () => {
    const result = project('type Book { title: Text }\ntype Box<T> { item: Book }', { names: [{ declaration: ['Box', 'T'], name: 'Book' }] });
    expect(result.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
});
