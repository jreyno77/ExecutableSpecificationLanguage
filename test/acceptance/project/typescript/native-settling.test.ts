import { afterEach, describe, it } from 'vitest';
import { SettlingNativeExamples } from '../../../dsl/project/typescript/native-settling.js';

afterEach(() => SettlingNativeExamples.clean());

describe('initial native evidence after one status-time settling event', () => {
  it('captures the same declaration bytes after a single settled status change', async () => {
    const project = await SettlingNativeExamples.connected();
    await project.package('catalog', { types: 'index.d.ts' }, {
      'index.d.ts': 'export interface Book { title: string }',
    });
    project.settleStatusOnceDuringInitialRead('node_modules/catalog/index.d.ts');
    await project.capture({ imports: ['catalog'] });
    project.expectComplete();
    project.expectReadOnlyText('node_modules/catalog/index.d.ts', 'export interface Book { title: string }');
    project.expectVersionIsHashOfActualBytes('node_modules/catalog/index.d.ts');
    project.expectNoEditablePackageFiles();
    project.expectOwnedDescriptorsClosed();
  });

  it('does not reread a declaration whose first read is fully stable', async () => {
    const project = await SettlingNativeExamples.catalog('export interface Book {}');
    project.observeInitialFileReads('node_modules/catalog/index.d.ts');
    await project.capture({ imports: ['catalog'] });
    project.expectComplete(); project.expectReadOnlyText('node_modules/catalog/index.d.ts', 'export interface Book {}');
    project.expectInitialAcquisitionReads('node_modules/catalog/index.d.ts', 1);
  });

  it('refuses different second-read bytes even when they have the same length and timestamp', async () => {
    const project = await SettlingNativeExamples.catalog('export type Value = "A";');
    project.settleStatusOnceDuringInitialRead('node_modules/catalog/index.d.ts');
    project.replaceBytesBeforeSettlingReadPreservingSizeAndModificationTime('node_modules/catalog/index.d.ts', 'export type Value = "B";');
    project.pinOnlyStatusTimeToCandidateDuringSettlingRead('node_modules/catalog/index.d.ts');
    await project.capture({ imports: ['catalog'] });
    project.expectIncomplete(); project.expectProblemAt('stale-project', 'node_modules/catalog/index.d.ts');
    project.expectNoReadOnlyFile('node_modules/catalog/index.d.ts');
    project.expectInitialActualReadBodies('node_modules/catalog/index.d.ts', ['export type Value = "A";', 'export type Value = "B";']);
    project.expectInitialAcquisitionReads('node_modules/catalog/index.d.ts', 2);
    project.expectSettlingMetadataChecksAgree('node_modules/catalog/index.d.ts');
    project.expectOwnedDescriptorsClosed();
  });

  it('refuses a mode change during the first read', async () => {
    const project = await SettlingNativeExamples.catalog('export interface Book {}');
    project.changeModeDuringInitialRead('node_modules/catalog/index.d.ts');
    await project.capture({ imports: ['catalog'] });
    project.expectIncomplete(); project.expectProblemAt('stale-project', 'node_modules/catalog/index.d.ts');
  });

  it('refuses a replacement identity even when the declaration bytes match', async () => {
    const project = await SettlingNativeExamples.catalog('export interface Book {}');
    project.replaceFileDuringInitialRead('node_modules/catalog/index.d.ts', 'export interface Book {}');
    await project.capture({ imports: ['catalog'] });
    project.expectIncomplete(); project.expectProblemAt('stale-project', 'node_modules/catalog/index.d.ts');
  });

  it('refuses a changed modification time instead of treating it as status settling', async () => {
    const project = await SettlingNativeExamples.catalog('export interface Book {}');
    project.changeModificationTimeDuringInitialRead('node_modules/catalog/index.d.ts');
    await project.capture({ imports: ['catalog'] });
    project.expectIncomplete(); project.expectProblemAt('stale-project', 'node_modules/catalog/index.d.ts');
  });

  it('refuses a status change before the first descriptor is opened', async () => {
    const project = await SettlingNativeExamples.catalog('export interface Book {}');
    project.changeStatusBetweenObservationAndOpen('node_modules/catalog/index.d.ts');
    await project.capture({ imports: ['catalog'] });
    project.expectIncomplete(); project.expectProblemAt('stale-project', 'node_modules/catalog/index.d.ts');
  });

  it('refuses named metadata that differs from the first read descriptor', async () => {
    const project = await SettlingNativeExamples.catalog('export interface Book {}');
    project.changeStatusAgainBeforeNamedCheck('node_modules/catalog/index.d.ts');
    await project.capture({ imports: ['catalog'] });
    project.expectIncomplete(); project.expectProblemAt('stale-project', 'node_modules/catalog/index.d.ts');
  });

  it('refuses a second status change rather than reading until it succeeds', async () => {
    const project = await SettlingNativeExamples.catalog('export interface Book {}');
    project.changeStatusOnEveryInitialRead('node_modules/catalog/index.d.ts');
    await project.capture({ imports: ['catalog'] });
    project.expectIncomplete(); project.expectProblemAt('stale-project', 'node_modules/catalog/index.d.ts');
    project.expectInitialAcquisitionReads('node_modules/catalog/index.d.ts', 2);
    project.expectOwnedDescriptorsClosed();
  });

  it('refuses a symlink substituted before the settling read', async () => {
    const project = await SettlingNativeExamples.catalog('export interface Book {}');
    project.settleStatusOnceDuringInitialRead('node_modules/catalog/index.d.ts');
    await project.replaceWithLinkBeforeSettlingRead('node_modules/catalog/index.d.ts');
    await project.capture({ imports: ['catalog'] });
    project.expectIncomplete(); project.expectProblemAt('stale-project', 'node_modules/catalog/index.d.ts');
    project.expectLinkTargetNotRead();
  });

  it('still detects a newly appearing higher-priority native route', async () => {
    const project = await SettlingNativeExamples.connected();
    await project.package('catalog', { types: 'index.d.ts' }, {
      'index.d.ts': 'export type { Book } from "./book";', 'book/index.d.ts': 'export interface Book {}',
    });
    project.settleStatusOnceDuringInitialRead('node_modules/catalog/book/index.d.ts');
    project.createDuringSettlingRead('node_modules/catalog/book.d.ts', 'export interface Book { changed: true }');
    await project.capture({ imports: ['catalog'] });
    project.expectIncomplete(); project.expectAnyProblem('stale-project');
  });

  it('does not settle metadata changed after the final awaited project capture', async () => {
    const project = await SettlingNativeExamples.catalog('export interface Book {}');
    project.settleStatusOnceDuringInitialRead('node_modules/catalog/index.d.ts');
    project.changeStatusAfterFinalProjectRead('node_modules/catalog/index.d.ts');
    await project.capture({ imports: ['catalog'] });
    project.expectIncomplete(); project.expectAnyProblem('stale-project');
  });

  it('keeps native bytes read-only after successful settling', async () => {
    const project = await SettlingNativeExamples.catalog('export interface Book {}');
    project.settleStatusOnceDuringInitialRead('node_modules/catalog/index.d.ts');
    await project.capture({ imports: ['catalog'] }); project.expectComplete();
    await project.attemptPackageWrite('node_modules/catalog/index.d.ts', 'export interface ChangedBook {}');
    project.expectWriteRejectedBeforeMutation();
    project.expectActualText('node_modules/catalog/index.d.ts', 'export interface Book {}');
  });
});
