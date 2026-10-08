import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import type ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TypeScriptContext, type ProjectContext, type ProjectSnapshot } from '../../../../src/index.js';
import { NativeContextDriver } from '../../../driver/project/typescript/typescript-context.js';

const observation = vi.hoisted(() => ({ programs: 0 }));
vi.mock('typescript', async importOriginal => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return { ...actual, default: new Proxy(actual.default, { get(target, key, receiver) {
    if (key !== 'createLanguageService') return Reflect.get(target, key, receiver);
    return function (...args: Parameters<typeof target.createLanguageService>) {
      observation.programs++;
      return Reflect.apply(target.createLanguageService, target, args);
    };
  } }) };
});
const projects: NativeContextDriver[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const p of projects.splice(0)) await p.dispose(); });
async function project(): Promise<NativeContextDriver> {
  const p = new NativeContextDriver(); projects.push(p); await p.connect();
  await p.file('src/use.ts', 'import type { Book } from "catalog"; export type Title = Book["title"];');
  observation.programs = 0; return p;
}
const original = 'export interface Book { title: string }';
const replacement = 'export interface Book { title: number }';
async function catalog(p: NativeContextDriver): Promise<void> { await p.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': original }); }
function complete(result: ProjectSnapshot): void { expect(result.complete, JSON.stringify(result.problems)).toBe(true); expect(result.problems).toEqual([]); }
function nativeText(result: ProjectSnapshot, path: string): string {
  const file = result.readOnlyFiles?.find(f => f.path === path); expect(file, path).toBeDefined();
  return Buffer.from(file!.bytes).toString();
}
const declaration = 'node_modules/catalog/index.d.ts';

describe('verified reuse of native acquisition', { timeout: 30_000 }, () => {
  it('returns independent real declaration bytes without rebuilding unchanged inputs', async () => {
    const p = await project(); await catalog(p); const context = new TypeScriptContext(p.context);
    const first = await context.readSnapshot(), second = await context.readSnapshot();
    complete(first); complete(second); expect(nativeText(second, declaration)).toBe(original);
    expect(observation.programs).toBe(1);
    first.readOnlyFiles!.find(f => f.path === declaration)!.bytes.fill(0);
    expect(nativeText(second, declaration)).toBe(original);
    const third = await context.readSnapshot(); complete(third); expect(nativeText(third, declaration)).toBe(original);
    expect(observation.programs).toBe(1);
  });
  it('reacquires changed declaration bytes rather than returning prior success', async () => {
    const p = await project(); await catalog(p); const context = new TypeScriptContext(p.context);
    complete(await context.readSnapshot()); await p.file(declaration, replacement);
    const next = await context.readSnapshot(); complete(next); expect(nativeText(next, declaration)).toBe(replacement);
    expect(observation.programs).toBe(2);
  });
  it('observes a newly shadowing nested module', async () => {
    const p = await project(); await p.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'import type { Mode } from "mode"; export interface Book { title: Mode }' });
    await p.package('mode', { types: 'index.d.ts' }, { 'index.d.ts': 'export type Mode = "outer";' });
    const context = new TypeScriptContext(p.context), first = await context.readSnapshot(); complete(first);
    expect(nativeText(first, 'node_modules/mode/index.d.ts')).toBe('export type Mode = "outer";');
    await p.package('catalog/node_modules/mode', { types: 'index.d.ts' }, { 'index.d.ts': 'export type Mode = "nested";' });
    const next = await context.readSnapshot(); complete(next);
    expect(nativeText(next, 'node_modules/catalog/node_modules/mode/index.d.ts')).toBe('export type Mode = "nested";');
    expect(next.readOnlyFiles!.some(f => f.path === 'node_modules/mode/index.d.ts')).toBe(false);
    expect(observation.programs).toBe(2);
  });
  it('can acquire an input installed after an incomplete query', async () => {
    const p = await project(), context = new TypeScriptContext(p.context);
    expect((await context.readSnapshot()).complete).toBe(false); await catalog(p);
    const next = await context.readSnapshot(); complete(next); expect(nativeText(next, declaration)).toBe(original);
    expect(observation.programs).toBe(2);
  });
  it('checks changed source bytes even when a caller keeps the declared version', async () => {
    const p = await project(); await catalog(p); const supplied = await p.context.readSnapshot();
    const context = new TypeScriptContext({ root: p.context.root, readSnapshot: async () => structuredClone(supplied) });
    complete(await context.readSnapshot());
    (supplied.files.find(f => f.path === 'src/use.ts')! as { bytes: Uint8Array }).bytes = Buffer.from('import type { Missing } from "missing"; export type Value = Missing;');
    const next = await context.readSnapshot(); expect(next.complete).toBe(false);
    expect(next.problems.some(p => p.code === 'native-input-unavailable' && p.message.includes('missing'))).toBe(true);
    expect(observation.programs).toBe(2);
  });
  it('rechecks configuration and fails an unavailable configured type package', async () => {
    const p = await project(); await catalog(p);
    await p.file('tsconfig.json', '{"compilerOptions":{"types":[]},"include":["src/**/*.ts"]}');
    const context = new TypeScriptContext(p.context, { configFile: 'tsconfig.json' }); complete(await context.readSnapshot());
    await p.file('tsconfig.json', '{"compilerOptions":{"types":["missing-types"]},"include":["src/**/*.ts"]}');
    const next = await context.readSnapshot(); expect(next.complete).toBe(false);
    expect(next.problems.some(p => p.code === 'native-input-unavailable' && p.message.includes('missing-types'))).toBe(true);
  });
  it('reads actual dependency bytes again on each successful reuse', async () => {
    const p = await project(); await catalog(p); const context = new TypeScriptContext(p.context); complete(await context.readSnapshot());
    const read = vi.spyOn(fs, 'readFileSync'); const next = await context.readSnapshot(); complete(next);
    expect(nativeText(next, declaration)).toBe(original);
    expect(read.mock.calls.some(([input]) => typeof input === 'number')).toBe(true);
    expect(read.mock.results.filter(result => result.type === 'return' && Buffer.isBuffer(result.value)
      && result.value.toString() === original)).toHaveLength(2);
    expect(observation.programs).toBe(1);
  });
  it('refuses a dependency change during the final awaited project capture', async () => {
    const p = await project(); await catalog(p); let remaining = 0;
    const observedProject: ProjectContext = { root: p.context.root, readSnapshot: async () => {
      const snapshot = await p.context.readSnapshot();
      if (remaining && --remaining === 0) await p.file(declaration, replacement);
      return snapshot;
    } };
    const context = new TypeScriptContext(observedProject); complete(await context.readSnapshot()); remaining = 2;
    const next = await context.readSnapshot(); expect(next.complete).toBe(false);
    expect(next.problems.some(p => p.code === 'stale-project')).toBe(true);
    const repaired = await context.readSnapshot(); complete(repaired); expect(nativeText(repaired, declaration)).toBe(replacement);
  });
  it('keeps overlapping results isolated from caller mutation', async () => {
    const p = await project(); await catalog(p); const context = new TypeScriptContext(p.context), first = await context.readSnapshot();
    const [second, third] = await Promise.all([context.readSnapshot(), context.readSnapshot()]);
    first.readOnlyFiles!.find(f => f.path === declaration)!.bytes.fill(0);
    complete(second); complete(third); expect(nativeText(second, declaration)).toBe(original); expect(nativeText(third, declaration)).toBe(original);
    expect(observation.programs).toBe(1);
  });
  it('does not reuse missing required declaration evidence', async () => {
    const p = await project(); await catalog(p); const context = new TypeScriptContext(p.context); complete(await context.readSnapshot());
    fs.unlinkSync(p.path(declaration)); const next = await context.readSnapshot(); expect(next.complete).toBe(false);
    expect(next.problems.some(p => p.code === 'native-input-unavailable')).toBe(true);
    expect(next.readOnlyFiles!.some(f => f.path === declaration)).toBe(false);
  });
  it('observes replacement bytes when a required file is substituted during verification', async () => {
    const p = await project(); await catalog(p); const context = new TypeScriptContext(p.context); complete(await context.readSnapshot());
    duringNativeRead(() => { fs.unlinkSync(p.path(declaration)); fs.writeFileSync(p.path(declaration), replacement); });
    const next = await context.readSnapshot(); complete(next); expect(nativeText(next, declaration)).toBe(replacement);
    expect(observation.programs).toBe(2);
  });
  it('rechecks missing routes after reading native bytes', async () => {
    const p = await project();
    await p.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'import type { Mode } from "mode"; export interface Book { title: Mode }' });
    await p.package('mode', { types: 'index.d.ts' }, { 'index.d.ts': 'export type Mode = "outer";' });
    const context = new TypeScriptContext(p.context); complete(await context.readSnapshot());
    const nested = 'node_modules/catalog/node_modules/mode';
    duringNativeRead(() => {
      fs.mkdirSync(p.path(nested), { recursive: true });
      fs.writeFileSync(p.path(nested + '/package.json'), '{"name":"mode","version":"1.0.0","types":"index.d.ts"}');
      fs.writeFileSync(p.path(nested + '/index.d.ts'), 'export type Mode = "nested";');
    });
    const next = await context.readSnapshot(); complete(next);
    expect(nativeText(next, nested + '/index.d.ts')).toBe('export type Mode = "nested";');
    expect(next.readOnlyFiles!.some(f => f.path === 'node_modules/mode/index.d.ts')).toBe(false);
    expect(observation.programs).toBe(2);
  });
  it('cannot reuse an acquired closure after its project root is replaced', async () => {
    const p = await project(); await catalog(p); const context = new TypeScriptContext(p.context); complete(await context.readSnapshot());
    fs.renameSync(p.root, p.path('../previous-root')); fs.mkdirSync(p.root);
    const next = await context.readSnapshot(); expect(next.complete).toBe(false);
    expect(next.problems.some(p => p.code === 'root-changed')).toBe(true);
    expect(next.readOnlyFiles).toEqual([]);
  });
  it('reacquires when the caller changes captured exclusion metadata', async () => {
    const p = await project(); await catalog(p); let input = await p.context.readSnapshot();
    const context = new TypeScriptContext({ root: p.context.root, readSnapshot: async () => structuredClone(input) });
    complete(await context.readSnapshot()); input = { ...input, excludeNames: [...input.excludeNames, 'build'] };
    const next = await context.readSnapshot(); complete(next); expect(next.excludeNames).toContain('build');
    expect(nativeText(next, declaration)).toBe(original); expect(observation.programs).toBe(2);
  });
  it('reacquires when the caller changes captured native input evidence', async () => {
    const p = await project(); await catalog(p); let input = await p.context.readSnapshot();
    const context = new TypeScriptContext({ root: p.context.root, readSnapshot: async () => structuredClone(input) });
    complete(await context.readSnapshot());
    input = { ...input, nativeInputs: [{ uri: pathToFileURL(p.path('package.json')).href,
      version: input.files.find(file => file.path === 'package.json')!.version }] };
    const next = await context.readSnapshot(); complete(next);
    expect(next.nativeInputs).toEqual(input.nativeInputs);
    expect(nativeText(next, declaration)).toBe(original); expect(observation.programs).toBe(2);
  });
});

function duringNativeRead(effect: () => void): void {
  const read = fs.readFileSync; let pending = true;
  vi.spyOn(fs, 'readFileSync').mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
    const result = Reflect.apply(read, fs, args);
    if (pending && typeof args[0] === 'number') { pending = false; effect(); }
    return result;
  }) as typeof fs.readFileSync);
}


