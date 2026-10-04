import { afterEach, describe, expect, it } from 'vitest';
import { KotlinDeliveryDriver } from '../driver/kotlin-delivery.js';
import { kotlinOutput, SpecificationIdentity } from '../../src/index.js';

const fixtures: KotlinDeliveryDriver[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.dispose(); });
async function project() {
  const fixture = new KotlinDeliveryDriver(); fixtures.push(fixture);
  await fixture.initialize(); await fixture.configureNative(); fixture.source('class StoreGame {}');
  return fixture;
}
const adapter = () => kotlinOutput.open({ package: 'store' });

describe('Kotlin output ownership and transition contracts', () => {
  it('requires native input evidence before planning project mutations', async () => {
    const fixture = await project(), captured = await fixture.context.readSnapshot();
    const result = await adapter().plan({ operation: 'create', current: fixture.current }, { ...captured, nativeInputs: [] });
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('native-inputs-unavailable');
  }, 30_000);

  it('rejects a diff referring to an identity outside the current specification', async () => {
    const fixture = await project();
    const result = await adapter().plan({ operation: 'update', current: fixture.current,
      diff: { changes: [], affected: ['not-a-subject'], contextChanged: false } }, await fixture.context.readSnapshot());
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('inconsistent-diff');
  }, 60_000);

  it('does not reset established output ownership through a fresh identity baseline', async () => {
    const fixture = await project(); await fixture.build();
    let id = 0;
    const reset = new SpecificationIdentity(() => 'reset-' + ++id).associate(fixture.current.specification);
    expect(reset.problems).toEqual([]);
    const result = await adapter().plan({ operation: 'create', current: reset.value! }, await fixture.context.readSnapshot());
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('unknown-output-identity');
  }, 30_000);

  it('keeps insert limited to additions when an existing class is renamed', async () => {
    const fixture = await project(); await fixture.build();
    fixture.source('class SavedGame {}', { StoreGame: 'SavedGame' });
    const result = await adapter().plan({ operation: 'insert', current: fixture.current, diff: fixture.diff }, await fixture.context.readSnapshot());
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('not-addition-only');
  }, 60_000);

  it('repeats create without replacing a handwritten implementation of unchanged contracts', async () => {
    const fixture = await project();
    fixture.source('class StoreGame { public save\ncapability save() returns Text }'); await fixture.build();
    await fixture.replace('src/main/kotlin/store/StoreGame.kt', 'throw NotImplementedError("Not implemented: StoreGame.save")', 'return "saved"');
    const result = await adapter().plan({ operation: 'create', current: fixture.current }, await fixture.context.readSnapshot());
    expect(result.problems).toEqual([]);
    expect(result.value?.changes).toEqual([]);
  }, 60_000);
});

it('does not claim an unchanged output when its generated file is missing', async () => {
  const fixture = await project(); await fixture.build();
  const { promises: fs } = await import('node:fs');
  const { join } = await import('node:path');
  await fs.unlink(join(fixture.root, 'src/main/kotlin/store/StoreGame.kt'));
  const result = await adapter().plan({ operation: 'create', current: fixture.current }, await fixture.context.readSnapshot());
  expect(result.problems.map(problem => problem.code)).toContain('output-conflict');
  expect(result.value).toBeUndefined();
}, 60_000);

it('reports malformed saved options without throwing from planning or inspection', async () => {
  const fixture = await project(); await fixture.build();
  const path = '.expec/outputs/6b6f746c696e.json';
  const stored = JSON.parse(fixture.files.get(path)!); stored.options = '{';
  await fixture.file(path, JSON.stringify(stored));
  const captured = await fixture.context.readSnapshot();
  const result = await adapter().plan({ operation: 'create', current: fixture.current }, captured);
  expect(result.value).toBeUndefined();
  expect(result.problems.map(problem => problem.code)).toContain('invalid-output-state');
  const id = fixture.subject(fixture.current, 'StoreGame');
  const read = await adapter().read(id, captured), search = await adapter().search(id, captured);
  expect(read.coverage.complete).toBe(false);
  expect(read.problems.map(problem => problem.code)).toContain('invalid-output-state');
  expect(search.incoming.coverage.complete).toBe(false);
  expect(search.problems.map(problem => problem.code)).toContain('invalid-output-state');
}, 60_000);

it('does not trust malformed native associations from its saved ownership file', async () => {
  const fixture = await project(); await fixture.build();
  const path = '.expec/outputs/6b6f746c696e.json';
  const stored = JSON.parse(fixture.files.get(path)!);
  stored.files[0].artifacts[0].locator.value.declaration = [{ kind: 'class', name: 'StoreGame', fabricated: true }];
  await fixture.file(path, JSON.stringify(stored));
  const result = await adapter().plan({ operation: 'create', current: fixture.current }, await fixture.context.readSnapshot());
  expect(result.value).toBeUndefined();
  expect(result.problems.map(problem => problem.code)).toContain('invalid-output-state');
}, 60_000);
