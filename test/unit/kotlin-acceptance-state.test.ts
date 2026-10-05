import { expect, it, onTestFinished } from 'vitest';
import { KotlinAcceptanceDriver } from '../driver/kotlin-acceptance.js';

it('refuses incomplete saved source eligibility instead of creating a changed expectation', async () => {
  const project = new KotlinAcceptanceDriver(); onTestFinished(() => project.dispose());
  await project.prepare();
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 1 }');
  await project.generate(); expect(project.written.problems).toEqual([]);
  const test = 'src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt';
  const before = project.files.get(test);
  const path = '.expec/outputs/6b6f746c696e2d616363657074616e6365.json';
  const recorded = JSON.parse(project.files.get(path)!);
  recorded.contracts = [];
  await project.file(path, JSON.stringify(recorded));
  project.source('examples { observation quantity() returns Number\nexample "one copy": quantity() => 2 }');
  await project.generate();
  expect(project.written.problems.map(item => item.code)).toContain('invalid-output-state');
  expect(project.written.receipt).toBeUndefined();
  expect(project.files.get(test)).toBe(before);
}, 180_000);
it('does not trust an old version when supplied test bytes remove the assertion', async () => {
  const project = new KotlinAcceptanceDriver(); onTestFinished(() => project.dispose());
  await project.prepare(); project.source('examples { example "one copy": 1 => 1 }');
  await project.generate(); expect(project.written.problems).toEqual([]);
  const assertion = await project.comparisonCall('one copy');
  const captured = await project.context.readSnapshot(), path = 'src/test/kotlin/store/tests/acceptance/ShoppingAcceptance.kt';
  const before = captured.files.find(file => file.path === path)!;
  const text = Buffer.from(before.bytes).toString('utf8');
  expect(assertion.text).toContain('(1.0, 1.0)'); expect(text).toContain(assertion.text);
  const changed = { ...captured, files: captured.files.map(file => file.path === path ? { ...file,
    bytes: Buffer.from(text.replace(assertion.text, 'println("missing assertion")')) } : file) };
  const example = [...project.current.specification.inspection.query('example')][0]!;
  const { kotlinAcceptanceOutput } = await import('../../src/index.js');
  const result = await kotlinAcceptanceOutput.open({ package: 'store.tests', domain: 'shopping' }).read(project.current.id(example.id), changed);
  expect(result.coverage.complete).toBe(false);
  expect(result.problems.map(item => item.code)).toContain('output-conflict');
}, 120_000);
it('distinguishes an unknown acceptance identity from a previously removed case', async () => {
  const project = new KotlinAcceptanceDriver(); onTestFinished(() => project.dispose());
  await project.prepare(); project.source('examples { example "one copy": 1 => 1 }');
  await project.generate(); expect(project.written.problems).toEqual([]);
  const before = new Map(project.files);
  const result = await project.output.delete('never-owned');
  expect(result.problems.map(item => item.code)).toContain('not-found');
  expect(result.receipt).toBeUndefined();
  expect(await project.capturedFiles()).toEqual(before);
}, 90_000);
