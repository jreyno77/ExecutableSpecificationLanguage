import { describe, it } from 'vitest';
import { nativeStage } from '../../driver/cli/native-stage-memory.js';

describe('native stage snapshot ownership', () => {
  it('captures native stage evidence with only the consumer ownership copies', async () => {
    const stage = await nativeStage({ source: 'export interface Book { title: string }', opaqueBytes: 65_536 });
    const captured = await stage.capture();
    stage.expectSource(captured, 'export interface Book { title: string }');
    stage.expectProblems(captured, []);
    stage.expectNativeSnapshotCopies(2);
  });

  it('reuses native evidence without copying the private provider again', async () => {
    const stage = await nativeStage({ source: 'export interface Book { title: string }', opaqueBytes: 65_536 });
    await stage.capture();
    const captured = await stage.capture();
    stage.expectSource(captured, 'export interface Book { title: string }');
    stage.expectProblems(captured, []);
    stage.expectNativeSnapshotCopies(1);
  });

  it('keeps returned evidence independent of the supplied stage bytes', async () => {
    const stage = await nativeStage({ source: 'export interface Book { title: string }', opaqueBytes: 65_536 });
    const captured = await stage.capture();
    stage.changeReturnedSource(captured, 'export interface Lost {}');
    stage.expectOriginalSource('export interface Book { title: string }');
    stage.expectSource(await stage.capture(), 'export interface Book { title: string }');
  });
});
