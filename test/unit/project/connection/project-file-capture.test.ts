import { describe, it } from 'vitest';
import { CapturedFile } from '../../../dsl/project/connection/project-file-capture.js';

describe('guarded project file capture', () => {
  it('a stable file is captured from one actual body', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    await file.capture();
    file.expectCapturedBytes('{"copies":1}');
    file.expectOneBodyRead();
  });
  it('a status-only transition is confirmed by identical actual bodies after the first handle closes', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    file.statusSettlesDuringRead();
    await file.capture();
    file.expectCapturedBytes('{"copies":1}');
    file.expectConfirmedActualBodies('{"copies":1}');
  });
  it('capture refuses a modification-time change instead of confirming it', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    file.modificationTimeChangesDuringRead();
    await file.capture();
    file.expectRefused('stale-project');
    file.expectOneBodyRead();
  });
  it('capture refuses a mode change instead of confirming it', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    file.modeChangesDuringRead();
    await file.capture();
    file.expectRefused('stale-project');
    file.expectOneBodyRead();
  });
  it('capture refuses a size change without a confirmation read', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    file.sizeChangesDuringRead();
    await file.capture();
    file.expectRefused('stale-project');
    file.expectOneBodyRead();
  });
  it('capture refuses a different named identity after the read', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    file.namedIdentityChangesDuringRead();
    await file.capture();
    file.expectRefused('stale-project');
    file.expectOneBodyRead();
  });
  it('capture keeps the initial named-opened tuple strict', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    file.openedStatusDisagreesWithNamedFile();
    await file.capture();
    file.expectRefused('stale-project');
    file.expectNoBodyRead();
  });
  it('capture refuses another candidate after the first handle closes', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    file.confirmationCandidateChanges();
    await file.capture();
    file.expectRefused('stale-project');
    file.expectOneBodyRead();
    file.expectOneOpen();
  });
  it('capture refuses a replaced route before reopening confirmation', async () => {
    const file = await CapturedFile.withFile('data/book.json', '{"copies":1}');
    file.statusSettlesDuringRead();
    file.routeReplacedAfterFirstClose();
    await file.capture();
    file.expectRefused('stale-project');
    file.expectOneBodyRead();
    file.expectOneOpen();
    file.expectPreservedChildAcrossReplacedRoute('{"copies":1}');
  });
  it('capture refuses a replaced route after confirmation closes', async () => {
    const file = await CapturedFile.withFile('data/book.json', '{"copies":1}');
    file.statusSettlesDuringRead();
    file.routeReplacedAfterConfirmationClose();
    await file.capture();
    file.expectRefused('stale-project');
    file.expectTwoBodies();
    file.expectPreservedChildAcrossReplacedRoute('{"copies":1}');
  });
  it('capture refuses a failed first closure without reopening', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    file.statusSettlesDuringRead();
    file.firstCloseFailsAfterPhysicalClosure();
    await file.capture();
    file.expectClosureFailure();
    file.expectOneBodyRead();
    file.expectOneOpen();
  });
  it('capture refuses a failed confirmation closure without publishing success', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    file.statusSettlesDuringRead();
    file.confirmationCloseFailsAfterPhysicalClosure();
    await file.capture();
    file.expectClosureFailure();
    file.expectTwoBodies();
  });
  it('capture with previous evidence refuses changed bytes with the same length', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    await file.captureBaseline();
    await file.replace('{"copies":2}');
    await file.verifyCaptured();
    file.expectRefused('stale-project');
  });
  it('captured verification refuses a same-byte identity replacement', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    await file.captureBaseline();
    await file.replaceIdentity('{"copies":1}');
    await file.verifyCaptured();
    file.expectRefused('stale-project');
  });
  it('captured verification refuses an absent file becoming present', async () => {
    const file = await CapturedFile.withAbsentFile('book.json');
    await file.captureBaseline();
    await file.replace('{"copies":1}');
    await file.verifyCaptured();
    file.expectRefused('stale-project');
  });
  it('captured verification refuses a present file becoming absent', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    await file.captureBaseline();
    await file.remove();
    await file.verifyCaptured();
    file.expectRefused('stale-project');
  });
  it('captured verification refuses an unknown prior observation', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    file.previousObservationIsUnknown();
    await file.verifyCaptured();
    file.expectRefused('stale-project');
  });
  it('captured verification retains multiply-linked refusal', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    await file.captureBaseline();
    await file.addOrdinaryHardLink();
    await file.verifyCaptured();
    file.expectRefused('unsupported-change');
  });
  it('captured verification accepts unchanged actual previous bytes after settlement', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    await file.captureBaseline();
    file.statusSettlesDuringRead();
    await file.verifyCaptured();
    file.expectCapturedBytes('{"copies":1}');
    file.expectConfirmedActualBodies('{"copies":1}');
  });
  it('ordinary writer reading keeps status transitions strict', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    file.statusSettlesDuringRead();
    await file.readStrictly();
    file.expectRefused('stale-project');
    file.expectOneBodyRead();
  });
  it('ordinary writer verification keeps status transitions strict', async () => {
    const file = await CapturedFile.withFile('book.json', '{"copies":1}');
    await file.captureBaseline();
    file.statusSettlesDuringRead();
    await file.verifyStrictly();
    file.expectRefused('stale-project');
    file.expectOneBodyRead();
  });
});
