import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageExamples } from '../../dsl/package/installed-package.js';

beforeAll(() => PackageExamples.prepare());
afterAll(() => PackageExamples.finish());

describe('Installed package consumers', () => {
  it('guards a planned write when an actual external native input changes through the installed package', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.applyWriteAfterNativeReplacement({
      library: 'catalog.jar', before: 'version-one', after: 'version-two', file: 'result.txt', text: 'written',
    });
    consumer.expectExternalNativeChangeStopsWrite('result.txt', 'version-one', 'version-two');
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('queries actual installed Vitest declarations and refuses a write after they change', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.captureNativeDependencies({ vitest: '5.0.2', '@types/node': '24.13.6' });
    consumer.expectInstalledMethodConsumer('test/manual.ts', 'expectQuantity');
    consumer.expectReadOnlyNativeEvidence('node_modules/vitest/dist/index.d.ts');
    consumer.expectChangedNativeEvidenceStopsWrite('notes.txt');
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('initializes the chosen project and builds its starter through installed public exports', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.initializeProject('chosen-game', 'typescript');
    consumer.expectInstalledInitialization(['package.json', 'tsconfig.json', 'src/index.ts', '.gitignore']);
    consumer.expectInstalledToolchainAcquired('typescript', '5.9.3');
    consumer.expectInstalledStarterBuild('5.9.3');
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('acquires packages in a UUID folder through the installed public product', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.provideLocalLibraryAndNativeRegistry('workspace-ac9f7484-6445-4166-82d0-d154b34699f2');
    await consumer.installConfiguredStorage();
    consumer.expectSelectedAndInstalledStorage('2.1.0');
    await consumer.loadAcquiredLibrary('use Book from "books"\nfunction save(book: Book) returns Nothing');
    consumer.expectAcquiredFieldType('Book.title', 'Text');
    consumer.expectSelectedAndInstalledStorage('2.1.0');
    consumer.expectNoLibraryModuleInWorkspaceOwnership();
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('reads handwritten TypeScript and discovers an unmodeled caller through the installed package', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.readTypeScriptProject({
      'store.ts': 'export class StoreGame { private count = 1; }',
      'run.ts': 'import { StoreGame } from "./store.js"; export const game = new StoreGame();',
    });

    consumer.expectInstalledProjectFile('store.ts', 'export class StoreGame { private count = 1; }');
    consumer.expectInstalledProjectConsumer('run.ts', 'StoreGame', 'new StoreGame()', 'construct');
    consumer.expectRuntimeTypeScriptInstalled('5.9.3');
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('applies a guarded file change through the installed public writer', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.changeProjectFile('original book', 'updated book');

    consumer.expectInstalledPackageUsed();
    consumer.expectProjectFileChanged('original book', 'updated book');
  });
});
