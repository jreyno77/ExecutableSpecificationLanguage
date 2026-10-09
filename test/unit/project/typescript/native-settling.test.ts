import { afterEach, describe, it } from 'vitest';
import { SettlingNativeExamples as SettlingNativeReads } from '../../../dsl/project/typescript/native-settling.js';

afterEach(() => SettlingNativeReads.clean());

describe('the one fresh native read owns its complete evidence', () => {
  it('refuses a status change between the second named observation and opening', async () => {
    const input = await SettlingNativeReads.file('node_modules/catalog/index.d.ts', 'export interface Book {}');
    input.settleStatusOnceDuringInitialRead();
    input.changeStatusBetweenSettlingObservationAndOpen();
    input.read();
    input.expectNoText(); input.expectProblem('stale-project'); input.expectNoCapturedFile();
    input.expectSuccessfulDescriptorReads(1); input.expectOwnedDescriptorsClosed();
  });

  it('refuses a second named-after status that disagrees with its descriptor', async () => {
    const input = await SettlingNativeReads.file('node_modules/catalog/index.d.ts', 'export interface Book {}');
    input.settleStatusOnceDuringInitialRead();
    input.changeStatusOnlyAtSettlingNamedAfter();
    input.read();
    input.expectNoText(); input.expectProblem('stale-project'); input.expectNoCapturedFile();
    input.expectSuccessfulDescriptorReads(2); input.expectOwnedDescriptorsClosed();
  });

  it('closes both descriptors and publishes no file when the second read throws', async () => {
    const input = await SettlingNativeReads.file('node_modules/catalog/index.d.ts', 'export interface Book {}');
    input.settleStatusOnceDuringInitialRead();
    input.failSettlingRead('EIO');
    input.read();
    input.expectNoText(); input.expectProblem('native-read-failed'); input.expectNoCapturedFile();
    input.expectReadAttempts(2); input.expectSuccessfulDescriptorReads(1);
    input.expectOwnedDescriptorsClosed();
  });
});


describe("first-open native evidence retains one settling budget", () => {
  it('refuses a mode difference at the first opened descriptor', async () => {
    const input = await SettlingNativeReads.file('node_modules/catalog/index.d.ts', 'export interface Book {}');
    input.changeModeWhenFirstOpened();
    input.read();
    input.expectNoText(); input.expectProblem('stale-project'); input.expectNoCapturedFile();
    input.expectSuccessfulDescriptorReads(0); input.expectOwnedDescriptorsClosed();
  });

  it('refuses a size difference at the first opened descriptor', async () => {
    const input = await SettlingNativeReads.file('node_modules/catalog/index.d.ts', 'export interface Book {}');
    input.changeSizeWhenFirstOpened();
    input.read();
    input.expectNoText(); input.expectProblem('stale-project'); input.expectNoCapturedFile();
    input.expectSuccessfulDescriptorReads(0); input.expectOwnedDescriptorsClosed();
  });

  it('refuses a modification-time difference at the first opened descriptor', async () => {
    const input = await SettlingNativeReads.file('node_modules/catalog/index.d.ts', 'export interface Book {}');
    input.changeModificationTimeWhenFirstOpened();
    input.read();
    input.expectNoText(); input.expectProblem('stale-project'); input.expectNoCapturedFile();
    input.expectSuccessfulDescriptorReads(0); input.expectOwnedDescriptorsClosed();
  });

  it('refuses an identity difference at the first opened descriptor', async () => {
    const input = await SettlingNativeReads.file('node_modules/catalog/index.d.ts', 'export interface Book {}');
    input.changeIdentityWhenFirstOpened();
    input.read();
    input.expectNoText(); input.expectProblem('stale-project'); input.expectNoCapturedFile();
    input.expectSuccessfulDescriptorReads(0); input.expectOwnedDescriptorsClosed();
  });

  it('refuses another status change during the first read after opening settled', async () => {
    const input = await SettlingNativeReads.file('node_modules/catalog/index.d.ts', 'export interface Book {}');
    input.settleStatusOnceWhenFirstOpened();
    input.changeStatusAgainDuringInitialRead();
    input.read();
    input.expectNoText(); input.expectProblem('stale-project'); input.expectNoCapturedFile();
    input.expectSuccessfulDescriptorReads(1); input.expectOwnedDescriptorsClosed();
  });

  it('refuses an initial named route that disagrees with the settled opened descriptor', async () => {
    const input = await SettlingNativeReads.file('node_modules/catalog/index.d.ts', 'export interface Book {}');
    input.settleStatusOnceWhenFirstOpened();
    input.changeStatusOnlyAtInitialNamedAfter();
    input.read();
    input.expectNoText(); input.expectProblem('stale-project'); input.expectNoCapturedFile();
    input.expectSuccessfulDescriptorReads(1); input.expectOwnedDescriptorsClosed();
  });

  it('compares both actual byte bodies after opening settled despite pinned metadata', async () => {
    const input = await SettlingNativeReads.file('node_modules/catalog/index.d.ts', 'export type Value = "A";');
    input.settleStatusOnceWhenFirstOpened();
    input.replaceBytesBeforeSettlingReadPreservingSizeAndModificationTime('node_modules/catalog/index.d.ts', 'export type Value = "B";');
    input.pinOnlyStatusTimeToCandidateDuringSettlingRead('node_modules/catalog/index.d.ts');
    input.read();
    input.expectNoText(); input.expectProblem('stale-project'); input.expectNoCapturedFile();
    input.expectInitialActualReadBodies('node_modules/catalog/index.d.ts', ['export type Value = "A";', 'export type Value = "B";']);
    input.expectSettlingMetadataChecksAgree('node_modules/catalog/index.d.ts');
    input.expectSuccessfulDescriptorReads(2); input.expectOwnedDescriptorsClosed();
  });
});
