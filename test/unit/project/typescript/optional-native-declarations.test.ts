import { afterEach, describe, expect, it } from 'vitest';
import { Compiler, FileProjectWriter, Outputs, SpecificationIdentity, TypeScriptContext, typescriptOutput } from '../../../../src/index.js';
import { NativeContextDriver } from '../../../driver/project/typescript/typescript-context.js';

const projects: NativeContextDriver[] = [];
afterEach(async () => { for (const project of projects.splice(0)) await project.dispose(); });
async function project(): Promise<NativeContextDriver> {
  const driver = new NativeContextDriver(); projects.push(driver); await driver.connect();
  await driver.file('src/book.ts', 'import type { Book } from "catalog"; export const book: Book = { title: "Dune" };');
  return driver;
}
const optional = { peerDependencies: { renderer: '*' }, peerDependenciesMeta: { renderer: { optional: true } } };

describe('native dependency declarations follow the project compiler', { timeout: 30_000 }, () => {
  it('accepts a package-authored suppressed optional type import without installing that peer', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', ...optional }, {
      'index.d.ts': '// @ts-ignore optional peer\nimport type { Renderer } from "renderer";\nexport interface Book { title: string }',
    });
    expect(driver.nativeDiagnostics()).toEqual([]);
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.problems).toEqual([]); expect(captured.complete).toBe(true);
    expect(captured.readOnlyFiles!.map(file => file.path)).toContain('node_modules/catalog/package.json');
    expect(captured.readOnlyFiles!.some(file => file.path.startsWith('node_modules/renderer/'))).toBe(false);
  });
  it('recognizes a suppressed declaration reexport from an optional scoped-package subpath', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'types/index.d.ts', peerDependencies: { '@shop/renderer': '*' }, peerDependenciesMeta: { '@shop/renderer': { optional: true } } }, {
      'types/index.d.ts': '// @ts-ignore optional browser types\nexport * from "@shop/renderer/context";\nexport interface Book { title: string }',
    });
    expect(driver.nativeDiagnostics()).toEqual([]);
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.problems).toEqual([]); expect(captured.complete).toBe(true);
  });
  it('accepts a suppressed declaration without requiring optional-peer metadata', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', peerDependencies: { renderer: '*' } }, {
      'index.d.ts': '// @ts-ignore\nimport type { Renderer } from "renderer";\nexport interface Book { title: string }',
    });
    expect(driver.nativeDiagnostics()).toEqual([]);
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.problems).toEqual([]); expect(captured.complete).toBe(true);
  });
  it('accepts the Playwright-shaped Electron type query without installing Electron', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts' }, {
      'index.d.ts': "// @ts-ignore this will be any if electron is not installed\ntype ElectronType = typeof import('electron');\nexport interface Book { title: string }",
    });
    expect(driver.nativeDiagnostics()).toEqual([]);
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.problems).toEqual([]); expect(captured.complete).toBe(true);
    expect(captured.readOnlyFiles!.some(file => file.path.startsWith('node_modules/electron/'))).toBe(false);
  });
  it('retains the located compiler error for an unsuppressed optional peer import', async () => {
    const driver = await project(), declaration = 'import type { Renderer } from "renderer";\nexport interface Book { title: string }';
    await driver.package('catalog', { types: 'index.d.ts', ...optional }, { 'index.d.ts': declaration });
    const native = driver.nativeDiagnostics();
    expect(native).toHaveLength(1); expect(native[0]).toMatchObject({ code: 2307, file: 'node_modules/catalog/index.d.ts' });
    expect(declaration.slice(native[0]!.start!, native[0]!.start! + native[0]!.length!)).toBe('"renderer"');
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.complete).toBe(false);
    expect(captured.problems).toContainEqual(expect.objectContaining({
      code: 'native-input-unavailable', message: native[0]!.message,
      at: { kind: 'dependency', path: ['typescript', native[0]!.file, native[0]!.start, native[0]!.length] },
    }));
  });
  it('does not require metadata from either the declaration owner or another package', async () => {
    const driver = await project();
    await driver.package('unrelated', { types: 'index.d.ts', ...optional }, { 'index.d.ts': 'export {};' });
    await driver.package('catalog', { types: 'index.d.ts' }, {
      'index.d.ts': '// @ts-ignore\nexport type { Renderer } from "renderer";\nexport interface Book { title: string }',
    });
    expect(driver.nativeDiagnostics()).toEqual([]);
    const captured = await new TypeScriptContext(driver.context, { imports: ['unrelated'] }).readSnapshot();
    expect(captured.problems).toEqual([]); expect(captured.complete).toBe(true);
  });
  it('accepts a suppressed declaration side-effect import accepted by the compiler', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', ...optional }, {
      'index.d.ts': '// @ts-ignore optional peer\nimport "renderer";\nexport interface Book { title: string }',
    });
    expect(driver.nativeDiagnostics()).toEqual([]);
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.problems).toEqual([]); expect(captured.complete).toBe(true);
  });
  it('respects a native suppression in authored project source', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', ...optional }, { 'index.d.ts': 'export interface Book { title: string }' });
    await driver.file('src/missing.ts', '// @ts-ignore optional peer\nimport type { Renderer } from "renderer";\nexport type Value = Renderer;');
    expect(driver.nativeDiagnostics()).toEqual([]);
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.problems).toEqual([]); expect(captured.complete).toBe(true);
  });
  it('accepts a suppressed import in an ambient declaration when the native compiler accepts it', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', ...optional }, {
      'index.d.ts': 'declare module "renderer-adapter" {\n// @ts-ignore\nexport type { Renderer } from "renderer";\n}\ndeclare module "catalog" { export interface Book { title: string } }',
    });
    await driver.file('src/renderer.ts', 'import type { Renderer } from "renderer-adapter"; export type RendererType = Renderer;');
    expect(driver.nativeDiagnostics()).toEqual([]);
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.problems).toEqual([]); expect(captured.complete).toBe(true);
  });
  it('retains a real error when an augmentation targets an unavailable module', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts', ...optional }, {
      'index.d.ts': 'declare module "renderer-adapter" {\n// @ts-ignore\nexport type { Renderer } from "renderer";\n}\nexport interface Book { title: string }',
    });
    const source = 'import type { Renderer } from "renderer-adapter"; export type RendererType = Renderer;';
    await driver.file('src/renderer.ts', source);
    const native = driver.nativeDiagnostics().find(problem => problem.code === 2307 && problem.file === 'src/renderer.ts');
    expect(native).toBeDefined();
    expect(source.slice(native!.start!, native!.start! + native!.length!)).toBe('"renderer-adapter"');
    const captured = await new TypeScriptContext(driver.context).readSnapshot();
    expect(captured.complete).toBe(false);
    expect(captured.problems).toContainEqual(expect.objectContaining({
      code: 'native-input-unavailable', message: native!.message,
      at: { kind: 'dependency', path: ['typescript', native!.file, native!.start, native!.length] },
    }));
  });
  it('cannot adopt an unavailable optional type as a promised Number result', async () => {
    const driver = await project();
    await unavailablePrice(driver);
    expect(driver.nativeDiagnostics()).toEqual([]);
    const result = await adoptPrice(driver);
    expect(result.receipt).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('adoption-contract-mismatch');
  });
  it('still requires the explicit Number contract when native checking is disabled', async () => {
    const driver = await project();
    await unavailablePrice(driver);
    await driver.file('tsconfig.json', '{"compilerOptions":{"noCheck":true,"types":[]},"include":["src/**/*.ts"]}');
    expect(driver.nativeDiagnostics('tsconfig.json')).toEqual([]);
    const result = await adoptPrice(driver, 'tsconfig.json');
    expect(result.receipt).toBeUndefined(); expect(result.problems.map(problem => problem.code)).toContain('adoption-contract-mismatch');
  });
});

async function unavailablePrice(driver: NativeContextDriver): Promise<void> {
  await driver.package('catalog', { types: 'index.d.ts', ...optional }, {
    'index.d.ts': '// @ts-ignore optional peer\nimport type { Renderer } from "renderer";\nexport type Value = Renderer;\nexport interface Book { title: string }',
  });
  await driver.file('src/price.ts', 'import type { Value } from "catalog";\nexport function price(): Value { return undefined; }');
}
async function adoptPrice(driver: NativeContextDriver, configFile?: string) {
  const checked = new Compiler().compile({ source: { sourceId: 'main.expec', text: 'function price() returns Number' }, locator: 'main', dependencies: { modules: [], packages: [] } });
  expect(checked.value).toBeDefined(); let sequence = 0;
  const identities = new SpecificationIdentity(() => 'optional-' + ++sequence), identified = identities.associate(checked.value!);
  const price = [...checked.value!.inspection.query('function')][0]!;
  const mapped = identities.withArtifacts(identified.value!, [{ specId: identified.value!.id(price.id), locator: {
    outputId: 'typescript', format: 'typescript-symbol-1', value: { file: 'src/price.ts', declaration: [{ kind: 'function', name: 'price' }] },
  } }]);
  const context = new TypeScriptContext(driver.context, configFile ? { configFile } : {}), outputs = new Outputs(); outputs.register(typescriptOutput);
  const opened = outputs.open('typescript', { directory: 'src', adoptExisting: true, ...(configFile ? { configFile } : {}) },
    context, new FileProjectWriter(context), { workspaceModules: ['main'] });
  return opened.value!.create(mapped.value!);
}
