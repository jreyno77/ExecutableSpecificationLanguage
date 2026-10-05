import { describe, expect, it } from 'vitest';
import { cliProfile } from '../../src/cli/cli-profile.js';
import type { Configuration } from '../../src/project/connection/configuration.js';

function configured(outputs: Configuration['outputs'], names: readonly string[] = []): Configuration {
  return { sourceId: 'file:///workspace/expec.json', formatVersion: 1, version: '1.0.0', build: { entries: ['main.expec'] },
    outputs, libraries: [], packages: names.map((name, index) => ({ alias: 'dependency' + index, name, version: '1.0.0', phases: ['runtime'] })) };
}
describe('choosing the connected CLI target', () => {
  it('selects Python alongside a documentation output', () => {
    const result = cliProfile(configured([{ id: 'python', options: {} }, { id: 'python-acceptance', options: {} }, { id: 'markdown', options: {} }], ['pypi:pytest']));
    expect(result).toEqual({ value: { target: 'python', configFile: 'expec.python.json' }, problems: [], deferred: [] });
  });
  it('uses the one explicit Python configuration without changing the request', () => {
    const configuration = configured([{ id: 'python', options: { configFile: 'native/python.json' } }, { id: 'python-acceptance', options: { configFile: 'native/python.json' } }]);
    const before = structuredClone(configuration);
    expect(cliProfile(configuration).value).toEqual({ target: 'python', configFile: 'native/python.json' });
    expect(configuration).toEqual(before);
  });
  it('recognizes an explicit default as the same Python configuration', () => {
    expect(cliProfile(configured([{ id: 'python', options: {} }, { id: 'python-acceptance', options: { configFile: 'expec.python.json' } }])).value)
      .toEqual({ target: 'python', configFile: 'expec.python.json' });
  });
  it('refuses two different Python configuration files at the conflicting option', () => {
    const result = cliProfile(configured([{ id: 'python', options: {} }, { id: 'python-acceptance', options: { configFile: 'other.json' } }]));
    expect(result.value).toBeUndefined();
    expect(result.problems).toMatchObject([{ code: 'conflicting-native-profile', at: { path: ['manifest', 'file:///workspace/expec.json', 'outputs', 1, 'options', 'configFile'] } }]);
  });
  it('refuses to choose between Python and TypeScript', () => {
    const result = cliProfile(configured([{ id: 'python', options: {} }, { id: 'acceptance', options: {} }]));
    expect(result.value).toBeUndefined();
    expect(result.problems).toMatchObject([{ code: 'conflicting-native-profile', at: { path: ['manifest', 'file:///workspace/expec.json', 'outputs', 1, 'id'] } }]);
  });
  it('refuses npm packages in the selected Python profile', () => {
    const result = cliProfile(configured([{ id: 'python', options: {} }], ['npm:typescript']));
    expect(result.value).toBeUndefined();
    expect(result.problems).toMatchObject([{ code: 'unsupported-package-ecosystem', at: { path: ['manifest', 'file:///workspace/expec.json', 'packages', 0, 'name'] } }]);
  });
  it('does not infer a Python target from an unselected pypi requirement', () => {
    const result = cliProfile(configured([{ id: 'markdown', options: {} }], ['pypi:pytest']));
    expect(result.value).toBeUndefined();
    expect(result.problems).toMatchObject([{ code: 'unsupported-native-profile' }]);
  });
  it('preserves documentation-only npm acquisition without inventing an output', () => {
    expect(cliProfile(configured([{ id: 'markdown', options: {} }], ['npm:typescript'])))
      .toEqual({ value: {}, problems: [], deferred: [] });
  });
  it('preserves an empty output selection without packages', () => {
    expect(cliProfile(configured([]))).toEqual({ value: {}, problems: [], deferred: [] });
  });
  it('retains independently configured TypeScript contract and acceptance outputs', () => {
    expect(cliProfile(configured([{ id: 'typescript', options: { configFile: 'tsconfig.main.json' } }, { id: 'acceptance', options: { configFile: 'tsconfig.test.json' } }], ['npm:vitest'])))
      .toEqual({ value: { target: 'typescript' }, problems: [], deferred: [] });
  });
  it('selects Java and its explicitly configured Maven input', () => {
    expect(cliProfile(configured([{ id: 'java', options: { configFile: 'native/java.json' } }, { id: 'java-acceptance', options: { configFile: 'native/java.json' } }], ['maven:org.junit.jupiter:junit-jupiter'])).value)
      .toEqual({ target: 'java', configFile: 'native/java.json' });
  });
  it('selects the fixed Kotlin native configuration', () => {
    expect(cliProfile(configured([{ id: 'kotlin', options: {} }, { id: 'kotlin-acceptance', options: {} }], ['maven:org.junit.jupiter:junit-jupiter'])).value)
      .toEqual({ target: 'kotlin', configFile: 'expec.kotlin.json' });
  });
  it('does not guess Java or Kotlin from an unselected Maven requirement', () => {
    const result = cliProfile(configured([], ['maven:org.junit.jupiter:junit-jupiter']));
    expect(result.value).toBeUndefined(); expect(result.problems).toMatchObject([{ code: 'unsupported-native-profile' }]);
  });
});
