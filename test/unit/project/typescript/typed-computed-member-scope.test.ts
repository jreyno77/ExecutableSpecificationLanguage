import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TypeScriptProject, type ArtifactAssociation, type ProjectSearch, type ProjectSnapshot } from '../../../../src/index.js';

type NativeSelector = { kind: string; name: string; static?: boolean };
const content = [{ kind: 'type', name: 'OutputTab' }, { kind: 'property', name: 'content' }];
const numericMembers = 'export type OutputTab = { "0": string; "-1": string; "1.5": string; "1e3": string; NaN: string; Infinity: string; "-Infinity": string };';

/** The query consumer supplies exact captured bytes; the actual native checker supplies all reference facts. */
function search(lookup: string, declaration: NativeSelector[] = content, model = 'export type OutputTab = { content: string };'): ProjectSearch {
  const sources = { 'model.ts': model, 'lookup.ts': lookup };
  const snapshot: ProjectSnapshot = { root: { path: process.cwd(), identity: 'typed-computed-example' }, complete: true,
    problems: [], excludeNames: [], excluded: [], files: Object.entries(sources).map(([path, text]) => {
      const bytes = Buffer.from(text); return { path, bytes, version: createHash('sha256').update(bytes).digest('hex') };
    }) };
  const association: ArtifactAssociation = { specId: 'selected', locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file: 'model.ts', declaration } } };
  return new TypeScriptProject({ outputId: 'typescript' }, [association]).search('selected', snapshot);
}
function expectComputedUncertainty(result: ProjectSearch, source: string, expression: string, direction: 'incoming' | 'outgoing' = 'incoming', file = 'lookup.ts'): void {
  const start = source.indexOf(expression); expect(start).toBeGreaterThanOrEqual(0);
  expect(result[direction].unresolved).toContainEqual(expect.objectContaining({ reason: 'Computed member lookup has no unique static target.',
    at: expect.objectContaining({ format: 'typescript-site-1', value: expect.objectContaining({ file, start, end: start + expression.length, role: 'unresolved' }) }) }));
  expect(result[direction].coverage.complete).toBe(false);
}
function expectCompleteIncoming(result: ProjectSearch): void {
  expect(result.problems).toEqual([]); expect(result.definitions).toHaveLength(1);
  expect(result.incoming.uses).toEqual([]); expect(result.incoming.unresolved).toEqual([]);
  expect(result.incoming.coverage.complete).toBe(true); expect(result.incoming.coverage.limitations).toEqual([]);
}

describe('computed numeric array keys cannot select unrelated named members', () => {
  it('excludes a numeric array access from a named field incoming scope', () => {
    const result = search('export const lookup = (values: number[], index: number) => values[index];');
    expectCompleteIncoming(result);
  });
  it('excludes a readonly numeric array access from a named field incoming scope', () => {
    const result = search('export const lookup = (values: readonly number[], index: number) => values[index];');
    expectCompleteIncoming(result);
  });
  it('excludes numeric literal union indexing of a readonly tuple from a named field incoming scope', () => {
    const result = search('export const lookup = (values: readonly [number, string], index: 0 | 1) => values[index];');
    expectCompleteIncoming(result);
  });
  it('retains a computed lookup when the receiver is any', () => {
    const source = 'export const lookup = (values: any, index: number) => values[index];';
    expectComputedUncertainty(search(source), source, 'values[index]');
  });
  it('retains a computed lookup and native errors when the receiver is unknown', () => {
    const source = 'export const lookup = (values: unknown, index: number) => values[index];', result = search(source);
    expectComputedUncertainty(result, source, 'values[index]');
    expect(result.problems.map(problem => problem.code)).toContain('typescript-18046');
  });
  it('retains a computed lookup when the key is any', () => {
    const source = 'export const lookup = (values: number[], index: any) => values[index];';
    expectComputedUncertainty(search(source), source, 'values[index]');
  });
  it('retains a computed lookup and native errors when the key is unknown', () => {
    const source = 'export const lookup = (values: number[], index: unknown) => values[index];', result = search(source);
    expectComputedUncertainty(result, source, 'values[index]');
    expect(result.problems.map(problem => problem.code)).toContain('typescript-2538');
  });
  it('retains a computed lookup when the key is string', () => {
    const source = 'export const lookup = (values: number[], index: string) => values[index];';
    expectComputedUncertainty(search(source), source, 'values[index]');
  });
  it('retains a computed lookup when a mixed key can name content', () => {
    const source = 'export const lookup = (values: number[], index: number | "content") => values[index];';
    expectComputedUncertainty(search(source), source, 'values[index]');
  });
  it('does not normalize a numeric generic constraint into a proved key type', () => {
    const source = 'export function lookup<K extends number>(values: number[], index: K) { return values[index]; }';
    expectComputedUncertainty(search(source), source, 'values[index]');
  });
  it('does not normalize a generic array constraint into a proved receiver', () => {
    const source = 'export function lookup<T extends readonly number[]>(values: T, index: number) { return values[index]; }';
    expectComputedUncertainty(search(source), source, 'values[index]');
  });
  it('retains a computed lookup on an intersection receiver', () => {
    const source = 'export const lookup = (values: number[] & { content: string }, index: number) => values[index];';
    expectComputedUncertainty(search(source), source, 'values[index]');
  });
  it('retains a computed lookup on a non-array numeric-indexed record', () => {
    const source = 'export const lookup = (values: { [key: number]: number }, index: number) => values[index];';
    expectComputedUncertainty(search(source), source, 'values[index]');
  });
  it('retains a computed lookup on a mixed array and record receiver', () => {
    const source = 'export const lookup = (values: number[] | { [key: number]: number; content: string }, index: number) => values[index];';
    expectComputedUncertainty(search(source), source, 'values[index]');
  });
  it('retains numeric array uncertainty when the selected member is zero', () => {
    const source = 'export const lookup = (values: number[], index: number) => values[index];';
    expectComputedUncertainty(search(source, [{ kind: 'type', name: 'OutputTab' }, { kind: 'property', name: '0' }], numericMembers), source, 'values[index]');
  });
  it('retains numeric array uncertainty when the selected member is negative', () => {
    const source = 'export const lookup = (values: number[], index: number) => values[index];';
    expectComputedUncertainty(search(source, [{ kind: 'type', name: 'OutputTab' }, { kind: 'property', name: '-1' }], numericMembers), source, 'values[index]');
  });
  it('retains numeric array uncertainty when the selected member is fractional', () => {
    const source = 'export const lookup = (values: number[], index: number) => values[index];';
    expectComputedUncertainty(search(source, [{ kind: 'type', name: 'OutputTab' }, { kind: 'property', name: '1.5' }], numericMembers), source, 'values[index]');
  });
  it('retains numeric array uncertainty when the selected member has an exponent name', () => {
    const source = 'export const lookup = (values: number[], index: number) => values[index];';
    expectComputedUncertainty(search(source, [{ kind: 'type', name: 'OutputTab' }, { kind: 'property', name: '1e3' }], numericMembers), source, 'values[index]');
  });
  it('retains numeric array uncertainty when the selected member is NaN', () => {
    const source = 'export const lookup = (values: number[], index: number) => values[index];';
    expectComputedUncertainty(search(source, [{ kind: 'type', name: 'OutputTab' }, { kind: 'property', name: 'NaN' }], numericMembers), source, 'values[index]');
  });
  it('retains numeric array uncertainty when the selected member is Infinity', () => {
    const source = 'export const lookup = (values: number[], index: number) => values[index];';
    expectComputedUncertainty(search(source, [{ kind: 'type', name: 'OutputTab' }, { kind: 'property', name: 'Infinity' }], numericMembers), source, 'values[index]');
  });
  it('retains numeric array uncertainty when the selected member is negative Infinity', () => {
    const source = 'export const lookup = (values: number[], index: number) => values[index];';
    expectComputedUncertainty(search(source, [{ kind: 'type', name: 'OutputTab' }, { kind: 'property', name: '-Infinity' }], numericMembers), source, 'values[index]');
  });
  it('does not infer named member scope from the selected whole type', () => {
    const source = 'export const lookup = (values: number[], index: number) => values[index];';
    expectComputedUncertainty(search(source, [{ kind: 'type', name: 'OutputTab' }]), source, 'values[index]');
  });
  it('retains the outgoing computed observation within a selected method', () => {
    const source = 'export class Reader { read(values: number[], index: number) { return values[index]; } }';
    const result = search('', [{ kind: 'class', name: 'Reader' }, { kind: 'method', name: 'read', static: false }], source);
    expectComputedUncertainty(result, source, 'values[index]', 'outgoing', 'model.ts');
  });
});
