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
