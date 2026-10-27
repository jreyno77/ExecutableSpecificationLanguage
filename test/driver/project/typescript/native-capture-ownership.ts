import fs from 'node:fs';
import { expect, onTestFinished, vi } from 'vitest';
import type ts from 'typescript';
import { TypeScriptCapture, nativeInputProblemsFromOwnedSnapshot } from '../../../../src/project/typescript/typescript-capture.js';
import { TypeScriptContext } from '../../../../src/project/typescript/typescript-context.js';
import { NativeDeclarations } from '../../../../src/project/typescript/native-declarations.js';
import type { ProjectSnapshot } from '../../../../src/project/connection/project-connection.js';
import { NativeContextDriver } from './typescript-context.js';

type Observation = { created: number; disposed: number; fields: { declaration: string; field: string; type: string | undefined }[]; restore: (() => void)[] };
const observing = vi.hoisted(() => ({ active: undefined as Observation | undefined }));
vi.mock('typescript', async importOriginal => {
  const actual = await importOriginal<{ default: typeof ts }>(), native = actual.default;
  return { ...actual, default: new Proxy(native, { get(target, key, receiver) {
    if (key !== 'createLanguageService') return Reflect.get(target, key, receiver);
    return function (this: typeof ts, ...args: Parameters<typeof native.createLanguageService>) {
      const service = Reflect.apply(native.createLanguageService, this, args) as ts.LanguageService, observation = observing.active;
      if (!observation) return service;
      observation.created++;
      const dispose = service.dispose, getProgram = service.getProgram;
      observation.restore.push(vi.spyOn(service, 'dispose').mockImplementation(() => { observation.disposed++; return dispose.call(service); }).mockRestore);
      observation.restore.push(vi.spyOn(service, 'getProgram').mockImplementation(() => {
        const program = getProgram.call(service), source = program?.getSourceFile('/__expec_project__/book.ts');
        if (source) for (const declaration of source.statements.filter(native.isInterfaceDeclaration))
          for (const field of declaration.members.filter(native.isPropertySignature)) observation.fields.push({ declaration: declaration.name.text,
            field: field.name.getText(source), type: field.type?.getText(source) });
        return program;
      }).mockRestore);
      return service;
    };
  } }) };
});
const gate = () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  return { entered: started, release, wait: async () => { entered(); await held; } };
};
export async function nativeOwnership(source: string) {
  const project = new NativeContextDriver(), observation: Observation = { created: 0, disposed: 0, fields: [], restore: [] };
  const ordinary: TypeScriptCapture[] = [], pending: Promise<ProjectSnapshot>[] = [];
  let held: ReturnType<typeof gate> | undefined;
  onTestFinished(async () => {
    held?.release(); await Promise.allSettled(pending);
    for (const capture of ordinary) capture.service.dispose();
    observation.restore.reverse().forEach(restore => restore()); observing.active = undefined;
    await project.dispose();
  });
  await project.file('book.ts', source); await project.connect();
  const supplied = await project.ordinary.readSnapshot();
  const sourceFile = (snapshot: ProjectSnapshot) => {
    const file = snapshot.files.find(file => file.path === 'book.ts');
    if (!file) throw Error('The ownership example must contain its actual book.ts source.');
    return file;
  };
  let reads = 0, declarationRead = false, findingsFailure = false;
  const provider = { root: supplied.root, readSnapshot: async () => { if (++reads === 2) await held?.wait(); return supplied; } };
  const changeSource = (text: string) => {
    const file = sourceFile(supplied), bytes = Buffer.from(text);
    if (bytes.length > file.bytes.length) throw Error('The mutation must fit in its actual supplied source buffer.');
    file.bytes.fill(0); file.bytes.set(bytes);
  };
  const declarationAction = (name: string, action: () => void) => {
    const selected = project.path('node_modules/' + name + '/index.d.ts'), open = fs.openSync.bind(fs), read = fs.readFileSync.bind(fs);
    let handle: number | undefined;
    observation.restore.push(vi.spyOn(fs, 'openSync').mockImplementation(((path: fs.PathLike, ...args: unknown[]) => {
      const result = Reflect.apply(open, fs, [path, ...args]); if (String(path) === selected) handle = result; return result;
    }) as typeof fs.openSync).mockRestore);
    observation.restore.push(vi.spyOn(fs, 'readFileSync').mockImplementation(((path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      const bytes = Reflect.apply(read, fs, [path, ...args]);
      if (path === handle) { handle = undefined; declarationRead = true; action(); }
      return bytes;
    }) as typeof fs.readFileSync).mockRestore);
  };
  observing.active = observation;
  return {
    async installDeclaration(name: string, text: string) { await project.package(name, { types: 'index.d.ts' }, { 'index.d.ts': text }); },
    capture(imports: readonly string[] = []) { const reading = new TypeScriptContext(provider, { imports }).readSnapshot(); pending.push(reading); return reading; },
    holdFreshCapture() { return held = gate(); },
    changeProvidedSource: changeSource,
    changeProvidedSourceDuringRead(name: string, text: string) { declarationAction(name, () => changeSource(text)); },
    expectDeclarationRead() { expect(declarationRead).toBe(true); },
    expectSource(snapshot: ProjectSnapshot, text: string) { expect(Buffer.from(sourceFile(snapshot).bytes).toString('utf8')).toBe(text); },
    expectStale(snapshot: ProjectSnapshot) { expect(snapshot.complete).toBe(false); expect(snapshot.problems.map(problem => problem.code)).toContain('stale-project'); },
    ordinaryCaptureWithCustomHost() {
      const native = new NativeDeclarations(supplied.root, []), host = { imports: [], read: native.read.bind(native), fileExists: native.fileExists.bind(native),
        directoryExists: native.directoryExists.bind(native), directories: native.directories.bind(native) };
      const capture = new TypeScriptCapture(supplied, 'custom-host', undefined, new Map(), host); ordinary.push(capture); return capture;
    },
    expectCaptureSource(capture: TypeScriptCapture, text: string) { expect(Buffer.from(sourceFile(capture.snapshot).bytes).toString('utf8')).toBe(text); },
    checkOwned() { return nativeInputProblemsFromOwnedSnapshot(structuredClone(supplied), undefined, new Map(), new NativeDeclarations(supplied.root, [])); },
    expectCheckedField(declaration: string, field: string, type: string) { expect(observation.fields).toContainEqual({ declaration, field, type }); },
    expectServiceLifecycle(expected: { created: number; disposed: number }) { expect({ created: observation.created, disposed: observation.disposed }).toEqual(expected); },
    failOwnedFindings(failure: Error) {
      const has = Set.prototype.has;
      observation.restore.push(vi.spyOn(Set.prototype, 'has').mockImplementation(function (this: Set<unknown>, value: unknown) {
        if (value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' && value.code.startsWith('typescript-')) {
          findingsFailure = true; throw failure;
        }
        return has.call(this, value);
      }).mockRestore);
    },
    captureOwnedFailure() { try { this.checkOwned(); } catch (error) { return error; } throw Error('The owned findings operation unexpectedly succeeded.'); },
    expectFindingsFailureReached() { expect(findingsFailure).toBe(true); },
  };
}
