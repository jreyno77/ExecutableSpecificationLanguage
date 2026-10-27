import { describe, it } from 'vitest';
import { ConfirmedBuild } from '../../dsl/cli/confirmed-build.js';

describe('confirmed connected build acquisition', () => {
  it('build evidence confirms a status-only change while reading an authored file', async () => {
    const build = await ConfirmedBuild.withFile('src/book.ts', 'export const copies = 1;');
    build.fileStatusSettlesDuringRead('src/book.ts');
    await build.collect();
    build.expectCompleteFile('src/book.ts', 'export const copies = 1;');
    build.expectConfirmedActualBodies('src/book.ts', 'export const copies = 1;');
  });
  it('a subsequent build acquisition also confirms the settled file', async () => {
    const build = await ConfirmedBuild.withFile('src/book.ts', 'export const copies = 1;');
    await build.collect();
    build.fileStatusSettlesDuringRead('src/book.ts');
    await build.collect();
    build.expectCompleteFile('src/book.ts', 'export const copies = 1;');
    build.expectClosedDescriptors();
  });
  it('native declaration capture uses the same confirmed project acquisition', async () => {
    const build = await ConfirmedBuild.withNativeType('src/book.ts', 'import type { Value } from "tiny-types"; export const book: Value = { n: 1 };');
    build.fileStatusSettlesDuringNativeRead('src/book.ts');
    await build.collect();
    build.expectCompleteFile('src/book.ts', 'import type { Value } from "tiny-types"; export const book: Value = { n: 1 };');
    build.expectNativeDeclaration('node_modules/tiny-types/index.d.ts', 'export interface Value { n: number }');
  });
  it('changed bytes during confirmation remain refused', async () => {
    const build = await ConfirmedBuild.withFile('src/book.ts', 'export const copies = 1;');
    build.replaceDuringConfirmation('src/book.ts', 'export const copies = 2;');
    await build.collect();
    build.expectIncomplete('changed-during-read');
  });
  it('a second metadata change during confirmation remains refused', async () => {
    const build = await ConfirmedBuild.withFile('src/book.ts', 'export const copies = 1;');
    build.fileStatusChangesDuringBothReads('src/book.ts');
    await build.collect();
    build.expectIncomplete('changed-during-read');
    build.expectNoThirdBodyReadInTriggeredConfirmation();
  });
  it('a supplied project without confirmed capture remains supported', async () => {
    const build = await ConfirmedBuild.withOrdinarySource('src/book.ts', 'export const copies = 1;');
    await build.collect();
    build.expectCompleteFile('src/book.ts', 'export const copies = 1;');
  });
  it('an incomplete confirmed capture never falls back to strict reading', async () => {
    const build = await ConfirmedBuild.withFile('src/book.ts', 'export const copies = 1;');
    build.fileStatusChangesDuringBothReads('src/book.ts');
    await build.collect();
    build.expectIncomplete('changed-during-read');
    build.expectNoOrdinaryFallback();
  });
  it('a rejected confirmed capture surfaces its failure without strict fallback', async () => {
    const build = await ConfirmedBuild.withFile('src/book.ts', 'export const copies = 1;');
    build.rejectConfirmedCapture('The captured project became unavailable.');
    await build.expectCollectionRejected('The captured project became unavailable.');
    build.expectNoOrdinaryFallback();
  });
  it('stable build acquisitions each read the authored body once', async () => {
    const build = await ConfirmedBuild.withFile('src/book.ts', 'export const copies = 1;');
    await build.collect();
    build.expectCompleteFile('src/book.ts', 'export const copies = 1;');
    build.expectOneBodyReadPerAcquisition();
  });
  it('the final fresh acquisition confirms a settled file before comparing evidence', async () => {
    const build = await ConfirmedBuild.withFile('src/book.ts', 'export const copies = 1;');
    build.fileStatusSettlesDuringFinalRead('src/book.ts');
    await build.collect();
    build.expectCompleteFile('src/book.ts', 'export const copies = 1;');
    build.expectConfirmedActualBodies('src/book.ts', 'export const copies = 1;');
  });
});
