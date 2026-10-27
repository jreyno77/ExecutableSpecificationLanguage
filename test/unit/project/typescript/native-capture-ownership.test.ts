import { describe, expect, it } from 'vitest';
import { nativeOwnership } from '../../../driver/project/typescript/native-capture-ownership.js';

describe('owned native TypeScript capture', () => {
  it('keeps an ordinary custom native host capture independently owned', async () => {
    const native = await nativeOwnership('export interface Book { title: string }');
    const capture = native.ordinaryCaptureWithCustomHost();
    native.changeProvidedSource('export interface Lost {}');
    native.expectCaptureSource(capture, 'export interface Book { title: string }');
    native.expectCheckedField('Book', 'title', 'string');
  });

  it('disposes the real owned native service after returning its diagnostics', async () => {
    const native = await nativeOwnership('export interface Book { title: string }');
    expect(native.checkOwned()).toEqual([]);
    native.expectCheckedField('Book', 'title', 'string');
    native.expectServiceLifecycle({ created: 1, disposed: 1 });
  });

  it('propagates the original post-construction failure after disposing its real service', async () => {
    const native = await nativeOwnership('export interface Book { title: }');
    const failure = new Error('owned findings failed');
    native.failOwnedFindings(failure);
    expect(native.captureOwnedFailure()).toBe(failure);
    native.expectFindingsFailureReached();
    native.expectServiceLifecycle({ created: 1, disposed: 1 });
  });

  it('refuses changed provider bytes without changing its owned source observation', async () => {
    const native = await nativeOwnership('export interface Book { title: string }');
    await native.installDeclaration('catalog', 'export interface Catalog { book: string }');
    native.changeProvidedSourceDuringRead('catalog', 'export interface Lost {}');
    const captured = await native.capture(['catalog']);
    native.expectDeclarationRead();
    native.expectSource(captured, 'export interface Book { title: string }');
    native.expectStale(captured);
  });

  it('retains its owned observation while the fresh provider capture is pending', async () => {
    const native = await nativeOwnership('export interface Book { title: string }');
    const fresh = native.holdFreshCapture(), reading = native.capture();
    try {
      await fresh.entered;
      native.changeProvidedSource('export interface Lost {}');
    } finally { fresh.release(); }
    const captured = await reading;
    native.expectSource(captured, 'export interface Book { title: string }');
    native.expectStale(captured);
  });
});
