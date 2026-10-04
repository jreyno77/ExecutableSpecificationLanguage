import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Compiler, Outputs, SpecificationIdentity, acceptanceOutput, type OutputPlan, type ProjectSnapshot } from '../../src/index.js';

const empty: ProjectSnapshot = { root: { path: '/acceptance-fixture', identity: 'fixture' }, complete: true, files: [], excludeNames: [], excluded: [], problems: [] };
function caller(options: Record<string, unknown> = {}) {
  const outputs = new Outputs(); outputs.register(acceptanceOutput);
  const opened = outputs.open('acceptance', { domain: 'shopping', ...options }, { root: empty.root, readSnapshot: async () => empty }, { apply: async () => { throw Error('Pure planning cannot write.'); } });
  return { opened, async plan(text: string, snapshot = empty) {
    const compilation = new Compiler().compile({ source: { sourceId: 'main.expec', text }, locator: 'main', dependencies: { modules: [], packages: [] } });
    if (!compilation.value) throw Error(JSON.stringify(compilation)); let next = 0;
    const current = new SpecificationIdentity(() => 'unit-' + ++next).associate(compilation.value);
    if (!current.value) throw Error(JSON.stringify(current));
    return opened.value!.plan({ operation: 'create', current: current.value }, snapshot);
  } };
}
const emitted = (plan: Awaited<ReturnType<ReturnType<typeof caller>['plan']>>, path: string): string => {
  expect(plan.problems).toEqual([]); const change = plan.value!.changes.find(change => change.kind === 'write' && change.path === path);
  expect(change?.kind).toBe('write'); return Buffer.from((change as { bytes: Uint8Array }).bytes).toString();
};
function recorded(plan: OutputPlan, edit: (value: Record<string, any>) => void): ProjectSnapshot {
  const files = plan.changes.flatMap(change => change.kind !== 'write' ? [] : [{ path: change.path, bytes: change.bytes, version: createHash('sha256').update(change.bytes).digest('hex') }]);
  const file = files.find(file => file.path.startsWith('.expec/outputs/'))!, state = JSON.parse(Buffer.from(file.bytes).toString()) as Record<string, any>;
  edit(state); const bytes = Buffer.from(JSON.stringify(state)); return { ...empty, files: files.map(item => item === file ? { ...item, bytes, version: createHash('sha256').update(bytes).digest('hex') } : item) };
}

describe('acceptance projection contracts for its caller', () => {
  it('refuses an operation that collides with the private driver member', async () => {
    const plan = await caller().plan('examples { action driver() returns Nothing }');
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('refuses fixture data that collides with the private driver member', async () => {
    const plan = await caller().plan('examples { fixture driver: Number = 1 }');
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('refuses a domain whose DSL file would replace the comparison runtime', async () => {
    const plan = await caller({ domain: 'comparison' }).plan('examples { example "one": 1 => 1 }');
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('rejects an unknown option before opening', () => { expect(caller({ hiddenRunner: true }).opened.value).toBeUndefined(); });
  it('rejects a foreign driver namespace before it can claim a class', () => {
    expect(caller({ driver: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file: 'driver.ts', declaration: [{ kind: 'class', name: 'Driver' }] } } }).opened.value).toBeUndefined();
  });
  it('rejects malformed fixture selection rather than throwing during a plan', () => {
    expect(caller({ fixture: { outputId: 'acceptance', format: 'typescript-symbol-1', value: { file: '../outside.ts' } } }).opened.value).toBeUndefined();
  });
  it('rejects platform-dependent glob and separator spelling in the test root', () => {
    expect(caller({ testRoot: 'test\\acceptance' }).opened.value).toBeUndefined();
    expect(caller({ testRoot: 'test/*' }).opened.value).toBeUndefined();
  });
  it('rejects colliding native parameters before emitting an invalid method', async () => {
    const plan = await caller({ names: [{ declaration: ['save', 'title'], name: 'value' }, { declaration: ['save', 'copies'], name: 'value' }] })
      .plan('examples { action save(title: Text, copies: Number) returns Nothing }');
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('uses the mapped parameter identity in its authored return', async () => {
    const plan = await caller({ names: [{ declaration: ['title', 'book name'], name: 'bookName' }] })
      .plan('examples { observation title(`book name`: Text) returns Text { return `book name` } }');
    expect(emitted(plan, 'test/dsl/shopping.ts')).toContain('return bookName;');
  });
  it('retains declared data defaults in the emitted call', async () => {
    const plan = await caller().plan('examples { observation copies(count: Number = 2) returns Number { return count }\nexample "default copies": copies() => 2 }');
    expect(emitted(plan, 'test/acceptance/shopping.test.ts')).toContain('shopping.copies(2)');
  });
  it('emits unary numeric and Boolean operations with their checked meaning', async () => {
    const plan = await caller().plan('examples { example "negative": -2 => -2\nexample "not false": not false => true }');
    expect(emitted(plan, 'test/acceptance/shopping.test.ts')).toContain('!false');
    expect(emitted(plan, 'test/acceptance/shopping.test.ts')).toContain('finiteNumber');
  });
  it('refuses a typo in a native type import mapping instead of silently ignoring it', async () => {
    const plan = await caller({ imports: [{ module: 'main', declaration: ['Missing'], name: 'URL' }] }).plan('examples { example "one": 1 => 1 }');
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('invalid-native-mapping');
  });
  it('refuses two fixtures that would share one generated data property', async () => {
    const plan = await caller().plan('examples { fixture title: Text = "Dune" }\nexamples { fixture title: Text = "Foundation" }');
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('leaves an unconnected application capability as a typed failing bridge', async () => {
    const plan = await caller().plan('concept Store { capability save(title: Text) returns Nothing\nexamples { action store() returns Nothing { do save("Dune") }\nscenario "requires runtime" { when store()\nthen true } } }');
    expect(plan.problems).toEqual([]); expect(plan.value!.obligations?.map(item => item.code)).toContain('implementation-required');
    expect(emitted(plan, 'test/driver/shopping.ts')).toContain('save(title: string): Promise<void>');
    expect(emitted(plan, 'test/driver/shopping.ts')).toContain('Not implemented: shopping.save');
  });
  it('rejects a saved artifact format the acceptance output does not own', async () => {
    const value = caller(), source = 'examples { observation count() returns Number }', plan = await value.plan(source);
    const snapshot = recorded(plan.value!, state => { state.files.find((file: any) => file.artifacts.length).artifacts[0].locator.format = 'imaginary'; });
    const next = await value.plan(source, snapshot); expect(next.value).toBeUndefined(); expect(next.problems[0]?.code).toBe('invalid-output-state');
  });
  it('rejects a saved generated baseline that no longer contains its recorded member', async () => {
    const value = caller(), source = 'examples { observation count() returns Number }', plan = await value.plan(source);
    const snapshot = recorded(plan.value!, state => {
      const file = state.files.find((file: any) => file.container?.role === 'driver');
      file.generated = file.generated.replace('count(', 'other('); file.hash = createHash('sha256').update(file.generated).digest('hex');
    });
    const next = await value.plan(source, snapshot); expect(next.value).toBeUndefined(); expect(next.problems[0]?.code).toBe('invalid-output-state');
  });
  it('rejects different identities claiming the same saved native member', async () => {
    const value = caller(), source = 'examples { observation count() returns Number }', plan = await value.plan(source);
    const snapshot = recorded(plan.value!, state => { const file = state.files.find((file: any) => file.container?.role === 'driver'); file.artifacts.push({ ...file.artifacts[0], specId: 'other' }); });
    const next = await value.plan(source, snapshot); expect(next.value).toBeUndefined(); expect(next.problems[0]?.code).toBe('invalid-output-state');
  });
  it('rejects a generated baseline missing its recorded native test marker', async () => {
    const value = caller(), source = 'examples { example "one": 1 => 1 }', plan = await value.plan(source);
    const snapshot = recorded(plan.value!, state => {
      const file = state.files.find((file: any) => file.artifacts.some((item: any) => item.locator.format === 'vitest-test-1'));
      file.generated = file.generated.replace(/\/\* @expec-test .+ \*\//, ''); file.hash = createHash('sha256').update(file.generated).digest('hex');
    });
    const next = await value.plan(source, snapshot); expect(next.value).toBeUndefined(); expect(next.problems[0]?.code).toBe('invalid-output-state');
  });
  it('refuses direct removal of an operation while keeping its implementation intact', async () => {
    const value = caller(), plan = await value.plan('examples { observation count() returns Number }'), snapshot = recorded(plan.value!, () => {});
    const id = plan.value!.artifacts.find(item => item.locator.format === 'typescript-symbol-1')!.specId;
    const next = await value.opened.value!.plan({ operation: 'delete', id }, snapshot);
    expect(next.value).toBeUndefined(); expect(next.problems[0]?.code).toBe('nested-delete');
  });
});
