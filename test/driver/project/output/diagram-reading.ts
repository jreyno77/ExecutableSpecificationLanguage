import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { D2 } from '@d2lang/d2';
import { vi } from 'vitest';
import { Compiler, SpecificationIdentity, umlOutput, type ProjectFile, type ProjectRead, type ProjectSnapshot } from '../../../../src/index.js';
import { ProjectOutput } from '../../../../src/project/output/output.js';

const file = (path: string, bytes: Uint8Array): ProjectFile => ({ path, bytes: Uint8Array.from(bytes),
  version: createHash('sha256').update(bytes).digest('hex') });

/** Arranges actual generated D2, SVG and ownership before observing query work. */
export async function diagramContracts(source: string) {
  const compilation = new Compiler().compile({ locator: 'diagrams', source: { sourceId: 'diagrams.expec', text: source },
    dependencies: { modules: [], packages: [] } });
  if (!compilation.value) throw Error(JSON.stringify(compilation));
  let serial = 0;
  const identified = new SpecificationIdentity(() => 'diagram-read-' + ++serial).associate(compilation.value);
  if (!identified.value) throw Error(JSON.stringify(identified));
  const current = identified.value, adapter = umlOutput.open({ directory: 'design', views: ['structure'] });
  const empty: ProjectSnapshot = { root: { path: process.cwd(), identity: 'diagram-reading' }, complete: true,
    problems: [], files: [], excluded: [], excludeNames: ['.git', 'node_modules'] };
  const planned = await adapter.plan({ operation: 'create', current }, empty);
  if (!planned.value || planned.problems.length) throw Error(JSON.stringify(planned));
  const files = new Map<string, ProjectFile>();
  for (const change of planned.value.changes) {
    if (change.kind !== 'write') throw Error('Creating diagram contracts must produce writes.');
    files.set(change.path, file(change.path, change.bytes));
  }
  const snapshot: ProjectSnapshot = { ...empty, files: [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
  const output = new ProjectOutput(adapter, { get root() { return { ...snapshot.root }; },
    readSnapshot: async () => structuredClone(snapshot) }, { apply: async () => { throw Error('Reading diagram contracts must not write.'); } });
  const bytes = (path: string): Uint8Array => {
    const found = snapshot.files.find(item => item.path === path);
    if (!found) throw Error('Missing arranged diagram file: ' + path);
    return found.bytes;
  };
  return { output, snapshot, file: bytes, text: (path: string) => Buffer.from(bytes(path)).toString('utf8'),
    id: (name: string) => {
      const found = current.baseline.elements.filter(item => item.address.name === name);
      if (found.length !== 1) throw Error('Expected one arranged declaration: ' + name);
      return found[0]!.id;
    } };
}

export function artifact(read: ProjectRead, path: string): Uint8Array {
  const matches = read.artifacts.filter(item => item.file.path === path);
  if (matches.length !== 1) throw Error('Expected one returned diagram artifact: ' + path);
  return matches[0]!.file.bytes;
}

export function subject(read: ProjectRead): string | undefined {
  const value = read.artifacts.find(item => item.at.format === 'd2-object')?.at.value;
  return value && typeof value === 'object' && !Array.isArray(value) && 'subject' in value && typeof value.subject === 'string' ? value.subject : undefined;
}

export function withFile(snapshot: ProjectSnapshot, path: string, text: string): ProjectSnapshot {
  const captured = structuredClone(snapshot), files = [...captured.files.filter(item => item.path !== path), file(path, Buffer.from(text))];
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { ...captured, files };
}

export function withText(snapshot: ProjectSnapshot, path: string, text: string): ProjectSnapshot {
  if (!snapshot.files.some(item => item.path === path)) throw Error('Cannot edit an absent arranged file: ' + path);
  return withFile(snapshot, path, text);
}

/** Holds only the returned completion after real native cleanup has finished. */
export function holdNativeDisposal() {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  return { entered: started.then(() => setImmediate()), release, wait: async () => { entered(); await held; } };
}

/** Calls the real native implementation; disposal is counted only after it settles. */
export function observeNativeWork(disposal?: ReturnType<typeof holdNativeDisposal>): () => { compiled: number; rendered: number; disposed: number } {
  const counts = { compiled: 0, rendered: 0, disposed: 0 };
  const compile = D2.prototype.compile, render = D2.prototype.render, dispose = D2.prototype.dispose;
  vi.spyOn(D2.prototype, 'compile').mockImplementation(function (this: D2, ...args: Parameters<typeof compile>) {
    counts.compiled++; return Reflect.apply(compile, this, args);
  });
  vi.spyOn(D2.prototype, 'render').mockImplementation(function (this: D2, ...args: Parameters<typeof render>) {
    counts.rendered++; return Reflect.apply(render, this, args);
  });
  vi.spyOn(D2.prototype, 'dispose').mockImplementation(async function (this: D2, ...args: Parameters<typeof dispose>) {
    await Reflect.apply(dispose, this, args); counts.disposed++;
    if (disposal) await disposal.wait();
  });
  return () => ({ ...counts });
}
