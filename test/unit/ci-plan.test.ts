import { describe, expect, it } from 'vitest';
import { allChecks, checksFor } from '../../.github/ci/plan.js';

describe('checks selected for a contribution', () => {
  it('checks Java and its shared consumers without other native targets', () => {
    expect(checksFor('pull_request', ['src/project/java/java-query.ts']))
      .toEqual(['core', 'package', 'clean', 'java', 'native-java']);
  });
  it('checks every component after any main push', () => {
    expect(checksFor('push', ['src/project/java/java-query.ts'])).toEqual(allChecks);
  });
  it('checks all consumers of a compiler change', () => {
    expect(checksFor('pull_request', ['src/compiler/types.ts'])).toEqual(allChecks);
  });
  it('selects both targets when a source file moves', () => {
    const checks = checksFor('pull_request', ['src/project/java/old.ts', 'src/project/kotlin/new.ts']);
    expect(checks).toContain('java'); expect(checks).toContain('kotlin'); expect(checks).not.toContain('python');
  });
  it('runs the native suite for a changed Kotlin test', () => {
    expect(checksFor('pull_request', ['test/acceptance/kotlin-data.test.ts'])).toEqual(['kotlin']);
  });
  it('checks TypeScript and its installed journeys', () => {
    expect(checksFor('pull_request', ['src/project/typescript/output-typescript.ts']))
      .toEqual(['core', 'pilot', 'package', 'clean']);
  });
  it('keeps unknown and missing change information conservative', () => {
    expect(checksFor('pull_request', ['new-component/build.xyz'])).toEqual(allChecks);
    expect(checksFor('pull_request', [])).toEqual(allChecks);
  });
  it('checks all documented workflows when the README changes', () => {
    expect(checksFor('pull_request', ['README.md'])).toEqual(allChecks);
  });
});
