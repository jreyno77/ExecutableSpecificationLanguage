import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { Compiler, Outputs, SpecificationIdentity, typescriptOutput,
  type IdentifiedSpecification, type OutputContext, type OutputPlan, type ProjectSnapshot } from '../../../../src/index.js';

const empty: ProjectSnapshot = { root: { path: '/native-fixture', identity: 'fixture' }, complete: true, files: [], excludeNames: [], excluded: [], problems: [] };
const file = (path: string, text: string) => ({ path, bytes: Buffer.from(text), version: createHash('sha256').update(text).digest('hex') });
function caller(options: Record<string, unknown> = { directory: 'src' }, membership?: OutputContext) {
  let next = 0, snapshot = empty;
  const identity = new SpecificationIdentity(() => 'native-unit-' + ++next), outputs = new Outputs(); outputs.register(typescriptOutput);
  const context = { root: empty.root, readSnapshot: async () => snapshot }, writer = { apply: async () => { throw new Error('A pure output plan cannot write'); } };
  const opened = outputs.open('typescript', options, context, writer, membership), output = opened.value;
  return { outputs, identity, opened, output, get snapshot() { return snapshot; },
    specify(text: string, before?: IdentifiedSpecification, locator = 'main') {
      const result = new Compiler().compile({ locator, source: { sourceId: locator === 'main' ? 'main.expec' : locator, text }, dependencies: { modules: [], packages: [] } });
      if (!result.value) throw new Error(JSON.stringify(result)); const current = identity.associate(result.value, before?.baseline);
      if (!current.value) throw new Error(JSON.stringify(current)); return current.value;
    },
    materialize(plan: OutputPlan) { for (const change of plan.changes) {
      if (change.kind === 'move') throw new Error('This observer needs a concrete move implementation');
      snapshot = { ...snapshot, files: [...snapshot.files.filter(file => file.path !== change.path), ...change.kind === 'write' ? [file(change.path, Buffer.from(change.bytes).toString())] : []] };
    } },
    edit(path: string, text: string) { snapshot = { ...snapshot, files: [...snapshot.files.filter(file => file.path !== path), file(path, text)] }; },
    reopen(options: Record<string, unknown>, membership?: OutputContext) { return outputs.open('typescript', options, context, writer, membership); },
  };
}
const text = (plan: OutputPlan, path: string): string => { const change = plan.changes.find(change => change.kind === 'write' && change.path === path); expect(change, path).toBeDefined(); return Buffer.from((change as { bytes: Uint8Array }).bytes).toString(); };

describe('native output contracts from a caller', () => {
  it('rejects unknown options before any plan is available', () => {
    const value = caller({ directory: 'src', dangerous: true }); expect(value.opened.value).toBeUndefined(); expect(value.opened.problems[0]?.code).toBe('invalid-output-options');
  });
  it('rejects portable paths that could escape or target output state', () => {
    for (const directory of ['../src', '.expec/types', 'src\\types', '/tmp/out', 'src/*', 'src/{x}']) expect(caller({ directory }).opened.value, directory).toBeUndefined();
  });
  it('rejects blank and malformed context without opening a registration', () => {
    const value = caller(); for (const context of [{ workspaceModules: [''] }, { workspaceModules: [3] }, { workspaceModules: [], hidden: true }, null]) {
      const result = value.reopen({ directory: 'src' }, context as unknown as OutputContext); expect(result.value).toBeUndefined(); expect(result.problems[0]?.code).toBe('invalid-output-context');
    }
  });
  it('copies and freezes context while retaining exact opaque module names', () => {
    const outputs = new Outputs(), source = { workspaceModules: [' custom module '] }; let observed: OutputContext | undefined;
    outputs.register({ ...typescriptOutput, id: 'observe', open: (_options, context) => {
      observed = context; const adapter = typescriptOutput.open({ directory: 'src' });
      return { id: 'observe', plan: adapter.plan.bind(adapter), read: adapter.read.bind(adapter), search: adapter.search.bind(adapter) };
    } });
    outputs.open('observe', { directory: 'src' }, { root: empty.root, readSnapshot: async () => empty }, { apply: async () => { throw new Error('No writes'); } }, source);
    source.workspaceModules.length = 0; expect(observed).toEqual({ workspaceModules: [' custom module '] }); expect(Object.isFrozen(observed)).toBe(true); expect(Object.isFrozen(observed!.workspaceModules)).toBe(true);
  });
  it('keeps a quoted parameter readable through an explicit name mapping', async () => {
    const value = caller({ directory: 'src', names: [{ declaration: ['save', 'player name'], name: 'playerName' }] }), current = value.specify('function save(`player name`: Text) returns Nothing');
    const plan = await value.output!.plan({ operation: 'create', current }, empty); expect(plan.problems).toEqual([]); expect(text(plan.value!, 'src/save.ts')).toContain('playerName: string');
  });
  it('maps a quoted generic parameter everywhere its type is used', async () => {
    const value = caller({ directory: 'src', names: [{ declaration: ['Box', 'my value'], name: 'T' }] }), current = value.specify('type Box<`my value`> { item: `my value` }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty); expect(plan.problems).toEqual([]); expect(text(plan.value!, 'src/Box.ts')).toContain('Box<T>'); expect(text(plan.value!, 'src/Box.ts')).toContain('item: T');
  });
  it('reports an unmatched mapping instead of silently ignoring it', async () => {
    const value = caller({ directory: 'src', names: [{ declaration: ['Missing'], name: 'Fine' }] }), current = value.specify('class Game {}');
    const plan = await value.output!.plan({ operation: 'create', current }, empty); expect(plan.value).toBeUndefined(); expect(plan.problems[0]?.code).toBe('invalid-native-mapping');
  });
  it('rejects two callable parameters mapped to the same native name', async () => {
    const value = caller({ directory: 'src', names: [{ declaration: ['save', 'title'], name: 'value' }, { declaration: ['save', 'copies'], name: 'value' }] });
    const current = value.specify('function save(title: Text, copies: Number) returns Nothing');
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('rejects two record fields mapped to the same native property', async () => {
    const value = caller({ directory: 'src', names: [{ declaration: ['Book', 'title'], name: 'value' }, { declaration: ['Book', 'copies'], name: 'value' }] });
    const current = value.specify('type Book { title: Text\ncopies: Number }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('rejects two capabilities mapped to the same native method', async () => {
    const value = caller({ directory: 'src', names: [{ declaration: ['Store', 'save'], name: 'perform' }, { declaration: ['Store', 'delete'], name: 'perform' }] });
    const current = value.specify('class Store { capability save() returns Nothing\ncapability delete() returns Nothing }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('rejects a renamed generic parameter that hides its sibling parameter', async () => {
    const value = caller({ directory: 'src', names: [{ declaration: ['Pair', 'L'], name: 'R' }] });
    const current = value.specify('type Pair<L, R> { left: L\nright: R }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('rejects colliding names in an explicit constructor parameter list', async () => {
    const value = caller({ directory: 'src', names: [{ declaration: ['Game', 'construction', 'title'], name: 'copies' }] });
    const current = value.specify('class Game { construction(title: Text, copies: Number) }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('rejects a generic mapping that hides a referenced native type', async () => {
    const value = caller({ directory: 'src', names: [{ declaration: ['Box', 'T'], name: 'Book' }] });
    const current = value.specify('type Book { title: Text }\ntype Box<T> { item: Book }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('permits a value parameter with the same name as a type-only reference', async () => {
    const value = caller({ directory: 'src', names: [{ declaration: ['save', 'label'], name: 'Book' }] });
    const current = value.specify('type Book { title: Text }\nfunction save(label: Text, item: Book) returns Nothing');
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.problems).toEqual([]); expect(text(plan.value!, 'src/save.ts')).toContain('Book: string, item: Book');
  });
  it('does not confuse a generic Error type with the native Error constructor value', async () => {
    const value = caller(), current = value.specify('error type Rejected<Error> { code: "no"\npayload: Error }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.problems).toEqual([]); expect(text(plan.value!, 'src/Rejected.ts')).toContain('class RejectedError<Error> extends Error');
  });
  it('permits a local Error type alias beside a stub using the global constructor', async () => {
    const value = caller({ directory: 'src', names: [{ declaration: ['Game', 'Failure'], name: 'Error' }] });
    const current = value.specify('class Game { local type Failure = Text\ncapability save() returns Nothing }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.problems).toEqual([]); expect(text(plan.value!, 'src/Game.ts')).toContain('type Error = string');
  });
  it('permits a function named Array to use the global Array type', async () => {
    const value = caller(), current = value.specify('function Array(items: List<Text>) returns Nothing');
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.problems).toEqual([]); expect(text(plan.value!, 'src/Array.ts')).toContain('items: Array<string>');
  });
  it('does not let an interface constructor companion hide another declaration', async () => {
    const value = caller(), current = value.specify('interface Game { construction() }\ntype GameConstructor = Text');
    const plan = await value.output!.plan({ operation: 'create', current }, empty); expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('does not let a flattened local type hide a top-level declaration', async () => {
    const value = caller(), current = value.specify('class Game { local type Cache = Text }\ntype Game_Cache = Number');
    const plan = await value.output!.plan({ operation: 'create', current }, empty); expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('escapes documentation terminators without emitting source code from prose', async () => {
    const value = caller(), current = value.specify('function save() returns Nothing { promises "close */ injected() /*" }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty); expect(plan.problems).toEqual([]);
    const source = ts.createSourceFile('save.ts', text(plan.value!, 'src/save.ts'), ts.ScriptTarget.Latest, true);
    expect(source.statements).toHaveLength(1); expect(ts.isFunctionDeclaration(source.statements[0]!)).toBe(true); expect(source.text).toContain('close * / injected() /*');
  });
  it('does not ban an unused native-looking declaration', async () => {
    const value = caller(), current = value.specify('type Array = Text');
    const plan = await value.output!.plan({ operation: 'create', current }, empty); expect(plan.problems).toEqual([]); expect(text(plan.value!, 'src/Array.ts')).toContain('export type Array = string');
  });
  it('rejects an unsafe class constructor method name rather than printing invalid TypeScript', async () => {
    const value = caller(), current = value.specify('class Game { capability `constructor`() returns Nothing }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty); expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('resolves nested local type names through their full authored owner path', async () => {
    const value = caller(), current = value.specify('class Game { local class Cache { local type Entry = Text\ncapability write(entry: Entry) returns Nothing } }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty); expect(plan.problems).toEqual([]);
    expect(text(plan.value!, 'src/Game.ts')).toContain('Game_Cache_Entry');
    const write = plan.value!.artifacts.find(item => (item.locator.value as { declaration: { name: string }[] }).declaration.at(-1)?.name === 'write');
    expect((write!.locator.value as { declaration: { name: string }[] }).declaration[0]?.name).toBe('Game_Cache');
  });
  it('protects native Array from a generic parameter only inside the list scope', async () => {
    const value = caller(), current = value.specify('type Box<Array> { items: List<Array> }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty); expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('uses real Array in one local declaration without banning a separate generic Array scope', async () => {
    const value = caller(), current = value.specify('class Game { local type Box<Array> { value: Array }\nlocal type Shelf { items: List<Text> } }');
    const plan = await value.output!.plan({ operation: 'create', current }, empty); expect(plan.problems).toEqual([]); expect(plan.value).toBeDefined();
  });
  it('reports option migration distinctly from corrupt state', async () => {
    const value = caller(), current = value.specify('class Game {}'); value.materialize((await value.output!.plan({ operation: 'create', current }, empty)).value!);
    const result = await value.reopen({ directory: 'elsewhere' }).value!.plan({ operation: 'create', current }, value.snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems[0]?.code).toBe('output-options-changed');
  });
  it('refuses a corrupt byte version before constructing a plan', async () => {
    const value = caller(), current = value.specify('class Game {}');
    const result = await value.output!.plan({ operation: 'create', current }, { ...empty, files: [{ ...file('readme', 'old'), bytes: Buffer.from('new') }] });
    expect(result.value).toBeUndefined(); expect(result.problems[0]?.code).toBe('invalid-project-snapshot');
  });
  it('refuses an output destination excluded by the current capture', async () => {
    const value = caller(), current = value.specify('class Game {}');
    const result = await value.output!.plan({ operation: 'create', current }, { ...empty, excludeNames: ['src'] });
    expect(result.value).toBeUndefined(); expect(result.problems[0]?.code).toBe('output-conflict');
  });
  it('does not allow a file to occupy the private state parent', async () => {
    const value = caller(), current = value.specify('class Game {}'); value.edit('.expec/outputs', 'handwritten');
    const result = await value.output!.plan({ operation: 'create', current }, value.snapshot); expect(result.value).toBeUndefined(); expect(result.problems[0]?.code).toBe('output-conflict');
  });
  it('does not repair lost output state by adopting generated-looking files', async () => {
    const value = caller(), current = value.specify('class Game {}'); value.edit('src/Game.ts', 'export class Game {}');
    const result = await value.output!.plan({ operation: 'create', current }, value.snapshot); expect(result.value).toBeUndefined(); expect(result.problems[0]?.code).toBe('output-conflict');
  });
  it('rejects an artifact-only diff with no actual identity record', async () => {
    const value = caller(), current = value.specify('class Game {}');
    const result = await value.output!.plan({ operation: 'update', current, diff: { contextChanged: false, changes: [{ id: 'ghost', kinds: ['artifacts'] }], affected: [] } }, empty);
    expect(result.value).toBeUndefined(); expect(result.problems[0]?.code).toBe('inconsistent-diff');
  });
  it('preserves earlier reports and the checked model while planning again', async () => {
    const value = caller(), current = value.specify('type Book { title: Text }'), before = JSON.stringify([...current.specification.inspection.roots()]);
    const first = await value.output!.plan({ operation: 'create', current }, empty), copy = structuredClone(first);
    await value.output!.plan({ operation: 'create', current }, empty);
    expect(first).toEqual(copy); expect(JSON.stringify([...current.specification.inspection.roots()])).toBe(before);
  });
  it('refuses a saved declaration identity copied into a different owned file', async () => {
    const value = caller(), current = value.specify('class Game {}\nclass Cart {}');
    value.materialize((await value.output!.plan({ operation: 'create', current }, empty)).value!);
    const stateFile = value.snapshot.files.find(file => file.path.startsWith('.expec/outputs/'))!;
    const state = JSON.parse(Buffer.from(stateFile.bytes).toString());
    state.files[1].artifacts.push({ ...state.files[1].artifacts[0], specId: state.files[0].id });
    value.edit(stateFile.path, JSON.stringify(state));
    const result = await value.output!.plan({ operation: 'create', current }, value.snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems[0]?.code).toBe('invalid-output-state');
  });
  it('rejects duplicate keys in the saved ownership record', async () => {
    const value = caller(), current = value.specify('class Game {}');
    value.materialize((await value.output!.plan({ operation: 'create', current }, empty)).value!);
    const stateFile = value.snapshot.files.find(file => file.path.startsWith('.expec/outputs/'))!;
    value.edit(stateFile.path, Buffer.from(stateFile.bytes).toString().trimEnd().slice(0, -1) + ',"format":1}');
    const result = await value.output!.plan({ operation: 'create', current }, value.snapshot);
    expect(result.value).toBeUndefined(); expect(result.problems[0]?.code).toBe('invalid-output-state');
  });
});

describe('source-folder output from a caller', () => {
  const manifestLocation = resolve('layout-fixture/specs/expec.json');
  const locator = pathToFileURL(resolve('layout-fixture/specs/core/game.expec')).href;
  const membership = { workspaceModules: [locator], manifestLocation };

  it('accepts explicit relative layout roots and leaves legacy flat options unchanged', () => {
    for (const sourceRoot of ['.', '..', '../specs', 'contracts']) {
      const value = caller({ sourceRoot, directory: '.' }, membership);
      expect(value.opened.problems, sourceRoot).toEqual([]); expect(value.output).toBeDefined();
    }
    expect(caller({ directory: 'src' }).opened.problems).toEqual([]);
    expect(caller({ directory: '.' }).opened.problems[0]?.code).toBe('invalid-output-options');
  });

  it.each(['', '/specs', 'C:/specs', 'C:specs', 'file:///specs', 'specs\\core', null, 3])('rejects invalid sourceRoot %j at the option boundary', sourceRoot => {
    const value = caller({ sourceRoot, directory: 'src' }, membership);
    expect(value.output).toBeUndefined(); expect(value.opened.problems[0]?.code).toBe('invalid-output-options');
  });

  it.each(['', 'specs/expec.json', 'C:expec.json', 'file:///specs/expec.json', null, 3])('rejects a manifest location that is not an absolute native filename: %j', manifestLocation => {
    const value = caller({ directory: 'src' }, { workspaceModules: [], manifestLocation } as unknown as OutputContext);
    expect(value.output).toBeUndefined(); expect(value.opened.problems[0]?.code).toBe('invalid-output-context');
  });

  it('copies and freezes the manifest location with the workspace context', () => {
    const outputs = new Outputs(), source = { workspaceModules: [locator], manifestLocation }; let observed: OutputContext | undefined;
    outputs.register({ ...typescriptOutput, id: 'observe-layout', open: (_options, context) => {
      observed = context; const adapter = typescriptOutput.open({ directory: 'src' });
      return { id: 'observe-layout', plan: adapter.plan.bind(adapter), read: adapter.read.bind(adapter), search: adapter.search.bind(adapter) };
    } });
    const opened = outputs.open('observe-layout', { sourceRoot: '.', directory: '.' },
      { root: empty.root, readSnapshot: async () => empty }, { apply: async () => { throw new Error('No writes'); } }, source);
    expect(opened.problems).toEqual([]);
    source.manifestLocation = resolve('elsewhere/expec.json'); source.workspaceModules.length = 0;
    expect(observed).toEqual({ workspaceModules: [locator], manifestLocation });
    expect(Object.isFrozen(observed)).toBe(true); expect(Object.isFrozen(observed!.workspaceModules)).toBe(true);
  });
  it('reports a missing manifest location before planning source-folder output', async () => {
    for (const context of [undefined, { workspaceModules: [locator] }]) {
      const value = caller({ sourceRoot: '.', directory: 'src' }, context), current = value.specify('class Game {}', undefined, locator);
      expect(value.opened.problems).toEqual([]);
      const plan = await value.output!.plan({ operation: 'create', current }, empty);
      expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('invalid-source-layout');
    }
  });

  it.each([
    'urn:contracts:game', 'file:///bad%ZZ/game.expec', 'file:///bad%2Ffolder/game.expec',
    locator + '?revision=1', locator + '#declaration', 'file:///Z:/different-volume/game.expec',
    pathToFileURL(resolve('layout-fixture/outside/game.expec')).href,
  ])('refuses a source origin that cannot identify one file inside the layout root: %s', async source => {
    const value = caller({ sourceRoot: '.', directory: 'src' }, { ...membership, workspaceModules: [source] });
    const current = value.specify('class Game {}', undefined, source); expect(value.opened.problems).toEqual([]);
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('invalid-source-layout');
  });

  it.each(['.expec', 'bad*folder', 'preview?mode', 'fragment#name'])('refuses an unsafe mirrored destination folder: %s', async folder => {
    const source = pathToFileURL(resolve('layout-fixture/specs', folder, 'game.expec')).href;
    const value = caller({ sourceRoot: '.', directory: 'src' }, { ...membership, workspaceModules: [source] });
    const current = value.specify('class Game {}', undefined, source); expect(value.opened.problems).toEqual([]);
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('invalid-source-layout');
  });

  it('protects an unowned file at the mirrored destination', async () => {
    const value = caller({ sourceRoot: '.', directory: 'src' }, membership), current = value.specify('class Game {}', undefined, locator);
    expect(value.opened.problems).toEqual([]); value.edit('src/core/Game.ts', 'handwritten');
    const before = structuredClone(value.snapshot), plan = await value.output!.plan({ operation: 'create', current }, value.snapshot);
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('output-conflict');
    expect(structuredClone(value.snapshot)).toEqual(before);
  });

  it('retains the native name collision check within a mirrored folder', async () => {
    const value = caller({ sourceRoot: '.', directory: 'src', names: [{ declaration: ['Cart'], name: 'Game' }] }, membership);
    const current = value.specify('class Game {}\nclass Cart {}', undefined, locator); expect(value.opened.problems).toEqual([]);
    const plan = await value.output!.plan({ operation: 'create', current }, empty);
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });

  it('reads root-directory ownership through a new output instance without planning duplicates', async () => {
    const options = { sourceRoot: '.', directory: '.' }, value = caller(options, membership), current = value.specify('class Game {}', undefined, locator);
    expect(value.opened.problems).toEqual([]);
    const first = await value.output!.plan({ operation: 'create', current }, empty);
    expect(first.problems).toEqual([]); expect(text(first.value!, 'core/Game.ts')).toContain('export class Game');
    expect(first.value!.changes.flatMap(change => change.kind === 'write' && change.path.endsWith('.ts') ? [change.path] : [])).toEqual(['core/Game.ts']);
    value.materialize(first.value!);
    const reopened = value.reopen(options, membership); expect(reopened.problems).toEqual([]);
    const repeated = await reopened.value!.plan({ operation: 'create', current }, value.snapshot);
    expect(repeated.problems).toEqual([]); expect(repeated.value!.changes).toEqual([]);
    expect(repeated.value!.artifacts).toEqual(first.value!.artifacts);
  });
});
