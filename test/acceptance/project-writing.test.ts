import { describe, it } from 'vitest';
import { ProjectWrites } from '../dsl/project-writing.js';

describe('applying changes to an observed project', () => {
  it('creates a requested file and keeps an unrelated handwritten file', async () => {
    const project = await ProjectWrites.create({ 'src/handwritten.ts': 'export const answer = 42;\n' });
    await project.observe();
    project.write('src/generated.ts', 'export interface Book {}\n');

    await project.apply();

    project.expectOutcome('src/generated.ts', 'applied');
    await project.expectFile('src/generated.ts', 'export interface Book {}\n');
    await project.expectFile('src/handwritten.ts', 'export const answer = 42;\n');
    project.expectCompleted();
  });

  it('replaces only the specified complete file bytes', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'export interface Book {}\r\n' });
    await project.observe();
    project.write('src/book.ts', 'export interface Book { title: string }\r\n');
    await project.apply();

    await project.expectFile('src/book.ts', 'export interface Book { title: string }\r\n');
    project.expectPreviousBytes('src/book.ts', 'export interface Book {}\r\n');
    project.expectCompleted();
  });

  it('moves the requested file without changing its body', async () => {
    const project = await ProjectWrites.create({ 'src/store.ts': 'export function save() { handwritten(); }\n' });
    await project.observe();
    project.move('src/store.ts', 'src/game/store.ts');
    await project.apply();

    await project.expectAbsent('src/store.ts');
    await project.expectFile('src/game/store.ts', 'export function save() { handwritten(); }\n');
    project.expectCreatedDirectories(['src/game']);
    project.expectMoveOutcome('src/store.ts', 'src/game/store.ts', 'applied');
  });

  it('removes one requested file without deleting its directory or neighbor', async () => {
    const project = await ProjectWrites.create({ 'src/old.ts': 'old', 'src/manual.ts': 'manual' });
    await project.observe();
    project.remove('src/old.ts');
    await project.apply();

    await project.expectAbsent('src/old.ts');
    await project.expectFile('src/manual.ts', 'manual');
    await project.expectDirectory('src');
    project.expectPreviousBytes('src/old.ts', 'old');
  });

  it('moves a file with explicitly prepared text changes in one operation', async () => {
    const project = await ProjectWrites.create({ 'src/store.ts': 'export function save() { handwritten(); }\n' });
    await project.observe();
    project.moveWithBytes('src/store.ts', 'src/game.ts', 'export function saveGame() { handwritten(); }\n');
    await project.apply();

    await project.expectAbsent('src/store.ts');
    await project.expectFile('src/game.ts', 'export function saveGame() { handwritten(); }\n');
    project.expectPreviousBytes('src/store.ts', 'export function save() { handwritten(); }\n');
    project.expectMoveOutcome('src/store.ts', 'src/game.ts', 'applied');
  });

  it('leaves an unchanged repeat untouched', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book' });
    await project.observe();
    await project.rememberFileMetadata('src/book.ts', ['mtime', 'mode', 'identity']);
    project.write('src/book.ts', 'book');
    await project.apply();

    project.expectUnchanged();
    project.expectOutcome('src/book.ts', 'unchanged');
    await project.expectRememberedFileMetadata('src/book.ts', ['mtime', 'mode', 'identity']);
  });

  it('keeps a handwritten edit made after planning', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'original' });
    await project.observe();
    project.write('src/book.ts', 'generated');
    await project.edit('src/book.ts', 'handwritten');
    await project.apply();

    project.expectStopped('stale-project');
    project.expectNoAppliedChanges();
    await project.expectFile('src/book.ts', 'handwritten');
  });

  it('rejects deletion after a new unmodeled consumer appears', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'export class Book {}' });
    await project.observe();
    project.remove('src/book.ts');
    await project.edit('src/launcher.ts', 'import { Book } from "./book.js"; new Book();');
    await project.apply();

    project.expectStopped('stale-project');
    await project.expectFile('src/book.ts', 'export class Book {}');
    await project.expectFile('src/launcher.ts', 'import { Book } from "./book.js"; new Book();');
    project.expectNoAppliedChanges();
  });

  it('checks files that are not themselves being written', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book', 'src/use.ts': 'old use' });
    await project.observe();
    project.write('src/book.ts', 'new book');
    await project.edit('src/use.ts', 'changed use');
    await project.apply();

    project.expectStopped('stale-project');
    await project.expectFile('src/book.ts', 'book');
  });

  it('allows changes inside an explicitly excluded directory', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book', 'node_modules/pkg/index.js': 'old package' });
    await project.observe();
    project.write('src/book.ts', 'new book');
    await project.edit('node_modules/pkg/index.js', 'new package');
    await project.apply();

    project.expectCompleted();
    await project.expectFile('src/book.ts', 'new book');
    await project.expectFile('node_modules/pkg/index.js', 'new package');
  });

  it('does not write using an incomplete snapshot', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book' });
    await project.addInternalLink('linked', 'src');
    await project.observe();
    project.write('src/book.ts', 'new book');
    await project.apply();

    project.expectStopped('incomplete-project');
    project.expectNoAppliedChanges();
    await project.expectFile('src/book.ts', 'book');
  });

  it('rejects an escaped destination before making any planned changes', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book' });
    await project.observe();
    project.write('src/book.ts', 'new book');
    project.write('../outside.ts', 'escaped');
    await project.apply();

    project.expectStopped('invalid-change');
    project.expectNoAppliedChanges();
    await project.expectFile('src/book.ts', 'book');
    await project.expectOutsideAbsent('outside.ts');
  });

  it('rejects overlapping operations as one invalid plan', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book' });
    await project.observe();
    project.move('src/book.ts', 'src/item.ts');
    project.write('src/book.ts', 'replacement');
    await project.apply();

    project.expectStopped('invalid-change');
    project.expectNoAppliedChanges();
    await project.expectFile('src/book.ts', 'book');
    await project.expectAbsent('src/item.ts');
  });

  it('does not traverse a newly introduced directory link', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book' });
    await project.observe();
    project.write('src/new.ts', 'new');
    await project.replaceDirectoryWithOutsideLink('src');
    await project.apply();

    project.expectStopped();
    project.expectNoAppliedChanges();
    await project.expectOutsideAbsent('new.ts');
  });

  it('does not write through a replacement project root', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book' });
    await project.observe();
    project.write('src/book.ts', 'new book');
    await project.replaceRoot({ 'src/book.ts': 'other project' });
    await project.apply();

    project.expectStopped('stale-project');
    project.expectNoAppliedChanges();
    await project.expectFile('src/book.ts', 'other project');
  });

  it('captures proposed bytes before the caller changes its buffer', async () => {
    const project = await ProjectWrites.create({});
    await project.observe();
    const bytes = new TextEncoder().encode('planned');
    project.writeBytes('src/book.ts', bytes);
    const applying = project.apply();
    bytes.fill(0);
    await applying;

    await project.expectFile('src/book.ts', 'planned');
    project.expectCompleted();
  });
});

describe('stopping and recovering from partial application', () => {
  it('reports earlier changes when a later filesystem operation fails', async () => {
    const project = await ProjectWrites.create({ 'src/first.ts': 'first', 'src/second.ts': 'second' });
    await project.observe();
    project.write('src/first.ts', 'new first');
    project.write('src/second.ts', 'new second');
    await project.denyWriteAfterFirstChange('src/second.ts');
    await project.apply();

    project.expectStopped('write-failed');
    project.expectOutcome('src/first.ts', 'applied');
    project.expectOutcome('src/second.ts', 'not-applied');
    await project.expectFile('src/first.ts', 'new first');
    await project.expectFile('src/second.ts', 'second');
    project.expectPreviousBytes('src/first.ts', 'first');
  });

  it('stops after observing cancellation between operations', async () => {
    const project = await ProjectWrites.create({ 'src/first.ts': 'first', 'src/second.ts': 'second' });
    await project.observe();
    project.write('src/first.ts', 'new first');
    project.write('src/second.ts', 'new second');
    project.cancelAfterFirstChange();
    await project.apply();

    project.expectStopped('write-cancelled');
    project.expectOutcome('src/first.ts', 'applied');
    project.expectOutcome('src/second.ts', 'not-applied');
    await project.expectFile('src/second.ts', 'second');
  });

  it('does not restore recovery bytes over a newer handwritten edit', async () => {
    const project = await ProjectWrites.create({ 'src/first.ts': 'first', 'src/second.ts': 'second' });
    await project.observe();
    project.write('src/first.ts', 'new first');
    project.write('src/second.ts', 'new second');
    project.cancelAfterFirstChange();
    await project.apply();
    project.rememberReceipt();
    await project.observe();
    project.planRestoreFromReceipt('src/first.ts');
    await project.edit('src/first.ts', 'new handwritten work');
    await project.apply();

    project.expectStopped('stale-project');
    await project.expectFile('src/first.ts', 'new handwritten work');
    project.expectRememberedPreviousBytes('src/first.ts', 'first');
  });

  it('restores explicitly selected old bytes with a fresh unchanged baseline', async () => {
    const project = await ProjectWrites.create({ 'src/first.ts': 'first', 'src/second.ts': 'second' });
    await project.observe();
    project.write('src/first.ts', 'new first');
    project.write('src/second.ts', 'new second');
    project.cancelAfterFirstChange();
    await project.apply();
    project.rememberReceipt();
    await project.observe();
    project.planRestoreFromReceipt('src/first.ts');
    await project.apply();

    project.expectCompleted();
    await project.expectFile('src/first.ts', 'first');
    await project.expectFile('src/second.ts', 'second');
    project.expectRememberedReceiptUnchanged();
  });

  it('reports a move whose destination exists but source removal failed', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book' });
    await project.observe();
    project.move('src/book.ts', 'src/item.ts');
    project.failMoveSourceRemoval('src/book.ts');
    await project.apply();

    project.expectStopped('write-failed');
    project.expectMoveOutcome('src/book.ts', 'src/item.ts', 'uncertain');
    project.expectObservedBytes('src/book.ts', 'book');
    project.expectObservedBytes('src/item.ts', 'book');
    await project.expectFile('src/book.ts', 'book');
    await project.expectFile('src/item.ts', 'book');
  });

  it('does not call an inaccessible result absent or successfully written', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book' });
    await project.observe();
    project.write('src/book.ts', 'new book');
    await project.denyReadAfterWrite('src/book.ts');
    await project.apply();

    project.expectStopped('verification-failed');
    project.expectOutcome('src/book.ts', 'uncertain');
    project.expectUnknownAfter('src/book.ts');
    project.expectPreviousBytes('src/book.ts', 'book');
  });

  it('does not let a second cooperating writer apply a stale plan', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book' });
    await project.observeForTwoWriters();
    project.firstWriterWrites('src/book.ts', 'first update');
    project.secondWriterWrites('src/book.ts', 'second update');
    await project.applyFirstWhileSecondAttempts();
    project.expectSecondStopped('writer-busy');
    await project.retrySecondUnchangedPlan();

    project.expectFirstCompleted();
    project.expectSecondStopped('stale-project');
    await project.expectFile('src/book.ts', 'first update');
  });

  it('does not steal an existing writer marker', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book' });
    await project.observe();
    project.write('src/book.ts', 'new book');
    await project.placeWriterMarker('another writer');
    await project.apply();

    project.expectStopped('writer-busy');
    project.expectNoAppliedChanges();
    await project.expectFile('src/book.ts', 'book');
    await project.expectFile('.expec/write.lock', 'another writer');
  });

  it('retains a receipt when an unexpected collaborator failure follows an applied change', async () => {
    const project = await ProjectWrites.create({ 'src/first.ts': 'first', 'src/second.ts': 'second' });
    await project.observe();
    project.write('src/first.ts', 'new first');
    project.write('src/second.ts', 'new second');
    project.failContextAfterFirstChange(new Error('reader stopped unexpectedly'));
    await project.apply();

    project.expectStopped();
    project.expectProblemMessage('reader stopped unexpectedly');
    project.expectOutcome('src/first.ts', 'applied');
    project.expectOutcome('src/second.ts', 'not-applied');
    project.expectPreviousBytes('src/first.ts', 'first');
    await project.expectFile('src/first.ts', 'new first');
  });

  it('detects a later edit to an earlier applied file during final verification', async () => {
    const project = await ProjectWrites.create({ 'src/book.ts': 'book' });
    await project.observe();
    project.write('src/book.ts', 'generated');
    project.editBeforeFinalVerification('src/book.ts', 'handwritten afterward');
    await project.apply();

    project.expectStopped('stale-project');
    project.expectOutcome('src/book.ts', 'applied');
    await project.expectFile('src/book.ts', 'handwritten afterward');
  });
});
