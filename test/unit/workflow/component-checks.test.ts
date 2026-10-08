import { describe, expect, it } from 'vitest';
import { checksFor } from '../../../.github/ci/select-tests.js';

describe('checks for directly changed components', () => {
  it('checks both native targets for their shared JUnit input', () => {
    expect(checksFor('pull_request', ['test/resources/jvm/junit-platform-console-standalone-6.1.3.jar']))
      .toEqual({ core: [], java: true, kotlin: true, python: false, package: false,
        pilot: false, workflow: false, consumers: ['java', 'kotlin'], prepareConsumer: true, shards: [1] });
  });

  it('checks both native targets for their shared JUnit notice', () => {
    expect(checksFor('pull_request', ['test/resources/jvm/JUNIT-NOTICE.txt']))
      .toEqual({ core: [], java: true, kotlin: true, python: false, package: false,
        pilot: false, workflow: false, consumers: ['java', 'kotlin'], prepareConsumer: true, shards: [1] });
  });

  it('prepares an archive for a pilot-only change without selecting package tests', () => {
    const selected = checksFor('pull_request', ['src/cli/cli.ts']);
    expect(selected.pilot).toBe(true);
    expect(selected.package).toBe(false);
    expect(selected.prepareConsumer).toBe(true);
  });

  it('uses the selected package producer for every main push', () => {
    const selected = checksFor('push', []);
    expect(selected.package).toBe(true);
    expect(selected.pilot).toBe(true);
    expect(selected.prepareConsumer).toBe(false);
  });

  it('uses the package producer when CLI and package both change', () => {
    expect(checksFor('pull_request', ['src/cli/cli.ts', 'package.json']))
      .toMatchObject({ pilot: true, package: true, prepareConsumer: false });
  });

  it('prepares the Python walkthrough without selecting pilots or package tests', () => {
    expect(checksFor('pull_request', ['src/project/python/python-context.ts']))
      .toMatchObject({ python: true, pilot: false, package: false, consumers: ['python'], prepareConsumer: true });
  });

  it('does not prepare an unused pilot archive for a workflow-only change', () => {
    expect(checksFor('pull_request', ['.github/workflows/ci.yml']))
      .toMatchObject({ workflow: true, pilot: false, package: false, prepareConsumer: false });
  });

  it('does not prepare an unused pilot archive for a documentation-only change', () => {
    expect(checksFor('pull_request', ['README.md']))
      .toMatchObject({ pilot: false, package: false, prepareConsumer: false });
  });

  it('checks Java alone for a Java change', () => {
    expect(checksFor('pull_request', ['src/project/java/java-inputs.ts']))
      .toEqual({ core: [], java: true, kotlin: false, python: false, package: false, pilot: false, workflow: false, consumers: ['java'], prepareConsumer: true, shards: [1] });
  });

  it('checks Kotlin alone for Kotlin source and every Kotlin test layer', () => {
    for (const path of ['src/project/kotlin/kotlin-context.ts', 'src/project/kotlin/native/build.gradle.kts',
      ...['unit', 'acceptance', 'dsl', 'driver'].map(layer => 'test/' + layer + '/project/kotlin/example.ts')]) {
      expect(checksFor('pull_request', [path]))
        .toEqual({ core: [], java: false, kotlin: true, python: false, package: false, pilot: false, workflow: false, consumers: ['kotlin'], prepareConsumer: true, shards: [1] });
    }
  });

  it('keeps installed Kotlin fixtures with the Kotlin owner', () => {
    for (const fixture of ['kotlin-consumer.mjs', 'kotlin-cli-consumer.mjs', 'checkout-guard.mjs'])
      expect(checksFor('pull_request', ['test/resources/package-consumer/' + fixture]))
        .toEqual({ core: [], java: false, kotlin: true, python: false, package: false, pilot: false, workflow: false, consumers: ['kotlin'], prepareConsumer: true, shards: [1] });
  });

  it('checks only shared output for a changed output test resource', () => {
    expect(checksFor('pull_request', ['test/resources/project/output/bounded-plan.mjs']))
      .toEqual({ core: ['test/unit/project/output', 'test/acceptance/project/output'],
        java: false, kotlin: false, python: false, package: false, pilot: false, workflow: false, consumers: [], prepareConsumer: false, shards: [1] });
  });

  it('checks compiler folders without consumers', () => {
    expect(checksFor('pull_request', ['src/compiler/compiler.ts']))
      .toEqual({ core: ['test/unit/compiler', 'test/acceptance/compiler'],
        java: false, kotlin: false, python: false, package: false, pilot: false, workflow: false, consumers: [], prepareConsumer: false, shards: [1] });
  });

  it('combines only directly changed owners, once', () => {
    const checks = checksFor('pull_request', [
      'src/compiler/compiler.ts', 'test/driver/model/inspection.ts', 'src/compiler/compiler.ts',
    ]);
    expect(checks.core).toEqual([
      'test/unit/model', 'test/acceptance/model', 'test/unit/compiler', 'test/acceptance/compiler',
    ]);
    expect(checks.java || checks.kotlin || checks.python || checks.package || checks.pilot || checks.workflow).toBe(false);
  });

  it('checks both sides of a rename', () => {
    expect(checksFor('pull_request', ['src/language/old.ts', 'src/model/new.ts']).core)
      .toEqual(['test/unit/language', 'test/acceptance/language', 'test/unit/model', 'test/acceptance/model']);
  });

  it('retains the owner of a deleted file', () => {
    expect(checksFor('pull_request', ['src/project/output/deleted.ts']).core)
      .toEqual(['test/unit/project/output', 'test/acceptance/project/output']);
  });

  it('does not build the product for documentation or an empty diff', () => {
    const none = { core: [], java: false, kotlin: false, python: false, package: false, pilot: false, workflow: false, consumers: [], prepareConsumer: false, shards: [1] };
    expect(checksFor('pull_request', ['README.md', '.agents/skills/example/SKILL.md', '.github/pull_request_template.md']))
      .toEqual(none);
    expect(checksFor('pull_request', [])).toEqual(none);
  });

  it('reports missing ownership instead of choosing a fallback', () => {
    expect(() => checksFor('pull_request', ['src/surprise/new.ts'])).toThrow('src/surprise/new.ts');
    expect(() => checksFor('pull_request', ['new-config.json'])).toThrow('new-config.json');
    expect(() => checksFor('pull_request', ['src/workflow/new.ts'])).toThrow('src/workflow/new.ts');
    expect(() => checksFor('pull_request', ['test/resources/jvm/another.jar'])).toThrow('test/resources/jvm/another.jar');
    expect(() => checksFor('pull_request', ['src/package/new.ts'])).toThrow('src/package/new.ts');
  });

  it('recognizes Java fixture exceptions before the package folder', () => {
    for (const fixture of ['java-consumer.mjs', 'java-cli-consumer.mjs', 'java-cli-guard.mjs']) {
      const checks = checksFor('pull_request', ['test/resources/package-consumer/' + fixture]);
      expect(checks.java).toBe(true);
      expect(checks.package).toBe(false);
    }
    expect(checksFor('pull_request', ['test/resources/package-consumer/consumer.mjs']).package).toBe(true);
  });

  it('keeps the CLI pilot with its owner', () => {
    const checks = checksFor('pull_request', ['src/cli-entry.ts']);
    expect(checks.core).toEqual(['test/unit/cli', 'test/acceptance/cli']);
    expect(checks.pilot).toBe(true);
    expect(checks.java || checks.kotlin || checks.python || checks.package).toBe(false);
  });

  it('assigns each test layer to its component', () => {
    for (const layer of ['unit', 'acceptance', 'dsl', 'driver'])
      expect(checksFor('pull_request', ['test/' + layer + '/project/connection/example.ts']).core)
        .toEqual(['test/unit/project/connection', 'test/acceptance/project/connection']);
  });

  it('owns shared package configuration without expanding to consumers', () => {
    for (const path of ['src/index.ts', 'src/resources.ts', 'package.json', 'package-lock.json',
      '.node-version', '.npmrc', 'tsconfig.json', 'tsconfig.build.json', 'rolldown.config.mjs']) {
      expect(checksFor('pull_request', [path]))
        .toEqual({ core: ['test/unit/package', 'test/acceptance/package'],
          java: false, kotlin: false, python: false, package: true, pilot: false, workflow: false, consumers: [], prepareConsumer: false, shards: [1] });
    }
  });

  it('checks CI policy without product setup', () => {
    for (const path of ['.github/workflows/ci.yml', '.github/ci/select-tests.ts', 'vitest.core.config.ts',
      'test/global-setup.ts', 'test/driver/compiled-checkout.ts', 'test/driver/unreadable-file.ts', '.gitignore', '.gitattributes']) {
      expect(checksFor('pull_request', [path]))
        .toEqual({ core: [], java: false, kotlin: false, python: false, package: false, pilot: false, workflow: true, consumers: [], prepareConsumer: false, shards: [1] });
    }
  });

  it('assigns fixtures to the behavior they exercise', () => {
    expect(checksFor('pull_request', ['langium-config.json', 'test/resources/grammar/valid/a.expec']).core)
      .toEqual(['test/unit/language', 'test/acceptance/language']);
    expect(checksFor('pull_request', ['test/resources/domain-failures/a.json', 'test/resources/workspace-compilation/a.json']).core)
      .toEqual(['test/unit/compiler', 'test/acceptance/compiler']);
    expect(checksFor('pull_request', ['test/resources/diagrams/a.mjs']).core)
      .toEqual(['test/unit/project/output', 'test/acceptance/project/output']);
    expect(checksFor('pull_request', ['test/resources/java-project/build.gradle']).java).toBe(true);
    expect(checksFor('pull_request', ['test/resources/scenario-execution/a.ts']).core)
      .toEqual(['test/unit/project/typescript', 'test/acceptance/project/typescript']);
    for (const path of ['test/resources/junit-reports/a.xml', 'test/resources/pilot/a.json',
      'test/resources/connected-output.mjs', 'test/resources/connected-selection.mjs'])
      expect(checksFor('pull_request', [path]).pilot).toBe(true);
  });

  it('runs all partitions on main and for a release merge with an inherited PR event', () => {
    for (const checks of [checksFor('push', []), checksFor('pull_request', ['README.md'], 'merge-sha')]) {
      expect(checks.java && checks.kotlin && checks.python && checks.package && checks.pilot && checks.workflow).toBe(true);
      expect(checks.shards).toEqual([1, 2, 3, 4, 5]);
      expect(checks.core).toEqual([
        'test/unit/language', 'test/acceptance/language', 'test/unit/model', 'test/acceptance/model',
        'test/unit/compiler', 'test/acceptance/compiler', 'test/unit/cli', 'test/acceptance/cli',
        'test/unit/project/connection', 'test/acceptance/project/connection',
        'test/unit/project/dependencies', 'test/acceptance/project/dependencies',
        'test/unit/project/output', 'test/acceptance/project/output',
        'test/unit/project/typescript', 'test/acceptance/project/typescript',
        'test/unit/package', 'test/acceptance/package',
      ]);
    }
  });
});
describe('checks for the Python owner', () => {
  it('selects Python checks for a Python implementation change', () => {
    const checks = checksFor('pull_request', ['src/project/python/python-context.ts']);
    expect(checks.python).toBe(true);
    expect(checks.java).toBe(false);
    expect(checks.kotlin).toBe(false);
    expect(checks.core).toEqual([]);
  });
  it('keeps Python checks out of a compiler-only PR', () => {
    expect(checksFor('pull_request', ['src/compiler/compiler.ts']).python).toBe(false);
  });
  it('includes Python with all other components on main', () => {
    const checks = checksFor('push', []);
    expect(checks.python).toBe(true);
    expect(checks.java).toBe(true);
    expect(checks.kotlin).toBe(true);
  });
  it('keeps every Python test layer and private runtime resource with Python', () => {
    for (const path of ['src/project/python/resources/inspect.py',
      'test/unit/project/python/cli-pytest-result.test.ts', 'test/acceptance/project/python/python-installed-package.test.ts',
      'test/dsl/project/python/python-project.ts', 'test/driver/project/python/python-project.ts',
      'test/resources/python/basket.py']) {
      expect(checksFor('pull_request', [path]))
        .toEqual({ core: [], java: false, kotlin: false, python: true, package: false, pilot: false, workflow: false, consumers: ['python'], prepareConsumer: true, shards: [1] });
    }
  });
  it('keeps the installed Python fixtures with Python', () => {
    for (const fixture of ['python-cli-consumer.mjs', 'python-cli-guard.mjs', 'python-public.mts']) {
      const checks = checksFor('pull_request', ['test/resources/package-consumer/' + fixture]);
      expect(checks.python).toBe(true);
      expect(checks.package).toBe(false);
    }
  });
});
