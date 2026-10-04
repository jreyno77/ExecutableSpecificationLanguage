import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { NativeEdits } from '../../src/typescript-edits.js';
import { Compiler, LangiumReader, LangiumModel, SpecificationIdentity, typescriptOutput, type ArtifactAssociation, type IdentifiedSpecification,
  type OutputPlan, type ProjectSnapshot } from '../../src/index.js';

const captured = (files: Record<string, string>): ProjectSnapshot => ({ root: { path: '/preservation-unit', identity: 'unit' },
  complete: true, problems: [], excluded: [], excludeNames: [], files: Object.entries(files).map(([path, text]) => ({ path, bytes: Buffer.from(text), version: createHash('sha256').update(text).digest('hex') })) });
function author(text: string, libraries: Record<string, string> = {}, identifier = (index: number) => 'preservation-unit-' + index) {
  let next = 0; const identity = new SpecificationIdentity(() => identifier(++next));
  const modules = Object.entries(libraries).map(([locator, text]) => { const read = new LangiumReader().read({ sourceId: locator + '.expec', text }); if (read.status !== 'accepted') throw Error(JSON.stringify(read)); return new LangiumModel(locator, read.document); });
  const compile = (text: string) => { const checked = new Compiler().compile({ locator: 'main', source: { sourceId: 'main.expec', text }, dependencies: { modules, packages: [] } });
    if (!checked.value) throw Error(JSON.stringify(checked)); return checked.value; };
  const initial = identity.associate(compile(text)).value!;
  const id = (name: string, current = initial): string => { const item = current.baseline.elements.find(element => element.address.name === name || name === 'construction' && element.address.kind === 'construction'); if (!item) throw Error('Missing ' + name); return item.id; };
  const map = (current: IdentifiedSpecification, name: string, file: string, declaration: { kind: string; name: string; static?: boolean }[]) => {
    const association: ArtifactAssociation = { specId: id(name, current), locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file, declaration } } };
    const result = identity.withArtifacts(current, [...current.baseline.artifacts, association]); if (!result.value) throw Error(JSON.stringify(result)); return result.value;
  };
  const revise = (text: string, retired: string[] = [], before = initial) => { const result = identity.associate(compile(text), before.baseline, retired.map(name => ({ retire: id(name, before) }))); if (!result.value) throw Error(JSON.stringify(result)); return result.value; };
  const rename = (text: string, from: string, to: string, before = initial) => {
    const specification = compile(text), fresh = identity.associate(specification).value!, result = identity.associate(specification, before.baseline, [{ id: id(from, before), to: fresh.node(id(to, fresh)) }]);
    if (!result.value) throw Error(JSON.stringify(result)); return result.value;
  };
  return { identity, initial, id, map, revise, rename };
}
const output = () => typescriptOutput.open({ directory: 'src', adoptExisting: true });
const materialize = (snapshot: ProjectSnapshot, plan: OutputPlan): ProjectSnapshot => {
  const files = Object.fromEntries(snapshot.files.map(file => [file.path, Buffer.from(file.bytes).toString()]));
  for (const change of plan.changes) {
    if (change.kind === 'remove') delete files[change.path];
    else if (change.kind === 'write') files[change.path] = Buffer.from(change.bytes).toString();
    else { files[change.to] = change.bytes ? Buffer.from(change.bytes).toString() : files[change.from]!; delete files[change.from]; }
  }
  return captured(files);
};

describe('native preservation decisions', { timeout: 30_000 }, () => {
  it('renames a record member independently of an unrelated lexical name', async () => {
    const user = author('type Book { title: Text }'), adapter = output();
    const first = await adapter.plan({ operation: 'create', current: user.initial }, captured({}));
    expect(first.problems).toEqual([]);
    const snapshot = materialize(captured({}), first.value!);
    const current = user.rename('type Book { name: Text }', 'title', 'name');
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.problems).toEqual([]); expect(result.value).toBeDefined();
    const file = materialize(snapshot, result.value!).files.find(file => file.path === 'src/Book.ts')!;
    expect(Buffer.from(file.bytes).toString()).toContain('name: string');
  });
  it('requires an explicit association for an existing represented member', async () => {
    const user = author('class Store { public save\ncapability save() returns Nothing }');
    const mapped = user.map(user.initial, 'Store', 'game.ts', [{ kind: 'class', name: 'Store' }]);
    const result = await output().plan({ operation: 'create', current: mapped }, captured({ 'game.ts': 'class Store { save(): void {} }' }));
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('incomplete-adoption');
  });
  it('rejects competing identities mapped to the same native declaration', async () => {
    const user = author('interface First {}\ninterface Second {}');
    let mapped = user.map(user.initial, 'First', 'first.ts', [{ kind: 'interface', name: 'Game' }]);
    mapped = user.map(mapped, 'Second', 'second.ts', [{ kind: 'interface', name: 'Game' }]);
    const result = await output().plan({ operation: 'create', current: mapped }, captured({ 'first.ts': 'interface Game {}', 'second.ts': 'interface Game {}' }));
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('conflicting-project-association');
  });
  it('does not adopt a symbol outside the configured native program', async () => {
    const user = author('class Store {}'), mapped = user.map(user.initial, 'Store', 'game.ts', [{ kind: 'class', name: 'Store' }]);
    const result = await typescriptOutput.open({ directory: 'src', adoptExisting: true, configFile: 'tsconfig.json' }).plan({ operation: 'create', current: mapped },
      captured({ 'game.ts': 'class Store {}', 'other.ts': 'export {};', 'tsconfig.json': '{"files":["other.ts"]}' }));
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('outside-project-program');
  });
  it('does not accept a private member as a public contract', async () => {
    const user = author('class Store { public save\ncapability save() returns Nothing }');
    let mapped = user.map(user.initial, 'Store', 'game.ts', [{ kind: 'class', name: 'Store' }]);
    mapped = user.map(mapped, 'save', 'game.ts', [{ kind: 'class', name: 'Store' }, { kind: 'method', name: 'save', static: false }]);
    const result = await output().plan({ operation: 'create', current: mapped }, captured({ 'game.ts': 'class Store { private save(): void {} }' }));
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('adoption-contract-mismatch');
  });
  it('keeps two identically shaped named types distinct during adoption', async () => {
    const user = author('type Book { title: Text }\ntype Movie { title: Text }\nfunction save(item: Book) returns Nothing');
    let mapped = user.map(user.initial, 'Book', 'models.ts', [{ kind: 'type', name: 'Book' }]);
    mapped = user.map(mapped, 'title', 'models.ts', [{ kind: 'type', name: 'Book' }, { kind: 'property', name: 'title' }]);
    mapped = user.map(mapped, 'Movie', 'models.ts', [{ kind: 'type', name: 'Movie' }]);
    const movieTitle = mapped.baseline.elements.find(item => item.address.name === 'title' && item.address.owner === user.id('Movie'))!;
    const extra = { specId: movieTitle.id, locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file: 'models.ts', declaration: [{ kind: 'type', name: 'Movie' }, { kind: 'property', name: 'title' }] } } };
    mapped = user.identity.withArtifacts(mapped, [...mapped.baseline.artifacts, extra]).value!;
    mapped = user.map(mapped, 'save', 'save.ts', [{ kind: 'function', name: 'save' }]);
    const result = await output().plan({ operation: 'create', current: mapped }, captured({ 'models.ts': 'export type Book = { title: string }; export type Movie = { title: string };', 'save.ts': 'import type { Movie } from "./models.js"; export function save(item: Movie): void {}' }));
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('adoption-contract-mismatch');
  });
  it('retains a comment placed inside an otherwise unchanged generated stub', async () => {
    const user = author('class Store { public save\ncapability save() returns Nothing }'), adapter = output();
    const first = await adapter.plan({ operation: 'create', current: user.initial }, captured({})); expect(first.problems).toEqual([]);
    let snapshot = materialize(captured({}), first.value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path.endsWith('.ts') ? Buffer.from(file.bytes).toString().replace('throw new Error(', '// hand written note\nthrow new Error(') : Buffer.from(file.bytes).toString()])));
    const current = user.revise('class Store {}', ['save']), diff = user.identity.compare(user.initial.baseline, current).value!;
    const result = await adapter.plan({ operation: 'update', current, diff }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('handwritten-removal');
  });
  it('does not insert over an unowned member that resembles the desired stub', async () => {
    const user = author('class Store {}'), adapter = output();
    const first = await adapter.plan({ operation: 'create', current: user.initial }, captured({})); let snapshot = materialize(captured({}), first.value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path === 'src/Store.ts' ? 'export class Store { save(): void { throw new Error("Not implemented: Store.save"); } }' : Buffer.from(file.bytes).toString()])));
    const current = user.revise('class Store { public save\ncapability save() returns Nothing }'), diff = user.identity.compare(user.initial.baseline, current).value!;
    const result = await adapter.plan({ operation: 'update', current, diff }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('refuses edits of a declaration whose captured body cannot be parsed', async () => {
    const user = author('function save() returns Number'), adapter = output();
    const first = await adapter.plan({ operation: 'create', current: user.initial }, captured({})); let snapshot = materialize(captured({}), first.value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path.endsWith('.ts') ? 'export function save(): number { const value = ; return 1; }' : Buffer.from(file.bytes).toString()])));
    const current = user.revise('function save() returns Text'), diff = user.identity.compare(user.initial.baseline, current).value!;
    const result = await adapter.plan({ operation: 'update', current, diff }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.some(problem => problem.code === 'typescript-1109')).toBe(true);
  });
  it('rejects a validly hashed baseline whose recorded native declaration is missing', async () => {
    const user = author('class Store {}'), adapter = output(), first = await adapter.plan({ operation: 'create', current: user.initial }, captured({}));
    let snapshot = materialize(captured({}), first.value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => {
      if (!file.path.endsWith('.json')) return [file.path, Buffer.from(file.bytes).toString()];
      const state = JSON.parse(Buffer.from(file.bytes).toString()); state.files[0].generated = 'export class Other {}';
      state.files[0].hash = createHash('sha256').update(state.files[0].generated).digest('hex'); return [file.path, JSON.stringify(state)];
    })));
    const current = user.revise('class Store { public save\ncapability save() returns Nothing }'), diff = user.identity.compare(user.initial.baseline, current).value!;
    const result = await adapter.plan({ operation: 'update', current, diff }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('invalid-output-state');
  });
  it('replaces newly owned documentation on an adopted method only once', async () => {
    const user = author('class Store { public save\ncapability save() returns Nothing { promises "first" } }'), adapter = output();
    let current = user.map(user.initial, 'Store', 'game.ts', [{ kind: 'class', name: 'Store' }]);
    current = user.map(current, 'save', 'game.ts', [{ kind: 'class', name: 'Store' }, { kind: 'method', name: 'save', static: false }]);
    let snapshot = captured({ 'game.ts': 'class Store { /** User note. */ save(): void {} }' });
    const adoption = await adapter.plan({ operation: 'create', current }, snapshot); expect(adoption.problems).toEqual([]); snapshot = materialize(snapshot, adoption.value!);
    for (const obligation of ['second', 'third']) {
      const next = user.revise('class Store { public save\ncapability save() returns Nothing { promises "' + obligation + '" } }', [], current);
      const result = await adapter.plan({ operation: 'update', current: next, diff: user.identity.compare(current.baseline, next).value! }, snapshot);
      expect(result.problems).toEqual([]); snapshot = materialize(snapshot, result.value!); current = next;
    }
    const source = Buffer.from(snapshot.files.find(file => file.path === 'game.ts')!.bytes).toString();
    expect(source).toContain('User note.'); expect(source).toContain('third'); expect(source).not.toContain('second');
  });
  it('preserves an imported native type alias when extending its callable signature', async () => {
    const user = author('type Snapshot { title: Text }\nclass Store { public save\ncapability save(snapshot: Snapshot) returns Nothing }'), adapter = output();
    let current = user.map(user.initial, 'Snapshot', 'model.ts', [{ kind: 'type', name: 'Snapshot' }]);
    current = user.map(current, 'title', 'model.ts', [{ kind: 'type', name: 'Snapshot' }, { kind: 'property', name: 'title' }]);
    current = user.map(current, 'Store', 'store.ts', [{ kind: 'class', name: 'Store' }]);
    current = user.map(current, 'save', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'method', name: 'save', static: false }]);
    let snapshot = captured({ 'model.ts': 'export type Snapshot = { title: string };', 'store.ts': 'import type { Snapshot as State } from "./model.js"; export class Store { save(snapshot: State): void { console.log(snapshot); } }' });
    const adoption = await adapter.plan({ operation: 'create', current }, snapshot); expect(adoption.problems).toEqual([]); snapshot = materialize(snapshot, adoption.value!);
    const next = user.revise('type Snapshot { title: Text }\nclass Store { public save\ncapability save(snapshot: Snapshot, copies: Number) returns Nothing }', [], current);
    const result = await adapter.plan({ operation: 'update', current: next, diff: user.identity.compare(current.baseline, next).value! }, snapshot);
    expect(result.problems).toEqual([]);
    snapshot = materialize(snapshot, result.value!);
    expect(Buffer.from(snapshot.files.find(file => file.path === 'store.ts')!.bytes).toString()).toContain('save(snapshot: State, copies: number): void');
  });
  it('confirms renamed members at the location their real consumer calls', async () => {
    const user = author('class Store { public save\ncapability save() returns Nothing }'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured({ ...Object.fromEntries(snapshot.files.map(file => [file.path, Buffer.from(file.bytes).toString()])), 'caller.ts': 'import { Store } from "./src/Store.js"; new Store().save();' });
    const compiled = new Compiler().compile({ locator: 'main', source: { sourceId: 'main.expec', text: 'class Store { public saveGame\ncapability saveGame() returns Nothing }' }, dependencies: { modules: [], packages: [] } }).value!;
    const provisional = user.identity.associate(compiled).value!;
    const current = user.identity.associate(compiled, user.initial.baseline, [{ id: user.id('save'), to: provisional.node(user.id('saveGame', provisional)) }]).value!;
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.problems).toEqual([]); snapshot = materialize(snapshot, result.value!);
    const search = await adapter.search(user.id('save'), snapshot);
    expect(search.incoming.uses).toEqual(expect.arrayContaining([expect.objectContaining({ target: expect.objectContaining({ kind: 'project' }), at: expect.objectContaining({ value: expect.objectContaining({ file: 'caller.ts' }) }) })]));
  });
  it('does not infer a parameter rename from an inserted earlier parameter', async () => {
    const user = author('function save(snapshot: Text) returns Nothing'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path.endsWith('.ts') ? 'export function save(snapshot: string): void { console.log(snapshot); }' : Buffer.from(file.bytes).toString()])));
    const current = user.revise('function save(prefix: Text, snapshot: Text) returns Nothing'), diff = user.identity.compare(user.initial.baseline, current).value!;
    const result = await adapter.plan({ operation: 'update', current, diff }, snapshot); expect(result.problems).toEqual([]);
    snapshot = materialize(snapshot, result.value!);
    expect(Buffer.from(snapshot.files.find(file => file.path === 'src/save.ts')!.bytes).toString()).toContain('{ console.log(snapshot); }');
  });
  it('retains an adopted constructor parameter property when its annotation changes', async () => {
    const user = author('class Cache { construction(size: Number) }'), adapter = output();
    let current = user.map(user.initial, 'Cache', 'cache.ts', [{ kind: 'class', name: 'Cache' }]);
    current = user.map(current, 'construction', 'cache.ts', [{ kind: 'class', name: 'Cache' }, { kind: 'constructor', name: 'constructor' }]);
    let snapshot = captured({ 'cache.ts': 'class Cache { constructor(readonly size: number) { console.log(size); } }' });
    const adoption = await adapter.plan({ operation: 'create', current }, snapshot); expect(adoption.problems).toEqual([]); snapshot = materialize(snapshot, adoption.value!);
    const next = user.revise('class Cache { construction(size: Text) }', [], current);
    const result = await adapter.plan({ operation: 'update', current: next, diff: user.identity.compare(current.baseline, next).value! }, snapshot);
    expect(result.problems).toEqual([]); snapshot = materialize(snapshot, result.value!);
    expect(Buffer.from(snapshot.files.find(file => file.path === 'cache.ts')!.bytes).toString()).toContain('constructor(readonly size: string) { console.log(size); }');
  });
  it('adds the real import required by a newly introduced record field', async () => {
    const user = author('type Book { title: Text }\ntype Shelf {}'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    const current = user.revise('type Book { title: Text }\ntype Shelf { book: Book }');
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.problems).toEqual([]); snapshot = materialize(snapshot, result.value!);
    const search = await adapter.search(user.id('Shelf'), snapshot);
    expect(search.problems).toEqual([]); expect(search.outgoing.coverage.complete).toBe(true);
  });
  it('renames a generic binder and its native uses without discarding an unowned field', async () => {
    const user = author('type Box<T> { item: T }'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path.endsWith('.ts') ? 'export type Box<T> = { item: T; userValue?: T; };' : Buffer.from(file.bytes).toString()])));
    const current = user.rename('type Box<Value> { item: Value }', 'T', 'Value');
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.problems).toEqual([]); snapshot = materialize(snapshot, result.value!);
    expect(Buffer.from(snapshot.files.find(file => file.path === 'src/Box.ts')!.bytes).toString()).toBe('export type Box<Value> = { item: Value; userValue?: Value; };');
  });
  it('renames every signature of one adopted native overloaded method', async () => {
    const user = author('class Store { public save\ncapability save(snapshot: Text) returns Nothing }'), adapter = output();
    let current = user.map(user.initial, 'Store', 'store.ts', [{ kind: 'class', name: 'Store' }]);
    current = user.map(current, 'save', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'method', name: 'save', static: false }]);
    let snapshot = captured({ 'store.ts': 'export class Store { save(snapshot: "Dune"): void; save(snapshot: string): void; save(snapshot: string): void { console.log(snapshot); } }' });
    const adoption = await adapter.plan({ operation: 'create', current }, snapshot); expect(adoption.problems).toEqual([]); snapshot = materialize(snapshot, adoption.value!);
    const next = user.rename('class Store { public saveGame\ncapability saveGame(snapshot: Text) returns Nothing }', 'save', 'saveGame', current);
    const result = await adapter.plan({ operation: 'update', current: next, diff: user.identity.compare(current.baseline, next).value! }, snapshot);
    expect(result.problems).toEqual([]); snapshot = materialize(snapshot, result.value!);
    expect(Buffer.from(snapshot.files.find(file => file.path === 'store.ts')!.bytes).toString()).toBe('export class Store { saveGame(snapshot: "Dune"): void; saveGame(snapshot: string): void; saveGame(snapshot: string): void { console.log(snapshot); } }');
  });
  it('does not rename a parameter into a body-local binding', async () => {
    const user = author('function save(snapshot: Text) returns Nothing'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path.endsWith('.ts') ? 'export function save(snapshot: string): void { const state = 1; console.log(snapshot, state); }' : Buffer.from(file.bytes).toString()])));
    const current = user.rename('function save(state: Text) returns Nothing', 'snapshot', 'state');
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('uses an adopted same-file type when adding a new field', async () => {
    const user = author('type Book {}\ntype Shelf {}'), adapter = output();
    let current = user.map(user.initial, 'Book', 'models.ts', [{ kind: 'type', name: 'Book' }]);
    current = user.map(current, 'Shelf', 'models.ts', [{ kind: 'type', name: 'Shelf' }]);
    let snapshot = captured({ 'models.ts': 'type Book = {}; type Shelf = {};' });
    const adoption = await adapter.plan({ operation: 'create', current }, snapshot); expect(adoption.problems).toEqual([]); snapshot = materialize(snapshot, adoption.value!);
    const next = user.revise('type Book {}\ntype Shelf { book: Book }', [], current);
    const result = await adapter.plan({ operation: 'update', current: next, diff: user.identity.compare(current.baseline, next).value! }, snapshot);
    expect(result.problems).toEqual([]); snapshot = materialize(snapshot, result.value!);
    const text = Buffer.from(snapshot.files.find(file => file.path === 'models.ts')!.bytes).toString();
    expect(text).toContain('book: Book'); expect(text).not.toContain('import');
    expect((await adapter.search(user.id('Shelf'), snapshot)).problems).toEqual([]);
  });
  it('declines a new cross-file reference to an unexported adopted type', async () => {
    const user = author('type Book {}\ntype Shelf {}'), adapter = output();
    let current = user.map(user.initial, 'Book', 'book.ts', [{ kind: 'type', name: 'Book' }]);
    current = user.map(current, 'Shelf', 'shelf.ts', [{ kind: 'type', name: 'Shelf' }]);
    let snapshot = captured({ 'book.ts': 'type Book = {}; export const book = {};', 'shelf.ts': 'export type Shelf = {};' });
    const adoption = await adapter.plan({ operation: 'create', current }, snapshot); expect(adoption.problems).toEqual([]); snapshot = materialize(snapshot, adoption.value!);
    const next = user.revise('type Book {}\ntype Shelf { book: Book }', [], current);
    const result = await adapter.plan({ operation: 'update', current: next, diff: user.identity.compare(current.baseline, next).value! }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('native-mapping-conflict');
  });
  it('does not rewrite only an overload implementation when its contract changes', async () => {
    const user = author('class Store { public save\ncapability save(snapshot: Text) returns Nothing }'), adapter = output();
    let current = user.map(user.initial, 'Store', 'store.ts', [{ kind: 'class', name: 'Store' }]);
    current = user.map(current, 'save', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'method', name: 'save', static: false }]);
    let snapshot = captured({ 'store.ts': 'export class Store { save(snapshot: "Dune"): void; save(snapshot: string): void; save(snapshot: string): void { console.log(snapshot); } }' });
    const adoption = await adapter.plan({ operation: 'create', current }, snapshot); expect(adoption.problems).toEqual([]); snapshot = materialize(snapshot, adoption.value!);
    const unchanged = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(current.baseline, current).value! }, snapshot);
    expect(unchanged.problems).toEqual([]); expect(unchanged.value!.changes).toEqual([]);
    const next = user.revise('class Store { public save\ncapability save(snapshot: Text, copies: Number) returns Nothing }', [], current);
    const result = await adapter.plan({ operation: 'update', current: next, diff: user.identity.compare(current.baseline, next).value! }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('unsupported-overload-change');
  });
  it('keeps handwritten comments around existing parameters when adding a parameter', async () => {
    const user = author('function save(title: Text) returns Nothing'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path.endsWith('.ts') ? 'export function save(/* retry rationale */ title /* user parameter */: string /* user suffix */): void { console.log(title); }' : Buffer.from(file.bytes).toString()])));
    const current = user.revise('function save(title: Text, copies: Number) returns Nothing');
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.problems).toEqual([]); snapshot = materialize(snapshot, result.value!);
    expect(Buffer.from(snapshot.files.find(file => file.path === 'src/save.ts')!.bytes).toString()).toContain('save(/* retry rationale */ title /* user parameter */: string /* user suffix */, copies: number)');
  });
  it('does not remove a class containing only a handwritten line comment', async () => {
    const user = author('class Store {}'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path.endsWith('.ts') ? 'export class Store {\n// Preserve this rationale.\n}' : Buffer.from(file.bytes).toString()])));
    const result = await adapter.plan({ operation: 'delete', id: user.id('Store') }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('handwritten-removal');
  });
  it('locates invalid proposed syntax before an editor can publish its source', () => {
    const edits = new NativeEdits(), source = 'export function save(): void {}';
    edits.add('save.ts', source.indexOf('void'), source.indexOf('void') + 4, ')');
    edits.source('save.ts', source);
    expect(edits.problems.map(problem => problem.code)).toContain('typescript-1110');
    expect(edits.problems[0]!.at).toMatchObject({ kind: 'dependency', path: ['typescript', 'save.ts', 24, 1] });
  });
  it('reports malformed private rendered associations without throwing', async () => {
    const user = author('class Store {}'), adapter = output(), current = user.map(user.initial, 'Store', 'store.ts', [{ kind: 'class', name: 'Store' }]);
    let snapshot = materialize(captured({ 'store.ts': 'class Store {}' }), (await adapter.plan({ operation: 'create', current }, captured({ 'store.ts': 'class Store {}' }))).value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => {
      if (!file.path.endsWith('.json')) return [file.path, Buffer.from(file.bytes).toString()];
      const state = JSON.parse(Buffer.from(file.bytes).toString()); state.files[0].renderedArtifacts[0].locator.value.declaration = null;
      return [file.path, JSON.stringify(state)];
    })));
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(current.baseline, current).value! }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('invalid-output-state');
  });
  it('retains a bound type rename inside a simultaneously extended signature', async () => {
    const user = author('type Snapshot {}\nfunction save(snapshot: Snapshot) returns Nothing'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    const current = user.rename('type PlayerState {}\nfunction save(snapshot: PlayerState, copies: Number) returns Nothing', 'Snapshot', 'PlayerState');
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.problems).toEqual([]); snapshot = materialize(snapshot, result.value!);
    expect(Buffer.from(snapshot.files.find(file => file.path === 'src/save.ts')!.bytes).toString()).toContain('save(snapshot: PlayerState, copies: number)');
    expect((await adapter.search(user.id('save'), snapshot)).problems).toEqual([]);
  });
  it('retains a handwritten comment when removing its parameter', async () => {
    const user = author('function save(title: Text, copies: Number) returns Nothing'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path.endsWith('.ts') ? 'export function save(title: string, /* Handwritten copy rationale. */ copies: number): void {}' : Buffer.from(file.bytes).toString()])));
    const current = user.revise('function save(title: Text) returns Nothing', ['copies']);
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.problems).toEqual([]); snapshot = materialize(snapshot, result.value!);
    const text = Buffer.from(snapshot.files.find(file => file.path === 'src/save.ts')!.bytes).toString();
    expect(text).toContain('/* Handwritten copy rationale. */'); expect(text).not.toContain('copies: number');
    expect((await adapter.search(user.id('save'), snapshot)).problems).toEqual([]);
  });
  it('rejects a rename that would capture a consumer-local binding', async () => {
    const user = author('class Store {}'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured({ ...Object.fromEntries(snapshot.files.map(file => [file.path, Buffer.from(file.bytes).toString()])), 'caller.ts': 'import { Store } from "./src/Store.js"; const Shop = 1; new Store();' });
    const current = user.rename('class Shop {}', 'Store', 'Shop');
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('native-name-conflict');
    expect(result.problems.find(problem => problem.code === 'native-name-conflict')!.at).toMatchObject({ kind: 'dependency', path: ['typescript', 'caller.ts', 9, 5] });
  });
  it('does not remove duplicated obligation comments with ambiguous ownership', async () => {
    const user = author('function save() returns Nothing { promises "Keep this obligation." }'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => {
      const text = Buffer.from(file.bytes).toString();
      return [file.path, file.path.endsWith('.ts') ? text.slice(0, text.indexOf('export function')) + text : text];
    })));
    const result = await adapter.plan({ operation: 'delete', id: user.id('save') }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('handwritten-removal');
  });
  it('keeps handwritten comments within a changed generic declaration', async () => {
    const user = author('type Box<T> {}'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path.endsWith('.ts') ? 'export type Box</* Binder rationale. */ T> = {};' : Buffer.from(file.bytes).toString()])));
    const current = user.rename('type Box<Value> {}', 'T', 'Value');
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.problems).toEqual([]); snapshot = materialize(snapshot, result.value!);
    expect(Buffer.from(snapshot.files.find(file => file.path === 'src/Box.ts')!.bytes).toString()).toContain('/* Binder rationale. */');
    expect((await adapter.search(user.id('Box'), snapshot)).problems).toEqual([]);
  });
  it('keeps handwritten comments inside a changed type annotation', async () => {
    const user = author('function save(values: List<Text>) returns Nothing'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path.endsWith('.ts') ? 'export function save(values: Array</* Element rationale. */ string>): void {}' : Buffer.from(file.bytes).toString()])));
    const current = user.revise('function save(values: List<Number>) returns Nothing');
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.problems).toEqual([]); snapshot = materialize(snapshot, result.value!);
    expect(Buffer.from(snapshot.files.find(file => file.path === 'src/save.ts')!.bytes).toString()).toContain('/* Element rationale. */');
    expect((await adapter.search(user.id('save'), snapshot)).problems).toEqual([]);
  });
  it('does not rename an inherited call into an unrelated receiver member', async () => {
    const user = author('class Store { public save\ncapability save() returns Nothing }'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured({ ...Object.fromEntries(snapshot.files.map(file => [file.path, Buffer.from(file.bytes).toString()])),
      'caller.ts': 'import { Store } from "./src/Store.js"; class Child extends Store { saveGame(): void { console.log("unrelated child behavior"); } } new Child().save();' });
    const current = user.rename('class Store { public saveGame\ncapability saveGame() returns Nothing }', 'save', 'saveGame');
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('native-name-conflict');
    expect(result.problems.some(problem => problem.at.kind === 'dependency' && problem.at.path.includes('caller.ts'))).toBe(true);
  });
  it('does not rename an owned record field into an unowned field', async () => {
    const user = author('type Book { item: Text }'), adapter = output();
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path.endsWith('.ts') ? 'export type Book = { item: string; title: string; };' : Buffer.from(file.bytes).toString()])));
    const current = user.rename('type Book { title: Text }', 'item', 'title');
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('accepts an unchanged configured external import alias by its native identity', async () => {
    const user = author('use Book from "catalog"\nfunction save(book: Book) returns Nothing', { catalog: 'type Book {}' });
    const adapter = typescriptOutput.open({ directory: 'src', imports: [{ module: 'catalog', declaration: ['Book'], name: 'Book', as: 'NativeBook', from: '../native/book.js' }] });
    let snapshot = captured({ 'native/book.ts': 'export type Book = {};' });
    const first = await adapter.plan({ operation: 'create', current: user.initial }, snapshot); expect(first.problems).toEqual([]); snapshot = materialize(snapshot, first.value!);
    const result = await adapter.plan({ operation: 'update', current: user.initial, diff: user.identity.compare(user.initial.baseline, user.initial).value! }, snapshot);
    expect(result.problems).toEqual([]); expect(result.value!.changes).toEqual([]);
  });
  it('does not confuse two native libraries exporting the same type name', async () => {
    const user = author('use Book as First from "catalog-a"\nuse Book as Second from "catalog-b"\nfunction compare(first: First, second: Second) returns Nothing', { 'catalog-a': 'type Book {}', 'catalog-b': 'type Book {}' });
    const adapter = typescriptOutput.open({ directory: 'src', imports: [
      { module: 'catalog-a', declaration: ['Book'], name: 'Book', as: 'FirstBook', from: '../native/a.js' },
      { module: 'catalog-b', declaration: ['Book'], name: 'Book', as: 'SecondBook', from: '../native/b.js' },
    ] });
    let snapshot = captured({ 'native/a.ts': 'export type Book = {};', 'native/b.ts': 'export type Book = {};' });
    const first = await adapter.plan({ operation: 'create', current: user.initial }, snapshot); expect(first.problems).toEqual([]); snapshot = materialize(snapshot, first.value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path === 'src/compare.ts' ? Buffer.from(file.bytes).toString().replace('first: FirstBook', 'first: SecondBook') : Buffer.from(file.bytes).toString()])));
    const result = await adapter.plan({ operation: 'update', current: user.initial, diff: user.identity.compare(user.initial.baseline, user.initial).value! }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('contract-drift');
  });
  it('does not confuse an opaque specification ID with an unrelated native type name', async () => {
    const user = author('type Book {}\nfunction save(book: Book) returns Nothing', {}, index => 'Other' + index), adapter = output();
    expect(user.id('Book')).toBe('Other1');
    let snapshot = materialize(captured({}), (await adapter.plan({ operation: 'create', current: user.initial }, captured({}))).value!);
    snapshot = captured(Object.fromEntries(snapshot.files.map(file => [file.path, file.path === 'src/Book.ts' ? 'export type Book = {}; export type Other1 = {};'
      : file.path === 'src/save.ts' ? 'import type { Book, Other1 } from "./Book.js"; export function save(book: Other1): void {}' : Buffer.from(file.bytes).toString()])));
    const result = await adapter.plan({ operation: 'update', current: user.initial, diff: user.identity.compare(user.initial.baseline, user.initial).value! }, snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('contract-drift');
  });
  it('retains the implementation obligation when an untouched generated stub is renamed', async () => {
    const user = author('function save() returns Nothing'), adapter = output();
    const first = await adapter.plan({ operation: 'create', current: user.initial }, captured({}));
    const snapshot = materialize(captured({}), first.value!), current = user.rename('function saveGame() returns Nothing', 'save', 'saveGame');
    const result = await adapter.plan({ operation: 'update', current, diff: user.identity.compare(user.initial.baseline, current).value! }, snapshot);
    expect(result.problems).toEqual([]);
    expect(result.value!.obligations).toMatchObject([{ code: 'implementation-required', message: 'Implement saveGame.', at: { kind: 'source' } }]);
  });
  it('does not label a signature-only interface as an unfinished implementation', async () => {
    const user = author('interface Store { capability save() returns Nothing }');
    const result = await output().plan({ operation: 'create', current: user.initial }, captured({}));
    expect(result.problems).toEqual([]); expect(result.value!.obligations).toEqual([]);
  });
  it('does not infer generated ownership from an adopted handwritten throw', async () => {
    const user = author('function save() returns Nothing'), mapped = user.map(user.initial, 'save', 'manual.ts', [{ kind: 'function', name: 'save' }]);
    const result = await output().plan({ operation: 'create', current: mapped }, captured({ 'manual.ts': 'export function save(): void { throw new Error("Not implemented: handwritten policy"); }' }));
    expect(result.problems).toEqual([]); expect(result.value!.obligations).toEqual([]);
  });

});
