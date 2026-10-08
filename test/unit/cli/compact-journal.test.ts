import { createHash } from 'node:crypto';
import { describe, it } from 'vitest';
import { JournalProject } from '../../dsl/cli/journal-project.js';

const utf8 = (value: string) => Buffer.from(value);

describe('compact pending build recovery for a journal caller', () => {
  it('retains an unrelated archive fact without copying its body and resumes the original identities', async () => {
    const project = await JournalProject.create();
    const archive = new Uint8Array(8 * 1024 * 1024).fill(0x5a);
    const version = createHash('sha256').update(archive).digest('hex');
    await project.write('tool/archive.bin', archive);
    project.stopAtWrite('Second.txt');
    await project.apply(project.plan([
      { kind: 'write', path: 'First.txt', bytes: utf8('First') },
      { kind: 'write', path: 'Second.txt', bytes: utf8('Second') },
    ]));
    await project.expectText('First.txt', 'First');
    await project.expectRecordBelow(64 * 1024);
    await project.expectFileFact('tool/archive.bin', { version, preimage: false });
    await project.rememberPendingAllocatedIds();
    project.clearWriteFailure();
    await project.recover();
    project.expectBuilt();
    await project.expectText('Second.txt', 'Second');
    await project.expectOriginalAllocatedIdsConfirmed();
    await project.expectNoPending();
  });

  it('keeps every existing mutation endpoint and prior identity as an original preimage', async () => {
    const project = await JournalProject.create({ 'changed.txt': 'before write', 'moved.txt': 'before move', 'removed.txt': 'before removal', 'notes.txt': 'unrelated' });
    await project.confirmOriginalIdentity();
    await project.rememberOriginalGraph();
    project.stopAtWrite('.expec/identity.json');
    await project.apply(project.plan([
      { kind: 'write', path: 'changed.txt', bytes: utf8('after write') },
      { kind: 'move', from: 'moved.txt', to: 'relocated.txt' },
      { kind: 'remove', path: 'removed.txt' },
    ]));
    project.expectProblem('unconfirmed-state');
    await project.expectText('changed.txt', 'after write');
    await project.expectText('relocated.txt', 'before move');
    await project.expectAbsent('moved.txt');
    await project.expectAbsent('removed.txt');
    await project.expectPreimagePaths(['.expec/identity.json', 'changed.txt', 'moved.txt', 'removed.txt']);
    await project.expectOriginalFileFacts();
    await project.expectOriginalPreimages();
    project.clearWriteFailure();
    await project.recover();
    project.expectBuilt();
    await project.expectOriginalAllocatedIdsConfirmed();
    await project.expectNoPending();
  });

  it('keeps staged completion bytes needed to reconstruct the original graph', async () => {
    const project = await JournalProject.create({ '.expec/build-transition.json': 'prior transition bytes' });
    await project.rememberOriginalGraph();
    project.stopAtWrite('.expec/identity.json');
    await project.apply(project.plan([{ kind: 'write', path: 'generated.txt', bytes: utf8('generated') }]), { kind: 'remove', path: '.expec/build-transition.json' });
    await project.expectPreimagePaths(['.expec/build-transition.json']);
    await project.expectOriginalFileFacts();
    await project.expectOriginalPreimages();
    project.clearWriteFailure();
    await project.recover();
    project.expectBuilt();
    await project.expectAbsent('.expec/build-transition.json');
    await project.expectNoPending();
  });

  it('refuses a missing required preimage even before the first planned write', async () => {
    const project = await JournalProject.create({ 'changed.txt': 'original' });
    project.stopAtWrite('changed.txt');
    await project.apply(project.plan([{ kind: 'write', path: 'changed.txt', bytes: utf8('changed') }]));
    await project.rewritePending(record => { delete record.graph.files.find((file: any) => file.path === 'changed.txt').bytes; });
    await project.rememberActualFiles();
    project.clearWriteFailure();
    await project.recover();
    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectText('changed.txt', 'original');
    await project.expectPendingRetained();
  });

  it('refuses corrupt original preimage bytes before attempting replay', async () => {
    const project = await JournalProject.create({ 'changed.txt': 'original' });
    project.stopAtWrite('changed.txt');
    await project.apply(project.plan([{ kind: 'write', path: 'changed.txt', bytes: utf8('changed') }]));
    await project.rewritePending(record => { record.graph.files[0].bytes = utf8('wrong original').toString('base64'); });
    await project.rememberActualFiles();
    project.clearWriteFailure();
    await project.recover();
    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('refuses a plan changed to target protected identity state', async () => {
    const project = await JournalProject.create({ 'changed.txt': 'original' });
    project.stopAtWrite('changed.txt');
    await project.apply(project.plan([{ kind: 'write', path: 'changed.txt', bytes: utf8('changed') }]));
    await project.rewritePending(record => { record.plans[0].changes[0].path = '.expec/identity.json'; });
    await project.rememberActualFiles();
    project.clearWriteFailure();
    await project.recover();
    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('does not treat a destination-written source-retained move as a completed operation', async () => {
    const project = await JournalProject.create({ 'source.txt': 'move me' });
    project.stopAtRemove('source.txt');
    await project.apply(project.plan([{ kind: 'move', from: 'source.txt', to: 'target.txt' }]));
    await project.expectText('source.txt', 'move me');
    await project.expectText('target.txt', 'move me');
    await project.rememberActualFiles();
    project.clearWriteFailure();
    await project.recover();
    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('continues genuine historical format-1 intent without changing allocated identities', async () => {
    const project = await JournalProject.fromLegacyFixture();
    await project.expectHistoricalFixturePreserved();
    await project.expectText('First.txt', 'First');
    await project.expectAbsent('Second.txt');
    await project.rememberPendingAllocatedIds();
    await project.recover();
    project.expectBuilt();
    await project.expectText('First.txt', 'First');
    await project.expectText('Second.txt', 'Second');
    await project.expectOriginalAllocatedIdsConfirmed();
    await project.expectNoPending();
  });

  it('refuses an extra preimage for an untouched original file', async () => {
    const project = await JournalProject.create({ 'changed.txt': 'original', 'notes.txt': 'untouched' });
    project.stopAtWrite('changed.txt');
    await project.apply(project.plan([{ kind: 'write', path: 'changed.txt', bytes: utf8('changed') }]));
    await project.rewritePending(record => { record.graph.files.find((file: any) => file.path === 'notes.txt').bytes = utf8('untouched').toString('base64'); });
    await project.rememberActualFiles();
    project.clearWriteFailure();
    await project.recover();
    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('refuses a duplicated original file row', async () => {
    const project = await JournalProject.create({ 'changed.txt': 'original' });
    project.stopAtWrite('changed.txt');
    await project.apply(project.plan([{ kind: 'write', path: 'changed.txt', bytes: utf8('changed') }]));
    await project.rewritePending(record => { record.graph.files.push({ ...record.graph.files[0] }); });
    await project.rememberActualFiles();
    project.clearWriteFailure();
    await project.recover();
    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('refuses borrowing an untouched original file that was removed', async () => {
    const project = await JournalProject.create({ 'changed.txt': 'original', 'notes.txt': 'untouched' });
    project.stopAtWrite('changed.txt');
    await project.apply(project.plan([{ kind: 'write', path: 'changed.txt', bytes: utf8('changed') }]));
    project.clearWriteFailure();
    await project.remove('notes.txt');
    await project.rememberActualFiles();
    await project.recover();
    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('refuses an unrelated file added after intent was saved', async () => {
    const project = await JournalProject.create({ 'changed.txt': 'original' });
    project.stopAtWrite('changed.txt');
    await project.apply(project.plan([{ kind: 'write', path: 'changed.txt', bytes: utf8('changed') }]));
    project.clearWriteFailure();
    await project.write('new.txt', 'new handwritten data');
    await project.rememberActualFiles();
    await project.recover();
    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('refuses an original preimage whose recorded hash was changed', async () => {
    const project = await JournalProject.create({ 'changed.txt': 'original' });
    project.stopAtWrite('changed.txt');
    await project.apply(project.plan([{ kind: 'write', path: 'changed.txt', bytes: utf8('changed') }]));
    await project.rewritePending(record => { record.graph.files[0].version = '0'.repeat(64); });
    await project.rememberActualFiles();
    project.clearWriteFailure();
    await project.recover();
    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

  it('refuses a retained plan for an unselected output', async () => {
    const project = await JournalProject.create({ 'changed.txt': 'original' });
    project.stopAtWrite('changed.txt');
    await project.apply(project.plan([{ kind: 'write', path: 'changed.txt', bytes: utf8('changed') }]));
    await project.rewritePending(record => { record.plans[0].outputId = 'foreign'; });
    await project.rememberActualFiles();
    project.clearWriteFailure();
    await project.recover();
    project.expectProblem('recovery-conflict');
    await project.expectActualFilesUnchanged();
    await project.expectPendingRetained();
  });

});
