import { describe, it } from 'vitest';
import { InitializationExamples } from '../dsl/project-initialization.js';

describe('the starter declares its build requirement', () => {
it('returns the exact build requirement needed by the generated TypeScript starter', async () => {
  const project = await InitializationExamples.withUnconnectedManifest();
  project.forbidProcessNetworkAndOutputExecution();
  await project.prepare('../store-game', 'typescript');
  project.expectProposedPackages([
    { alias: 'typescript', name: 'npm:typescript', version: '5.9.3', phases: ['build'] }
  ]);
  await project.expectManifestUnchanged();
  await project.expectDestinationAbsent();
  project.expectNoForbiddenExecution();
});

it('retains an exact existing compiler alias and additional phases without duplication', async () => {
  const project = await InitializationExamples.withPackages([
    { alias: 'compiler', name: 'npm:typescript', version: '=5.9.3', phases: ['test', 'build'] },
    { alias: 'storage', name: 'npm:store', version: '^1.0.0', phases: ['runtime'] }
  ]);
  await project.prepare('../store-game', 'typescript');
  project.expectProposedPackages([
    { alias: 'compiler', name: 'npm:typescript', version: '=5.9.3', phases: ['test', 'build'] },
    { alias: 'storage', name: 'npm:store', version: '^1.0.0', phases: ['runtime'] }
  ]);
});

it('rejects a broad compiler range that could escape the pinned starter profile', async () => {
  const project = await InitializationExamples.withPackages([
    { alias: 'compiler', name: 'npm:typescript', version: '^5.9.0', phases: ['build'] }
  ]);
  await project.prepare('../store-game', 'typescript');
  project.expectProblem('unsupported-initialization-toolchain');
  project.expectNoPlan();
  await project.expectDestinationAbsent();
});

it('does not silently reclassify a runtime-only compiler requirement', async () => {
  const project = await InitializationExamples.withPackages([
    { alias: 'compiler', name: 'npm:typescript', version: '5.9.3', phases: ['runtime'] }
  ]);
  await project.prepare('../store-game', 'typescript');
  project.expectProblem('unsupported-initialization-toolchain');
  project.expectNoPlan();
  await project.expectManifestUnchanged();
});

it('does not steal an existing package alias for the generated toolchain', async () => {
  const project = await InitializationExamples.withPackages([
    { alias: 'typescript', name: 'npm:other-package', version: '1.0.0', phases: ['build'] }
  ]);
  await project.prepare('../store-game', 'typescript');
  project.expectProblem('unsupported-initialization-toolchain');
  project.expectNoPlan();
  await project.expectDestinationAbsent();
});

it('does not return compiler aliases that the native acquisition contract rejects', async () => {
  const project = await InitializationExamples.withPackages([
    { alias: 'build-compiler', name: 'npm:typescript', version: '5.9.3', phases: ['build'] },
    { alias: 'test-compiler', name: 'npm:typescript', version: '=5.9.3', phases: ['test'] }
  ]);
  await project.prepare('../store-game', 'typescript');
  project.expectProblem('unsupported-initialization-toolchain');
  project.expectNoPlan();
});

});

describe('the author controls initialization', () => {
  it('declines a prepared destination without creating anything', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../store-game', 'typescript');
    await project.apply(false);
    project.expectStatus('declined');
    project.expectNoConnection();
    await project.expectDestinationAbsent();
    await project.expectManifestUnchanged();
    project.expectNoWriterReceipt();
  });

  it('shows the actual files and selected location without applying them', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../store-game', 'typescript');
    project.expectPlannedRoot('../store-game');
    project.expectPlannedPaths(['package.json', 'tsconfig.json', 'src/index.ts', '.gitignore']);
    project.expectPlannedText('src/index.ts', 'export {};\n');
    project.expectPlannedJson('package.json', {
      private: true, version: '0.1.0', type: 'module',
      scripts: { build: 'tsc --project tsconfig.json' },
      devDependencies: { typescript: '5.9.3' },
    });
    await project.expectDestinationAbsent();
    await project.expectManifestUnchanged();
  });

  it('creates and connects the chosen missing leaf, relative to the manifest', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    project.runFromUnrelatedDirectory();
    await project.prepare('../chosen-game', 'typescript');
    await project.apply(true);
    project.expectStatus('applied');
    project.expectCreatedRoot('../chosen-game');
    project.expectConnectedRoot('../chosen-game');
    await project.expectExactStarterFiles(['package.json', 'tsconfig.json', 'src/index.ts', '.gitignore']);
    await project.expectFile('src/index.ts', 'export {};\n');
    await project.expectFile('.gitignore', 'node_modules/\ndist/\n');
    await project.expectUnrelatedWorkingDirectoryUnchanged();
    await project.expectManifestUnchanged();
  });

  it('initializes an existing empty directory without replacing its identity', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.emptyDestination('../chosen-game');
    await project.rememberDestinationIdentity();
    await project.prepare('../chosen-game', 'typescript');
    await project.apply(true);
    project.expectStatus('applied');
    project.expectNoCreatedRoot();
    await project.expectSameDestinationIdentity();
    await project.expectFile('src/index.ts', 'export {};\n');
  });

  it('preserves existing configuration and returns the explicit connection change', async () => {
    const project = await InitializationExamples.withManifest({
      formatVersion: 1, version: '2.3.4', build: { entries: ['spec/game.expec'], sourceRoots: ['spec'] },
      outputs: [{ id: 'markdown', options: { directory: 'docs' } }],
      libraries: [{ module: 'books', version: '^1.0.0' }],
      packages: [{ alias: 'vite', name: 'vite', version: '^7.0.0', phases: ['build'] }],
    });
    await project.prepare('../chosen-game', 'typescript');
    await project.apply(true);
    project.expectReturnedProjectRoot('../chosen-game');
    project.expectReturnedBuild({ entries: ['spec/game.expec'], sourceRoots: ['spec'] });
    project.expectReturnedOutputs([
      { id: 'markdown', options: { directory: 'docs' } },
      { id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.json' } },
    ]);
    project.expectOriginalLibraries();
    project.expectReturnedPackages([
      { alias: 'vite', name: 'vite', version: '^7.0.0', phases: ['build'] },
      { alias: 'typescript', name: 'npm:typescript', version: '5.9.3', phases: ['build'] },
    ]);
    await project.expectJsonProperty('package.json', ['version'], '2.3.4');
    await project.expectManifestUnchanged();
    await project.expectNoCopiedSpecificationWorkspace();
  });

  it('reconnects using the returned configuration without reinitializing', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    await project.apply(true);
    project.rememberSuccessfulConnection();
    await project.reconnectReturnedConfiguration();
    project.expectSameConnectedRootIdentity();
    await project.expectFile('src/index.ts', 'export {};\n');
    await project.expectManifestUnchanged();
  });

  it('does not claim a new process will discover an unpersisted selection', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    await project.apply(true);
    await project.connectOriginalOnDiskManifest();
    project.expectOriginalManifestStillUnconnected('not-configured');
    await project.expectFile('src/index.ts', 'export {};\n');
  });
});

describe('initialization respects the actual destination', () => {
  it('refuses an existing file instead of treating it as a directory', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.destinationIsFile('../chosen-game', 'keep me');
    await project.prepare('../chosen-game', 'typescript');
    project.expectProblem('initialization-root-not-directory');
    project.expectNoPlan();
    await project.expectDestinationFile('keep me');
  });

  it('refuses an existing handwritten project even without filename collisions', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.destinationFiles('../chosen-game', { 'notes.txt': 'my existing project' });
    await project.prepare('../chosen-game', 'typescript');
    project.expectProblem('initialization-root-not-empty');
    project.expectNoPlan();
    await project.expectDestinationFilesExactly({ 'notes.txt': 'my existing project' });
  });

  it('does not hide an existing excluded directory when deciding emptiness', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.destinationDirectory('../chosen-game/.git');
    await project.prepare('../chosen-game', 'typescript');
    project.expectProblem('initialization-root-not-empty');
    project.expectNoPlan();
    await project.expectOnlyDestinationDirectory('.git');
  });

  it('reports missing ancestry instead of recursively creating it', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../missing-parent/chosen-game', 'typescript');
    project.expectProblem('unsupported-initialization-parent');
    project.expectNoPlan();
    await project.expectPathAbsent('../missing-parent');
  });

  it('refuses a linked destination instead of initializing its target', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.linkDestination('../chosen-game', '../elsewhere');
    await project.prepare('../chosen-game', 'typescript');
    project.expectProblem('unsupported-initialization-root');
    project.expectNoPlan();
    await project.expectLinkedTargetEmpty();
  });

  it('stops when someone creates the absent destination after preparation', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    await project.destinationFiles('../chosen-game', { 'src/custom.ts': 'export const custom = 42;' });
    await project.apply(true);
    project.expectStatus('stopped');
    project.expectProblem('destination-changed');
    project.expectNoConnection();
    await project.expectDestinationFilesExactly({ 'src/custom.ts': 'export const custom = 42;' });
  });

  it('does not adopt an empty directory created after an absent-root preview', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    await project.emptyDestination('../chosen-game');
    await project.apply(true);
    project.expectStatus('stopped');
    project.expectProblem('destination-changed');
    await project.expectDestinationEmpty();
  });

  it('stops when an existing empty root gains a file after preparation', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.emptyDestination('../chosen-game');
    await project.prepare('../chosen-game', 'typescript');
    await project.destinationFiles('../chosen-game', { 'package.json': '{"private":true,"name":"mine"}\n' });
    await project.apply(true);
    project.expectProblem('destination-changed');
    project.expectNoWriterReceipt();
    await project.expectDestinationFilesExactly({ 'package.json': '{"private":true,"name":"mine"}\n' });
  });

  it('detects replacement of an empty root instead of trusting the same path', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.emptyDestination('../chosen-game');
    await project.prepare('../chosen-game', 'typescript');
    await project.replaceDestinationWithEmptyDirectory();
    await project.apply(true);
    project.expectProblem('destination-changed');
    await project.expectDestinationEmpty();
  });

  it('detects replacement of the captured parent before creating its child', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.parentDirectory('../games');
    await project.prepare('../games/chosen-game', 'typescript');
    await project.replaceParentWithEmptyDirectory('../games');
    await project.apply(true);
    project.expectProblem('destination-changed');
    await project.expectPathAbsent('../games/chosen-game');
  });

  it('refuses an unsupported target', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'unknown-target');
    project.expectProblem('unsupported-initialization-target');
    project.expectNoPlan();
    await project.expectDestinationAbsent();
  });

  it('preserves a conflicting TypeScript layout instead of replacing its options', async () => {
    const project = await InitializationExamples.withManifest({
      formatVersion: 1, version: '0.1.0', build: { entries: ['main.expec'] },
      outputs: [{ id: 'typescript', options: { directory: 'application', configFile: 'config/typescript.json' } }],
    });
    await project.prepare('../chosen-game', 'typescript');
    project.expectProblem('unsupported-initialization-options');
    project.expectNoPlan();
    project.expectInputConfigurationUnchanged();
    await project.expectDestinationAbsent();
  });
});

describe('effects, failure and retry are observable', () => {
  it('does not run packages, compilers, outputs or tests during initialization', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    project.forbidProcessNetworkAndOutputExecution();
    await project.prepare('../chosen-game', 'typescript');
    await project.apply(true);
    project.expectStatus('applied');
    await project.expectAbsentFiles(['package-lock.json', 'node_modules', 'dist', 'test', 'expec.json', 'main.expec']);
    project.expectNoForbiddenExecution();
  });

  it('reports failure to create the root without fabricating a writer result', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    project.failRootCreation('EACCES');
    await project.apply(true);
    project.expectStatus('stopped');
    project.expectProblem('initialization-root-unavailable');
    project.expectNoCreatedRoot();
    project.expectNoWriterReceipt();
    project.expectNoConnection();
    await project.expectDestinationAbsent();
  });

  it('retains actual partial files and the writer receipt after a later write fails', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    project.failRealFileCreation('tsconfig.json', 'EACCES');
    await project.apply(true);
    project.expectStatus('stopped');
    project.expectCreatedRoot('../chosen-game');
    project.expectWriterStatus('stopped');
    project.expectWriterOutcome('package.json', 'applied');
    project.expectWriterOutcome('tsconfig.json', 'not-applied');
    project.expectNoConnection();
    await project.expectJsonProperty('package.json', ['devDependencies', 'typescript'], '5.9.3');
    await project.expectAbsentFiles(['tsconfig.json', 'src/index.ts', '.gitignore']);
    await project.expectManifestUnchanged();
  });

  it('does not replay an attempted plan or adopt its partial files on retry', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    project.failRealFileCreation('tsconfig.json', 'EACCES');
    await project.apply(true);
    project.restoreFileCreation();
    await project.rememberDestinationBytes();
    await project.apply(true);
    project.expectProblem('initialization-already-attempted');
    await project.expectRememberedDestinationBytes();
    await project.prepare('../chosen-game', 'typescript');
    project.expectProblem('initialization-root-not-empty');
    project.expectNoPlan();
    await project.expectRememberedDestinationBytes();
  });

  it('can freshly prepare after a zero-effect failure is corrected', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    project.failRootCreation('EACCES');
    await project.apply(true);
    await project.expectDestinationAbsent();
    project.restoreRootCreation();
    await project.prepare('../chosen-game', 'typescript');
    await project.apply(true);
    project.expectStatus('applied');
    await project.expectFile('src/index.ts', 'export {};\n');
  });

  it('cancels before effects without calling the result a decline', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    await project.applyWithAlreadyAbortedSignal(true);
    project.expectStatus('stopped');
    project.expectProblem('initialization-cancelled');
    project.expectNoCreatedRoot();
    project.expectNoWriterReceipt();
    await project.expectDestinationAbsent();
  });

  it('captures configuration data and refuses a changed preview', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    project.mutateCallerConfigurationVersion('9.9.9');
    project.expectPlannedJsonProperty('package.json', ['version'], '0.1.0');
    project.changePreviewBytes('src/index.ts', 'export const changed = true;');
    await project.expectApplyTypeError();
    await project.expectDestinationAbsent();
  });
});

describe('the starter is a real native project', { timeout: 30_000 }, () => {
  it('builds with the explicitly supplied pinned TypeScript compiler', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    await project.apply(true);
    await project.expectAbsentFiles(['dist', 'node_modules']);
    await project.supplyInstalledTypeScript('5.9.3');
    await project.runNativeBuildScript();
    project.expectNativeBuildExit(0);
    await project.expectFile('dist/index.js', 'export {};\n');
    await project.expectFile('dist/index.d.ts', 'export {};\n');
  });


  it('accepts actual subsequent TypeScript output without generating it during initialization', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    await project.apply(true);
    await project.expectAbsentFiles(['src/StoreGame.ts']);
    await project.generateTypeScript('class StoreGame { public save\ncapability save() returns Nothing }');
    await project.supplyInstalledTypeScript('5.9.3');
    await project.runNativeBuildScript();
    project.expectNativeBuildExit(0);
    await project.runConsumer("import { StoreGame } from './dist/StoreGame.js'; new StoreGame().save();");
    project.expectThrownError('Not implemented: StoreGame.save');
    await project.expectFile('src/index.ts', 'export {};\n');
    await project.expectNoGeneratedTests();
  });

  it('does not emit new native output after a real type error', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.prepare('../chosen-game', 'typescript');
    await project.apply(true);
    await project.writeImplementation('src/broken.ts', 'export const count: number = "many";\n');
    await project.supplyInstalledTypeScript('5.9.3');
    await project.runNativeBuildScript();
    project.expectNativeBuildFailedAt('src/broken.ts', 2322);
    await project.expectAbsentFiles(['dist/index.js', 'dist/broken.js']);
    await project.expectFile('src/broken.ts', 'export const count: number = "many";\n');
  });

});
