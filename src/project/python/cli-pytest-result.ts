import { z } from 'zod';

export interface PythonTest { id: string; file: string; name: string; title: string }
const location = { nodeid: z.string(), file: z.string(), line: z.number().int().positive() };
export const pytestReport = z.strictObject({
  collected: z.array(z.strictObject(location)),
  phases: z.array(z.strictObject({ ...location, when: z.enum(['setup', 'call', 'teardown']), outcome: z.enum(['passed', 'failed', 'skipped']),
    xfail: z.boolean(), detail: z.string(), sections: z.array(z.tuple([z.string(), z.string()])) })),
  errors: z.array(z.string()), cancelled: z.boolean(),
});
export type PytestReport = z.infer<typeof pytestReport>;
export const pythonNodeId = (test: PythonTest): string => test.file + '::' + test.name;

/** Only exact, completed native phases establish that the authored cases passed. */
export function pytestOutcome(selected: readonly PythonTest[], report: PytestReport) {
  const path = (file: string) => file.replaceAll('\\', '/');
  const expected = new Map(selected.map(test => [pythonNodeId(test), test]));
  const collected = report.collected.map(site => ({ ...site, ...expected.has(site.nodeid) ? { id: expected.get(site.nodeid)!.id } : {},
    title: expected.get(site.nodeid)?.title ?? site.nodeid }));
  const nodes = new Set([...expected.keys(), ...report.collected.map(site => site.nodeid), ...report.phases.map(phase => phase.nodeid)]);
  const tests = [...nodes].map(nodeid => {
    const test = expected.get(nodeid), phases = report.phases.filter(phase => phase.nodeid === nodeid), sites = collected.filter(site => site.nodeid === nodeid);
    const errors = phases.filter(phase => phase.outcome === 'failed').map(phase => phase.when + ': ' + phase.detail);
    const complete = !!test && sites.length === 1 && path(sites[0]!.file) === test.file && phases.length === 3
      && ['setup', 'call', 'teardown'].every(when => phases.filter(phase => phase.when === when).length === 1)
      && phases.every(phase => path(phase.file) === test.file && phase.line === sites[0]!.line);
    const passed = complete && phases.every(phase => phase.outcome === 'passed' && !phase.xfail);
    return { ...test ? { id: test.id } : {}, nodeid, file: test?.file ?? sites[0]?.file ?? phases[0]?.file ?? '',
      title: test?.title ?? nodeid, ...(sites[0] ? { line: sites[0].line } : {}),
      state: errors.length ? 'failed' : passed ? 'passed' : phases.some(phase => phase.xfail) ? 'xfail'
        : phases.some(phase => phase.outcome === 'skipped') ? 'skipped' : 'incomplete', errors, phases };
  });
  return { collected, tests, errors: report.errors,
    passed: !!selected.length && expected.size === selected.length && new Set(selected.map(test => test.id)).size === selected.length
      && !report.cancelled && !report.errors.length && collected.length === selected.length
      && tests.length === selected.length && tests.every(test => test.state === 'passed') };
}
