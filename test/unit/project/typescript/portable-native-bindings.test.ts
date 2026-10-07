import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Compiler, LangiumModel, LangiumReader, Outputs, SpecificationIdentity, acceptanceOutput, typescriptOutput,
  type OutputPlan, type ProjectSnapshot } from '../../../../src/index.js';

const firstCheckout = 'file:///first-checkout/generation/expec/editor.expec';
const secondCheckout = 'file:///second-checkout/generation/expec/editor.expec';
const documentBinding = { declaration: ['VsCodeDocument'], name: 'TextDocument', from: 'vscode' };
const documentSource = 'opaque type VsCodeDocument\nfunction read(document: VsCodeDocument) returns Text';
const declarations = 'declare module "vscode" { export interface TextDocument { getText(): string }\nexport interface OtherDocument { getText(): string } }';

function snapshot(files: Record<string, string> = {}): ProjectSnapshot {
  return { root: { path: '/portable-native-bindings', identity: 'portable-native-bindings' }, complete: true, problems: [], excluded: [], excludeNames: [],
    files: Object.entries(files).map(([path, text]) => ({ path, bytes: Buffer.from(text), version: createHash('sha256').update(text).digest('hex') })) };
}
const native = () => snapshot({ 'vscode.d.ts': declarations,
  'tsconfig.json': '{"compilerOptions":{"target":"ES2022","lib":["ES2022"],"strict":true,"types":[]},"include":["**/*.ts"]}' });
// Only the generated acceptance support's host surface is needed; these cases
// check native binding plans, not Vitest or Node's assertion implementations.
const acceptanceNative = () => edit(native(), 'test-host.d.ts', [
  'declare module "vitest" {',
  '  interface Test<Context = {}> {',
  '    (name: string, body: (context: Context) => void | Promise<void>): void;',
  '    extend<Name extends string, Value>(name: Name, setup: () => Value): Test<Context & Record<Name, Value>>;',
  '  }',
  '  export const test: Test;',
  '  export function expect(actual: unknown): { toBe(expected: unknown): void; toStrictEqual(expected: unknown): void };',
  '}',
  'declare module "node:util" {',
  '  export function isDeepStrictEqual(actual: unknown, expected: unknown): boolean;',
  '  export const types: { isProxy(value: unknown): boolean };',
  '}',
].join('\n'));
function author(text: string, locator = firstCheckout, libraries: Record<string, string> = {}) {
  const modules = Object.entries(libraries).map(([locator, text]) => {
    const read = new LangiumReader().read({ sourceId: locator, text });
    if (read.status !== 'accepted') throw Error(JSON.stringify(read));
    return new LangiumModel(locator, read.document);
  });
  const checked = new Compiler().compile({ locator, source: { sourceId: locator, text }, dependencies: { modules, packages: [] } });
  expect(checked.problems).toEqual([]); expect(checked.value).toBeDefined();
  let next = 0;
  const identity = new SpecificationIdentity(() => 'portable-' + ++next), identified = identity.associate(checked.value!);
  expect(identified.problems).toEqual([]); expect(identified.value).toBeDefined();
  return { identity, current: identified.value! };
}
function open(id: 'typescript' | 'acceptance', imports: readonly Record<string, unknown>[], basedOn = id === 'acceptance' ? acceptanceNative() : native(), settings: Record<string, unknown> = {}) {
  const outputs = new Outputs(); outputs.register(typescriptOutput); outputs.register(acceptanceOutput);
  const options = { ...(id === 'typescript' ? { directory: 'src' } : { domain: 'editor' }), configFile: 'tsconfig.json', imports, ...settings };
  const result = outputs.open(id, options, { root: basedOn.root, readSnapshot: async () => basedOn },
    { apply: async () => { throw Error('A supplied-snapshot planning test cannot write to a project.'); } });
  expect(result.problems).toEqual([]); expect(result.value).toBeDefined();
  return result.value!;
}
function emitted(plan: OutputPlan, path: string): string {
  const change = plan.changes.find(change => change.kind === 'write' && change.path === path);
  expect(change?.kind, path).toBe('write');
  if (change?.kind !== 'write') throw Error('Expected generated file ' + path);
  return Buffer.from(change.bytes).toString();
}
function materialize(before: ProjectSnapshot, plan: OutputPlan): ProjectSnapshot {
  const files = Object.fromEntries(before.files.map(file => [file.path, Buffer.from(file.bytes).toString()]));
  for (const change of plan.changes) {
    if (change.kind === 'write') files[change.path] = Buffer.from(change.bytes).toString();
    else if (change.kind === 'remove') delete files[change.path];
    else throw Error('This binding contract does not request native file relocation.');
  }
  return snapshot(files);
}
function edit(before: ProjectSnapshot, path: string, text: string): ProjectSnapshot {
  return snapshot({ ...Object.fromEntries(before.files.map(file => [file.path, Buffer.from(file.bytes).toString()])), [path]: text });
}

describe('portable native type bindings', () => {
  it('uses one declaration-only mapping in different specification checkouts', async () => {
    const imports = [documentBinding], initial = native();
    const first = await open('typescript', imports).plan({ operation: 'create', current: author(documentSource, firstCheckout).current }, initial);
    const second = await open('typescript', imports).plan({ operation: 'create', current: author(documentSource, secondCheckout).current }, initial);
    expect(first.problems).toEqual([]); expect(second.problems).toEqual([]);
    const generated = emitted(first.value!, 'src/read.ts');
    expect(generated).toContain('import type { TextDocument } from "vscode";');
    expect(generated).toContain('read(document: TextDocument): string');
    expect(emitted(second.value!, 'src/read.ts')).toBe(generated);
    expect(imports).toEqual([{ declaration: ['VsCodeDocument'], name: 'TextDocument', from: 'vscode' }]);
  });

  it('uses the same portable native mapping for acceptance support in either checkout', async () => {
    const source = 'opaque type VsCodeDocument\nexamples { action openDocument(document: VsCodeDocument) returns Nothing }';
    const imports = [documentBinding], initial = acceptanceNative();
    const first = await open('acceptance', imports).plan({ operation: 'create', current: author(source, firstCheckout).current }, initial);
    const second = await open('acceptance', imports).plan({ operation: 'create', current: author(source, secondCheckout).current }, initial);
    expect(first.problems).toEqual([]); expect(second.problems).toEqual([]);
    const dsl = emitted(first.value!, 'test/dsl/editor.ts'), driver = emitted(first.value!, 'test/driver/editor.ts');
    expect(dsl).toContain('import type { TextDocument } from "vscode";');
    expect(driver).toContain('import type { TextDocument } from "vscode";');
    expect(dsl).toContain('openDocument(document: TextDocument)');
    expect(driver).toContain('openDocument(document: TextDocument)');
    expect(emitted(second.value!, 'test/dsl/editor.ts')).toBe(dsl);
    expect(emitted(second.value!, 'test/driver/editor.ts')).toBe(driver);
    expect(imports).toEqual([{ declaration: ['VsCodeDocument'], name: 'TextDocument', from: 'vscode' }]);
  });

  it('emits acceptance native bindings as type-only imports', async () => {
    const current = author('opaque type VsCodeDocument\nexamples { action openDocument(document: VsCodeDocument) returns Nothing }').current;
    const result = await open('acceptance', [{ ...documentBinding, module: firstCheckout }])
      .plan({ operation: 'create', current }, acceptanceNative());
    expect(result.problems).toEqual([]);
    expect(emitted(result.value!, 'test/dsl/editor.ts')).toContain('import type { TextDocument } from "vscode";');
    expect(emitted(result.value!, 'test/driver/editor.ts')).toContain('import type { TextDocument } from "vscode";');
  });

  it('refuses a declaration-only mapping that selects nothing', async () => {
    const result = await open('typescript', [{ ...documentBinding, declaration: ['Missing'] }])
      .plan({ operation: 'create', current: author('function read() returns Text').current }, native());
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('invalid-native-mapping');
  });

  it('refuses a declaration-only mapping shared by two eligible provider types', async () => {
    const current = author('use VsCodeDocument as First from "first"\nuse VsCodeDocument as Second from "second"\nfunction read(first: First, second: Second) returns Text',
      firstCheckout, { first: 'opaque type VsCodeDocument', second: 'opaque type VsCodeDocument' }).current;
    const result = await open('typescript', [documentBinding]).plan({ operation: 'create', current }, native());
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('invalid-native-mapping');
  });

  it('refuses an acceptance mapping that selects nothing', async () => {
    const result = await open('acceptance', [{ ...documentBinding, declaration: ['Missing'] }])
      .plan({ operation: 'create', current: author('examples { action openDocument() returns Nothing }').current }, native());
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('invalid-native-mapping');
  });

  it('refuses an acceptance mapping shared by two eligible provider types', async () => {
    const current = author('use VsCodeDocument as First from "first"\nuse VsCodeDocument as Second from "second"\nexamples { action openDocument(first: First, second: Second) returns Nothing }',
      firstCheckout, { first: 'opaque type VsCodeDocument', second: 'opaque type VsCodeDocument' }).current;
    const result = await open('acceptance', [documentBinding]).plan({ operation: 'create', current }, native());
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('invalid-native-mapping');
  });

  it('uses explicit modules to bind only the intended same-named declarations', async () => {
    const current = author('use VsCodeDocument as First from "first"\nuse VsCodeDocument as Second from "second"\nfunction read(first: First, second: Second) returns Text',
      firstCheckout, { first: 'opaque type VsCodeDocument', second: 'opaque type VsCodeDocument' }).current;
    const result = await open('typescript', [
      { ...documentBinding, module: 'first' },
      { ...documentBinding, module: 'second', name: 'OtherDocument' },
    ]).plan({ operation: 'create', current }, native());
    expect(result.problems).toEqual([]);
    const generated = emitted(result.value!, 'src/read.ts');
    expect(generated).toContain('read(first: TextDocument, second: OtherDocument): string');
    expect(generated).toContain('from "vscode"');
  });

  it('preserves a handwritten body when repeating an ambient native type binding', async () => {
    const user = author(documentSource), output = open('typescript', [{ ...documentBinding, module: firstCheckout }]), before = native();
    const first = await output.plan({ operation: 'create', current: user.current }, before);
    expect(first.problems).toEqual([]);
    const generated = emitted(first.value!, 'src/read.ts');
    expect(generated).toContain('import type { TextDocument } from "vscode";');
    expect(generated).toContain('throw new Error("Not implemented: read");');
    const handwritten = generated.replace('throw new Error("Not implemented: read");', 'return document.getText();');
    const implemented = edit(materialize(before, first.value!), 'src/read.ts', handwritten);
    const repeated = await output.plan({ operation: 'update', current: user.current,
      diff: user.identity.compare(user.current.baseline, user.current).value! }, implemented);
    expect(repeated.problems).toEqual([]);
    expect(repeated.value).toBeDefined();
    const after = materialize(implemented, repeated.value!);
    expect(Buffer.from(after.files.find(file => file.path === 'src/read.ts')!.bytes).toString()).toBe(handwritten);
  });

  it('refuses a different ambient type even when it has the same structural shape', async () => {
    const user = author(documentSource), output = open('typescript', [{ ...documentBinding, module: firstCheckout }]), before = native();
    const first = await output.plan({ operation: 'create', current: user.current }, before);
    expect(first.problems).toEqual([]);
    const generated = emitted(first.value!, 'src/read.ts');
    expect(generated).toContain('document: TextDocument');
    const changed = generated.replace('import type { TextDocument }', 'import type { TextDocument, OtherDocument }')
      .replace('document: TextDocument', 'document: OtherDocument');
    const result = await output.plan({ operation: 'update', current: user.current,
      diff: user.identity.compare(user.current.baseline, user.current).value! }, edit(materialize(before, first.value!), 'src/read.ts', changed));
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('contract-drift');
  });
});


async function generatedBindings(text: string, imports: readonly Record<string, unknown>[] = [], id: 'typescript' | 'acceptance' = 'typescript', libraries: Record<string, string> = {}) {
  const user = author(text, firstCheckout, libraries), before = id === 'acceptance' ? acceptanceNative() : native();
  const generated = await open(id, imports).plan({ operation: 'create', current: user.current }, before);
  expect(generated.problems).toEqual([]); expect(generated.value).toBeDefined();
  return { user, generated: generated.value!, snapshot: materialize(before, generated.value!) };
}
function changedSpecification(user: ReturnType<typeof author>, text: string, rename?: { from: string; to: string }, libraries: Record<string, string> = {}) {
  const specification = author(text, firstCheckout, libraries).current.specification;
  const decisions = rename ? [{
    id: user.current.baseline.elements.find(item => item.address.name === rename.from)!.id,
    to: [...specification.inspection.query('opaque-type-declaration')].find(item => item.name === rename.to)!.id,
  }] : [];
  const next = user.identity.associate(specification, user.current.baseline, decisions);
  expect(next.problems).toEqual([]); expect(next.value).toBeDefined();
  const compared = user.identity.compare(user.current.baseline, next.value!);
  expect(compared.problems).toEqual([]); expect(compared.value).toBeDefined();
  return { current: next.value!, diff: compared.value! };
}
const anotherBinding = { declaration: ['AnotherDocument'], name: 'OtherDocument', from: 'vscode' };
const anotherSource = '\nopaque type AnotherDocument\nfunction readAnother(document: AnotherDocument) returns Text';

describe('adding a native binding during an explicit specification update', () => {
  it('adds the first binding for a new opaque type and keeps the handwritten body', async () => {
    const project = await generatedBindings('function read(document: Text) returns Text');
    const generated = emitted(project.generated, 'src/read.ts');
    expect(generated).toContain('throw new Error("Not implemented: read");');
    const implemented = edit(project.snapshot, 'src/read.ts', generated.replace('throw new Error("Not implemented: read");', 'return "cached";'));
    const next = changedSpecification(project.user, documentSource);
    const output = open('typescript', [documentBinding]);
    const result = await output.plan({ operation: 'update', ...next }, implemented);
    expect(result.problems).toEqual([]); expect(result.value).toBeDefined();
    const updated = emitted(result.value!, 'src/read.ts');
    expect(updated).toContain('import type { TextDocument } from "vscode";');
    expect(updated).toContain('read(document: TextDocument): string');
    expect(updated).toContain('return "cached";');
    const after = materialize(implemented, result.value!);
    const repeat = await output.plan({ operation: 'update', current: next.current,
      diff: project.user.identity.compare(next.current.baseline, next.current).value! }, after);
    expect(repeat.problems).toEqual([]); expect(repeat.value).toBeDefined();
    expect(Buffer.from(materialize(after, repeat.value!).files.find(file => file.path === 'src/read.ts')!.bytes).toString()).toBe(updated);
  });

  it('appends a new binding without changing the existing mapped declaration or body', async () => {
    const project = await generatedBindings(documentSource, [documentBinding]);
    const generated = emitted(project.generated, 'src/read.ts');
    expect(generated).toContain('throw new Error("Not implemented: read");');
    const handwritten = generated.replace('throw new Error("Not implemented: read");', 'return document.getText();');
    const implemented = edit(project.snapshot, 'src/read.ts', handwritten);
    const next = changedSpecification(project.user, documentSource + anotherSource);
    const result = await open('typescript', [documentBinding, anotherBinding]).plan({ operation: 'update', ...next }, implemented);
    expect(result.problems).toEqual([]); expect(result.value).toBeDefined();
    expect(emitted(result.value!, 'src/readAnother.ts')).toContain('readAnother(document: OtherDocument): string');
    expect(Buffer.from(materialize(implemented, result.value!).files.find(file => file.path === 'src/read.ts')!.bytes).toString()).toBe(handwritten);
  });

  it('requires update rather than create to introduce a binding into saved output', async () => {
    const project = await generatedBindings('function read(document: Text) returns Text');
    const next = changedSpecification(project.user, documentSource);
    const result = await open('typescript', [documentBinding]).plan({ operation: 'create', current: next.current }, project.snapshot);
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('output-options-changed');
  });

  it('refuses to bind an old unbound opaque type as though it were newly added', async () => {
    const libraries = { 'native-types': 'opaque type VsCodeDocument' };
    const project = await generatedBindings('use VsCodeDocument from "native-types"\nfunction read(document: Text) returns Text', [], 'typescript', libraries);
    const next = changedSpecification(project.user, 'use VsCodeDocument from "native-types"\nfunction read(document: VsCodeDocument) returns Text', undefined, libraries);
    const result = await open('typescript', [documentBinding]).plan({ operation: 'update', ...next }, project.snapshot);
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('output-options-changed');
  });

  it('refuses replacement of an established mapping while appending a new one', async () => {
    const project = await generatedBindings(documentSource, [documentBinding]);
    const next = changedSpecification(project.user, documentSource + anotherSource);
    const result = await open('typescript', [{ ...documentBinding, name: 'OtherDocument' }, anotherBinding])
      .plan({ operation: 'update', ...next }, project.snapshot);
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('output-options-changed');
  });

  it('refuses removal of an established mapping while appending a new one', async () => {
    const project = await generatedBindings(documentSource, [documentBinding]);
    const next = changedSpecification(project.user, documentSource + anotherSource);
    const result = await open('typescript', [anotherBinding]).plan({ operation: 'update', ...next }, project.snapshot);
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('output-options-changed');
  });

  it('refuses an unrelated output-directory change alongside a valid new binding', async () => {
    const project = await generatedBindings('function read(document: Text) returns Text');
    const next = changedSpecification(project.user, documentSource);
    const result = await open('typescript', [documentBinding], native(), { directory: 'other' })
      .plan({ operation: 'update', ...next }, project.snapshot);
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('output-options-changed');
  });

  it('refuses to retarget an unchanged selector to a different source identity', async () => {
    const project = await generatedBindings('opaque type VsCodeDocument\nfunction label() returns Text', [documentBinding]);
    const next = changedSpecification(project.user,
      'opaque type OriginalDocument\nfunction label() returns Text\n' + documentSource + anotherSource,
      { from: 'VsCodeDocument', to: 'OriginalDocument' });
    const result = await open('typescript', [documentBinding, anotherBinding]).plan({ operation: 'update', ...next }, project.snapshot);
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('output-options-changed');
  });

  it('adds a binding for a new acceptance operation while preserving the existing driver body', async () => {
    const project = await generatedBindings('examples { action closeDocument() returns Nothing }', [], 'acceptance');
    const generated = emitted(project.generated, 'test/driver/editor.ts');
    expect(generated).toContain('throw new Error("Not implemented: editor.closeDocument");');
    const handwritten = generated.replace('throw new Error("Not implemented: editor.closeDocument");', 'return;');
    const implemented = edit(project.snapshot, 'test/driver/editor.ts', handwritten);
    const next = changedSpecification(project.user,
      'opaque type VsCodeDocument\nexamples { action closeDocument() returns Nothing\naction openDocument(document: VsCodeDocument) returns Nothing }');
    const result = await open('acceptance', [documentBinding]).plan({ operation: 'update', ...next }, implemented);
    expect(result.problems).toEqual([]); expect(result.value).toBeDefined();
    const driver = Buffer.from(materialize(implemented, result.value!).files.find(file => file.path === 'test/driver/editor.ts')!.bytes).toString();
    expect(driver).toContain('import type { TextDocument } from "vscode";');
    expect(driver).toContain('openDocument(document: TextDocument)');
    expect(driver).toContain('async closeDocument(): Promise<void> {\n    return;\n  }');
  });

  it('refuses to rebind an old acceptance type while adding a new binding', async () => {
    const source = 'opaque type VsCodeDocument\nexamples { action openDocument(document: VsCodeDocument) returns Nothing }';
    const project = await generatedBindings(source, [documentBinding], 'acceptance');
    const next = changedSpecification(project.user,
      'opaque type VsCodeDocument\nopaque type AnotherDocument\nexamples { action openDocument(document: VsCodeDocument) returns Nothing\naction openAnother(document: AnotherDocument) returns Nothing }');
    const result = await open('acceptance', [{ ...documentBinding, name: 'OtherDocument' }, anotherBinding])
      .plan({ operation: 'update', ...next }, project.snapshot);
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('native-mapping-conflict');
  });
});
