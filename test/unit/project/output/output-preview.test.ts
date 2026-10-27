import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  Compiler, Outputs, type Check, type Diagnostic, type IdentifiedSpecification,
  type OutputContext, type OutputPreviewDocument, type OutputRegistration, type Specification,
} from '../../../../src/index.js';

const bookUri = 'file:///authoring/book.expec';
const book = checkedSpecification('type Book { title: Text }', bookUri);
const issue: Diagnostic = {
  code: 'missing-mapping', message: 'No native mapping for Book.',
  at: { kind: 'dependency', path: ['outputs', 'draft', 'options', 'mapping'] }, related: [],
};

describe('a caller previews documents through the registered output contract', () => {
  it('reports unavailable preview without opening a project adapter', async () => {
    let opened = 0;
    const outputs = new Outputs();
    outputs.register({ id: 'archive', validate: () => [], open() { opened++; throw new Error('Unexpected adapter open'); } });

    const result = await outputs.preview('archive', {}, book);

    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toEqual(['output-preview-unavailable']);
    expect(result.deferred).toEqual([]);
    expect(opened).toBe(0);
  });

  it('reports the unregistered output ID', async () => {
    const result = await new Outputs().preview('missing', {}, book);

    expect(result.value).toBeUndefined();
    expect(result.problems).toMatchObject([{
      code: 'unknown-output', at: { kind: 'dependency', path: ['outputs', 'missing'] },
    }]);
    expect(result.deferred).toEqual([]);
  });

  it('retains the registered validator finding without asking for a preview', async () => {
    let previewed = 0;
    const outputs = new Outputs();
    outputs.register({
      id: 'draft', validate: () => [{ path: ['directory'], message: 'Choose a draft directory.' }],
      open: unexpectedAdapter,
      preview: async () => { previewed++; return { value: [], problems: [], deferred: [] }; },
    });

    const result = await outputs.preview('draft', { directory: 7 }, book);

    expect(result.value).toBeUndefined();
    expect(result.problems).toEqual([{
      code: 'invalid-output-options', message: 'Choose a draft directory.',
      at: { kind: 'dependency', path: ['outputs', 'draft', 'options', 'directory'] }, related: [],
    }]);
    expect(previewed).toBe(0);
  });

  it('refuses options containing nonfinite JSON numbers', async () => {
    const result = await replying({ value: [], problems: [], deferred: [] })
      .preview('draft', { amount: Number.NaN }, book);

    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toEqual(['invalid-output-options']);
  });

  it('refuses a relative native manifest location', async () => {
    const result = await replying({ value: [], problems: [], deferred: [] })
      .preview('draft', {}, book, { workspaceModules: [bookUri], manifestLocation: 'expec.json' });

    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toEqual(['invalid-output-context']);
  });

  it('refuses duplicate supplied workspace module locators', async () => {
    const result = await replying({ value: [], problems: [], deferred: [] })
      .preview('draft', {}, book, { workspaceModules: [bookUri, bookUri] });

    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toEqual(['invalid-output-context']);
  });

  it('distinguishes a successful empty projection from unavailable preview', async () => {
    const result = await replying({ value: [], problems: [], deferred: [] }).preview('draft', {}, book);

    expect(result).toEqual({ value: { outputId: 'draft', documents: [] }, problems: [], deferred: [] });
  });

  it('supplies the real specification and registered receiver while retaining document order', async () => {
    const documents = [
      { path: 'draft/Book.ts', mediaType: 'text/typescript', bytes: new Uint8Array([65]) },
      { path: 'draft/Book.md', mediaType: 'text/markdown', bytes: new Uint8Array([66]) },
    ];
    const context = { workspaceModules: [bookUri], manifestLocation: resolve('expec.json') };
    const outputs = new Outputs();
    const registration: OutputRegistration = {
      id: 'draft', validate() { expect(this.id).toBe('draft'); return []; }, open: unexpectedAdapter,
      async preview(current, options, suppliedContext) {
        expect(this).toBe(registration);
        expect(current.specification).toBe(book);
        expect(current.baseline.artifacts).toEqual([]);
        expect(current.baseline.retired).toEqual([]);
        const declaration = [...current.specification.inspection.query('record-type-declaration')][0]!;
        expect(declaration.name).toBe('Book');
        expect(current.node(current.id(declaration.id))).toBe(declaration.id);
        expect(options).toEqual({ directory: 'draft' });
        expect(suppliedContext).toEqual(context);
        return { value: documents, problems: [], deferred: [] };
      },
    };
    outputs.register(registration);

    const result = await outputs.preview('draft', { directory: 'draft' }, book, context);

    expect(result).toEqual({ value: { outputId: 'draft', documents }, problems: [], deferred: [] });
  });

  it('captures nested options and context before an asynchronous provider finishes', async () => {
    const started = signal(), finish = signal();
    const options = { layout: { directory: 'draft' } };
    const context = { workspaceModules: [bookUri], manifestLocation: resolve('expec.json') };
    const originalManifest = context.manifestLocation;
    let receivedOptions: Readonly<Record<string, unknown>> | undefined;
    let receivedContext: OutputContext | undefined;
    const outputs = previewing(async (_current, suppliedOptions, suppliedContext) => {
      receivedOptions = suppliedOptions; receivedContext = suppliedContext;
      started.release();
      await finish.promise;
      return { value: [], problems: [], deferred: [] };
    });
    const pending = outputs.preview('draft', options, book, context);
    try {
      await Promise.race([started.promise, pending]);
      options.layout.directory = 'changed';
      context.workspaceModules.push('file:///authoring/other.expec');
      context.manifestLocation = resolve('changed.json');

      expect(receivedOptions).toEqual({ layout: { directory: 'draft' } });
      expect(receivedContext).toEqual({ workspaceModules: [bookUri], manifestLocation: originalManifest });
    } finally {
      finish.release();
      await Promise.allSettled([pending]);
    }
  });

  it('captures returned paths, media types and byte views independently from provider mutation', async () => {
    const storage = new Uint8Array([0, 65, 66, 0]);
    const document = { path: 'draft/Book.ts', mediaType: 'text/typescript', bytes: storage.subarray(1, 3) };
    const documents = [document];
    const result = await replying({ value: documents, problems: [], deferred: [] }).preview('draft', {}, book);

    document.path = 'changed.ts'; document.mediaType = 'text/plain'; storage[1] = 90;
    documents.push({ path: 'new.txt', mediaType: 'text/plain', bytes: new Uint8Array([67]) });

    expect(result.value?.documents).toEqual([
      { path: 'draft/Book.ts', mediaType: 'text/typescript', bytes: new Uint8Array([65, 66]) },
    ]);
  });

  it('retains the actual reason an output refuses its projection', async () => {
    const problem = { ...issue };
    const result = await replying({ problems: [problem], deferred: [] }).preview('draft', {}, book);
    problem.message = 'Changed after returning'; problem.at = { kind: 'dependency', path: ['changed'] };

    expect(result).toEqual({ problems: [issue], deferred: [] });
  });

  it('retains a real deferred prerequisite without inventing successful documents', async () => {
    const declaration = [...book.inspection.query('record-type-declaration')][0]!;
    const requirement = { reason: 'native-mapping', origin: declaration.origin, requires: 'Provide a native Book mapping.' };
    const result = await replying({ problems: [], deferred: [requirement] }).preview('draft', {}, book);

    expect(result).toEqual({ problems: [], deferred: [requirement] });
    expect(result.value).toBeUndefined();
  });

  it('propagates an unexpected provider exception unchanged', async () => {
    const failure = new Error('Unexpected preview provider failure');
    const outputs = previewing(async () => { throw failure; });

    await expect(outputs.preview('draft', {}, book)).rejects.toBe(failure);
  });

  it('rejects refusal without any problem or deferred requirement', async () => {
    await expect(replying({ problems: [], deferred: [] }).preview('draft', {}, book)).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects successful documents accompanied by a problem', async () => {
    await expect(replying({ value: [], problems: [issue], deferred: [] }).preview('draft', {}, book))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('rejects successful documents accompanied by a deferred requirement', async () => {
    const declaration = [...book.inspection.query('record-type-declaration')][0]!;
    const requirement = { reason: 'native-mapping', origin: declaration.origin, requires: 'Provide a native Book mapping.' };

    await expect(replying({ value: [], problems: [], deferred: [requirement] }).preview('draft', {}, book))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a callback reply missing the Check findings arrays', async () => {
    await expect(replying({ value: [] }).preview('draft', {}, book)).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a document path that traverses outside the draft', async () => {
    const documents = [{ path: '../Book.ts', mediaType: 'text/typescript', bytes: new Uint8Array([65]) }];

    await expect(replying({ value: documents, problems: [], deferred: [] }).preview('draft', {}, book))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('rejects an absolute document path', async () => {
    const documents = [{ path: resolve('Book.ts'), mediaType: 'text/typescript', bytes: new Uint8Array([65]) }];

    await expect(replying({ value: documents, problems: [], deferred: [] }).preview('draft', {}, book))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('rejects duplicate document paths from a custom provider', async () => {
    const documents = [
      { path: 'draft/Book.ts', mediaType: 'text/typescript', bytes: new Uint8Array([65]) },
      { path: 'draft/Book.ts', mediaType: 'text/typescript', bytes: new Uint8Array([66]) },
    ];

    await expect(replying({ value: documents, problems: [], deferred: [] }).preview('draft', {}, book))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('rejects numeric objects masquerading as document bytes', async () => {
    const documents = [{ path: 'draft/Book.ts', mediaType: 'text/typescript', bytes: { 0: 65, length: 1 } }];

    await expect(replying({ value: documents, problems: [], deferred: [] }).preview('draft', {}, book))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a document collection that is not an array', async () => {
    await expect(replying({ value: { path: 'draft/Book.ts' }, problems: [], deferred: [] }).preview('draft', {}, book))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('rejects an unqualified media label', async () => {
    const documents = [{ path: 'draft/Book.ts', mediaType: 'typescript', bytes: new Uint8Array([65]) }];

    await expect(replying({ value: documents, problems: [], deferred: [] }).preview('draft', {}, book))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('rejects media parameters outside the MIME essence contract', async () => {
    const documents = [{ path: 'draft/Book.ts', mediaType: 'text/typescript; charset=utf-8', bytes: new Uint8Array([65]) }];

    await expect(replying({ value: documents, problems: [], deferred: [] }).preview('draft', {}, book))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a media type containing control characters', async () => {
    const documents = [{ path: 'draft/Book.ts', mediaType: 'text/\ntypescript', bytes: new Uint8Array([65]) }];

    await expect(replying({ value: documents, problems: [], deferred: [] }).preview('draft', {}, book))
      .rejects.toBeInstanceOf(TypeError);
  });

  it('retains a valid unfamiliar media type for a registered provider', async () => {
    const documents = [{ path: 'draft/Book.custom', mediaType: 'application/vnd.example+json', bytes: new Uint8Array([123, 125]) }];
    const result = await replying({ value: documents, problems: [], deferred: [] }).preview('draft', {}, book);

    expect(result.value?.documents).toEqual(documents);
    expect(result.problems).toEqual([]);
    expect(result.deferred).toEqual([]);
  });

  it('keeps concurrent invocation identities and documents tied to their own specifications', async () => {
    const novel = checkedSpecification('type Novel { title: Text }', 'file:///authoring/novel.expec');
    const firstStarted = signal(), secondStarted = signal(), finishFirst = signal(), finishSecond = signal();
    const received: IdentifiedSpecification[] = [];
    const outputs = previewing(async current => {
      const declaration = [...current.specification.inspection.query('record-type-declaration')][0]!;
      received.push(current);
      const finish = declaration.name === 'Book' ? finishFirst : finishSecond;
      (declaration.name === 'Book' ? firstStarted : secondStarted).release();
      await finish.promise;
      expect(current.node(current.id(declaration.id))).toBe(declaration.id);
      return { value: [{ path: 'draft/' + declaration.name + '.txt', mediaType: 'text/plain',
        bytes: new TextEncoder().encode(declaration.name) }], problems: [], deferred: [] };
    });
    const first = outputs.preview('draft', {}, book);
    let second: ReturnType<Outputs['preview']> | undefined;
    try {
      await Promise.race([firstStarted.promise, first]);
      second = outputs.preview('draft', {}, novel);
      await Promise.race([secondStarted.promise, second]);
      expect(received[0]).not.toBe(received[1]);
      expect(received[0]?.specification).toBe(book);
      expect(received[1]?.specification).toBe(novel);
      expect(received.map(current => current.baseline.artifacts)).toEqual([[], []]);
      expect(received.map(current => current.baseline.retired)).toEqual([[], []]);
      finishSecond.release();
      const newer = await second;
      expect(newer.value?.documents).toEqual([
        { path: 'draft/Novel.txt', mediaType: 'text/plain', bytes: new TextEncoder().encode('Novel') },
      ]);
      finishFirst.release();
      const older = await first;
      expect(older.value?.documents).toEqual([
        { path: 'draft/Book.txt', mediaType: 'text/plain', bytes: new TextEncoder().encode('Book') },
      ]);
    } finally {
      finishFirst.release(); finishSecond.release();
      await Promise.allSettled(second === undefined ? [first] : [first, second]);
    }
  });
});

function checkedSpecification(text: string, sourceId: string): Specification {
  const result = new Compiler().compile({ source: { sourceId, text }, locator: sourceId,
    dependencies: { modules: [], packages: [] } });
  expect(result.syntax).toEqual([]);
  expect(result.problems).toEqual([]);
  expect(result.deferred).toEqual([]);
  if (!result.value) throw new Error('The preview caller requires a real accepted Specification.');
  return result.value;
}
function unexpectedAdapter(): never { throw new Error('Preview must not open a project adapter.'); }
function previewing(preview: NonNullable<OutputRegistration['preview']>): Outputs {
  const outputs = new Outputs();
  outputs.register({ id: 'draft', validate: () => [], open: unexpectedAdapter, preview });
  return outputs;
}
function replying(result: unknown): Outputs {
  return previewing(async () => result as Check<readonly OutputPreviewDocument[]>);
}
function signal(): { promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
