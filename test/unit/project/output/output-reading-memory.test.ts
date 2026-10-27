import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ProjectOutput, type OutputAdapter } from '../../../../src/project/output/output.js';
import type { ProjectSnapshot } from '../../../../src/project/connection/project-connection.js';
import type { ProjectRead } from '../../../../src/project/connection/project-inspection.js';

const scope = [{ outputId: 'books', format: 'book-file', value: 'books' }];
const title = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
function readingBytes(captured: Uint8Array, returned?: Uint8Array) {
  const snapshot: ProjectSnapshot = { root: { path: '/books', identity: 'books' }, complete: true, problems: [],
    excludeNames: [], excluded: [], files: [{ path: 'book.txt', bytes: captured, version: createHash('sha256').update(captured).digest('hex') }] };
  let answer = returned;
  const adapter: OutputAdapter = {
    id: 'books', plan: async () => { throw Error('Read cannot plan writes'); }, search: async () => { throw Error('Read cannot search'); },
    read: async (_id, input): Promise<ProjectRead> => ({
      artifacts: [{ at: scope[0]!, file: { ...input.files[0]!, bytes: answer ?? input.files[0]!.bytes } }],
      coverage: { scope, complete: true, limitations: [] }, problems: [],
    }),
  };
  return {
    output: new ProjectOutput(adapter, { root: snapshot.root, readSnapshot: async () => snapshot },
      { apply: async () => { throw Error('Read cannot write'); } }),
    returnBytesWithCapturedVersion: (bytes: Uint8Array) => { answer = bytes; },
  };
}
function decoratedBytes(actual: string, claimed: string): Uint8Array {
  const bytes = Uint8Array.from(Buffer.from(actual)), facade = Uint8Array.from(Buffer.from(claimed));
  Object.defineProperties(bytes, { buffer: { value: facade.buffer }, byteOffset: { value: facade.byteOffset }, byteLength: { value: facade.byteLength } });
  return bytes;
}
async function observeRead(output: ProjectOutput): Promise<{ results: readonly ProjectRead[]; comparisonCopiedBytes: number }> {
  const original = Buffer.from;
  let comparisonCopiedBytes = 0;
  const spy = vi.spyOn(Buffer, 'from').mockImplementation(((...args: unknown[]) => {
    const result: Buffer = Reflect.apply(original, Buffer, args), source = args[0];
    if (source instanceof Uint8Array && (result.buffer !== source.buffer || result.byteOffset !== source.byteOffset
      || result.byteLength !== source.byteLength)) comparisonCopiedBytes += result.byteLength;
    return result;
  }) as typeof Buffer.from);
  try { return { results: await output.readAll(['book']), comparisonCopiedBytes }; }
  finally { spy.mockRestore(); }
}

describe('captured output byte comparisons', () => {
  it('reads captured books without allocating comparison copies', async () => {
    const books = readingBytes(Buffer.from('Dune'));

    const observed = await observeRead(books.output);

    expect(observed.results.map(result => title(result.artifacts[0]!.file.bytes))).toEqual(['Dune']);
    expect(observed.results[0]!.coverage.complete).toBe(true);
    expect(observed.comparisonCopiedBytes).toBe(0);
  });

  it('compares a Uint8Array slice with a Buffer slice and keeps the result owned', async () => {
    const captured = Uint8Array.from(Buffer.from('xDuney')).subarray(1, 5), returned = Buffer.from('zzDuneqq').subarray(2, 6);
    const books = readingBytes(captured, returned);

    const results = await books.output.readAll(['book']);

    expect(title(results[0]!.artifacts[0]!.file.bytes)).toBe('Dune');
    results[0]!.artifacts[0]!.file.bytes.fill(0);
    expect(title(captured)).toBe('Dune');
    expect(title(returned)).toBe('Dune');
  });

  it('compares a Buffer slice with a differently offset Uint8Array slice', async () => {
    const books = readingBytes(Buffer.from('xDuney').subarray(1, 5), Uint8Array.from(Buffer.from('zzDuneqq')).subarray(2, 6));

    const results = await books.output.readAll(['book']);

    expect(title(results[0]!.artifacts[0]!.file.bytes)).toBe('Dune');
  });

  it('rejects different bytes carrying the captured version', async () => {
    const books = readingBytes(Buffer.from('Dune'));
    books.returnBytesWithCapturedVersion(Buffer.from('Rome'));

    await expect(books.output.readAll(['book'])).rejects.toThrow(TypeError);
  });

  it('rejects returned bytes with forged buffer storage properties', async () => {
    const returned = decoratedBytes('Rome', 'Dune'), books = readingBytes(Buffer.from('Dune'), returned);
    expect(title(returned)).toBe('Rome');

    await expect(books.output.readAll(['book'])).rejects.toThrow(TypeError);
  });
});
