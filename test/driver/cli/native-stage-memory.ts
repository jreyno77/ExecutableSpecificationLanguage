import { expect, onTestFinished, vi } from 'vitest';
import { BuildContext } from '../../../src/cli/cli-context.js';
import { TypeScriptContext } from '../../../src/project/typescript/typescript-context.js';
import type { ProjectSnapshot } from '../../../src/project/connection/project-connection.js';
import { NativeContextDriver } from '../project/typescript/typescript-context.js';

export async function nativeStage(options: { source: string; opaqueBytes: number }) {
  const project = new NativeContextDriver();
  const restores: (() => void)[] = [];
  onTestFinished(async () => { restores.reverse().forEach(restore => restore()); await project.dispose(); });
  await project.file('expec.json', '{}');
  await project.file('book.ts', options.source);
  await project.file('payload.bin', '\0'.repeat(options.opaqueBytes));
  await project.connect();
  const original = await project.ordinary.readSnapshot();
  const stage = new BuildContext(project.ordinary, {
    manifest: project.path('expec.json'), text: '{}', captures: [], problems: [], syntax: [], deferred: [],
  }, [{ id: 'typescript', options: {} }]).during(original);
  let reading = 0;
  const copied = new Set<ArrayBufferLike>();
  const nativeRead = TypeScriptContext.prototype.readSnapshot, clone = globalThis.structuredClone;
  restores.push(vi.spyOn(TypeScriptContext.prototype, 'readSnapshot').mockImplementation(async function (this: TypeScriptContext) {
    reading++;
    try { return await nativeRead.call(this); } finally { reading--; }
  }).mockRestore);
  restores.push(vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown, options?: Parameters<typeof structuredClone>[1]) => {
    const result = clone(value, options);
    if (reading && result && typeof result === 'object' && 'files' in result && Array.isArray(result.files)) {
      const payload = result.files.find(file => file?.path === 'payload.bin' && file.bytes instanceof Uint8Array);
      if (payload) copied.add(payload.bytes.buffer);
    }
    return result;
  }) as typeof structuredClone).mockRestore);
  const source = (snapshot: ProjectSnapshot) => {
    const file = snapshot.files.find(file => file.path === 'book.ts');
    if (!file) throw Error('Native stage did not capture book.ts.');
    return file;
  };
  return {
    async capture() { copied.clear(); return stage.readSnapshot(); },
    expectSource(snapshot: ProjectSnapshot, text: string) { expect(Buffer.from(source(snapshot).bytes).toString('utf8')).toBe(text); },
    expectProblems(snapshot: ProjectSnapshot, codes: string[]) { expect(snapshot.problems.map(problem => problem.code)).toEqual(codes); expect(snapshot.complete).toBe(codes.length === 0); },
    expectNativeSnapshotCopies(count: number) { expect(copied.size).toBe(count); },
    changeReturnedSource(snapshot: ProjectSnapshot, text: string) {
      const bytes = source(snapshot).bytes, changed = Buffer.from(text);
      if (changed.length > bytes.length) throw Error('The mutation example must fit in its actual captured buffer.');
      bytes.fill(0); bytes.set(changed);
    },
    expectOriginalSource(text: string) { expect(Buffer.from(source(original).bytes).toString('utf8')).toBe(text); },
  };
}
