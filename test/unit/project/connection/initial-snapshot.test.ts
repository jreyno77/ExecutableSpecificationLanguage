import { describe, it } from 'vitest';
import { SnapshotProject } from '../../../dsl/project/connection/initial-snapshot.js';

describe('initial connected project snapshot', () => {
  it('captures stable project files with one body read', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    await project.captureInitialSnapshot();
    project.expectCompleteFile('*.expec text eol=lf\n');
    project.expectBodyReads(1);
    project.expectOpens(1);
    project.expectStatusObservations(2, 2);
    project.expectClosedDescriptors();
  });

  it('confirms unchanged project bytes after one initial status transition', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    project.statusChangesDuringRead();
    await project.captureInitialSnapshot();
    project.expectCompleteFile('*.expec text eol=lf\n');
    project.expectStrictConfirmationOfActualBodies('*.expec text eol=lf\n');
    project.expectBodyReads(2);
    project.expectOpens(2);
    project.expectClosedBeforeReopen();
    project.expectClosedDescriptors();
  });

  it('keeps an ordinary snapshot read strict for the same transition', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    project.statusChangesDuringRead();
    await project.readSnapshot();
    project.expectIncomplete('changed-during-read');
    project.expectBodyReads(1);
    project.expectOpens(1);
    project.expectClosedDescriptors();
  });

  it('keeps a later snapshot read strict after successful initial capture', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    await project.captureInitialSnapshot();
    project.expectCompleteFile('*.expec text eol=lf\n');
    project.statusChangesDuringRead();
    await project.readSnapshot();
    project.expectIncomplete('changed-during-read');
    project.expectBodyReads(2);
    project.expectOpens(1);
    project.expectClosedDescriptors();
  });

  it('refuses equal-size changed actual bytes despite otherwise stable confirmation', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    project.replaceBetweenReads('*.expec text eol=cr\n');
    await project.captureInitialSnapshot();
    project.expectComparedBodies('*.expec text eol=lf\n', '*.expec text eol=cr\n');
    project.expectStrictConfirmationTuples();
    project.expectIncomplete('changed-during-read');
    project.expectBodyReads(2);
    project.expectOpens(2);
    project.expectClosedDescriptors();
  });

  it('refuses a fresh named tuple different from the settled candidate before reopening', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    project.candidateChangesBeforeReopen();
    await project.captureInitialSnapshot();
    project.expectIncomplete('changed-during-read');
    project.expectCandidateAnchorRejected();
    project.expectBodyReads(1);
    project.expectOpens(1);
    project.expectClosedDescriptors();
  });

  it('refuses another status transition during the confirming read', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    project.statusChangesDuringBothReads();
    await project.captureInitialSnapshot();
    project.expectIncomplete('changed-during-read');
    project.expectBodyReads(2);
    project.expectNoThirdRead();
    project.expectClosedDescriptors();
  });

  it('refuses a modified-time change without a confirming read', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    project.modifiedTimeChangesDuringRead();
    await project.captureInitialSnapshot();
    project.expectIncomplete('changed-during-read');
    project.expectBodyReads(1);
    project.expectOpens(1);
    project.expectClosedDescriptors();
  });

  it('refuses a mode change without a confirming read', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    project.modeChangesDuringRead();
    await project.captureInitialSnapshot();
    project.expectIncomplete('changed-during-read');
    project.expectBodyReads(1);
    project.expectOpens(1);
    project.expectClosedDescriptors();
  });

  it('refuses a named-after identity disagreement without a confirming read', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    project.namedIdentityDisagreesAfterBody();
    await project.captureInitialSnapshot();
    project.expectIncomplete('changed-during-read');
    project.expectBodyReads(1);
    project.expectOpens(1);
    project.expectClosedDescriptors();
  });

  it('refuses an opened file differing from the original named observation', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    project.openedFileDisagreesWithNamedFile();
    await project.captureInitialSnapshot();
    project.expectIncomplete('changed-during-read');
    project.expectBodyReads(0);
    project.expectOpens(1);
    project.expectClosedDescriptors();
  });

  it('reports a first-close error without a confirming reopen', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    project.statusChangesDuringRead();
    project.closeReportsErrorAfterPhysicalClose(1);
    await project.captureInitialSnapshot();
    project.expectIncomplete('read-failed');
    project.expectBodyReads(1);
    project.expectOpens(1);
    project.expectClosedDescriptors();
  });

  it('reports a confirming-close error without publishing provisional bytes', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    project.statusChangesDuringRead();
    project.closeReportsErrorAfterPhysicalClose(2);
    await project.captureInitialSnapshot();
    project.expectIncomplete('read-failed');
    project.expectBodyReads(2);
    project.expectOpens(2);
    project.expectClosedBeforeReopen();
    project.expectClosedDescriptors();
  });

  it('preserves the ordinary stable-close error and its already observed partial file', async () => {
    const project = await SnapshotProject.connected('*.expec text eol=lf\n');
    project.closeReportsErrorAfterPhysicalClose(1);
    await project.captureInitialSnapshot();
    project.expectIncomplete('read-failed', true);
    project.expectCapturedFile('*.expec text eol=lf\n');
    project.expectBodyReads(1);
    project.expectOpens(1);
    project.expectStatusObservations(2, 2);
    project.expectClosedDescriptors();
  });
});
