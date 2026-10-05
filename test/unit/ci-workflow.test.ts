import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checksFor, allChecks } from '../../.github/ci/plan.js';
const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const release = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');

describe('the delivery workflows preserve checks while sharing outputs', () => {
  it('checks native consumers of shared document output', () => {
    expect(checksFor('pull_request', ['src/project/output/specification/output-documents.ts'])).toEqual(allChecks);
  });
  it('builds in one matrix step and never rebuilds for release', () => {
    expect(ci.match(/run: npm run build/g)).toHaveLength(1);
    expect(release).not.toMatch(/npm (?:run build|pack|version)|uses: \.\/\.github\/workflows\/ci.yml/);
  });
  it('keeps every existing suite invocation available', () => {
    for (const suite of ['core', 'pilot', 'package', 'java-package', 'kotlin-package', 'python', 'clean', 'native-consumer'])
      expect(ci).toContain('vitest.' + suite + '.config.');
    expect(ci).toContain('npm run test:java');
    expect(ci).toContain('npm run test:kotlin');
  });
  it('can reuse a successful build when only failed jobs rerun', () => {
    expect(ci).toContain('name: build-${{ matrix.os }}\n');
    expect(ci).toContain('name: public-consumer\n');
    expect(release).toContain('name: public-consumer\n');
    expect(ci).not.toContain('name: build-${{ matrix.os }}-${{ github.run_attempt }}');
    expect(ci).not.toContain('name: public-consumer-${{ github.run_attempt }}');
  });
  it('retains a distinct report for each executed attempt', () => {
    const reports = ci.match(/^ +name: (?:core-|pilot-|installed-|java-|kotlin-|python-|native-walkthrough-).*$/gm)!;
    expect(reports).toHaveLength(7);
    for (const report of reports) expect(report).toContain('attempt-${{ github.run_attempt }}');
  });
});
