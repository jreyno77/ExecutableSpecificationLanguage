import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checksFor } from '../../../.github/ci/select-tests.js';

const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const native = workflow.slice(workflow.indexOf('\n  native-consumer:'));

describe('installed walkthroughs for selected targets', () => {
  it('prepares a Java-only consumer without generic package tests', () => {
    expect(checksFor('pull_request', ['src/project/java/java-project.ts'])).toMatchObject({
      java: true, kotlin: false, package: false, consumers: ['java'], prepareConsumer: true,
    });
  });
  it('uses the package producer for every target on main', () => {
    expect(checksFor('push', [])).toMatchObject({
      package: true, consumers: ['java', 'kotlin', 'python'], prepareConsumer: false,
    });
  });
  it('keeps package-only changes out of native walkthroughs', () => {
    expect(checksFor('pull_request', ['package.json'])).toMatchObject({
      package: true, consumers: [], prepareConsumer: false,
    });
  });
  it('keeps documentation-only changes out of artifact preparation', () => {
    expect(checksFor('pull_request', ['README.md'])).toMatchObject({
      package: false, consumers: [], prepareConsumer: false,
    });
  });
  it('assigns the clean public-consumer fixture to its package owner', () => {
    expect(checksFor('pull_request', ['test/resources/clean-package/consumer.ts']).package).toBe(true);
  });
  it('runs native consumers after either selected producer succeeds', () => {
    expect(native).toContain('needs: [scope, installed-package, prepare-consumer]');
    expect(native).toContain("needs.installed-package.result == 'success' || needs.prepare-consumer.result == 'success'");
    expect(native).toContain("needs.scope.outputs.consumers != '[]'");
    expect(native).toContain('target: ${{ fromJSON(needs.scope.outputs.consumers) }}');
    expect(native).not.toContain('include:');
    expect(native).not.toContain('actions/checkout@');
  });
  it('keeps preparation-only work separate from package assertions', () => {
    const preparation = workflow.split('\n  prepare-consumer:')[1]?.split('\n  java:')[0];
    expect(preparation).toBeDefined();
    expect(preparation).toContain("if: needs.scope.outputs.prepareConsumer == 'true'");
    expect(preparation).not.toContain('vitest run');
    expect(preparation).toContain('npm run build');
  });
});

it('copies the tested main archive into the bounded consumer artifact', () => {
  const stage = workflow.split('run: &stage-consumer |')[1]?.split('\n      - uses:')[0];
  expect(stage).toBeDefined();
  expect(stage).toContain('if ($env:EXPEC_TEST_PACKAGE)');
  expect(stage).toContain('Copy-Item -LiteralPath $env:EXPEC_TEST_PACKAGE -Destination $stage');
  expect(stage).toContain("'provenance.json'");
  expect(stage).toContain('} else {\n            $packed = npm pack --ignore-scripts');
  expect(workflow).toContain('run: *stage-consumer');
  expect(workflow).toContain('name: public-consumer\n          path: ${{ runner.temp }}/expec-consumer/\n          overwrite: true');
});
