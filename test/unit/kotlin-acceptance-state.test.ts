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
