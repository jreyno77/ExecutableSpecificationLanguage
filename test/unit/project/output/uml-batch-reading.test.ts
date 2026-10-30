import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagramDocuments } from '../../../../src/project/output/uml-documents.js';
import { artifact, diagramContracts, holdNativeDisposal, observeNativeWork, subject, withFile, withText } from '../../../driver/project/output/diagram-reading.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('reading several native diagram contracts', { timeout: 30_000 }, () => {
  it('reads Book and Library in request order with one native acquisition', async () => {
    const diagrams = await diagramContracts('component Book {}\ncomponent Library {}');
    const work = observeNativeWork();
    const reads = await diagrams.output.readAll([
      diagrams.id('Library'), diagrams.id('Book'), diagrams.id('Library'),
    ], diagrams.snapshot);

    expect(reads.map(subject)).toEqual([
      diagrams.id('Library'), diagrams.id('Book'), diagrams.id('Library'),
    ]);
    expect(reads.map(read => read.artifacts.map(item => item.file.path))).toEqual([
      ['design/structure.d2', 'design/structure.svg'],
      ['design/structure.d2', 'design/structure.svg'],
      ['design/structure.d2', 'design/structure.svg'],
    ]);
    expect(reads.map(read => read.problems)).toEqual([[], [], []]);
    expect(reads.map(read => read.coverage.complete)).toEqual([true, true, true]);
    expect(work()).toEqual({ compiled: 1, rendered: 0, disposed: 1 });
  });

  it('keeps duplicate answers independent of each other and the supplied source', async () => {
    const diagrams = await diagramContracts('component Book {}');
    const before = structuredClone(diagrams.snapshot);
    const [first, second] = await diagrams.output.readAll([
      diagrams.id('Book'), diagrams.id('Book'),
    ], diagrams.snapshot);

    first!.artifacts[0]!.file.bytes.fill(0);
    (first!.coverage.limitations as string[]).push('caller mutation');

    expect(Buffer.from(artifact(second!, 'design/structure.d2')))
      .toEqual(Buffer.from(diagrams.file('design/structure.d2')));
    expect(second!.coverage.limitations).toEqual([]);
    expect(diagrams.snapshot).toEqual(before);
  });

  it('reads a later source edit and reports its old SVG without rendering during a read', async () => {
    const diagrams = await diagramContracts('component Book {}');
    const work = observeNativeWork();
    const first = (await diagrams.output.readAll([diagrams.id('Book')], diagrams.snapshot))[0]!;
    const changed = withText(diagrams.snapshot, 'design/structure.d2',
      diagrams.text('design/structure.d2') + '\n# Backups are nightly.\n');
    const second = (await diagrams.output.readAll([diagrams.id('Book')], changed))[0]!;

    expect(Buffer.from(artifact(first, 'design/structure.d2')).toString()).not.toContain('Backups are nightly.');
    expect(Buffer.from(artifact(second, 'design/structure.d2')).toString()).toContain('# Backups are nightly.');
    expect(second.problems.map(problem => problem.code)).toContain('stale-diagram-render');
    expect(Buffer.from(artifact(second, 'design/structure.svg')))
      .toEqual(Buffer.from(diagrams.file('design/structure.svg')));
    expect(work()).toEqual({ compiled: 2, rendered: 0, disposed: 2 });
  });

  it('keeps an unknown subject finding out of a known subject answer', async () => {
    const diagrams = await diagramContracts('component Book {}');
    const [unknown, book] = await diagrams.output.readAll(['unknown', diagrams.id('Book')], diagrams.snapshot);

    expect(unknown!.artifacts).toEqual([]);
    expect(unknown!.problems.map(problem => problem.code)).toContain('output-not-found');
    expect(subject(book!)).toBe(diagrams.id('Book'));
    expect(book!.problems).toEqual([]);
    expect(book!.coverage.complete).toBe(true);
  });

  it('retains malformed owned D2 bytes and incomplete findings for every requested subject', async () => {
    const diagrams = await diagramContracts('component Book {}\ncomponent Library {}');
    const source = diagrams.text('design/structure.d2') + '\nbroken: {';
    const changed = withText(diagrams.snapshot, 'design/structure.d2', source);
    const work = observeNativeWork();
    const reads = await diagrams.output.readAll([
      diagrams.id('Book'), diagrams.id('Library'),
    ], changed);

    expect(reads.map(read => Buffer.from(artifact(read, 'design/structure.d2')).toString()))
      .toEqual([source, source]);
    expect(reads.map(read => read.problems.some(problem => problem.code === 'invalid-output-document')))
      .toEqual([true, true]);
    expect(reads.map(read => read.coverage.complete)).toEqual([false, false]);
    expect(reads.every(read => read.artifacts.some(item => item.at.format === 'd2-unreadable'))).toBe(true);
    expect(reads.every(read => read.artifacts.every(item => item.at.format !== 'd2-object'))).toBe(true);
    expect(work()).toEqual({ compiled: 1, rendered: 0, disposed: 1 });
  });

  it('compiles each captured document once while retaining an unrelated unsupported native scope', async () => {
    const diagrams = await diagramContracts('component Book {}\ncomponent Library {}');
    const captured = withFile(diagrams.snapshot, 'notes/nested.d2', 'container: { child: Child }\n');
    const work = observeNativeWork();
    const reads = await diagrams.output.readAll([
      diagrams.id('Book'), diagrams.id('Library'),
    ], captured);

    expect(reads.map(subject)).toEqual([diagrams.id('Book'), diagrams.id('Library')]);
    expect(reads.map(read => read.coverage.complete)).toEqual([false, false]);
    expect(reads.map(read => read.coverage.limitations.some(text => text.includes('notes/nested.d2') && text.includes('nested native scope'))))
      .toEqual([true, true]);
    expect(work()).toEqual({ compiled: 2, rendered: 0, disposed: 1 });
  });

  it('does not start native work for an empty request', async () => {
    const diagrams = await diagramContracts('component Book {}');
    const work = observeNativeWork();

    expect(await diagrams.output.readAll([], diagrams.snapshot)).toEqual([]);
    expect(work()).toEqual({ compiled: 0, rendered: 0, disposed: 0 });
  });

  it('awaits native disposal when projecting one answer fails', async () => {
    const diagrams = await diagramContracts('component Book {}');
    const failure = Error('Deliberate subject-projection failure'), disposal = holdNativeDisposal();
    const work = observeNativeWork(disposal);
    vi.spyOn(DiagramDocuments.prototype, 'read').mockImplementationOnce(() => { throw failure; });
    let settled = false;
    const reading = diagrams.output.readAll([diagrams.id('Book')], diagrams.snapshot);
    const drained = reading.then(() => { settled = true; }, () => { settled = true; });

    try {
      await disposal.entered;
      expect(settled).toBe(false);
    } finally {
      disposal.release();
      await drained;
    }

    await expect(reading).rejects.toBe(failure);
    expect(work()).toEqual({ compiled: 1, rendered: 0, disposed: 1 });
  });
});
