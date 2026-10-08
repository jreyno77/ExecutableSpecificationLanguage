import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ProjectOutput, type OutputAdapter, type ProjectRead, type ProjectSnapshot } from '../../../../src/index.js';

const scope = [{ outputId: 'books', format: 'book-file', value: 'books' }];
const snapshot = (title: string): ProjectSnapshot => {
  const bytes = Buffer.from(title);
  return { root: { path: '/books', identity: 'books' }, complete: true, problems: [], excludeNames: [], excluded: [],
    files: [{ path: 'book.txt', bytes, version: createHash('sha256').update(bytes).digest('hex') }] };
};
const read = (captured: ProjectSnapshot): ProjectRead => ({ artifacts: [{ at: scope[0]!, file: captured.files[0]! }],
  coverage: { scope, complete: true, limitations: [] }, problems: [] });
function reading() {
  let current = snapshot('Dune'), captures = 0, writes = 0;
  const adapter: OutputAdapter = { id: 'books', plan: async () => { throw Error('Read cannot plan writes'); },
    search: async () => { throw Error('Read cannot search'); }, read: async (_id, captured) => read(captured) };
  const output = new ProjectOutput(adapter, { root: current.root, readSnapshot: async () => { captures++; return current; } },
    { apply: async () => { writes++; throw Error('Read cannot write'); } });
  return { output, adapter, capture: () => current, change: (title: string) => { current = snapshot(title); },
    work: () => ({ captures, writes }) };
}
const title = (result: ProjectRead) => Buffer.from(result.artifacts[0]!.file.bytes).toString();

describe('reading several output subjects from one project', () => {
  it('shares one live capture across legacy adapter reads', async () => {
    const books = reading();
    const results = await books.output.readAll(['book', 'book']);
    expect(results.map(title)).toEqual(['Dune', 'Dune']);
    expect(results.every(result => result.coverage.complete)).toBe(true);
    expect(books.work()).toEqual({ captures: 1, writes: 0 });
  });
  it('reads supplied bytes without observing a later edit, then observes it on a live read', async () => {
    const books = reading(), captured = books.capture();
    books.change('Foundation');
    expect((await books.output.readAll(['book'], captured)).map(title)).toEqual(['Dune']);
    expect(books.work()).toEqual({ captures: 0, writes: 0 });
    expect((await books.output.readAll(['book'])).map(title)).toEqual(['Foundation']);
    expect(books.work()).toEqual({ captures: 1, writes: 0 });
  });
  it('keeps legacy adapter mutation away from later input and the supplied capture', async () => {
    const books = reading(), captured = books.capture();
    books.adapter.read = async (_id, input) => {
      const result = structuredClone(read(input)); input.files[0]!.bytes.fill(0); return result;
    };
    const results = await books.output.readAll(['first', 'second'], captured);
    expect(results.map(title)).toEqual(['Dune', 'Dune']);
    expect(Buffer.from(captured.files[0]!.bytes).toString()).toBe('Dune');
  });
  it('retains each legacy answer when its adapter reuses one result object', async () => {
    const books = reading(), shared = structuredClone(read(books.capture()));
    books.adapter.read = async id => { (shared.artifacts[0]!.at as { value: unknown }).value = id; return shared; };
    const results = await books.output.readAll(['first', 'second']);
    expect(results.map(result => result.artifacts[0]!.at.value)).toEqual(['first', 'second']);
  });
  it('uses a batch adapter and isolates repeated results from each other', async () => {
    const books = reading(); let calls = 0;
    books.adapter.read = async () => { throw Error('Batch adapter should handle these reads'); };
    books.adapter.readAll = async (ids, captured) => { calls++; const result = read(captured); return ids.map(() => result); };
    const results = await books.output.readAll(['book', 'book']);
    expect(calls).toBe(1); expect(results.map(title)).toEqual(['Dune', 'Dune']);
    results[0]!.artifacts[0]!.file.bytes.fill(0);
    expect(title(results[1]!)).toBe('Dune'); expect(Buffer.from(books.capture().files[0]!.bytes).toString()).toBe('Dune');
  });
  it('performs no acquisition or adapter work for no subjects', async () => {
    const books = reading(); books.adapter.readAll = async () => { throw Error('No work expected'); };
    expect(await books.output.readAll([])).toEqual([]); expect(books.work()).toEqual({ captures: 0, writes: 0 });
  });
  it('retains the requested count when an adapter mutates its ID list', async () => {
    const books = reading();
    books.adapter.readAll = async (ids, captured) => { (ids as string[]).pop(); return [read(captured)]; };
    await expect(books.output.readAll(['first', 'second'])).rejects.toThrow(TypeError);
  });
  it('rejects missing result slots instead of skipping their validation', async () => {
    const books = reading(); books.adapter.readAll = async () => new Array<ProjectRead>(2);
    await expect(books.output.readAll(['first', 'second'])).rejects.toThrow(TypeError);
  });
  it('rejects missing input slots before acquiring a project', async () => {
    const books = reading();
    await expect(books.output.readAll(new Array<string>(1))).rejects.toThrow(TypeError);
    expect(books.work()).toEqual({ captures: 0, writes: 0 });
  });
  it('rejects a batch with missing results', async () => {
    const books = reading(); books.adapter.readAll = async () => [];
    await expect(books.output.readAll(['book'])).rejects.toThrow(TypeError);
  });
  it('rejects fabricated bytes returned by a batch adapter', async () => {
    const books = reading(); books.adapter.readAll = async () => [read(snapshot('fiction'))];
    await expect(books.output.readAll(['book'])).rejects.toThrow(TypeError);
  });
  it('rejects a batch claiming complete coverage with an unresolved limitation', async () => {
    const books = reading(); books.adapter.readAll = async (_ids, captured) => [{ ...read(captured),
      coverage: { scope, complete: true, limitations: ['Unavailable declaration'] } }];
    await expect(books.output.readAll(['book'])).rejects.toThrow(TypeError);
  });
});
