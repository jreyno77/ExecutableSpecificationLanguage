import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
const { ProjectOutput } = await import(process.argv[2]);
const bytes = new Uint8Array(Number(process.argv[3]) * 1024 * 1024).fill(73);
bytes[0] = 11; bytes[bytes.length - 1] = 97;
const snapshot = { root: { path: '/project', identity: 'captured' }, complete: true,
  files: [{ path: 'src/captured.ts', bytes, version: createHash('sha256').update(bytes).digest('hex') }], excludeNames: [], excluded: [], problems: [] };
const expected = structuredClone(snapshot);
let reads = 0, writes = 0, returned;
const output = new ProjectOutput({ id: 'custom',
  plan: async (_request, captured) => {
    returned = structuredClone(captured);
    return { value: { outputId: 'custom', basedOn: returned, changes: [], artifacts: [] }, problems: [], deferred: [] };
  }, read: async () => { throw new Error('Unexpected read'); }, search: async () => { throw new Error('Unexpected search'); },
}, { root: snapshot.root, readSnapshot: async () => { reads++; return snapshot; } },
{ apply: async () => { writes++; throw new Error('Unexpected write'); } });
const result = await output.plan({ operation: 'create', current: {} }, snapshot);
const actual = result.value?.basedOn;
const metadata = value => ({ ...value, files: value.files.map(({ bytes: _bytes, ...file }) => file) });
console.log(JSON.stringify({
  planned: !!actual && actual !== returned && actual.files[0].bytes.buffer !== snapshot.files[0].bytes.buffer
    && result.problems.length === 0 && result.deferred.length === 0 && result.value.changes.length === 0,
  bytesUnchanged: !!actual && Buffer.from(actual.files[0].bytes).equals(expected.files[0].bytes)
    && Buffer.from(snapshot.files[0].bytes).equals(expected.files[0].bytes),
  metadataUnchanged: !!actual && isDeepStrictEqual(metadata(actual), metadata(expected))
    && isDeepStrictEqual(metadata(snapshot), metadata(expected)), reads, writes,
}));
