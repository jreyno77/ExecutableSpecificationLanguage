import { describe, expect, it } from 'vitest';
import { ConfigurationReader } from '../../../../src/project/connection/configuration.js';
import { javaStarter } from '../../../../src/project/java/java-initialization.js';

describe('capture policy in a Java starter', () => {
  it('preserves configured artifact boundaries when choosing a new Java project root', async () => {
    const read = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({ formatVersion: 1, version: '0.1.0',
      project: { root: 'old', excludePaths: ['dist', 'generation/tooling'] }, build: { entries: ['book.expec'] } }) });
    if (!read.value) throw Error(JSON.stringify(read.problems));
    const before = structuredClone(read.value), javaHome = process.env.JAVA_HOME;
    if (!javaHome) throw Error('Provide the existing Java test job JDK21.');
    const prepared = await javaStarter(read.value, 'application', javaHome);
    expect(prepared.problems).toEqual([]);
    expect(prepared.value?.configuration.project).toEqual({ root: 'application', excludePaths: ['dist', 'generation/tooling'] });
    expect(read.value).toEqual(before);
  });
});
