import { afterEach, describe, expect, it } from 'vitest';
import { ConfigurationReader, FileProjectWriter, ProjectConnector, TypeScriptContext, TypeScriptProject,
  type Diagnostic, type ProjectSnapshot } from '../../../../src/index.js';
import { NativeContextDriver } from '../../../driver/project/typescript/typescript-context.js';

const active: NativeContextDriver[] = [];
afterEach(async () => { for (const driver of active.splice(0)) await driver.dispose(); });
async function project(excludeNames?: string[]): Promise<NativeContextDriver> {
  const driver = new NativeContextDriver(); active.push(driver); await driver.connect();
  if (excludeNames) {
    const config = new ConfigurationReader([]).read({ sourceId: 'manifest', text: JSON.stringify({ formatVersion: 1, version: '1.0.0', project: { root: '.' }, build: { entries: ['main.expec'] } }) });
    const connected = await new ProjectConnector(driver.path('expec.json'), { excludeNames }).connect(config.value!);
    if (connected.value?.status !== 'connected') throw Error(JSON.stringify(connected)); driver.context = connected.value.context;
  }
  return driver;
}
function read(snapshot: ProjectSnapshot, file: string, configFile?: string) {
  return new TypeScriptProject({ outputId: 'native', ...(configFile ? { configFile } : {}) }, [{ specId: 'file',
    locator: { outputId: 'native', format: 'typescript-file-1', value: { file } } }]).read('file', snapshot);
}
function expectLocated(problems: readonly Diagnostic[], code: string, file: string, source: string, token: string): void {
  const found = problems.find(problem => problem.code === code && problem.at.kind === 'dependency' && problem.at.path[1] === file);
  expect(found, JSON.stringify(problems)).toBeDefined();
  if (found?.at.kind !== 'dependency') throw Error('A native location was expected.');
  const start = found.at.path[2], length = found.at.path[3]; expect(typeof start).toBe('number'); expect(typeof length).toBe('number');
  expect(source.slice(start as number, (start as number) + (length as number))).toBe(token);
}

describe('editable imports and native acquisition remain distinct', { timeout: 30_000 }, () => {
  it('captures an absent editable import without certifying its native meaning', async () => {
    const driver = await project(), source = 'import type { Book } from "./Book.js"; export function price(book: Book): number { return 1; }';
    await driver.file('src/price.ts', source);
    const snapshot = await new TypeScriptContext(driver.context).readSnapshot();
    expect(snapshot.problems).toEqual([]); expect(snapshot.complete).toBe(true);
    expect(Buffer.from(snapshot.files.find(file => file.path === 'src/price.ts')!.bytes).toString()).toBe(source);
    const query = read(snapshot, 'src/price.ts'); expect(query.coverage.complete).toBe(false);
    expectLocated(query.problems, 'typescript-2307', 'src/price.ts', source, '"./Book.js"');
  });
  it('applies mutually referring source files with every writer guard intact', async () => {
    const driver = await project(); await driver.file('src/index.ts', 'export {};');
    const context = new TypeScriptContext(driver.context), before = await context.readSnapshot();
    const left = 'import type { Right } from "./Right.js"; export interface Left { right: Right }';
    const right = 'import type { Left } from "./Left.js"; export interface Right { left: Left }';
    const result = await new FileProjectWriter(context).apply({ basedOn: before, changes: [
      { kind: 'write', path: 'src/Left.ts', bytes: Buffer.from(left) }, { kind: 'write', path: 'src/Right.ts', bytes: Buffer.from(right) },
    ] });
    expect(result.problems).toEqual([]); expect(result.status).toBe('applied'); expect(result.outcomes.map(outcome => outcome.state)).toEqual(['applied', 'applied']);
    const after = await context.readSnapshot(); expect(after.complete).toBe(true);
    expect(Buffer.from(after.files.find(file => file.path === 'src/Left.ts')!.bytes).toString()).toBe(left);
    expect(Buffer.from(after.files.find(file => file.path === 'src/Right.ts')!.bytes).toString()).toBe(right);
    expect(read(after, 'src/Left.ts').coverage.complete).toBe(true); expect(read(after, 'src/Left.ts').problems).toEqual([]);
  });
  it('accepts an unchecked side-effect import when native TypeScript accepts it', async () => {
    const driver = await project(), source = 'import "./missing.js"; export class Store {}'; await driver.file('src/store.ts', source);
    expect(driver.nativeDiagnostics()).toEqual([]);
    const query = read(await driver.context.readSnapshot(), 'src/store.ts');
    expect(query.coverage.complete).toBe(true); expect(query.problems).toEqual([]);
  });
  it('honors noCheck in an editable native query', async () => {
    const driver = await project(), source = 'import { missing } from "./missing.js"; export class Store { value = missing; }';
    await driver.file('tsconfig.json', '{"compilerOptions":{"noCheck":true,"types":[]},"files":["src/store.ts"]}'); await driver.file('src/store.ts', source);
    expect(driver.nativeDiagnostics('tsconfig.json')).toEqual([]);
    const query = read(await driver.context.readSnapshot(), 'src/store.ts', 'tsconfig.json');
    expect(query.coverage.complete).toBe(true); expect(query.problems).toEqual([]);
  });
  it('honors an authored suppression in an editable native query', async () => {
    const driver = await project(), source = '// @ts-ignore\nimport { missing } from "./missing.js"; export class Store { value = missing; }'; await driver.file('src/store.ts', source);
    expect(driver.nativeDiagnostics()).toEqual([]);
    const query = read(await driver.context.readSnapshot(), 'src/store.ts');
    expect(query.coverage.complete).toBe(true); expect(query.problems).toEqual([]);
  });
  it('retains native side-effect diagnostics when the project enables them', async () => {
    const driver = await project(), source = 'import "./missing.js"; export class Store {}';
    await driver.file('src/store.ts', source);
    await driver.file('tsconfig.json', '{"compilerOptions":{"noUncheckedSideEffectImports":true,"types":[]},"files":["src/store.ts"]}');
    const native = driver.nativeDiagnostics('tsconfig.json');
    expect(native).toHaveLength(1); expect(native[0]).toMatchObject({ code: 2307, file: 'src/store.ts' });
    const snapshot = await new TypeScriptContext(driver.context, { configFile: 'tsconfig.json' }).readSnapshot();
    expect(snapshot.problems).toEqual([]); expect(snapshot.complete).toBe(true);
    const query = read(snapshot, 'src/store.ts', 'tsconfig.json'); expect(query.coverage.complete).toBe(false);
    expectLocated(query.problems, 'typescript-2307', 'src/store.ts', source, '"./missing.js"');
    expect(query.problems[0]!.message).toBe(native[0]!.message);
  });
  it('keeps an excluded native extension candidate incomplete', async () => {
    const driver = await project(['node_modules', 'Book.ts']), source = 'import type { Book } from "./Book.js"; export type Title = Book["title"];';
    await driver.file('src/Book.ts', 'export interface Book { title: string }'); await driver.file('src/use.ts', source);
    const snapshot = await new TypeScriptContext(driver.context).readSnapshot(); expect(snapshot.complete).toBe(false);
    expect(snapshot.excluded).toContain('src/Book.ts');
    expectLocated(snapshot.problems, 'native-input-unavailable', 'src/use.ts', source, '"./Book.js"');
  });
  it('keeps an excluded rootDirs lookup incomplete using actual native candidates', async () => {
    const driver = await project(['node_modules', 'generated']), source = 'import type { Book } from "./Book.js"; export type Title = Book["title"];';
    await driver.file('generated/Book.ts', 'export interface Book { title: string }'); await driver.file('src/use.ts', source);
    await driver.file('tsconfig.json', '{"compilerOptions":{"rootDirs":["src","generated"],"types":[]},"include":["src/*.ts"]}');
    const snapshot = await new TypeScriptContext(driver.context, { configFile: 'tsconfig.json' }).readSnapshot(); expect(snapshot.complete).toBe(false);
    expect(snapshot.excluded).toContain('generated');
    expectLocated(snapshot.problems, 'native-input-unavailable', 'src/use.ts', source, '"./Book.js"');
  });
  it('keeps a read-only declaration import into missing editable source incomplete', async () => {
    const driver = await project();
    const declaration = 'export type { Book } from "../../src/Book.js";';
    await driver.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': declaration });
    await driver.file('src/use.ts', 'import type { Book } from "catalog"; export type Title = Book["title"];');
    const snapshot = await new TypeScriptContext(driver.context).readSnapshot(); expect(snapshot.complete).toBe(false);
    expectLocated(snapshot.problems, 'native-input-unavailable', 'node_modules/catalog/index.d.ts', declaration, '"../../src/Book.js"');
  });
});
