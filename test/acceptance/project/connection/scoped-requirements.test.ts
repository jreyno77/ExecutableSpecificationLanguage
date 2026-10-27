import { describe, expect, it } from 'vitest';
import { requirementsFor } from '../../../../src/index.js';
import { scopedProject, scopedNativeManifest, preservedTypeScriptProject, readScopedConfiguration, attemptOriginMutation } from '../../../dsl/project/connection/scoped-requirements.js';

const toolCatalog = [
  { alias: 'typescript', name: 'npm:typescript', version: '5.9.3', phases: ['build'] },
  { alias: 'vite', name: 'npm:vite', version: '8.3.3', phases: ['build', 'test'] },
  { alias: 'vitest', name: 'npm:vitest', version: '5.0.2', phases: ['test'] },
  { alias: 'react', name: 'npm:react', version: '19.3.0', phases: ['runtime'] },
  { alias: 'playwright', name: 'npm:playwright', version: '1.63.0', phases: ['test'] },
];

describe('shared tooling and source-scoped dependencies', () => {
  it('shares build and test tools without repeating them in two component contracts', async () => {
    const project = await scopedProject({ packages: toolCatalog, requirements: {
      project: { build: ['typescript', 'vite'], test: ['vitest'] },
    } });
    project.source('src/core/store.expec', 'component Store {\n public count\n capability count() returns Number\n}');
    project.source('src/core/cart.expec', 'component Cart {\n public total\n capability total() returns Number\n}');
    await project.check();
    expect(project.compilationAccepted()).toBe(true);
    expect(project.requirements('src/core/store.expec')).toEqual(['typescript:build', 'vite:build', 'vitest:test']);
    expect(project.requirements('src/core/cart.expec')).toEqual(['typescript:build', 'vite:build', 'vitest:test']);
    expect(project.explicitRequirements('Store')).toEqual([]);
    expect(project.explicitRequirements('Cart')).toEqual([]);
  });

  it('adds React only to the UI folder and Playwright only to the named source', async () => {
    const project = await scopedProject({ packages: toolCatalog, requirements: {
      project: { build: ['typescript'] },
      folders: [{ path: 'src/ui', runtime: ['react'] }],
      files: [{ path: 'src/ui/view.expec', test: ['playwright'] }],
    } });
    project.source('src/ui/view.expec', 'component View { requires package "react" for runtime }');
    project.source('src/ui/button.expec', 'component Button {}');
    project.source('src/ui-extra/store.expec', 'component Store {}');
    await project.check();
    expect(project.compilationAccepted()).toBe(true);
    expect(project.requirements('src/ui/view.expec')).toEqual(['typescript:build', 'react:runtime', 'playwright:test']);
    expect(project.requirements('src/ui/button.expec')).toEqual(['typescript:build', 'react:runtime']);
    expect(project.requirements('src/ui-extra/store.expec')).toEqual(['typescript:build']);
    expect(project.explicitRequirements('View')).toEqual(['react:runtime']);
    expect(project.explicitRequirements('Button')).toEqual([]);
    expect(project.explicitRequirements('Store')).toEqual([]);
  });

  it('unions nested folder and file phases without overriding broader tooling', async () => {
    const project = await scopedProject({ packages: toolCatalog, requirements: {
      project: { build: ['vite'] },
      folders: [{ path: 'src', build: ['vite'] }, { path: 'src/ui', test: ['vite'] }],
      files: [{ path: 'src/ui/view.expec', runtime: ['react'] }],
    } });
    project.source('src/ui/view.expec', 'component View {}');
    await project.check();
    expect(project.requirements('src/ui/view.expec')).toEqual(['vite:build', 'vite:test', 'react:runtime']);
    expect(project.requirementOrigins('src/ui/view.expec', 'vite', 'build')).toEqual([
      ['requirements', 'project', 'build', 0], ['requirements', 'folders', 0, 'build', 0],
    ]);
  });

  it('uses the verified manifest root even through a nested root and leaves outside sources path-absent', async () => {
    const project = await scopedProject({ packages: toolCatalog,
      build: { entries: ['src/ui/view.expec'], sourceRoots: ['src/ui', '../shared'] },
      requirements: { project: { build: ['typescript'] }, folders: [{ path: 'src/ui', runtime: ['react'] }] },
    });
    project.source('src/ui/view.expec', 'include "../../../shared/other.expec"\ncomponent View {}');
    project.outsideSource('../shared/other.expec', 'type Shared {}');
    await project.check();
    expect(project.compilationAccepted()).toBe(true);
    expect(project.captureLocalPath('src/ui/view.expec')).toBe('src/ui/view.expec');
    expect(project.outsideCaptureLocalPath('../shared/other.expec')).toBeUndefined();
    expect(project.requirements('src/ui/view.expec')).toEqual(['typescript:build', 'react:runtime']);
    expect(project.outsideRequirements('../shared/other.expec')).toEqual(['typescript:build']);
  });

  it('rejects unknown aliases and missing declared phases at their configuration origins', async () => {
    const project = await scopedProject({ packages: toolCatalog, requirements: {
      project: { runtime: ['typescript'], test: ['missing-driver'] },
    } });
    await project.readConfiguration();
    expect(project.configurationAccepted()).toBe(false);
    expect(project.configurationFindings()).toEqual([
      { code: 'unavailable-package', path: ['requirements', 'project', 'runtime', 0], related: [['packages', 0, 'phases']] },
      { code: 'unknown-package-alias', path: ['requirements', 'project', 'test', 0], related: [] },
    ]);
  });

  it('rejects conflicting native identities instead of letting a narrower folder override them', async () => {
    const project = await scopedProject({ packages: [
      { alias: 'react', name: 'npm:react', version: '19.3.0', phases: ['runtime'] },
      { alias: 'react', name: 'npm:other-react', version: '1.0.0', phases: ['runtime'] },
    ], requirements: { folders: [{ path: 'src/ui', runtime: ['react'] }] } });
    await project.readConfiguration();
    expect(project.configurationAccepted()).toBe(false);
    expect(project.finding('duplicate-alias')).toMatchObject({ path: ['packages', 1, 'alias'], related: [['packages', 0, 'alias']] });
  });

  it('does not turn configured aliases into installed inventory evidence', async () => {
    const project = await scopedProject({ packages: toolCatalog, requirements: { project: { test: ['vitest'] } } });
    project.source('src/core/store.expec', 'component Store {}');
    await project.check();
    expect(project.compilationAccepted()).toBe(true);
    await project.verifyInventory([]);
    expect(project.inventoryAccepted()).toBe(false);
    expect(project.inventoryFinding('npm:vitest')).toMatchObject({ code: 'unavailable-package', path: ['packages', 2, 'name'] });
    expect(project.nativeInstallations()).toBe(0);
  });

  it('preserves legacy manifests and actual explicit component requirements', async () => {
    const project = await scopedProject({ packages: toolCatalog });
    project.source('src/ui/view.expec', 'component View { requires package "react" for runtime }');
    await project.check();
    expect(project.compilationAccepted()).toBe(true);
    expect(project.requirements('src/ui/view.expec')).toEqual([]);
    expect(project.explicitRequirements('View')).toEqual(['react:runtime']);
  });

  it('recomputes the same current unsaved source after a saved scope change at an unchanged editor version', async () => {
    const project = await scopedProject({ packages: toolCatalog, requirements: { folders: [{ path: 'src/ui', runtime: ['react'] }] } });
    project.source('src/ui/view.expec', 'component View {}');
    await project.check();
    project.editorSource('src/ui/view.expec', 'component ChangedView {}', 7);
    await project.checkCurrent();
    expect(project.capturedRequirements('src/ui/view.expec')).toEqual(['react:runtime']);
    expect(project.currentRequirements('src/ui/view.expec')).toEqual(['react:runtime']);
    await project.savedRequirements({ files: [{ path: 'src/ui/view.expec', test: ['playwright'] }] });
    await project.checkCurrent();
    expect(project.currentRequirements('src/ui/view.expec')).toEqual(['playwright:test']);
    expect(project.previousCurrentRequirements('src/ui/view.expec')).toEqual(['react:runtime']);
    expect(project.currentSourceVersion('src/ui/view.expec')).toBe(7);
    expect(project.currentDeclarationNames()).toEqual(['ChangedView']);
    expect(project.savedSource('src/ui/view.expec')).toBe('component View {}');
    expect(project.nativeInstallations()).toBe(0);
  });

  it('routes actual public CLI checking through source-scope preparation', async () => {
    const project = await scopedProject({ packages: [
      { alias: 'checks', name: 'npm:example-check', version: '^3', phases: ['build', 'test'] },
    ], requirements: { project: { build: ['checks'], test: ['checks'] } } });
    project.source('src/core/store.expec', 'component Store {}');
    await project.supplyNativeInventoryFiles('example-check', '3.0.0');
    await project.cliCheckWithRecordedNativePort();
    expect(project.cliStatus()).toBe('checked');
    expect(project.cliExitCode()).toBe(0);
    expect(project.cliLoadedRequirements('src/core/store.expec')).toEqual(['checks:build', 'checks:test']);
    expect(project.cliCaptureLocalPath('src/core/store.expec')).toBe('src/core/store.expec');
    expect(project.cliNativeInventoryVersions()).toEqual([{ name: 'npm:example-check', version: '3.0.0' }]);
    expect(project.nativeInstallations()).toBe(0);
    expect(await project.filesUnchangedByCheck()).toBe(true);
  });

  it('rejects bad scoped configuration before public CLI check or install performs native effects', async () => {
    const project = await scopedProject({ packages: toolCatalog, requirements: { project: { runtime: ['typescript'] } } });
    project.source('src/core/store.expec', 'component Store {}');
    await project.cliCheck();
    expect(project.cliStatus()).toBe('invalid');
    expect(project.cliExitCode()).toBe(1);
    expect(project.cliFinding('unavailable-package')).toMatchObject({ path: ['requirements', 'project', 'runtime', 0] });
    await project.cliInstall();
    expect(project.cliStatus()).toBe('invalid');
    expect(project.cliExitCode()).toBe(1);
    expect(project.cliFinding('unavailable-package')).toMatchObject({ path: ['requirements', 'project', 'runtime', 0] });
    expect(project.actualSourceLoadCalls()).toBe(0);
    expect(project.actualNativeCalls()).toBe(0);
    expect(await project.filesUnchangedByCommands()).toBe(true);
  });

  it('rejects contradictory path mappings for one actual source locator', async () => {
    const project = await scopedProject({ packages: toolCatalog });
    project.source('src/core/store.expec', 'component Store {}');
    await project.mapSameCapturedSource(['src/core/store.expec', 'src/ui/view.expec']);
    expect(project.requirementMappingAccepted()).toBe(false);
    expect(project.mappingFinding('invalid-dependency-input')).toMatchObject({
      path: ['sources', 1, 'sourceId'], related: [['sources', 0, 'sourceId']],
    });
  });

  it('preserves implementation and generated assertions when shared tooling moves out of a source contract', async () => {
    const project = await preservedTypeScriptProject({ packages: [toolCatalog[0], toolCatalog[2]],
      source: 'component Store {\n requires package "typescript" for build\n requires package "vitest" for test\n public count\n capability count() returns Number\n}\nexamples for Store {\n action readCount() returns Nothing\n observation count() returns Number\n check expectCount() {\n let actual = count()\n assert actual == 17\n }\n scenario "stored count" {\n when readCount()\n then expectCount()\n }\n}' });
    await project.generate();
    await project.implement('Store', 'count', 'return 17;');
    const assertions = await project.actualAcceptanceBytes('Store');
    await project.moveSharedTooling({ project: { build: ['typescript'], test: ['vitest'] } });
    await project.generate();
    expect(await project.actualSignature('Store', 'count')).toBe('count(): number');
    expect(await project.actualBody('Store', 'count')).toBe('return 17;');
    expect(await project.actualAcceptanceBytes('Store')).toEqual(assertions);
    expect(await project.handwrittenFilesUnchanged()).toBe(true);
  }, 30_000);
});

describe('scoped metadata and the existing native manifest writer', () => {
  it('keeps shared tools in devDependencies and runtime packages in dependencies without nested manifests', async () => {
    const project = await scopedNativeManifest({ packages: [
      { alias: 'checks', name: 'npm:example-check', version: '^3', phases: ['build', 'test'] },
      { alias: 'storage', name: 'npm:example-storage', version: '^2', phases: ['runtime', 'test'] },
    ], requirements: {
      project: { build: ['checks'], test: ['checks'] },
      folders: [{ path: 'src/data', runtime: ['storage'] }],
    } });
    await project.nativeManifest({ private: true, scripts: { build: 'my-build' }, custom: { keep: true } });
    await project.configureNativeManifest();
    expect(await project.nativeDependency('devDependencies', 'example-check')).toBe('^3');
    expect(await project.nativeDependency('dependencies', 'example-storage')).toBe('^2');
    expect(await project.nativeDependency('dependencies', 'example-check')).toBeUndefined();
    expect(await project.nativeDependency('devDependencies', 'example-storage')).toBeUndefined();
    expect(await project.nativeFields()).toMatchObject({ private: true, scripts: { build: 'my-build' }, custom: { keep: true } });
    expect(await project.actualPackageManifestPaths()).toEqual(['package.json']);
    expect(project.actualNativeProcesses()).toBe(0);
  });
});

describe('pure scoped requirement caller controls', () => {
  it('rejects a nonliteral scope address without normalizing it into another file', () => {
    const configuration = readScopedConfiguration({ packages: toolCatalog,
      requirements: { folders: [{ path: 'src/ui', runtime: ['react'] }] } });
    const result = requirementsFor(configuration, [{ sourceId: 'memory:view', localPath: 'src/ui/../view.expec' }]);
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => ({ code: problem.code, at: problem.at }))).toEqual([
      { code: 'invalid-dependency-input', at: { kind: 'dependency', path: ['sources', 0, 'localPath'] } },
    ]);
  });

  it('retains captured Unicode paths and detached repeated-scope origins', () => {
    const configuration = readScopedConfiguration({ packages: toolCatalog, requirements: {
      project: { build: ['typescript'] },
      folders: [{ path: 'src/Bibliothèque 📚', build: ['typescript'], runtime: ['react'] }],
    } });
    const sources = [{ sourceId: 'memory:view', localPath: 'src/Bibliothèque 📚/vue.expec' }];
    const first = requirementsFor(configuration, sources);
    expect(first.value?.map(({ alias, phase }) => [alias, phase])).toEqual([
      ['typescript', 'build'], ['react', 'runtime'],
    ]);
    expect(first.value?.[0]?.related).toEqual([
      { kind: 'dependency', path: ['manifest', configuration.sourceId, 'requirements', 'folders', 0, 'build', 0] },
    ]);
    sources[0]!.localPath = 'src/core/view.expec';
    attemptOriginMutation(first.value![0]!, 'corrupted');
    const second = requirementsFor(configuration, [{ sourceId: 'memory:view', localPath: 'src/Bibliothèque 📚/vue.expec' }]);
    expect(second.value?.map(({ alias, phase }) => [alias, phase])).toEqual([
      ['typescript', 'build'], ['react', 'runtime'],
    ]);
    expect(second.value?.[0]?.related).toEqual([
      { kind: 'dependency', path: ['manifest', configuration.sourceId, 'requirements', 'folders', 0, 'build', 0] },
    ]);
    expect(second.value?.[0]?.at).toEqual({ kind: 'dependency',
      path: ['manifest', configuration.sourceId, 'requirements', 'project', 'build', 0] });
  });
});
