import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Configuration } from '../../../../src/project/connection/configuration.js';
import type { ProjectSnapshot } from '../../../../src/project/connection/project-connection.js';
import { initialConfiguration } from '../../../../src/project/typescript/initialization-profile.js';
import { validateSnapshot } from '../../../../src/project/typescript/typescript-capture.js';
import { javaSnapshot } from '../../../../src/project/java/java-settings.js';
import { kotlinConfiguration } from '../../../../src/project/kotlin/kotlin-configuration.js';
import { pythonConfiguration } from '../../../../src/project/python/python-profile.js';
import { ListDocuments } from '../../../../src/project/output/output-documents.js';
import { checkPlan } from '../../../../src/project/output/output-contract.js';

const configuration = { sourceId: 'settings', formatVersion: 1, version: '1.0.0', build: { entries: ['main.expec'] },
  outputs: [], libraries: [], packages: [], project: { root: 'old', excludePaths: ['dist', 'generation/tooling'] } } satisfies Configuration;
function snapshot(): ProjectSnapshot {
  return { root: { path: process.cwd(), identity: 'supplied' }, complete: true, files: [],
    excludeNames: ['node_modules'], excluded: [], problems: [] };
}
function file(path: string) {
  const bytes = Buffer.from('export {};');
  return { path, bytes, version: createHash('sha256').update(bytes).digest('hex') };
}
function planAt(basedOn: ProjectSnapshot, path: string) {
  return { value: { outputId: 'typescript', basedOn, changes: [{ kind: 'write' as const, path, bytes: Buffer.from('new') }], artifacts: [] }, problems: [], deferred: [] };
}

describe('capture path policy at output and native boundaries', () => {
  it('preserves the selected artifact folders when preparing a TypeScript starter', () => {
    const prepared = initialConfiguration(configuration, 'new-project');
    expect(prepared.project).toEqual({ root: 'new-project', excludePaths: ['dist', 'generation/tooling'] });
    expect(configuration.project.root).toBe('old');
  });
  it('refuses an output plan that writes a future excluded destination', () => {
    const captured = { ...snapshot(), excludePaths: ['generation/tooling'] };
    expect(() => checkPlan(planAt(captured, 'generation/tooling/new.ts'), captured, 'typescript')).toThrow(TypeError);
  });
  it('refuses an output endpoint replacing the parent of a future excluded path', () => {
    const captured = { ...snapshot(), excludePaths: ['generation/tooling'] };
    expect(() => checkPlan(planAt(captured, 'generation'), captured, 'typescript')).toThrow(TypeError);
  });
  it('keeps a similarly named sibling writable', () => {
    const captured = { ...snapshot(), excludePaths: ['generation/tooling'] };
    expect(() => checkPlan(planAt(captured, 'generation/tooling-notes/new.ts'), captured, 'typescript')).not.toThrow();
  });
  it('rejects a supplied TypeScript snapshot contradicting its declared path policy', () => {
    const captured = { ...snapshot(), excludePaths: ['dist'], files: [file('dist/book.ts')] };
    expect(() => validateSnapshot(captured)).toThrow(TypeError);
  });
  it('rejects a supplied Java snapshot contradicting its declared path policy', () => {
    const captured = { ...snapshot(), excludePaths: ['dist'], files: [file('dist/Book.java')] };
    expect(() => javaSnapshot(captured)).toThrow(TypeError);
  });
  it('retains installed read-only declarations beneath an excluded editable folder', () => {
    const captured = { ...snapshot(), excludePaths: ['node_modules/catalog'], readOnlyFiles: [file('node_modules/catalog/index.d.ts')] };
    expect(() => validateSnapshot(captured)).not.toThrow();
    expect(() => javaSnapshot(captured)).not.toThrow();
  });
  it('reports malformed policy before reading Kotlin or Python configuration', () => {
    const captured = { ...snapshot(), excludePaths: ['../outside'] };
    expect(kotlinConfiguration(captured, 'expec.kotlin.json').problems.map(problem => problem.code)).toEqual(['invalid-project-snapshot']);
    expect(pythonConfiguration(captured).problems.map(problem => problem.code)).toEqual(['invalid-project-snapshot']);
  });
  it('reports the unobserved path policy separately from encountered witnesses in document scope', () => {
    const captured = { ...snapshot(), excludePaths: ['dist'] };
    const documents = new ListDocuments('structure', 'structure', captured);
    expect(documents.scope[0]!.value).toMatchObject({ excludePaths: ['dist'], excluded: [] });
  });
  it('rejects a supplied empty path field instead of changing legacy snapshot identity', () => {
    const captured = { ...snapshot(), excludePaths: [] };
    expect(() => validateSnapshot(captured)).toThrow(TypeError);
    expect(() => javaSnapshot(captured)).toThrow(TypeError);
  });
});
