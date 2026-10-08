import { describe, it } from 'vitest';
import { SnapshotExamples } from '../../../dsl/project/connection/parallel-snapshots.js';

describe('Fresh connected project snapshots with bounded independent acquisition', () => {
  it('reads independent files while one owned file acquisition is paused', async () => {
    const project = await SnapshotExamples.withFiles({
      'notes/first.txt': 'First', 'notes/second.txt': 'Second',
      'src/title.txt': 'Title', 'nested/value.txt': 'Value',
      'more/a.txt': 'A', 'more/b.txt': 'B', 'more/c.txt': 'C', 'more/d.txt': 'D',
    });
    await project.readWithFirstFilePaused();
    project.expectFiles({ 'nested/value.txt': 'Value', 'notes/first.txt': 'First',
      'notes/second.txt': 'Second', 'src/title.txt': 'Title',
      'more/a.txt': 'A', 'more/b.txt': 'B', 'more/c.txt': 'C', 'more/d.txt': 'D' });
    project.expectComplete();
    project.expectAllOpenedHandlesClosed();
    project.expectOtherFileReadWhilePaused();
  });

  it('bounds actual owned handles while acquiring eight independent file bodies', async () => {
    const project = await SnapshotExamples.withFiles({
      'notes/first.txt': 'First', 'notes/second.txt': 'Second',
      'src/title.txt': 'Title', 'nested/value.txt': 'Value',
      'more/a.txt': 'A', 'more/b.txt': 'B', 'more/c.txt': 'C', 'more/d.txt': 'D',
    });
    await project.readWithBodiesPaused();
    project.expectFiles({ 'nested/value.txt': 'Value', 'notes/first.txt': 'First',
      'notes/second.txt': 'Second', 'src/title.txt': 'Title',
      'more/a.txt': 'A', 'more/b.txt': 'B', 'more/c.txt': 'C', 'more/d.txt': 'D' });
    project.expectComplete();
    project.expectAllOpenedHandlesClosed();
    project.expectAtMostActiveFileHandles(4);
  });

  it('keeps an independent sibling when another captured directory is replaced', async () => {
    const project = await SnapshotExamples.withFiles({ 'z-changed/item.txt': 'Old', 'a-stable/item.txt': 'Stable' });
    project.replaceDirectoryAfterItsChildrenAreRead('z-changed', { 'item.txt': 'New' });
    await project.read();
    project.expectIncompleteAt('z-changed', 'changed-during-read');
    project.expectNoCapturedFile('z-changed/item.txt');
    project.expectFile('a-stable/item.txt', 'Stable');
    project.expectAllOpenedHandlesClosed();
  });

  it('retains captured descendants when the final directory observation fails', async () => {
    const project = await SnapshotExamples.withFiles({ 'z-changed/item.txt': 'Read', 'a-stable/item.txt': 'Stable' });
    project.removeDirectoryBeforeFinalObservation('z-changed');
    await project.read();
    project.expectIncompleteAt('z-changed', 'read-failed');
    project.expectFile('z-changed/item.txt', 'Read');
    project.expectFile('a-stable/item.txt', 'Stable');
    project.expectAllOpenedHandlesClosed();
  });

  it('returns independent fresh graphs in simultaneous and later reads', async () => {
    const project = await SnapshotExamples.withFiles({ 'title.txt': 'Before' });
    await project.readSimultaneously();
    project.expectIndependentSnapshotsWithFile('title.txt', 'Before');
    await project.write('title.txt', 'After');
    await project.read();
    project.expectFile('title.txt', 'After');
    project.expectEarlierSnapshotsWithFile('title.txt', 'Before');
  });
});
