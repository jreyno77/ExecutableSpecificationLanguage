import { describe, expect, it } from 'vitest';
import { ConfigurationReader } from '../../../../src/project/connection/configuration.js';
import { kotlinStarter } from '../../../../src/project/kotlin/kotlin-initialization.js';

describe('capture policy in a Kotlin starter', () => {
  it('preserves configured artifact boundaries when choosing a new Kotlin project root', async () => {
    const read = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({ formatVersion: 1, version: '0.1.0',
      project: { root: 'old', excludePaths: ['dist', 'generation/tooling'] }, build: { entries: ['book.expec'] } }) });
    if (!read.value) throw Error(JSON.stringify(read.problems));
    const before = structuredClone(read.value), javaHome = process.env.EXPEC_TEST_JAVA_HOME ?? process.env.JAVA_HOME;
    if (!javaHome) throw Error('Provide the existing Kotlin test job JDK21.');
    const prepared = await kotlinStarter(read.value, 'application', javaHome);
    expect(prepared.configuration.project).toEqual({ root: 'application', excludePaths: ['dist', 'generation/tooling'] });
    expect(read.value).toEqual(before);
  });
});
