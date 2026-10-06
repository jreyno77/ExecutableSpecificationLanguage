import { describe, expect, it } from 'vitest';
import { testsPassed, type NativeReport, type SelectedTest } from '../../../src/cli/cli-test-result.js';
const selected: SelectedTest[] = [{ id: 'dune', file: 'test/shopping.test.ts', title: 'add Dune', line: 4, column: 1, version: 'captured' }];
function passing(): NativeReport { return { collected: [{ ...selected[0]! }], tests: [{ ...selected[0]!, state: 'passed', errors: [], retryCount: 0, repeatCount: 0 }], errors: [], problems: [], cancelled: false }; }
describe('confirming the exact native execution', () => {
  it('accepts one actual passing observation for the selected callback', () => { expect(testsPassed(selected, passing())).toBe(true); });
  it('retains an unselected skipped neighbor without claiming it was executed', () => {
    const report = passing(); const neighbor = { file: 'test/shopping.test.ts', title: 'neighbor', line: 8, column: 1 };
    report.collected.push(neighbor); report.tests.push({ ...neighbor, state: 'skipped', errors: [], retryCount: 0, repeatCount: 0 });
    expect(testsPassed(selected, report)).toBe(true);
  });
  it('refuses a second failed observation carrying the selected identity', () => {
    const report = passing(); report.tests.push({ ...report.tests[0]!, state: 'failed', errors: ['actual failure'] });
    expect(testsPassed(selected, report)).toBe(false);
  });
  it('refuses an unexpected executed case instead of hiding its native failure', () => {
    const report = passing(); report.tests.push({ file: 'test/shopping.test.ts', title: 'unexpected', state: 'failed', errors: ['actual failure'] });
    expect(testsPassed(selected, report)).toBe(false);
  });
  it('refuses an unexpected passing case too', () => {
    const report = passing(); report.tests.push({ file: 'test/shopping.test.ts', title: 'unexpected', state: 'passed', errors: [] });
    expect(testsPassed(selected, report)).toBe(false);
  });
  it('does not erase errors retained on a nominally passing case', () => {
    const report = passing(); report.tests[0]!.errors.push('first attempt failed'); expect(testsPassed(selected, report)).toBe(false);
  });
  it('refuses native retry evidence', () => { const report = passing(); report.tests[0]!.retryCount = 1; expect(testsPassed(selected, report)).toBe(false); });
  it('refuses native repeat evidence', () => { const report = passing(); report.tests[0]!.repeatCount = 1; expect(testsPassed(selected, report)).toBe(false); });
  it('requires one collected callback at the captured location', () => {
    const report = passing(); report.collected[0]!.line = 9; expect(testsPassed(selected, report)).toBe(false);
  });
  it('refuses duplicate collection even if execution reported one pass', () => {
    const report = passing(); report.collected.push({ ...report.collected[0]! }); expect(testsPassed(selected, report)).toBe(false);
  });
  it('refuses a claimed identity at another execution location', () => {
    const report = passing(); report.tests[0]!.column = 9; expect(testsPassed(selected, report)).toBe(false);
  });
  it('requires actual zero counters and never guesses absent native diagnostics', () => {
    const report = passing(); delete report.tests[0]!.retryCount; expect(testsPassed(selected, report)).toBe(false);
  });
  it('requires a selected case instead of treating an empty invocation as passing', () => {
    const report = passing(); report.tests = []; report.collected = []; expect(testsPassed([], report)).toBe(false);
  });
  it('refuses retry evidence on an unselected nominally skipped neighbor', () => {
    const report = passing(), neighbor = { file: 'test/shopping.test.ts', title: 'neighbor', line: 8, column: 1 };
    report.collected.push(neighbor); report.tests.push({ ...neighbor, state: 'skipped', errors: [], retryCount: 1, repeatCount: 0 });
    expect(testsPassed(selected, report)).toBe(false);
  });
  it('refuses repeat evidence on an unselected nominally skipped neighbor', () => {
    const report = passing(), neighbor = { file: 'test/shopping.test.ts', title: 'neighbor', line: 8, column: 1 };
    report.collected.push(neighbor); report.tests.push({ ...neighbor, state: 'skipped', errors: [], retryCount: 0, repeatCount: 1 });
    expect(testsPassed(selected, report)).toBe(false);
  });

});
