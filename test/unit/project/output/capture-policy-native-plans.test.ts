import { describe, expect, it } from 'vitest';
import { Compiler, Outputs, SpecificationIdentity, acceptanceOutput, javaOutput,
  type OutputRegistration, type ProjectSnapshot } from '../../../../src/index.js';

function planner(registration: OutputRegistration, excludePaths: readonly string[], options: Record<string, unknown>) {
  const snapshot: ProjectSnapshot = { root: { path: process.cwd(), identity: 'planning-fixture' },
    complete: true, files: [], excludeNames: [], excluded: [], problems: [], excludePaths };
  const outputs = new Outputs(); outputs.register(registration);
  const opened = outputs.open(registration.id, options, { root: snapshot.root, readSnapshot: async () => snapshot },
    { apply: async () => { throw Error('Pure planning must not write.'); } });
  if (!opened.value) throw Error(JSON.stringify(opened.problems));
  return async (source: string) => {
    const compiled = new Compiler().compile({ source: { sourceId: 'main.expec', text: source }, locator: 'main', dependencies: { modules: [], packages: [] } });
    if (!compiled.value) throw Error(JSON.stringify(compiled));
    let next = 0;
    const current = new SpecificationIdentity(() => 'path-policy-' + ++next).associate(compiled.value);
    if (!current.value) throw Error(JSON.stringify(current));
    return opened.value!.plan({ operation: 'create', current: current.value }, snapshot);
  };
}

function expectConflict(result: Awaited<ReturnType<ReturnType<typeof planner>>>, path: string) {
  expect(result.value).toBeUndefined();
  expect(result.deferred).toEqual([]);
  expect(result.problems).toContainEqual(expect.objectContaining({ code: 'output-conflict', at: expect.objectContaining({ path: expect.arrayContaining([path]) }) }));
}

describe('native output plans respect configured capture boundaries', () => {
  it('refuses a new excluded Java declaration before constructing a native candidate', async () => {
    const plan = planner(javaOutput, ['src/main/java/books'], { package: 'books', directory: 'src/main/java' });
    expectConflict(await plan('type Book { title: Text }'), 'src/main/java/books/Book.java');
  });

  it('returns a located refusal for an excluded generated acceptance module', async () => {
    const plan = planner(acceptanceOutput, ['test/acceptance'], { domain: 'shopping' });
    expectConflict(await plan('examples { example "one": 1 => 1 }'), 'test/acceptance/shopping.test.ts');
  });

  it('refuses an excluded acceptance candidate before native import validation', async () => {
    const plan = planner(acceptanceOutput, ['test/acceptance'], { domain: 'shopping',
      imports: [{ declaration: ['Book'], name: 'Book', from: './book.js' }] });
    expectConflict(await plan('type Book { title: Text }\nexamples { example "one": 1 => 1 }'), 'test/acceptance/shopping.test.ts');
  });

  it('keeps a similarly named acceptance sibling usable', async () => {
    const plan = planner(acceptanceOutput, ['test/acceptance-cache'], { domain: 'shopping' });
    const result = await plan('examples { example "one": 1 => 1 }');
    expect(result.problems).toEqual([]);
    expect(result.value?.changes).toContainEqual(expect.objectContaining({ kind: 'write', path: 'test/acceptance/shopping.test.ts' }));
  });
});
