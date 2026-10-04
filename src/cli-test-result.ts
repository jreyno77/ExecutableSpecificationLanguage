import { z } from 'zod';
export interface SelectedTest { id: string; file: string; title: string; line: number; column: number; version: string }
const site = { id: z.string().optional(), file: z.string(), title: z.string(), line: z.number().optional(), column: z.number().optional() };
export const nativeReport = z.strictObject({
  collected: z.array(z.object(site)),
  tests: z.array(z.object({ ...site, state: z.string(), errors: z.array(z.unknown()), retryCount: z.number().optional(), repeatCount: z.number().optional() })),
  errors: z.array(z.unknown()), problems: z.array(z.object({ code: z.string(), message: z.string() })), cancelled: z.boolean(),
});
export type NativeReport = z.infer<typeof nativeReport>;
/** Only complete native observations can establish that the requested cases passed. */
export function testsPassed(selected: readonly SelectedTest[], report: NativeReport): boolean {
  const same = (a: { id?: string | undefined; file: string; title: string; line?: number | undefined; column?: number | undefined }, b: typeof a) =>
    a.id === b.id && a.file === b.file && a.title === b.title && a.line === b.line && a.column === b.column;
  return !!selected.length && new Set(selected.map(item => item.id)).size === selected.length
    && !report.cancelled && !report.errors.length && !report.problems.length
    && selected.every(item => report.collected.filter(at => same(at, item)).length === 1
      && report.tests.filter(test => same(test, item)).length === 1)
    && report.tests.every(test => report.collected.filter(at => same(at, test)).length === 1
      && !test.errors.length && (test.id === undefined ? test.state === 'skipped' && !test.retryCount && !test.repeatCount
        : selected.some(item => same(item, test)) && test.state === 'passed' && test.retryCount === 0 && test.repeatCount === 0))
    && report.tests.every(test => report.tests.filter(other => same(test, other)).length === 1);
}
