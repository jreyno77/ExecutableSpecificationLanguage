import { afterEach, describe, it } from 'vitest';
import { CapturedSource } from '../../../dsl/project/connection/source-capture.js';
let source: CapturedSource | undefined;
afterEach(async () => { const owned = source; source = undefined; await owned?.dispose(); });
describe('initial source acquisition', () => {
  it('captures stable source bytes once', async () => {
    source = await CapturedSource.author('opaque type Before');
    await source.read();
    source.expectSource('opaque type Before', 1);
  });
  it('confirms identical source bytes after one initial status change', async () => {
    source = await CapturedSource.author('opaque type Before'); source.transition('once');
    await source.read();
    await source.verifyCapture(); source.expectSource('opaque type Before', 2);
  });
  it('keeps later source verification strict and retains captured evidence', async () => {
    source = await CapturedSource.author('opaque type Before'); source.transition('once');
    await source.read(); source.expectSource('opaque type Before', 2);
    await source.changeStatusThenVerify();
    source.expectProblem('source-changed'); source.expectRetainedSource('opaque type Before');
  });
  it('refuses changed actual bytes of equal length', async () => {
    source = await CapturedSource.author('opaque type Before'); source.transition('body');
    await source.read(); source.expectConfirmedBodies('opaque type Before', 'opaque type After!'); source.expectRefused('source-changed', 2);
  });
  it('refuses a confirming status that differs from the candidate', async () => {
    source = await CapturedSource.author('opaque type Before'); source.transition('candidate');
    await source.read(); source.expectRefused('source-changed', 1);
  });
  it('refuses another transition during confirmation', async () => {
    source = await CapturedSource.author('opaque type Before'); source.transition('twice');
    await source.read(); source.expectRefused('source-changed', 2);
  });
  it('refuses modified-time changes without confirmation', async () => {
    source = await CapturedSource.author('opaque type Before'); source.transition('mtime');
    await source.read(); source.expectRefused('source-changed', 1);
  });
  it('refuses mode changes without confirmation', async () => {
    source = await CapturedSource.author('opaque type Before'); source.transition('mode');
    await source.read(); source.expectRefused('source-changed', 1);
  });
  it('refuses a named-after identity disagreement without confirmation', async () => {
    source = await CapturedSource.author('opaque type Before'); source.transition('name');
    await source.read(); source.expectRefused('source-changed', 1);
  });
  it('refuses a named/opened mismatch before reading', async () => {
    source = await CapturedSource.author('opaque type Before'); source.transition('opening');
    await source.read(); source.expectRefused('source-changed', 0);
  });
  it('reports a first-close error and does not reopen', async () => {
    source = await CapturedSource.author('opaque type Before'); source.transition('first-close');
    await source.read(); source.expectRefused('source-unavailable', 1);
  });
  it('reports a confirming-close error and does not publish', async () => {
    source = await CapturedSource.author('opaque type Before'); source.transition('second-close');
    await source.read(); source.expectRefused('source-unavailable', 2);
  });
});