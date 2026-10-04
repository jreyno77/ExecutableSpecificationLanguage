import { describe, expect, it } from 'vitest';
import { JavaContext, JavaProject, javaAcceptanceOutput, javaOutput, type ProjectContext } from '../../src/index.js';

const project: ProjectContext = { root: { path: 'unused', identity: 'fixture' }, readSnapshot: async () => {
  throw new Error('Constructor validation cannot capture the project.');
} };
describe('Java caller options', () => {
  it('rejects an accidental ambient configuration lookup', () => {
    expect(() => new JavaContext(project, { configFile: '../expec.java.json' })).toThrow(TypeError);
  });
  it('requires an output namespace for native questions', () => {
    expect(() => new JavaProject({ outputId: '' }, [])).toThrow(TypeError);
  });
  it('rejects an unreviewed native compiler option', () => {
    expect(javaOutput.validate({ package: 'store', compilerFlags: ['-proc:full'] })).toEqual([
      expect.objectContaining({ path: ['compilerFlags'] }),
    ]);
  });
  it('requires a readable acceptance domain', () => {
    expect(javaAcceptanceOutput.validate({ package: 'store.tests' })).toEqual([
      expect.objectContaining({ path: ['domain'] }),
    ]);
  });
});
