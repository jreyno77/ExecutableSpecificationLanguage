import { describe, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical } from '../../../src/model/identity-baseline.js';
import { JournalProject } from '../../dsl/cli/journal-project.js';

const statePath = '.expec/outputs/616363657074616e6365.json';

describe('retiring completed acceptance confirmations for the journal caller', () => {
  it('removes only the pending record with equivalent reordered associations and later handwriting', async () => {
    const project = await JournalProject.completedConfirmation();
    await project.write('test/driver/counts.ts', 'export class CountsDriver { count(): number { return 2; } }');
    await project.rememberActualFiles();

    await project.recover();

    project.expectRecovered();
    await project.expectOnlyPendingRemoved();
    await project.expectText('test/driver/counts.ts', 'export class CountsDriver { count(): number { return 2; } }');
  });

  it('keeps an unapplied confirmation update after a later edit', async () => {
    const project = await JournalProject.completedConfirmation({ unapplied: true });
    await project.write('notes.txt', 'new handwriting');
    await project.rememberActualFiles();

    await project.recover();

    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('keeps metadata that changes more than confirmation fields', async () => {
    const project = await JournalProject.completedConfirmation({ nonConfirmation: true });
    await project.write('notes.txt', 'new handwriting');
    await project.rememberActualFiles();

    await project.recover();

    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('keeps a refresh whose candidate changes the original confirmed identity', async () => {
    const project = await JournalProject.completedConfirmation({ changedIdentity: true });
    await project.write('notes.txt', 'new handwriting');
    await project.rememberActualFiles();

    await project.recover();

    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('keeps a complete planned confirmation after its actual metadata bytes are changed', async () => {
    const project = await JournalProject.completedConfirmation();
    await project.write(statePath, '{}');
    await project.write('notes.txt', 'new handwriting');
    await project.rememberActualFiles();

    await project.recover();

    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('keeps an acceptance journal that also planned a public generated file', async () => {
    const project = await JournalProject.completedConfirmation({ publicWrite: true });
    await project.write('notes.txt', 'new handwriting');
    await project.rememberActualFiles();

    await project.recover();

    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('keeps a confirmation with a corrupted retained metadata preimage', async () => {
    const project = await JournalProject.completedConfirmation();
    await project.rewritePending(record => { record.graph.files.find((file: any) => file.path === statePath).bytes = Buffer.from('{}').toString('base64'); });
    await project.rememberActualFiles();

    await project.recover();

    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('keeps a confirmation with duplicate original file facts', async () => {
    const project = await JournalProject.completedConfirmation();
    await project.rewritePending(record => { record.graph.files.push({ ...record.graph.files[0] }); });
    await project.rememberActualFiles();

    await project.recover();

    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it.each([
    ['an editable package file', (record: any) => { record.graph.files.push({ path: 'node_modules/pkg/index.d.ts', version: '0'.repeat(64) }); }],
    ['an excluded editable file', (record: any) => { record.graph.files.push({ path: '.git/config', version: '0'.repeat(64) }); }],
    ['a file used as another file parent', (record: any) => { record.graph.files.push({ path: 'test/driver/counts.ts/child.txt', version: '0'.repeat(64) }); }],
    ['read-only evidence outside packages', (record: any) => { const facts = JSON.parse(record.facts); facts.readOnly.push(['notes.d.ts', '0'.repeat(64)]); record.facts = canonical(facts); }],
    ['native evidence contradicting an original editable fact', (record: any) => {
      const uri = pathToFileURL(join(record.graph.root.path, 'test/driver/counts.ts')).href;
      record.graph.nativeInputs.push({ uri, version: '0'.repeat(64) });
      const facts = JSON.parse(record.facts); facts.native = [...record.graph.nativeInputs].sort((a, b) => a.uri.localeCompare(b.uri)); record.facts = canonical(facts);
    }],
    ['missing manifest native evidence', (record: any) => {
      record.graph.nativeInputs = record.graph.nativeInputs.filter((input: any) => input.uri !== pathToFileURL(record.manifest).href);
      const facts = JSON.parse(record.facts); facts.native = [...record.graph.nativeInputs].sort((a, b) => a.uri.localeCompare(b.uri)); record.facts = canonical(facts);
    }],
    ['a missing required identity preimage', (record: any) => { delete record.graph.files.find((file: any) => file.path === '.expec/identity.json').bytes; }],
    ['a corrupted original identity preimage', (record: any) => { record.graph.files.find((file: any) => file.path === '.expec/identity.json').bytes = Buffer.from('{}').toString('base64'); }],
    ['a candidate inconsistent with the planned identity', (record: any) => { record.candidate.context = 'sha256:' + '0'.repeat(64); }],
    ['a changed planned acceptance association', (record: any) => { record.plans[0].artifacts[0].locator.value.file = 'test/driver/other.ts'; }],
  ])('keeps completed bookkeeping with %s', async (_name, corrupt) => {
    const project = await JournalProject.completedConfirmation();
    await project.write('notes.txt', 'later public edit');
    await project.rewritePending(corrupt);
    await project.rememberActualFiles();

    await project.recover();

    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it.skipIf(process.platform !== 'win32')('keeps completed bookkeeping with a Windows case alias', async () => {
    const project = await JournalProject.completedConfirmation();
    await project.write('notes.txt', 'later public edit');
    await project.rewritePending(record => { record.graph.files.push({ path: 'TEST/DRIVER/COUNTS.ts', version: '0'.repeat(64) }); });
    await project.rememberActualFiles();

    await project.recover();

    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('keeps completed bookkeeping when the current identity bytes change', async () => {
    const project = await JournalProject.completedConfirmation();
    await project.write('.expec/identity.json', '{}');
    await project.rememberActualFiles();

    await project.recover();

    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('retains an eligible journal when cleanup is cancelled', async () => {
    const project = await JournalProject.completedConfirmation();
    await project.rememberActualFiles();

    await project.recoverCancelled();

    project.expectProblem('write-cancelled');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('reports completed cleanup when cancellation arrives after actual unlink', async () => {
    const project = await JournalProject.completedConfirmation();
    await project.rememberActualFiles();
    project.cancelAfterPendingRemoval();

    await project.recover();

    project.expectProblem('write-cancelled');
    project.expectStoppedCleanupWithAppliedRemoval();
    await project.expectNoPending();
    await project.expectFilesExceptPendingUnchanged();
  });

  it('preserves a concurrent public edit observed after actual journal unlink', async () => {
    const project = await JournalProject.completedConfirmation();
    await project.rememberActualFiles();
    project.changeAfterPendingRemoval('notes.txt', 'concurrent handwriting');

    await project.recover();

    project.expectProblem('stale-project');
    project.expectStoppedCleanupWithAppliedRemoval();
    await project.expectNoPending();
    await project.expectText('notes.txt', 'concurrent handwriting');
    await project.expectIdentityUnchanged();
  });

  it('does not discard an eligible journal over an edit made during cleanup', async () => {
    const project = await JournalProject.completedConfirmation();
    project.changeDuringCleanup('notes.txt', 'concurrent handwriting');

    await project.recover();

    project.expectProblem('stale-project');
    await project.expectText('notes.txt', 'concurrent handwriting');
    await project.expectPendingRetained();
  });
});
