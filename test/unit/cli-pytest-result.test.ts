import { describe, expect, it } from 'vitest';
import { pytestOutcome, type PytestReport } from '../../src/cli-pytest-result.js';

const selected = [{ id: 'dune', file: 'test/acceptance/test_shopping.py', name: 'test_add_book', title: 'a shopper adds Dune' }];
function completed(): PytestReport {
  const at = { nodeid: 'test/acceptance/test_shopping.py::test_add_book', file: 'test/acceptance/test_shopping.py', line: 8 };
  return { collected: [at], phases: ['setup', 'call', 'teardown'].map(when => ({ ...at, when: when as 'setup' | 'call' | 'teardown',
    outcome: 'passed', xfail: false, detail: '', sections: [] })), errors: [], cancelled: false };
}
describe('the CLI interprets native pytest phases', () => {
  it('accepts one exact collected case only after setup, call and cleanup all pass', () => {
    const outcome = pytestOutcome(selected, completed());
    expect(outcome.passed).toBe(true);
    expect(outcome.tests).toContainEqual(expect.objectContaining({ id: 'dune', title: 'a shopper adds Dune', state: 'passed', errors: [] }));
  });
  it('retains call and cleanup failures as independent causes', () => {
    const report = completed();
    Object.assign(report.phases[1]!, { outcome: 'failed', detail: 'Expected 1, actual 2' });
    Object.assign(report.phases[2]!, { outcome: 'failed', detail: 'Socket cleanup failed' });
    const outcome = pytestOutcome(selected, report);
    expect(outcome.passed).toBe(false);
    expect(outcome.tests[0]?.errors).toEqual(['call: Expected 1, actual 2', 'teardown: Socket cleanup failed']);
  });
  it('does not call setup and cleanup without a call a passing case', () => {
    const report = completed(); report.phases.splice(1, 1);
    const outcome = pytestOutcome(selected, report); expect(outcome.passed).toBe(false);
    expect(outcome.tests[0]?.state).toBe('incomplete');
  });
  it('does not accept duplicate calls, even when both passed', () => {
    const report = completed(); report.phases.push({ ...report.phases[1]! });
    expect(pytestOutcome(selected, report).passed).toBe(false);
  });
  it('does not hide an unexpected executed case from the report', () => {
    const report = completed(), nodeid = 'test/acceptance/test_shopping.py::test_other';
    report.collected.push({ ...report.collected[0]!, nodeid });
    report.phases.push({ ...report.phases[1]!, nodeid, outcome: 'failed', detail: 'Unexpected application call' });
    const outcome = pytestOutcome(selected, report); expect(outcome.passed).toBe(false);
    expect(outcome.tests).toContainEqual(expect.objectContaining({ nodeid, state: 'failed', errors: ['call: Unexpected application call'] }));
  });
  it('refuses xpass as well as skipped and xfailed calls', () => {
    const report = completed(); report.phases[1]!.xfail = true;
    expect(pytestOutcome(selected, report).passed).toBe(false);
    report.phases[1]!.outcome = 'skipped'; expect(pytestOutcome(selected, report).passed).toBe(false);
    report.phases[1]!.xfail = false; expect(pytestOutcome(selected, report).passed).toBe(false);
  });
  it('does not claim success after collection error, cancellation, or zero collection', () => {
    const report = completed(); report.errors.push('ImportError: fixture unavailable');
    expect(pytestOutcome(selected, report).passed).toBe(false);
    report.errors = []; report.cancelled = true; expect(pytestOutcome(selected, report).passed).toBe(false);
    report.cancelled = false; report.collected = []; expect(pytestOutcome(selected, report).passed).toBe(false);
  });
  it('retains native output sections even for passing calls', () => {
    const report = completed(); report.phases[1]!.sections = [['Captured stdout call', 'Quantity observed: 1\n']];
    expect(pytestOutcome(selected, report).tests[0]?.phases[1]?.sections).toEqual([['Captured stdout call', 'Quantity observed: 1\n']]);
  });
  it('does not accept a phase attributed to a different native file', () => {
    const report = completed(); report.phases[1]!.file = 'test/other.py';
    expect(pytestOutcome(selected, report).passed).toBe(false);
  });
});
